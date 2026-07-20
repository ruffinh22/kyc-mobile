export const migration = {
  name: '20260720_add_acquisition_columns',
  async up(pool: any) {
    const statements = [
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS nom_titulaire VARCHAR(200) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS prenom_titulaire VARCHAR(200) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS date_naissance VARCHAR(50) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS lieu_naissance VARCHAR(200) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS autre_numero VARCHAR(20) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS nom_pere VARCHAR(200) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS nom_mere VARCHAR(200) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS adresse_complete VARCHAR(500) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS numero_cni VARCHAR(50) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS sexe VARCHAR(20) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS nationalite VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS profession VARCHAR(100) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS country VARCHAR(5) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS ocr_overrides VARCHAR(200) DEFAULT NULL",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS flow_step TINYINT(1) DEFAULT 4",
      "ALTER TABLE dossiers ADD COLUMN IF NOT EXISTS acquisition_status VARCHAR(30) DEFAULT 'submitted'",
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
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS acquisition_status',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS flow_step',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS ocr_overrides',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS country',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS profession',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS nationalite',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS sexe',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS numero_cni',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS adresse_complete',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS nom_mere',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS nom_pere',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS autre_numero',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS lieu_naissance',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS date_naissance',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS prenom_titulaire',
      'ALTER TABLE dossiers DROP COLUMN IF EXISTS nom_titulaire',
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
