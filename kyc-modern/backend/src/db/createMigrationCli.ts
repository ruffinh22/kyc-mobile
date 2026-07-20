import { autoCreateMigration } from './migrations';

const name = process.argv[2];
if (!name) {
  console.error('Usage: yarn create-migration <name>');
  process.exit(1);
}

const filePath = autoCreateMigration(name);
console.log(filePath);
