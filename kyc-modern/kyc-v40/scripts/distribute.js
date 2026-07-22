#!/usr/bin/env node

/**
 * Script pour distribuer manuellement les dossiers en attente
 */

'use strict';

require('dotenv').config({ path: '.env', override: true });

const db = require('../server/db');

console.log('\n📦 Distribution manuelle des dossiers...\n');

try {
  const distribution = require('../server/utils/distribution');
  distribution.distribuerMaintenant();
  
  // Afficher le résultat
  setTimeout(() => {
    const dossiers = db.db.prepare(`
      SELECT id, numero_mtn, statut, agent_saisie 
      FROM dossiers 
      ORDER BY created_at DESC 
      LIMIT 5
    `).all();
    
    console.log('✅ Distribution terminée !\n');
    console.log('📋 Dossiers :');
    dossiers.forEach(d => {
      const stat = d.statut === 'en_attente' ? '⏳' : 
                   d.statut === 'en_cours' ? '⚙️' :
                   d.statut === 'accepte' ? '✅' : '❌';
      console.log(`  ${stat} ${d.id} — ${d.numero_mtn} — ${d.statut} (agent: ${d.agent_saisie || 'non assigné'})`);
    });
    console.log('\n');
    process.exit(0);
  }, 500);
  
} catch (err) {
  console.error('❌ Erreur :', err.message);
  process.exit(1);
}