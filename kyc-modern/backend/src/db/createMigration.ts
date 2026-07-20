import fs from 'fs';
import path from 'path';

export function createMigrationFile(name: string): string {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const migrationName = `${timestamp}_${slug}`;
  const dir = path.resolve(__dirname, 'migrations');
  const filePath = path.join(dir, `${migrationName}.ts`);

  if (fs.existsSync(filePath)) {
    throw new Error(`Migration already exists: ${filePath}`);
  }

  const content = `export const migration = {
  name: '${migrationName}',
  async up(pool: any) {
    // Add your SQL here
  },
  async down(pool: any) {
    // Add rollback SQL here
  },
};
`;

  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf8');
  return filePath;
}
