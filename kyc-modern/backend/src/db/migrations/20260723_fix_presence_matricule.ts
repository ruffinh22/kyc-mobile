import { Pool } from 'mysql2/promise';

export const migration = {
  name: '20260723_fix_presence_matricule',
  up: async (pool: Pool): Promise<void> => {
    // Supprimer la colonne 'nom' et ajouter 'matricule'
    await pool.execute(`
      ALTER TABLE presence 
      DROP COLUMN nom,
      ADD COLUMN matricule VARCHAR(30) NOT NULL AFTER id
    `);
    
    // Ajouter un index sur matricule
    await pool.execute(`
      ALTER TABLE presence 
      ADD UNIQUE INDEX idx_matricule (matricule)
    `);
  },
  down: async (pool: Pool): Promise<void> => {
    // Rollback: supprimer matricule et remettre nom
    await pool.execute(`
      ALTER TABLE presence 
      DROP COLUMN matricule,
      ADD COLUMN nom VARCHAR(30) NOT NULL AFTER id
    `);
    
    await pool.execute(`
      ALTER TABLE presence 
      ADD INDEX idx_nom (nom)
    `);
  }
};
