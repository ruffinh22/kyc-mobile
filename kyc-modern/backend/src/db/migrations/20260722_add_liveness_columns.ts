export const migration = {
  name: '20260722_add_liveness_columns',
  async up(pool: any) {
    const columns = [
      'liveness_status',
      'liveness_confidence',
      'liveness_verifie_le',
    ];

    const [existingRows] = await pool.execute(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'dossiers'
         AND COLUMN_NAME IN (?, ?, ?)`,
      columns,
    );
    const existing = new Set((existingRows as Array<{ COLUMN_NAME: string }>).map((row) => row.COLUMN_NAME));

    const statements = [] as string[];
    if (!existing.has('liveness_status')) {
      statements.push("ALTER TABLE dossiers ADD COLUMN liveness_status VARCHAR(20) DEFAULT NULL");
    }
    if (!existing.has('liveness_confidence')) {
      statements.push("ALTER TABLE dossiers ADD COLUMN liveness_confidence DECIMAL(5,2) DEFAULT NULL");
    }
    if (!existing.has('liveness_verifie_le')) {
      statements.push("ALTER TABLE dossiers ADD COLUMN liveness_verifie_le INT UNSIGNED DEFAULT NULL");
    }

    for (const statement of statements) {
      await pool.execute(statement);
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
