// ============================================================================
// KYC V4 – Verrou d'attribution par agent
// ============================================================================
// Garantit l'invariant "1 seul dossier en_cours par agent" de façon atomique,
// quel que soit le chemin d'attribution : push automatique (utils/distribution.ts),
// pull agent (POST /api/dossiers/appeler), prise manuelle d'un dossier précis
// (POST /api/dossiers/:id/prendre), ou transfert superviseur.
//
// Principe : `agent_dossier_lock.matricule` est PRIMARY KEY. Un agent ne peut
// donc avoir qu'UNE seule ligne à un instant T. Toute attribution passe par
// une transaction qui (1) essaie d'INSERT le verrou, (2) si ça réussit, met à
// jour le dossier. Si l'agent a déjà un verrou, l'INSERT échoue immédiatement
// sur la contrainte UNIQUE — même si deux requêtes concurrentes (le worker de
// distribution ET une requête /appeler du frontend) arrivent au même instant,
// une seule peut gagner la course : InnoDB sérialise les deux INSERT sur la
// même clé primaire.
//
// C'est ce qui manquait avant : le contrôle "SELECT COUNT(*) ... < maxTotal"
// était une lecture séparée de l'UPDATE d'attribution (race condition
// classique de type check-then-act), et le worker de distribution ne
// partageait aucun état avec la route /appeler.
// ============================================================================

import { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getPool, nowSec } from './index';

const DUPLICATE_ENTRY = 'ER_DUP_ENTRY';

function nowHHMM(): string {
  return new Date().toTimeString().slice(0, 5);
}

// ── Libération ──────────────────────────────────────────────────────────────

/**
 * Libère le verrou d'un agent. À appeler PARTOUT où un dossier quitte l'état
 * en_cours pour cet agent : accepter, rejeter, pause (remise en file),
 * expiration/timeout, reprise système.
 * Idempotent : ne fait rien si l'agent n'a pas de verrou.
 */
export async function releaseAgentLock(matricule: string): Promise<void> {
  await getPool().execute('DELETE FROM agent_dossier_lock WHERE matricule = ?', [matricule]);
}

// ── Attribution automatique (push, utilisé par utils/distribution.ts) ───────

export type AppelResult =
  | { result: 'ok'; dossierId: string; numeroMtn: string }
  | { result: 'agent_occupe' }
  | { result: 'aucun_dossier' };

/**
 * Réserve le "droit d'attribution" de l'agent (verrou), puis lui assigne le
 * plus ancien dossier en_attente, le tout dans une transaction unique.
 * Utilise SELECT ... FOR UPDATE SKIP LOCKED pour que deux agents demandant
 * en même temps ne se bloquent pas mutuellement et ne collisionnent jamais
 * sur le même dossier (remplace l'ancienne boucle de "5 essais anti-collision").
 */
