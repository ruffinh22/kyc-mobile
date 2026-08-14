// ============================================================================
// KYC V4 - Logique de distribution AUTO des dossiers
// Adaptée de kyc-v40 pour MySQL + TypeScript
// Appelée par le worker (toutes les 2s) ET à chaque soumission de dossier
// FIFO strict, max 1 push auto par agent
//
// PATCH 2026-08-08 : l'attribution passe désormais par
// db/locks.ts::appelerProchainDossier(), qui pose un verrou exclusif par
// agent (table agent_dossier_lock, PK matricule) dans la même transaction
// que l'UPDATE du dossier. Avant ce patch, l'exclusion des agents occupés
// se basait sur un simple "NOT IN (SELECT ... WHERE statut='en_cours')"
// relu séparément de l'UPDATE d'attribution : un appel concurrent à
// POST /api/dossiers/appeler (pull, déclenché par le frontend) pouvait
// s'intercaler entre les deux et faire passer un agent déjà servi ici une
// seconde fois — c'est la cause du bug "2 dossiers auto au lieu de 1".
// ============================================================================

import { query, exec, nowSec, getConfig, nextSeq } from '../db';
import { RowDataPacket } from 'mysql2';
import { appelerProchainDossier, releaseAgentLock, reconcileAgentLocks } from '../db/locks';

interface ConfigRow {
  valeur: string;
}

export function shouldRequeueDossier(assignedAt: number | null, now: number, abandonSec: number): boolean {
  if (assignedAt == null) return false;
  const timeoutSec = Math.max(30, abandonSec);
  return now - assignedAt >= timeoutSec;
}

