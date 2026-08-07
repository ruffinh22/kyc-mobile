import type { Pool } from 'mysql2/promise';

export const migration = {
  name: '20260807_set_distribution_max_total_1',
  up: async (pool: Pool): Promise<void> => {
    await pool.execute(
      "INSERT INTO config (cle, valeur, updated_at) VALUES ('distribution_max_total', '1', UNIX_TIMESTAMP()) ON DUPLICATE KEY UPDATE valeur = '1', updated_at = UNIX_TIMESTAMP()"
    );
  },
  down: async (pool: Pool): Promise<void> => {
    await pool.execute(
      "UPDATE config SET valeur = '2', updated_at = UNIX_TIMESTAMP() WHERE cle = 'distribution_max_total'"
    );
  },
};
