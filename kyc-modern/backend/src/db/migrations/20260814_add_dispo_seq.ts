import type { Pool } from 'mysql2/promise';

// ============================================================================
// Ajoute `dispo_seq` pour ordonner de façon déterministe les agents devenus
// éligibles en même seconde. Utilise la table `seq_counter` (idiome
// UPDATE ... LAST_INSERT_ID(...)) pour obtenir un compteur atomique.
// ============================================================================

export const migration = {
  name: '20260814_add_dispo_seq',

  async up(pool: Pool): Promise<void> {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS seq_counter (
        id VARCHAR(50) NOT NULL PRIMARY KEY,
        value BIGINT NOT NULL DEFAULT 0
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    await pool.execute(
      `INSERT IGNORE INTO seq_counter (id, value) VALUES ('dispo_seq', 0)`
    );

    await pool.execute(`
      ALTER TABLE presence
      ADD COLUMN dispo_seq BIGINT DEFAULT NULL
    `).catch((err: any) => {
      if (err?.code !== 'ER_DUP_FIELDNAME') throw err;
    });

    await pool.execute(`
      ALTER TABLE presence
      ADD INDEX idx_dispo_seq (dispo_seq)
    `).catch((err: any) => {
      if (!['1061', 'ER_DUP_KEYNAME'].includes(err?.code)) throw err;
    });
  },

  async down(pool: Pool): Promise<void> {
    await pool.execute(`ALTER TABLE presence DROP INDEX idx_dispo_seq`).catch(() => {});
    await pool.execute(`ALTER TABLE presence DROP COLUMN dispo_seq`).catch(() => {});
    await pool.execute(`DROP TABLE IF EXISTS seq_counter`).catch(() => {});
  },
};
