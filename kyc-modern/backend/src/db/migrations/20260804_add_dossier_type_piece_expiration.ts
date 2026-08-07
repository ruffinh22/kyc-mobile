export const migration = {
  name: '20260804_add_dossier_type_piece_expiration',
  async up(pool: any) {
    const statements = [
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS type_piece VARCHAR(50) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS date_expiration VARCHAR(50) DEFAULT NULL",
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
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS date_expiration',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS type_piece',
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
