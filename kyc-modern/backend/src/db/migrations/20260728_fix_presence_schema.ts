import type { Pool } from 'mysql2/promise';

export const migration = {
  name: '20260728_fix_presence_schema',
  up: async (pool: Pool): Promise<void> => {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS presence (
        matricule VARCHAR(50) NOT NULL PRIMARY KEY,
        statut ENUM('online', 'pause', 'offline') NOT NULL DEFAULT 'offline',
        ts BIGINT NOT NULL DEFAULT 0,
        pause_debut BIGINT DEFAULT NULL,
        dispo_depuis BIGINT DEFAULT NULL,
        updated_at BIGINT NOT NULL,
        INDEX idx_statut_ts (statut, ts),
        INDEX idx_dispo_depuis (dispo_depuis)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.execute(`
      ALTER TABLE presence
      ADD COLUMN IF NOT EXISTS matricule VARCHAR(50)
    `);

    await pool.execute(`
      ALTER TABLE presence
      MODIFY COLUMN matricule VARCHAR(50) NOT NULL
    `);

    await pool.execute(`
      ALTER TABLE presence
      ADD PRIMARY KEY IF NOT EXISTS (matricule)
    `);

    await pool.execute(`
      ALTER TABLE presence
      ADD COLUMN IF NOT EXISTS statut ENUM('online', 'pause', 'offline') NOT NULL DEFAULT 'offline'
    `);

    await pool.execute(`
      ALTER TABLE presence
      ADD COLUMN IF NOT EXISTS ts BIGINT NOT NULL DEFAULT 0
    `);

    await pool.execute(`
      ALTER TABLE presence
      ADD COLUMN IF NOT EXISTS pause_debut BIGINT DEFAULT NULL
    `);

    await pool.execute(`
      ALTER TABLE presence
      ADD COLUMN IF NOT EXISTS dispo_depuis BIGINT DEFAULT NULL
    `);

    await pool.execute(`
      ALTER TABLE presence
      ADD COLUMN IF NOT EXISTS updated_at BIGINT NOT NULL DEFAULT 0
    `);

    await pool.execute(`
      ALTER TABLE presence
      ADD INDEX IF NOT EXISTS idx_statut_ts (statut, ts)
    `);

    await pool.execute(`
      ALTER TABLE presence
      ADD INDEX IF NOT EXISTS idx_dispo_depuis (dispo_depuis)
    `);
  },
  down: async (_pool: Pool): Promise<void> => {
    // Intentionally left empty for safety.
  }
};
