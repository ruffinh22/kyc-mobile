import type { Pool } from 'mysql2/promise';

export const migration = {
  name: '20260729_add_terrain_fcm_tokens',
  up: async (pool: Pool): Promise<void> => {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS terrain_fcm_tokens (
        numero      VARCHAR(32)  NOT NULL PRIMARY KEY,
        fcm_token   VARCHAR(255) NOT NULL,
        updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                  ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  },
  down: async (pool: Pool): Promise<void> => {
    await pool.execute(`DROP TABLE IF EXISTS terrain_fcm_tokens`);
  }
};
