import type { Pool } from 'mysql2/promise';

export const migration = {
  name: '20260803_add_distribution_timing_config',
  async up(pool: Pool): Promise<void> {
    await pool.execute(`
      INSERT INTO config (cle, valeur, updated_at)
      VALUES
        ('distribution_interval_ms', '2000', UNIX_TIMESTAMP()),
        ('distribution_abandon_sec', '120', UNIX_TIMESTAMP())
      ON DUPLICATE KEY UPDATE valeur = VALUES(valeur), updated_at = VALUES(updated_at)
    `);
  },
  async down(pool: Pool): Promise<void> {
    await pool.execute("DELETE FROM config WHERE cle IN ('distribution_interval_ms', 'distribution_abandon_sec')");
  },
};
