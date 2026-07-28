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

    // For older MySQL versions that don't support "IF NOT EXISTS" on ALTER
    // check information_schema and apply only the missing changes.
    const [[hasMatricule]]: any = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='presence' AND COLUMN_NAME='matricule'`
    );
    if (hasMatricule.c === 0) {
      await pool.execute(`ALTER TABLE presence ADD COLUMN matricule VARCHAR(50)`);
    }

    // Ensure matricule is NOT NULL
    await pool.execute(`ALTER TABLE presence MODIFY COLUMN matricule VARCHAR(50) NOT NULL`);

    const [[hasPK]]: any = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='presence' AND CONSTRAINT_TYPE='PRIMARY KEY'`
    );
    if (hasPK.c === 0) {
      await pool.execute(`ALTER TABLE presence ADD PRIMARY KEY (matricule)`);
    }

    const colsToEnsure: Array<{ name: string; def: string }> = [
      { name: 'statut', def: "ENUM('online', 'pause', 'offline') NOT NULL DEFAULT 'offline'" },
      { name: 'ts', def: 'BIGINT NOT NULL DEFAULT 0' },
      { name: 'pause_debut', def: 'BIGINT DEFAULT NULL' },
      { name: 'dispo_depuis', def: 'BIGINT DEFAULT NULL' },
      { name: 'updated_at', def: 'BIGINT NOT NULL DEFAULT 0' },
    ];

    for (const col of colsToEnsure) {
      const [[exists]]: any = await pool.query(
        `SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='presence' AND COLUMN_NAME=?`,
        [col.name]
      );
      if (exists.c === 0) {
        await pool.execute(`ALTER TABLE presence ADD COLUMN ${col.name} ${col.def}`);
      }
    }

    // Indexes
    const [[hasIdx1]]: any = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='presence' AND INDEX_NAME='idx_statut_ts'`
    );
    if (hasIdx1.c === 0) {
      await pool.execute(`ALTER TABLE presence ADD INDEX idx_statut_ts (statut, ts)`);
    }

    const [[hasIdx2]]: any = await pool.query(
      `SELECT COUNT(*) AS c FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='presence' AND INDEX_NAME='idx_dispo_depuis'`
    );
    if (hasIdx2.c === 0) {
      await pool.execute(`ALTER TABLE presence ADD INDEX idx_dispo_depuis (dispo_depuis)`);
    }
  },
  down: async (_pool: Pool): Promise<void> => {
    // Intentionally left empty for safety.
  }
};
