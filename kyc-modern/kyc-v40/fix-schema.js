require('dotenv').config();
const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH || '/opt/kyc-v4/data/mccb-v3.db');

const colonnes = [
  { col: 'transfert_message', def: 'TEXT' },
  { col: 'transfert_par', def: 'TEXT' },
  { col: 'wa_agent', def: 'TEXT' },
  { col: 'username_agent', def: 'TEXT' },
  { col: 'fonction_agent', def: 'TEXT' },
  { col: 'zone_agent', def: 'TEXT' },
  { col: 'ligne', def: 'TEXT' },
  { col: 'date', def: 'TEXT' },
  { col: 'heure_reception', def: 'TEXT' },
  { col: 'photo_recto', def: 'TEXT' },
  { col: 'photo_verso', def: 'TEXT' },
  { col: 'photo_live', def: 'TEXT' },
  { col: 'closed_at', def: 'INTEGER' }
];

for (const { col, def } of colonnes) {
  try {
    db.prepare('ALTER TABLE dossiers ADD COLUMN ' + col + ' ' + def).run();
    console.log('✅ ' + col);
  } catch (e) {
    if (e.message.includes('duplicate')) {
      console.log('ℹ️  ' + col);
    } else {
      console.error('❌ ' + col + ':', e.message);
    }
  }
}

db.close();
console.log('\n✅ Schéma corrigé!');
