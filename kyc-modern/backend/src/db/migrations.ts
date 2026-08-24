import fs from 'fs';
import path from 'path';
import type { Pool } from 'mysql2/promise';
import { createMigrationFile } from './createMigration';

const MIGRATION_TABLE = 'schema_migrations';

type MigrationModule = { name: string; up: (pool: Pool) => Promise<void>; down: (pool: Pool) => Promise<void> };

// Liste les fichiers de migration exécutables du dossier `migrations/`.
//
// En production (dist/), les migrations sont compilées en .js — en
// développement (src/, lancé via ts-node), elles restent en .ts. On
// accepte les deux extensions ici pour que ça marche dans les deux
// contextes, mais on exclut explicitement :
//   - les .d.ts (déclarations générées par tsc, jamais exécutables)
//   - les .js.map (source maps)
// et on déduplique par nom de migration pour ne jamais charger deux fois
// la même migration si .ts et .js coexistent (ex: build non nettoyé).
function listMigrationFilenames(dir: string): string[] {
  const files = fs.readdirSync(dir)
    .filter(file => (file.endsWith('.js') || file.endsWith('.ts')) && !file.endsWith('.d.ts'))
    .sort();

  const seen = new Set<string>();
  const result: string[] = [];
  for (const file of files) {
    const base = file.replace(/\.(js|ts)$/, '');
    if (seen.has(base)) continue; // priorité au premier trouvé (ordre alphabétique .js < .ts)
    seen.add(base);
    result.push(file);
  }
  return result;
}

function loadMigrations(): MigrationModule[] {
  const dir = path.resolve(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return [];

  return listMigrationFilenames(dir)
    .map(file => path.join(dir, file))
    .map(filePath => {
      const module = require(filePath) as { migration?: MigrationModule };
      return module.migration;
    })
    .filter((migration): migration is MigrationModule => Boolean(migration));
}

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      name VARCHAR(255) NOT NULL PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const migrations = loadMigrations();

  for (const migration of migrations) {
    const [rows] = await pool.execute(`SELECT 1 FROM ${MIGRATION_TABLE} WHERE name = ?`, [migration.name]);
    if ((rows as Array<Record<string, unknown>>).length > 0) {
      console.log(`[DB] migration already applied: ${migration.name}`);
      continue;
    }

    console.log(`[DB] applying migration: ${migration.name}`);
    await migration.up(pool);
    await pool.execute(`INSERT INTO ${MIGRATION_TABLE} (name) VALUES (?)`, [migration.name]);
    console.log(`[DB] migration applied: ${migration.name}`);
  }
}

export async function rollbackMigration(pool: Pool, migrationName: string): Promise<void> {
  const [rows] = await pool.execute(`SELECT 1 FROM ${MIGRATION_TABLE} WHERE name = ?`, [migrationName]);
  if ((rows as Array<Record<string, unknown>>).length === 0) {
    throw new Error(`Migration not applied: ${migrationName}`);
  }

  const migration = loadMigrations().find(item => item.name === migrationName);
  if (!migration) {
    throw new Error(`Unknown migration: ${migrationName}`);
  }

  await migration.down(pool);
  await pool.execute(`DELETE FROM ${MIGRATION_TABLE} WHERE name = ?`, [migrationName]);
  console.log(`[DB] migration rolled back: ${migrationName}`);
}

export function autoCreateMigration(name: string): string {
  return createMigrationFile(name);
}

export function listMigrationFiles(): string[] {
  const dir = path.resolve(__dirname, 'migrations');
  if (!fs.existsSync(dir)) return [];
  return listMigrationFilenames(dir).map(file => path.join(dir, file));
}