import { Pool } from 'mysql2/promise';

export const migration = {
  name: '20260723_add_presence_table',
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
  },
  down: async (pool: Pool): Promise<void> => {
    await pool.execute('DROP TABLE IF EXISTS presence');
  }
};
