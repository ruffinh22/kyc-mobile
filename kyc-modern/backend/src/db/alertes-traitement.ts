// ============================================================================
// KYC V4 - Alerte superviseur : traitement démarré non finalisé
// Appelée à chaque cycle du worker de distribution (utils/distribution.ts),
// indépendamment du mode auto/manuel — voir migration
// 20260820_add_dossier_alerte_traitement_long.ts pour le détail du besoin.
// ============================================================================

import { query, exec, nowSec, getConfig } from '../db';
import { RowDataPacket } from 'mysql2';

interface OrphelinRow extends RowDataPacket {
  id: string;
  agent_saisie: string;
  traitement_demarre_le: number;
}

interface SupRow extends RowDataPacket {
  matricule: string;
}

export async function verifierAlertesTraitementLong(): Promise<void> {
  try {
    const maintenant = nowSec();
    const seuilSec = parseInt((await getConfig('alerte_traitement_sec')) ?? '300', 10);
    const seuil = maintenant - Math.max(30, seuilSec);

    const candidats = await query<OrphelinRow>(
      `SELECT id, agent_saisie, traitement_demarre_le FROM dossiers
       WHERE statut='en_cours' AND traitement_demarre_le IS NOT NULL
       AND alerte_superviseur_le IS NULL
       AND traitement_demarre_le <= ?`,
      [seuil]
    );

    if (!candidats.length) return;

    // Chargé une seule fois par cycle, pas par dossier orphelin.
    const superviseurs = await query<SupRow>(
      `SELECT matricule FROM comptes WHERE role IN ('superviseur','admin')`
    );

    for (const c of candidats) {
      // Garde d'idempotence : seul le premier UPDATE gagnant déclenche la
      // notification (protège contre un chevauchement de cycles si le worker
      // venait à tourner plus vite que son intervalle configuré).
      const result = await exec(
        `UPDATE dossiers SET alerte_superviseur_le=? WHERE id=? AND statut='en_cours' AND alerte_superviseur_le IS NULL`,
        [maintenant, c.id]
      );
      if (result.affectedRows !== 1) continue;

      await exec(
        `INSERT INTO alertes_traitement_long (dossier_id, agent_saisie, traitement_demarre_le, cree_le)
         VALUES (?, ?, ?, ?)`,
        [c.id, c.agent_saisie, c.traitement_demarre_le, maintenant]
      );

      try {
        const sse = await import('../utils/sse.js');
        for (const sup of superviseurs) {
          sse.notifier(sup.matricule, 'alerte-traitement-long', {
            dossierId: c.id,
            agent: c.agent_saisie,
            depuisSec: maintenant - c.traitement_demarre_le,
          });
        }
      } catch (e) {
        // SSE best-effort : l'alerte reste de toute façon consultable via
        // GET /api/alertes-traitement (persistée en base ci-dessus).
      }
    }
  } catch (err) {
    console.error('[AlertesTraitementLong] Erreur:', err);
  }
}
