import type { Pool } from 'mysql2/promise';

type ColumnInfo = { COLUMN_NAME: string };

type IndexInfo = { Key_name: string };

export const migration = {
  name: '20260728_fix_presence_schema',
  up: async (pool: Pool): Promise<void> => {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS presence (
        matricule VARCHAR(50) NOT NULL,
        statut ENUM('online', 'pause', 'offline') NOT NULL DEFAULT 'offline',
        ts BIGINT NOT NULL DEFAULT 0,
        pause_debut BIGINT DEFAULT NULL,
        dispo_depuis BIGINT DEFAULT NULL,
        updated_at BIGINT NOT NULL DEFAULT 0,
        PRIMARY KEY (matricule),
        INDEX idx_statut_ts (statut, ts),
        INDEX idx_dispo_depuis (dispo_depuis)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [columnsRaw] = await pool.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'presence'`
    );
    const columns = (columnsRaw as ColumnInfo[]).map(column => column.COLUMN_NAME);

    if (!columns.includes('matricule')) {
      if (columns.includes('nom')) {
        await pool.execute(`ALTER TABLE presence CHANGE COLUMN nom matricule VARCHAR(50) NOT NULL`);
      } else {
        await pool.execute(`ALTER TABLE presence ADD COLUMN matricule VARCHAR(50) NOT NULL`);
      }
    }

    if (!columns.includes('statut')) {
      await pool.execute(`ALTER TABLE presence ADD COLUMN statut ENUM('online', 'pause', 'offline') NOT NULL DEFAULT 'offline'`);
    }

    if (!columns.includes('ts')) {
      await pool.execute(`ALTER TABLE presence ADD COLUMN ts BIGINT NOT NULL DEFAULT 0`);
    }

    if (!columns.includes('pause_debut')) {
      await pool.execute(`ALTER TABLE presence ADD COLUMN pause_debut BIGINT DEFAULT NULL`);
    }

    if (!columns.includes('dispo_depuis')) {
      await pool.execute(`ALTER TABLE presence ADD COLUMN dispo_depuis BIGINT DEFAULT NULL`);
    }

    if (!columns.includes('updated_at')) {
      await pool.execute(`ALTER TABLE presence ADD COLUMN updated_at BIGINT NOT NULL DEFAULT 0`);
    }

    await pool.execute(`ALTER TABLE presence MODIFY COLUMN matricule VARCHAR(50) NOT NULL`);
    await pool.execute(`ALTER TABLE presence MODIFY COLUMN statut ENUM('online', 'pause', 'offline') NOT NULL DEFAULT 'offline'`);
    await pool.execute(`ALTER TABLE presence MODIFY COLUMN ts BIGINT NOT NULL DEFAULT 0`);
    await pool.execute(`ALTER TABLE presence MODIFY COLUMN pause_debut BIGINT DEFAULT NULL`);
    await pool.execute(`ALTER TABLE presence MODIFY COLUMN dispo_depuis BIGINT DEFAULT NULL`);
    await pool.execute(`ALTER TABLE presence MODIFY COLUMN updated_at BIGINT NOT NULL DEFAULT 0`);

    try {
      await pool.execute(`ALTER TABLE presence ADD PRIMARY KEY (matricule)`);
    } catch (error: any) {
      const code = error?.code;
      if (!['42000', '23000', '1068', 'ER_MULTIPLE_PRI_KEY'].includes(code)) {
        throw error;
      }
    }

    try {
      await pool.execute(`ALTER TABLE presence ADD UNIQUE INDEX idx_presence_matricule (matricule)`);
    } catch (error: any) {
      const code = error?.code;
      if (!['42000', '23000', '1061', 'ER_DUP_KEYNAME'].includes(code)) {
        throw error;
      }
    }

    try {
      await pool.execute(`ALTER TABLE presence ADD INDEX idx_statut_ts (statut, ts)`);
    } catch (error: any) {
      const code = error?.code;
      if (!['42000', '23000', '1061', 'ER_DUP_KEYNAME'].includes(code)) {
        throw error;
      }
    }

    try {
      await pool.execute(`ALTER TABLE presence ADD INDEX idx_dispo_depuis (dispo_depuis)`);
    } catch (error: any) {
      const code = error?.code;
      if (!['42000', '23000', '1061', 'ER_DUP_KEYNAME'].includes(code)) {
        throw error;
      }
    }
  },
  down: async (_pool: Pool): Promise<void> => {
    // Intentionally left empty for safety.
  }
};
