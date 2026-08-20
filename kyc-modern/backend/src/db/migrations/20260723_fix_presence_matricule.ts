import type { Pool } from 'mysql2/promise';

export const migration = {
  name: '20260723_fix_presence_matricule',
  up: async (pool: Pool): Promise<void> => {
    // Rendre idempotent : vérifier existence des colonnes/index avant de
    // les supprimer/ajouter afin d'éviter des erreurs quand la migration
    // a déjà été partiellement appliquée.
    const [[colNom]] = await pool.query(`
      SELECT COUNT(*) as c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'presence' AND COLUMN_NAME = 'nom'
    `) as any;
    if (colNom.c > 0) {
      // Supprimer uniquement la colonne si elle existe
      await pool.execute(`ALTER TABLE presence DROP COLUMN nom`);
    }

    const [[colMatricule]] = await pool.query(`
      SELECT COUNT(*) as c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'presence' AND COLUMN_NAME = 'matricule'
    `) as any;
    if (colMatricule.c === 0) {
      await pool.execute(`ALTER TABLE presence ADD COLUMN matricule VARCHAR(30) NOT NULL AFTER id`);
    }

    // Ajouter un index sur matricule si absent
    const [[idxMat]] = await pool.query(`
      SELECT COUNT(*) as c FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'presence' AND INDEX_NAME = 'idx_matricule'
    `) as any;
    if (idxMat.c === 0) {
      await pool.execute(`ALTER TABLE presence ADD UNIQUE INDEX idx_matricule (matricule)`);
    }
  },
  down: async (pool: Pool): Promise<void> => {
    // Rollback idempotent : supprimer matricule si présent et recréer nom
    const [[colMatriculeDown]] = await pool.query(`
      SELECT COUNT(*) as c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'presence' AND COLUMN_NAME = 'matricule'
    `) as any;
    if (colMatriculeDown.c > 0) {
      await pool.execute(`ALTER TABLE presence DROP COLUMN matricule`);
    }

    const [[colNomDown]] = await pool.query(`
      SELECT COUNT(*) as c FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'presence' AND COLUMN_NAME = 'nom'
    `) as any;
    if (colNomDown.c === 0) {
      await pool.execute(`ALTER TABLE presence ADD COLUMN nom VARCHAR(30) NOT NULL AFTER id`);
    }

    const [[idxNomDown]] = await pool.query(`
      SELECT COUNT(*) as c FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'presence' AND INDEX_NAME = 'idx_nom'
    `) as any;
    if (idxNomDown.c === 0) {
      await pool.execute(`ALTER TABLE presence ADD INDEX idx_nom (nom)`);
    }
  }
};
