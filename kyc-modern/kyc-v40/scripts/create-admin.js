#!/usr/bin/env node

/**
 * Script pour créer un compte ADMIN - KYC V4
 * Les administrateurs ont accès à tous les paramètres et peuvent gérer tous les comptes
 * 
 * Usage: node scripts/create-admin.js
 * 
 * Sera demandé interactivement :
 *  - Matricule
 *  - Nom
 *  - Prénom
 *  - Mot de passe
 */

'use strict';

// Charger les variables d'environnement
require('dotenv').config({ path: '.env', override: true });

const readline = require('readline');

// Import du module DB et authentification
const db = require('../server/db');
const auth = require('../server/utils/auth');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => {
    rl.question(query, resolve);
  });
}

async function main() {
  console.log('\n╔════════════════════════════════════════════╗');
  console.log('║     Création d\'un compte ADMIN - KYC V4    ║');
  console.log('╚════════════════════════════════════════════╝\n');

  try {
    // Saisie des informations
    const matricule = (await question('📋 Matricule (ex: ADMIN01): ')).trim().toUpperCase();
    if (!matricule || matricule.length < 3) {
      console.error('❌ Matricule invalide');
      process.exit(1);
    }

    const nom = (await question('👤 Nom de famille: ')).trim();
    if (!nom) {
      console.error('❌ Nom obligatoire');
      process.exit(1);
    }

    const prenom = (await question('👤 Prénom: ')).trim();
    if (!prenom) {
      console.error('❌ Prénom obligatoire');
      process.exit(1);
    }

    const password = (await question('🔐 Mot de passe (min 8 caractères): ')).trim();
    if (password.length < 8) {
      console.error('❌ Mot de passe trop court (minimum 8 caractères)');
      process.exit(1);
    }

    const passwordConfirm = (await question('🔐 Confirmer le mot de passe: ')).trim();
    if (password !== passwordConfirm) {
      console.error('❌ Les mots de passe ne correspondent pas');
      process.exit(1);
    }

    // Vérifier que le compte n'existe pas déjà
    const existing = db.getCompteByMatricule(matricule);
    if (existing) {
      console.error('❌ Ce matricule existe déjà');
      process.exit(1);
    }

    // Hash du mot de passe
    console.log('\n⏳ Hachage du mot de passe...');
    const passwordHash = await auth.hashPassword(password);

    // Insertion en base de données
    console.log('⏳ Création du compte...');
    const stmt = db.db.prepare(`
      INSERT INTO comptes (
        matricule, 
        nom, 
        prenom, 
        role, 
        password_hash, 
        actif, 
        must_change_password, 
        failed_login_count,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const now = Math.floor(Date.now() / 1000);
    stmt.run(
      matricule,           // matricule
      nom,                 // nom
      prenom,              // prenom
      'admin',             // role = ADMIN (accès complet)
      passwordHash,        // password_hash
      1,                   // actif = OUI
      0,                   // must_change_password = NON
      0,                   // failed_login_count = 0
      now,                 // created_at
      now                  // updated_at
    );

    console.log('\n✅ Compte administrateur créé avec succès !\n');
    console.log('📊 Détails :');
    console.log(`  • Matricule : ${matricule}`);
    console.log(`  • Nom : ${nom} ${prenom}`);
    console.log(`  • Rôle : admin (administrateur)}`);
    console.log(`  • Actif : OUI`);
    console.log('\n💡 Cet administrateur pourra :');
    console.log('  ⚙️  Accéder aux paramètres système');
    console.log('  👥 Gérer tous les comptes (création, modification, suppression)');
    console.log('  📊 Voir tous les dossiers et historiques');
    console.log('  🔐 Réinitialiser les mots de passe');
    console.log('  ✅ Accepter/Rejeter les dossiers');
    console.log('\n');

    // Audit
    db.audit(null, 'ADMIN_CREATE', `matricule=${matricule} nom=${nom} prenom=${prenom}`, 'local', 'script');

    process.exit(0);

  } catch (err) {
    console.error('❌ Erreur :', err.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main();
