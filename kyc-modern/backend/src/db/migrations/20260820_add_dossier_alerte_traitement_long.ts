import type { Pool } from 'mysql2/promise';

// ============================================================================
// Alerte superviseur : un dossier dont le traitement a DÉMARRÉ
// (`traitement_demarre_le`, posée une seule fois à la première ouverture —
// voir 20260817_add_dossier_traitement_demarre_le.ts) et qui n'est TOUJOURS
// PAS finalisé (statut encore 'en_cours', ni accepté ni rejeté) après
// `alerte_traitement_sec` (config, défaut 300s / 5 min) doit remonter une
// alerte au superviseur.
//
// Distinct du filet de sécurité de utils/distribution.ts : ce dernier
// REQUEUE le dossier (le retire à l'agent) en se basant sur l'ABSENCE
// d'activité (`derniere_activite_le`). Ici, l'agent peut très bien être
// actif (il tape dans le formulaire GSM, ping régulier) sans jamais valider
// — ce n'est pas un abandon, c'est un traitement anormalement long, qui
// mérite une alerte plutôt qu'une reprise automatique. Les deux mécanismes
// sont indépendants et peuvent se déclencher l'un sans l'autre.
//
// `alerte_superviseur_le` : horodatage d'ENVOI de l'alerte, sert de garde
// d'idempotence (on ne notifie qu'une fois par traitement) — remis à NULL
// à chaque nouvelle attribution du dossier, comme `traitement_demarre_le`
// et `derniere_activite_le` (voir db/locks.ts).
// ============================================================================

export const migration = {
  name: '20260820_add_dossier_alerte_traitement_long',

  async up(pool: Pool): Promise<void> {
    const [columnsRaw] = await pool.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dossiers' AND COLUMN_NAME = 'alerte_superviseur_le'`
    );
    const exists = (columnsRaw as Array<{ COLUMN_NAME: string }>).length > 0;

    if (!exists) {
      await pool.execute(
        `ALTER TABLE dossiers ADD COLUMN alerte_superviseur_le BIGINT DEFAULT NULL`
      );
    }

    // Log persistant : garantit que l'alerte reste visible au superviseur
    // même s'il n'avait aucun onglet ouvert au moment de l'émission SSE
    // (le SSE est du "best effort", pas un canal fiable/rejouable).
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS alertes_traitement_long (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        dossier_id VARCHAR(64) NOT NULL,
        agent_saisie VARCHAR(32) NOT NULL,
        traitement_demarre_le BIGINT NOT NULL,
        cree_le BIGINT NOT NULL,
        vue_le BIGINT DEFAULT NULL,
        vue_par VARCHAR(32) DEFAULT NULL,
        INDEX idx_dossier (dossier_id),
        INDEX idx_vue (vue_le)
      )
    `);
  },

  async down(pool: Pool): Promise<void> {
    await pool.execute(`DROP TABLE IF EXISTS alertes_traitement_long`).catch(() => {});
    await pool.execute(`ALTER TABLE dossiers DROP COLUMN alerte_superviseur_le`).catch(() => {});
  },
};
