export const migration = {
  name: '20260722_add_liveness_columns',
  async up(pool: any) {
    const statements = [
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS liveness_status VARCHAR(20) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS liveness_confidence DECIMAL(5,2) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS liveness_verifie_le INT UNSIGNED DEFAULT NULL",
    ];
    for (const statement of statements) {
      try {
        await pool.execute(statement);
      } catch (err: any) {
        if (err?.code !== 'ER_DUP_FIELDNAME' && err?.code !== 'ER_PARSE_ERROR') {
          throw err;
        }
      }
    }
  },
  async down(pool: any) {
    const statements = [
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS liveness_verifie_le',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS liveness_confidence',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS liveness_status',
    ];
    for (const statement of statements) {
      try {
        await pool.execute(statement);
      } catch {
        // ignore rollback failures
      }
    }
  },
};
