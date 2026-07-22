require('dotenv').config();
const db = require('./server/db').db;

console.log('\n🔧 Distribution debug:\n');

const maintenant = Math.floor(Date.now() / 1000);
const limite = maintenant - 60;

// 1. Check config
const cfg = db.prepare("SELECT valeur FROM config WHERE cle='distribution_mode'").get();
console.log('1. Config check:', cfg);
if (!cfg || cfg.valeur !== 'auto') {
  console.log('   ❌ FAILED: distribution_mode not auto - RETURN');
  process.exit();
}

// 2. Get agents
const agents = db.prepare(
  "SELECT nom FROM presence WHERE statut='online' AND ts >= ? AND dispo_depuis IS NOT NULL AND nom NOT IN (SELECT agent_saisie FROM dossiers WHERE statut='en_cours' AND agent_saisie IS NOT NULL) ORDER BY dispo_depuis ASC"
).all(limite);
console.log('2. Agents disponibles:', agents);

// 3. For each agent, try to assign a dossier
for (const ag of agents) {
  console.log('\n3. Processing agent:', ag.nom);
  
  const prochain = db.prepare("SELECT id FROM dossiers WHERE statut='en_attente' ORDER BY created_at ASC LIMIT 1").get();
  console.log('   Next dossier:', prochain);
  if (!prochain) {
    console.log('   ❌ FAILED: No dossier waiting');
    break;
  }
  
  console.log('   Attempting UPDATE...');
  const r = db.prepare(
    "UPDATE dossiers SET statut='en_cours', agent_saisie=?, assigne_a=?, assigne_le=strftime('%s','now'), heure_prise=strftime('%H:%M','now','localtime'), updated_at=strftime('%s','now') WHERE id=? AND statut='en_attente'"
  ).run(ag.nom, ag.nom, prochain.id);
  console.log('   UPDATE result:', r);
  
  if (r.changes === 1) {
    console.log('   ✅ SUCCESS: Dossier assigned to', ag.nom);
  }
}

console.log('\n✅ Distribution complete');
