import type { Pool } from 'mysql2/promise';

type ColumnInfo = { COLUMN_NAME: string };
type IndexInfo = { Key_name: string };

async function getPresenceColumns(pool: Pool): Promise<string[]> {
  const [columnsRaw] = await pool.execute(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'presence'
  `);

  return (columnsRaw as ColumnInfo[]).map(column => column.COLUMN_NAME);
}

async function hasIndex(pool: Pool, indexName: string): Promise<boolean> {
  const [indexesRaw] = await pool.execute(`SHOW INDEX FROM presence`);
  const indexes = indexesRaw as IndexInfo[];

  return indexes.some(index => index.Key_name === indexName);
}

export const migration = {
  name: '20260723_fix_presence_matricule',
  up: async (pool: Pool): Promise<void> => {
    const columns = await getPresenceColumns(pool);

    if (!columns.includes('matricule')) {
      if (columns.includes('nom')) {
        await pool.execute(`
          ALTER TABLE presence
          CHANGE COLUMN nom matricule VARCHAR(30) NOT NULL
        `);
      } else {
        await pool.execute(`
          ALTER TABLE presence
          ADD COLUMN matricule VARCHAR(30) NOT NULL
        `);
      }
    }

    if (!await hasIndex(pool, 'idx_matricule')) {
      try {
        await pool.execute(`
          ALTER TABLE presence
          ADD UNIQUE INDEX idx_matricule (matricule)
        `);
      } catch (error: any) {
        if (!['42000', '23000', '1061'].includes(error?.code)) {
          throw error;
        }
      }
    }
  },
  down: async (pool: Pool): Promise<void> => {
    const columns = await getPresenceColumns(pool);

    if (columns.includes('matricule') && !columns.includes('nom')) {
      await pool.execute(`
        ALTER TABLE presence
        CHANGE COLUMN matricule nom VARCHAR(30) NOT NULL
      `);
    }

    if (await hasIndex(pool, 'idx_matricule')) {
      await pool.execute(`
        ALTER TABLE presence
        DROP INDEX idx_matricule
      `);
    }
  }
};
