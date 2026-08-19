import type { Pool } from 'mysql2/promise';

// ============================================================================
// Ajoute `derniere_activite_le` : horodatage (timestamp Unix) du DERNIER
// signe de vie de l'agent SUR CE DOSSIER PRÉCIS. Distincte de
// `traitement_demarre_le` (posée UNE SEULE FOIS, à la toute première
// ouverture — voir 20260817_add_dossier_traitement_demarre_le.ts) :
// `derniere_activite_le` est au contraire rafraîchie à CHAQUE signal
// d'activité (ouverture du dossier, sauvegarde réelle, ping dédié pendant la
// saisie GSM, clic "Appeler terrain"...), tant que le dossier reste en_cours.
//
// Remplace la dépendance à la présence générale (table `presence`,
// heartbeat ping-dispo global toutes les 20s, indépendant de l'écran
// affiché) dans le filet de sécurité de utils/distribution.ts : un agent
// "en ligne" ailleurs (autre onglet, pause café avec la session ouverte...)
// ne doit plus jamais protéger indéfiniment un dossier qu'il n'a pas
// concrètement touché depuis `abandonSec`. Voir dossiers.ts (GET /:id et
// POST /:id/activite) pour les points d'écriture, et utils/distribution.ts
// pour la lecture (COALESCE(derniere_activite_le, assigne_le)).
// ============================================================================

export const migration = {
  name: '20260819_add_dossier_derniere_activite_le',

  async up(pool: Pool): Promise<void> {
    const [columnsRaw] = await pool.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dossiers' AND COLUMN_NAME = 'derniere_activite_le'`
    );
    const exists = (columnsRaw as Array<{ COLUMN_NAME: string }>).length > 0;

    if (!exists) {
      await pool.execute(
        `ALTER TABLE dossiers ADD COLUMN derniere_activite_le BIGINT DEFAULT NULL`
      );
    }

    await pool.execute(
      `ALTER TABLE dossiers ADD INDEX idx_derniere_activite_le (derniere_activite_le)`
    ).catch((err: any) => {
      if (!['1061', 'ER_DUP_KEYNAME'].includes(err?.code)) throw err;
    });
  },

  async down(pool: Pool): Promise<void> {
    await pool.execute(`ALTER TABLE dossiers DROP INDEX idx_derniere_activite_le`).catch(() => {});
    await pool.execute(`ALTER TABLE dossiers DROP COLUMN derniere_activite_le`).catch(() => {});
  },
};
