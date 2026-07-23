import { Pool } from 'mysql2/promise';

export const migration = {
  name: '20260723_add_distribution_config',
  up: async (pool: Pool): Promise<void> => {
    // Insérer les configurations de distribution si elles n'existent pas
    await pool.execute(`
      INSERT IGNORE INTO config (cle, valeur, updated_at) 
      VALUES 
        ('distribution_mode', 'auto', UNIX_TIMESTAMP()),
        ('distribution_max_total', '2', UNIX_TIMESTAMP())
    `);
  },
  down: async (pool: Pool): Promise<void> => {
    await pool.execute("DELETE FROM config WHERE cle IN ('distribution_mode', 'distribution_max_total')");
  }
};
