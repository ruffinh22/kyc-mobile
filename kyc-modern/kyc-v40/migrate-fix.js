const Database = require('better-sqlite3');
const db = new Database('./data/mccb-v3.db');

const colonnes = [
  { col: 'heure_cloture', def: 'TEXT' },
  { col: 'raison_rejet', def: 'TEXT' },
  { col: 'agent_saisie', def: 'TEXT' },
  { col: 'heure_prise', def: 'TEXT' }
];

for (const { col, def } of colonnes) {
  try {
    db.prepare('ALTER TABLE dossiers ADD COLUMN ' + col + ' ' + def).run();
    console.log('✅ Colonne ajoutée : ' + col);
  } catch (e) {
    if (e.message.includes('duplicate')) {
      console.log('ℹ️  Colonne déjà présente : ' + col);
    } else {
      console.error('❌ Erreur ' + col + ':', e.message);
    }
  }
}
db.close();
console.log('\n✅ Migration terminée !');