export async function distribuerMaintenant(): Promise<void> {
  try {
    const maintenant = nowSec();
    const abandonSec = parseInt((await getConfig('distribution_abandon_sec')) ?? '120', 10);
    const seuilAbandon = maintenant - Math.max(30, abandonSec);

    // ---- FILET DE SÉCURITÉ (INCONDITIONNEL) ----
    // Doit tourner que distribution_mode soit 'auto' ou non : un dossier
    // abandonné par un agent ne doit JAMAIS rester bloqué à 00:00 juste
    // parce que le mode de distribution automatique est désactivé. C'est
    // la garantie "un dossier non traité dans les temps repart en file",
    // indépendante de la logique de push ci-dessous.

    // Répare tout verrou désynchronisé avant de calculer les agents
    // "libres" plus bas (peu coûteux, tables indexées).
    await reconcileAgentLocks();

    // Récupérer les dossiers en_cours qui ont dépassé le délai d'abandon
    // soit parce que l'agent n'a pas donné signe de vie, soit parce qu'ils
    // sont restés trop longtemps assignés sans action.
    const orphelins = await query<{ id: string; agent_saisie: string | null } & RowDataPacket>(
      `SELECT d.id, d.agent_saisie FROM dossiers d 
       WHERE d.statut='en_cours' AND d.agent_saisie IS NOT NULL
       AND (
         (d.assigne_le IS NOT NULL AND d.assigne_le <= ?)
         OR (d.assigne_le IS NULL AND d.updated_at IS NOT NULL AND d.updated_at <= ?)
         OR d.agent_saisie NOT IN (
           SELECT matricule FROM presence WHERE ts >= ?
         )
       )`,
      [seuilAbandon, seuilAbandon, seuilAbandon]
    );

    for (const o of orphelins) {
      await exec(
        `UPDATE dossiers 
         SET statut='en_attente', assigne_a=NULL, agent_saisie=NULL,
             assigne_le=NULL, heure_prise=NULL, updated_at=? 
         WHERE id=? AND statut='en_cours'`,
        [maintenant, o.id]
      );
      // Le dossier n'est plus en_cours pour cet agent : on libère son verrou
      // pour qu'il redevienne immédiatement éligible à une nouvelle attribution.
      if (o.agent_saisie) await releaseAgentLock(o.agent_saisie);
    }
    // ---- fin filet ----

    // ---- PUSH AUTOMATIQUE (gated par distribution_mode='auto') ----
    // Seule la distribution proactive vers les agents libres est
    // conditionnée au mode auto ; le filet de sécurité ci-dessus, lui,
    // s'est déjà exécuté quel que soit le mode.
    const configs = await query<ConfigRow & RowDataPacket>("SELECT valeur FROM config WHERE cle='distribution_mode'");
    if (!configs.length || configs[0].valeur !== 'auto') return;

    const intervalMs = parseInt((await getConfig('distribution_interval_ms')) ?? '2000', 10);
    const limite = maintenant - Math.max(30, Math.floor(abandonSec / 2));
    const intervalSec = Math.max(1, Math.floor(intervalMs / 1000));

    // Poser dispo_depuis et dispo_seq pour les agents devenus éligibles.
    // On lit la liste et on assigne un `dispo_seq` atomique par agent via
    // `nextSeq('dispo_seq')` pour garantir un ordre FIFO déterministe.
    const candidats = await query<{ matricule: string } & RowDataPacket>(
      `SELECT matricule FROM presence
       WHERE statut='online' AND ts >= ? AND dispo_depuis IS NULL
       AND matricule NOT IN (
         SELECT agent_saisie FROM dossiers WHERE statut='en_cours' AND agent_saisie IS NOT NULL
       )`,
      [limite]
    );

    for (const c of candidats) {
      try {
        const seq = await nextSeq('dispo_seq');
        await exec(
          `UPDATE presence SET dispo_depuis = ?, dispo_seq = ?
           WHERE matricule = ? AND dispo_depuis IS NULL`,
          [maintenant, seq, c.matricule]
        );
      } catch (e) {
        // Ignorer les erreurs individuelles; le worker réessaiera au prochain cycle
      }
    }

    // Le worker ne relance pas la distribution plus vite que l'intervalle configuré.
    if (intervalSec > 1) {
      await exec(
        `UPDATE dossiers SET updated_at=? WHERE statut='en_attente' AND updated_at < ?`,
        [maintenant, maintenant - intervalSec]
      );
    }

    // Effacer dispo_depuis et dispo_seq pour les non éligibles
    await exec(
      `UPDATE presence 
       SET dispo_depuis = NULL, dispo_seq = NULL
       WHERE dispo_depuis IS NOT NULL AND (
         statut!='online' OR ts < ? OR matricule IN (
           SELECT agent_saisie FROM dossiers WHERE statut='en_cours' AND agent_saisie IS NOT NULL
         )
       )`,
      [limite]
    );

    // Agents disponibles, FIFO — tri déterministe par `dispo_seq`, fallback sur `dispo_depuis`.
    const agents = await query<{ matricule: string } & RowDataPacket>(
      `SELECT matricule FROM presence 
       WHERE statut='online' AND ts >= ? AND dispo_depuis IS NOT NULL 
       AND matricule NOT IN (
         SELECT agent_saisie FROM dossiers WHERE statut='en_cours' AND agent_saisie IS NOT NULL
       )
       ORDER BY (dispo_seq IS NULL), dispo_seq ASC, dispo_depuis ASC`,
      [limite]
    );

    for (const ag of agents) {
      // appelerProchainDossier pose le verrou ET assigne le dossier dans une
      // seule transaction. Si un pull concurrent (POST /api/dossiers/appeler)
      // a entre-temps servi cet agent, le verrou existe déjà et l'attribution
      // échoue proprement (result: 'agent_occupe') au lieu de créer un
      // deuxième dossier en_cours pour lui.
      const res = await appelerProchainDossier(ag.matricule);
      if (res.result !== 'ok') continue;

      // Attribution réussie: l'agent devient occupé — effacer dispo_depuis et dispo_seq
      await exec("UPDATE presence SET dispo_depuis=NULL, dispo_seq=NULL WHERE matricule=?", [ag.matricule]);

      // Notifier via SSE
      try {
        const sse = await import('../utils/sse.js');
        sse.notifier(ag.matricule, 'nouveau-dossier', { id: res.dossierId });
      } catch (e) {}
    }
  } catch (err) {
    // Silencieux : le worker réessaiera au prochain cycle
    console.error('[Distribution] Erreur:', err);
  }
}