export async function appelerProchainDossier(matricule: string): Promise<AppelResult> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    // 1) Réservation exclusive : échoue immédiatement si l'agent a déjà un
    //    dossier en_cours (verrou existant), qu'il ait été posé par le worker
    //    de distribution, par un appel /appeler concurrent, ou autre.
    try {
      await conn.execute(
        'INSERT INTO agent_dossier_lock (matricule, dossier_id, created_at) VALUES (?, ?, ?)',
        [matricule, '', nowSec()]
      );
    } catch (err: any) {
      await conn.rollback();
      if (err?.code === DUPLICATE_ENTRY) return { result: 'agent_occupe' };
      throw err;
    }

    // 2) Le plus ancien dossier disponible, verrouillé pour cette transaction
    //    seulement (SKIP LOCKED laisse les autres agents piocher un autre
    //    dossier sans attendre).
    const [candidats] = await conn.execute(
      `SELECT id, numero_mtn FROM dossiers
       WHERE statut = 'en_attente'
       ORDER BY created_at ASC
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    ) as [RowDataPacket[], any];

    if (!candidats.length) {
      await conn.rollback();
      return { result: 'aucun_dossier' };
    }

    const dossier = candidats[0] as unknown as { id: string; numero_mtn: string };
    const maintenant = nowSec();

    await conn.execute(
      `UPDATE dossiers
       SET statut='en_cours', agent_saisie=?, assigne_a=?, assigne_le=?,
           heure_prise=?, updated_at=?
       WHERE id=? AND statut='en_attente'`,
      [matricule, matricule, maintenant, nowHHMM(), maintenant, dossier.id]
    );
    await conn.execute(
      'UPDATE agent_dossier_lock SET dossier_id = ? WHERE matricule = ?',
      [dossier.id, matricule]
    );

    await conn.commit();
    return { result: 'ok', dossierId: dossier.id, numeroMtn: dossier.numero_mtn };
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    conn.release();
  }
}

// ── Prise manuelle d'un dossier précis (POST /api/dossiers/:id/prendre) ─────

export type PrendreResult = 'ok' | 'agent_occupe' | 'dossier_indisponible';

/**
 * Même principe que appelerProchainDossier, mais pour un dossier ciblé par
 * son id (bouton "Prendre" sur un dossier précis de la file). L'ancienne
 * route /prendre ne vérifiait AUCUNE limite par agent — cette fonction ferme
 * aussi ce trou.
 */
export async function prendreDossierSpecifique(matricule: string, dossierId: string): Promise<PrendreResult> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    try {
      await conn.execute(
        'INSERT INTO agent_dossier_lock (matricule, dossier_id, created_at) VALUES (?, ?, ?)',
        [matricule, dossierId, nowSec()]
      );
    } catch (err: any) {
      await conn.rollback();
      if (err?.code === DUPLICATE_ENTRY) return 'agent_occupe';
      throw err;
    }

    const maintenant = nowSec();
    const [result] = await conn.execute(
      `UPDATE dossiers
       SET statut='en_cours', agent_saisie=?, assigne_a=?, assigne_le=?, heure_prise=?, updated_at=?
       WHERE id=? AND statut='en_attente'`,
      [matricule, matricule, maintenant, nowHHMM(), maintenant, dossierId]
    ) as [ResultSetHeader, any];

    if (result.affectedRows !== 1) {
      await conn.rollback();
      return 'dossier_indisponible';
    }

    await conn.commit();
    return 'ok';
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    conn.release();
  }
}

// ── Transfert superviseur (POST /api/dossiers/:id/transferer) ───────────────

export type TransferResult = 'ok' | 'cible_occupee' | 'introuvable';

/**
 * Transfère un dossier vers `cible`. Refuse si `cible` a déjà un dossier
 * en_cours (préserve l'invariant côté agent cible aussi) plutôt que de créer
 * silencieusement une seconde attribution pour lui.
 */
export async function transferDossierToAgent(
  dossierId: string,
  cible: string,
  extra: { message?: string | null; transferePar: string }
): Promise<TransferResult> {
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute(
      'SELECT id, agent_saisie FROM dossiers WHERE id = ? LIMIT 1 FOR UPDATE',
      [dossierId]
    ) as [RowDataPacket[], any];
    if (!rows.length) {
      await conn.rollback();
      return 'introuvable';
    }
    const ancienAgent = (rows[0] as any).agent_saisie as string | null;

    try {
      await conn.execute(
        'INSERT INTO agent_dossier_lock (matricule, dossier_id, created_at) VALUES (?, ?, ?)',
        [cible, dossierId, nowSec()]
      );
    } catch (err: any) {
      await conn.rollback();
      if (err?.code === DUPLICATE_ENTRY) return 'cible_occupee';
      throw err;
    }

    if (ancienAgent && ancienAgent !== cible) {
      await conn.execute('DELETE FROM agent_dossier_lock WHERE matricule = ?', [ancienAgent]);
    }

    const maintenant = nowSec();
    await conn.execute(
      `UPDATE dossiers
       SET statut='en_cours', agent_saisie=?, assigne_a=?, assigne_le=?, heure_prise=?,
           transfert_message=?, transfert_par=?, updated_at=?
       WHERE id=?`,
      [cible, cible, maintenant, nowHHMM(), extra.message ?? null, extra.transferePar, maintenant, dossierId]
    );

    await conn.commit();
    return 'ok';
  } catch (err) {
    try { await conn.rollback(); } catch {}
    throw err;
  } finally {
    conn.release();
  }
}

// ── Filet de sécurité : réconciliation périodique ────────────────────────────

/**
 * Resynchronise agent_dossier_lock avec la réalité de `dossiers`. Répare tout
 * verrou qui aurait pu se désynchroniser (release oublié quelque part, crash
 * en plein milieu d'une transaction externe non couverte par ce module,
 * déploiement, etc). Idempotente, peu coûteuse (tables indexées) — appelée au
 * démarrage du serveur et à chaque cycle du worker de distribution.
 *
 * Ne "fusionne" pas deux dossiers en_cours existants pour un même agent (ça,
 * seule la migration de réparation ponctuelle le fait) : elle part du principe
 * que l'invariant est déjà respecté et ne fait que réparer les verrous.
 */
export async function reconcileAgentLocks(): Promise<void> {
  const pool = getPool();

  await pool.execute(`
    DELETE l FROM agent_dossier_lock l
    LEFT JOIN dossiers d
      ON d.id = l.dossier_id AND d.agent_saisie = l.matricule AND d.statut = 'en_cours'
    WHERE d.id IS NULL
  `);

  await pool.execute(
    `INSERT IGNORE INTO agent_dossier_lock (matricule, dossier_id, created_at)
     SELECT d.agent_saisie, d.id, ?
     FROM dossiers d
     LEFT JOIN agent_dossier_lock l ON l.matricule = d.agent_saisie
     WHERE d.statut = 'en_cours' AND d.agent_saisie IS NOT NULL AND l.matricule IS NULL`,
    [nowSec()]
  );
}
