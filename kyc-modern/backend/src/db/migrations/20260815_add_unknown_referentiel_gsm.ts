import type { Pool } from 'mysql2/promise';

export const migration = {
  name: '20260815_add_unknown_referentiel_gsm',

  async up(pool: Pool): Promise<void> {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS unknown_referentiel_values (
        id BIGINT NOT NULL AUTO_INCREMENT,
        agent VARCHAR(50) NULL,
        field_name VARCHAR(100) NOT NULL,
        value VARCHAR(255) NOT NULL,
        gsm_id INT NULL,
        dossier_id VARCHAR(64) NULL,
        created_at BIGINT NOT NULL,
        PRIMARY KEY (id),
        INDEX idx_field (field_name),
        INDEX idx_agent (agent)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  },

  async down(pool: Pool): Promise<void> {
    await pool.execute(`DROP TABLE IF EXISTS unknown_referentiel_values`);
  },
};
