export const migration = {
  name: '20260804_reconcile_dossier_schema',
  async up(pool: any) {
    const conn = await pool.getConnection();
    try {
      const [columnsRaw] = await conn.query("SHOW COLUMNS FROM dossiers");
      const existing = new Set((columnsRaw as Array<{ Field: string }>).map((c) => c.Field));

      const definitions: Array<{ field: string; sql: string }> = [
        { field: 'nom_titulaire', sql: "ALTER TABLE dossiers ADD COLUMN nom_titulaire VARCHAR(200) DEFAULT NULL" },
        { field: 'prenom_titulaire', sql: "ALTER TABLE dossiers ADD COLUMN prenom_titulaire VARCHAR(200) DEFAULT NULL" },
        { field: 'date_naissance', sql: "ALTER TABLE dossiers ADD COLUMN date_naissance VARCHAR(50) DEFAULT NULL" },
        { field: 'lieu_naissance', sql: "ALTER TABLE dossiers ADD COLUMN lieu_naissance VARCHAR(200) DEFAULT NULL" },
        { field: 'autre_numero', sql: "ALTER TABLE dossiers ADD COLUMN autre_numero VARCHAR(20) DEFAULT NULL" },
        { field: 'nom_pere', sql: "ALTER TABLE dossiers ADD COLUMN nom_pere VARCHAR(200) DEFAULT NULL" },
        { field: 'nom_mere', sql: "ALTER TABLE dossiers ADD COLUMN nom_mere VARCHAR(200) DEFAULT NULL" },
        { field: 'adresse_complete', sql: "ALTER TABLE dossiers ADD COLUMN adresse_complete VARCHAR(500) DEFAULT NULL" },
        { field: 'numero_cni', sql: "ALTER TABLE dossiers ADD COLUMN numero_cni VARCHAR(50) DEFAULT NULL" },
        { field: 'sexe', sql: "ALTER TABLE dossiers ADD COLUMN sexe VARCHAR(20) DEFAULT NULL" },
        { field: 'nationalite', sql: "ALTER TABLE dossiers ADD COLUMN nationalite VARCHAR(100) DEFAULT NULL" },
        { field: 'profession', sql: "ALTER TABLE dossiers ADD COLUMN profession VARCHAR(100) DEFAULT NULL" },
        { field: 'type_piece', sql: "ALTER TABLE dossiers ADD COLUMN type_piece VARCHAR(50) DEFAULT NULL" },
        { field: 'date_expiration', sql: "ALTER TABLE dossiers ADD COLUMN date_expiration VARCHAR(50) DEFAULT NULL" },
        { field: 'country', sql: "ALTER TABLE dossiers ADD COLUMN country VARCHAR(5) DEFAULT NULL" },
        { field: 'ocr_overrides', sql: "ALTER TABLE dossiers ADD COLUMN ocr_overrides VARCHAR(200) DEFAULT NULL" },
        { field: 'flow_step', sql: "ALTER TABLE dossiers ADD COLUMN flow_step TINYINT(1) DEFAULT 4" },
        { field: 'acquisition_status', sql: "ALTER TABLE dossiers ADD COLUMN acquisition_status VARCHAR(30) DEFAULT 'submitted'" },
      ];

      for (const def of definitions) {
        if (existing.has(def.field)) continue;
        try {
          await conn.query(def.sql);
          existing.add(def.field);
        } catch (err: any) {
          if (err?.code !== 'ER_DUP_FIELDNAME' && err?.code !== 'ER_PARSE_ERROR') {
            throw err;
          }
        }
      }
    } finally {
      conn.release();
    }
  },
  async down(pool: any) {
    const conn = await pool.getConnection();
    try {
      const [columnsRaw] = await conn.query("SHOW COLUMNS FROM dossiers");
      const existing = new Set((columnsRaw as Array<{ Field: string }>).map((c) => c.Field));
      for (const field of ['acquisition_status', 'flow_step', 'ocr_overrides', 'country', 'date_expiration', 'type_piece', 'profession', 'nationalite', 'sexe', 'numero_cni', 'adresse_complete', 'nom_mere', 'nom_pere', 'autre_numero', 'lieu_naissance', 'date_naissance', 'prenom_titulaire', 'nom_titulaire']) {
        if (!existing.has(field)) continue;
        try {
          await conn.query(`ALTER TABLE dossiers DROP COLUMN ${field}`);
        } catch {
          // ignore rollback failures
        }
      }
    } finally {
      conn.release();
    }
  },
};
