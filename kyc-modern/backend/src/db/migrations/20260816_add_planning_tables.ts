import type { Pool } from 'mysql2/promise';

export const migration = {
  name: '20260816_add_planning_tables',
  up: async (pool: Pool): Promise<void> => {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS planning (
        id VARCHAR(255) NOT NULL,
        matricule VARCHAR(50) DEFAULT NULL,
        nom VARCHAR(255) DEFAULT NULL,
        statut VARCHAR(100) DEFAULT NULL,
        quartier VARCHAR(255) DEFAULT NULL,
        date DATE NOT NULL,
        type VARCHAR(100) DEFAULT NULL,
        horaire VARCHAR(100) DEFAULT NULL,
        heure_debut VARCHAR(20) DEFAULT NULL,
        heure_fin VARCHAR(20) DEFAULT NULL,
        activite VARCHAR(255) DEFAULT NULL,
        lieu VARCHAR(255) DEFAULT NULL,
        updated_at BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        INDEX idx_planning_matricule_date (matricule, date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS planning_managers (
        id INT NOT NULL AUTO_INCREMENT,
        semaine VARCHAR(50) NOT NULL,
        titre VARCHAR(255) DEFAULT NULL,
        data LONGTEXT DEFAULT NULL,
        updated_at BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (id),
        UNIQUE KEY uniq_planning_managers_semaine (semaine)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  },
  down: async (pool: Pool): Promise<void> => {
    await pool.execute('DROP TABLE IF EXISTS planning');
    await pool.execute('DROP TABLE IF EXISTS planning_managers');
  }
};
