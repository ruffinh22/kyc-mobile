import 'dotenv/config';
import { initDb, getCompteByMatricule, createCompte } from '../db';
import { hashPassword, validatePassword, validateMatricule } from '../utils/auth';

async function main() {
  const [matricule, nom, prenom, password] = process.argv.slice(2);
  if (!matricule || !nom || !password) {
    console.error('Usage: npx ts-node src/scripts/create-agent.ts MATRICULE Nom [Prenom] MotDePasse');
    process.exit(1);
  }
  if (!validateMatricule(matricule)) {
    console.error('Matricule invalide');
    process.exit(1);
  }
  const str = validatePassword(password);
  if (!str.valid) {
    console.error('Mot de passe faible:', str.errors.join(', '));
    process.exit(1);
  }

  await initDb();
  const existing = await getCompteByMatricule(matricule.toUpperCase());
  if (existing) {
    console.error(`Compte ${matricule.toUpperCase()} déjà existant`);
    process.exit(1);
  }

  const hash = await hashPassword(password);
  const id   = await createCompte({
    matricule: matricule.toUpperCase(),
    nom,
    prenom: prenom || '',
    role: 'agent',
    password_hash: hash,
  });

  console.log(`✅ Agent créé : id=${id} matricule=${matricule.toUpperCase()}`);
  process.exit(0);
}

main().catch(err => { console.error('[ERREUR]', err); process.exit(1); });
