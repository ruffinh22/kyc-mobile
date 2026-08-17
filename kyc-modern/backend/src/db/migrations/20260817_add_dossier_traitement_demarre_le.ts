import type { Pool } from 'mysql2/promise';

// ============================================================================
// Ajoute `traitement_demarre_le` : horodatage (timestamp Unix, comme
// `assigne_le`) de la toute première fois où l'agent assigné ouvre
// effectivement un dossier précis (voir GET /api/dossiers/:id). Sert de
// signal fin pour le filet de sécurité de utils/distribution.ts : un
// dossier jamais ouvert doit repartir en file dès que le délai d'abandon
// est dépassé, MÊME si l'agent est par ailleurs en ligne (présence
// générale, autre onglet...) — alors qu'un dossier réellement en cours de
// traitement doit rester protégé tant que l'agent donne signe de vie.
// ============================================================================

export const migration = {
  name: '20260817_add_dossier_traitement_demarre_le',

  async up(pool: Pool): Promise<void> {
    const [columnsRaw] = await pool.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dossiers' AND COLUMN_NAME = 'traitement_demarre_le'`
    );
    const exists = (columnsRaw as Array<{ COLUMN_NAME: string }>).length > 0;

    if (!exists) {
      await pool.execute(
        `ALTER TABLE dossiers ADD COLUMN traitement_demarre_le BIGINT DEFAULT NULL`
      );
    }

    await pool.execute(
      `ALTER TABLE dossiers ADD INDEX idx_traitement_demarre_le (traitement_demarre_le)`
    ).catch((err: any) => {
      if (!['1061', 'ER_DUP_KEYNAME'].includes(err?.code)) throw err;
    });
  },

  async down(pool: Pool): Promise<void> {
    await pool.execute(`ALTER TABLE dossiers DROP INDEX idx_traitement_demarre_le`).catch(() => {});
    await pool.execute(`ALTER TABLE dossiers DROP COLUMN traitement_demarre_le`).catch(() => {});
  },
};
