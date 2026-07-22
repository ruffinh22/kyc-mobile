export const migration = {
  name: '20260721_add_phone_verification_columns',
  async up(pool: any) {
    const statements = [
      "ALTER TABLE comptes ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20) DEFAULT NULL",
      "ALTER TABLE comptes ADD COLUMN IF NOT EXISTS phone_verified_at INT UNSIGNED DEFAULT NULL",
      "ALTER TABLE comptes ADD COLUMN IF NOT EXISTS phone_verification_code VARCHAR(20) DEFAULT NULL",
      "ALTER TABLE comptes ADD COLUMN IF NOT EXISTS phone_verification_expires_at INT UNSIGNED DEFAULT NULL",
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
      'ALTER TABLE comptes DROP COLUMN IF EXISTS phone_verification_expires_at',
      'ALTER TABLE comptes DROP COLUMN IF EXISTS phone_verification_code',
      'ALTER TABLE comptes DROP COLUMN IF EXISTS phone_verified_at',
      'ALTER TABLE comptes DROP COLUMN IF EXISTS phone_number',
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
