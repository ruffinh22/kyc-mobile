import mysql from 'mysql2/promise';
import { runMigrations, listMigrationFiles } from './migrations';
import type { Pool } from 'mysql2/promise';

function createPool(): Pool {
  return mysql.createPool({
    host:             process.env.DB_HOST     || '127.0.0.1',
    port:             parseInt(process.env.DB_PORT || '3306', 10),
    user:             process.env.DB_USER     || 'root',
    password:         process.env.DB_PASS     || '',
    database:         process.env.DB_NAME     || 'kyc_v4',
    waitForConnections: true,
    connectionLimit:  parseInt(process.env.DB_POOL_LIMIT || '2', 10),
    queueLimit: 0,
    enableKeepAlive: true,
    timezone: '+00:00',
    charset: 'utf8mb4',
  });
}

function usage() {
  console.log('Usage: ts-node src/db/forceMigrationsCli.ts --name=<migration_name> | --all');
  console.log('Requires environment variable FORCE_MIGRATIONS_CONFIRM=1 to proceed.');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.length) {
    usage();
    process.exit(1);
  }

  const nameArg = args.find(a => a.startsWith('--name='));
  const all = args.includes('--all');

  const confirm = process.env.FORCE_MIGRATIONS_CONFIRM === '1' || process.env.FORCE_MIGRATIONS === '1';
  if (!confirm) {
    console.error('Refusing to run: set FORCE_MIGRATIONS_CONFIRM=1 to confirm.');
    process.exit(2);
  }

  const pool = createPool();

  try {
    if (all) {
      console.log('[FORCE MIGRATIONS] Truncating schema_migrations...');
      await pool.execute('TRUNCATE TABLE schema_migrations');
      console.log('[FORCE MIGRATIONS] Running migrations...');
      await runMigrations(pool);
      console.log('[FORCE MIGRATIONS] Done.');
      process.exit(0);
    }

    if (nameArg) {
      const name = nameArg.split('=')[1];
      const files = listMigrationFiles().map(f => f.split('/').pop() || f);
      if (!files.includes(name + '.ts') && !files.includes(name)) {
        console.error(`[FORCE MIGRATIONS] Unknown migration: ${name}`);
        console.error('Available migrations:');
        for (const f of files) console.error('  ' + f);
        process.exit(3);
      }

      console.log(`[FORCE MIGRATIONS] Deleting entry for migration ${name} from schema_migrations (if present)`);
      await pool.execute('DELETE FROM schema_migrations WHERE name = ?', [name]);
      console.log(`[FORCE MIGRATIONS] Running migrations (will apply ${name})...`);
      await runMigrations(pool);
      console.log('[FORCE MIGRATIONS] Done.');
      process.exit(0);
    }

    usage();
    process.exit(1);
  } catch (err: any) {
    console.error('[FORCE MIGRATIONS] Error:', err?.message || err);
    process.exit(10);
  } finally {
    try { await (pool as Pool).end(); } catch (_) {}
  }
}

void main();
