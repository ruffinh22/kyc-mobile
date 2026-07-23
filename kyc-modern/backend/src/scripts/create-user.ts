import 'dotenv/config';
import { initDb, getCompteByMatricule, createCompte } from '../db';
import { hashPassword, validatePassword, validateMatricule } from '../utils/auth';

const allowedRoles = ['agent', 'superviseur', 'admin'] as const;
type UserRole = (typeof allowedRoles)[number];

function printUsage() {
  console.error('Usage: yarn create-user <agent|superviseur|admin> MATRICULE Nom [Prenom] MotDePasse');
  console.error('Exemples:');
  console.error('  yarn create-user agent AGT001 Dupont Jean secret123');
  console.error('  yarn create-user superviseur SUP001 Martin Claire StrongPass123!');
  console.error('  yarn create-user admin ADM001 Admin Toto StrongPass123!');
}

function parseArgs(args: string[]) {
  if (args.length < 2 || args.length > 4) {
    return null;
  }

  const [matricule, nom, prenomOrPassword, maybePassword] = args;

  if (!matricule || !nom) {
    return null;
  }

  if (args.length === 2) {
    return { matricule, nom, prenom: '', password: prenomOrPassword };
  }

  if (args.length === 3) {
    return { matricule, nom, prenom: '', password: prenomOrPassword };
  }

  return { matricule, nom, prenom: prenomOrPassword, password: maybePassword };
}

async function main() {
  const [roleArg, ...args] = process.argv.slice(2);

  if (!roleArg) {
    printUsage();
    process.exit(1);
  }

  const role = roleArg.toLowerCase();
  if (!allowedRoles.includes(role as UserRole)) {
    console.error(`Rôle invalide: ${roleArg}`);
    console.error(`Rôles autorisés: ${allowedRoles.join(', ')}`);
    process.exit(1);
  }

  const parsed = parseArgs(args);
  if (!parsed) {
    printUsage();
    process.exit(1);
  }

  const { matricule, nom, prenom, password } = parsed;

  if (!password) {
    printUsage();
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
  const id = await createCompte({
    matricule: matricule.toUpperCase(),
    nom,
    prenom: prenom || '',
    role: role as UserRole,
    password_hash: hash,
  });

  console.log(`✅ Compte créé : role=${role} id=${id} matricule=${matricule.toUpperCase()}`);
  process.exit(0);
}

main().catch(err => {
  console.error('[ERREUR]', err);
  process.exit(1);
});
