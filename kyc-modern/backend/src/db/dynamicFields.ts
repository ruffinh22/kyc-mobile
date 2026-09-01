// ============================================================================
// Champs dynamiques — helpers DB (KYC V4)
// ----------------------------------------------------------------------------
// Construit sur '../db' (mêmes conventions que gsm.ts / dossiers.ts :
// db.query<T>(sql, params), db.exec(sql, params), db.audit(...), db.nowSec()).
// Si votre module `db` expose des noms différents, adaptez uniquement les
// imports en tête de fichier — le reste ne change pas.
// ============================================================================
import crypto from 'crypto';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as db from './index';

const execFileAsync = promisify(execFile);

export type FieldType = 'VARCHAR' | 'TEXT' | 'INT' | 'BIGINT' | 'DATE' | 'DATETIME' | 'BOOLEAN' | 'DECIMAL';

export interface DynamicFieldInput {
  name: string;
  label: string;
  type: FieldType;
  length?: number;        // VARCHAR / DECIMAL(precision)
  decimalScale?: number;  // DECIMAL(precision, scale)
  nullable: boolean;
  defaultValue?: string | null;
  position?: number | null;
  targetTable?: string;   // défaut: 'dossiers'
}

export interface DynamicFieldRow {
  id: number;
  name: string;
  label: string;
  type: FieldType;
  length: number | null;
  decimal_scale: number | null;
  nullable: 0 | 1;
  default_value: string | null;
  position: number | null;
  target_table: string;
  status: 'active' | 'hidden' | 'drop_scheduled' | 'dropped';
  hidden_at: number | null;
  drop_scheduled_at: number | null;
  dropped_at: number | null;
  migration_file: string;
  checksum: string;
  backup_file: string | null;
  created_by: string;
  created_at: number;
  updated_at: number;
}

const NAME_RE = /^[a-z][a-z0-9_]{1,63}$/;
const ALLOWED_TYPES: FieldType[] = ['VARCHAR', 'TEXT', 'INT', 'BIGINT', 'DATE', 'DATETIME', 'BOOLEAN', 'DECIMAL'];
const MAX_VARCHAR = 255;
const RESERVED_NAMES = new Set([
  'id', 'created_at', 'updated_at', 'statut', 'agent_saisie', 'assigne_a', 'assigne_le',
  'numero_mtn', 'photo_recto', 'photo_verso', 'photo_live', 'photo_signature',
]);

export class DynamicFieldValidationError extends Error {}

/** Valide le nom, le type et les contraintes d'un champ. Lève DynamicFieldValidationError sinon. */
export function validateFieldInput(input: DynamicFieldInput): void {
  if (!input.name || !NAME_RE.test(input.name)) {
    throw new DynamicFieldValidationError(
      'Nom de champ invalide : lettres minuscules, chiffres et underscore uniquement, doit commencer par une lettre (ex: date_activation).'
    );
  }
  if (RESERVED_NAMES.has(input.name)) {
    throw new DynamicFieldValidationError(`Le nom "${input.name}" est réservé et ne peut pas être utilisé.`);
  }
  if (!input.label?.trim()) {
    throw new DynamicFieldValidationError('Le libellé est obligatoire.');
  }
  if (!ALLOWED_TYPES.includes(input.type)) {
    throw new DynamicFieldValidationError(`Type non autorisé : ${input.type}.`);
  }
  if (input.type === 'VARCHAR') {
    const len = input.length ?? 255;
    if (!Number.isInteger(len) || len < 1 || len > MAX_VARCHAR) {
      throw new DynamicFieldValidationError(`VARCHAR doit avoir une longueur entre 1 et ${MAX_VARCHAR}.`);
    }
  }
  if (input.type === 'DECIMAL') {
    const precision = input.length ?? 10;
    const scale = input.decimalScale ?? 2;
    if (!Number.isInteger(precision) || precision < 1 || precision > 30) {
      throw new DynamicFieldValidationError('DECIMAL : précision invalide (1 à 30).');
    }
    if (!Number.isInteger(scale) || scale < 0 || scale > precision) {
      throw new DynamicFieldValidationError('DECIMAL : échelle invalide.');
    }
  }
  // Règle de sécurité : un ADD NOT NULL doit obligatoirement fournir une valeur
  // par défaut, faute de quoi on refuse et on oriente vers la séquence sûre
  // (nullable -> backfill -> NOT NULL), voir docs/ALTER_TABLE_runbook.md.
  if (!input.nullable && (input.defaultValue === undefined || input.defaultValue === null || input.defaultValue === '')) {
    throw new DynamicFieldValidationError(
      "Un champ non-nullable exige une valeur par défaut. Ajoutez le champ en nullable, backfillez, puis reprogrammez-le en NOT NULL."
    );
  }
}

/** SQL du type de colonne (sans le nom), ex: "VARCHAR(255)", "DECIMAL(10,2)". */
export function columnTypeSql(input: DynamicFieldInput): string {
  switch (input.type) {
    case 'VARCHAR': return `VARCHAR(${input.length ?? 255})`;
    case 'DECIMAL': return `DECIMAL(${input.length ?? 10},${input.decimalScale ?? 2})`;
    case 'BOOLEAN': return 'TINYINT(1)';
    default: return input.type;
  }
}

function escapeSqlLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number' || typeof val === 'bigint') return String(val);
  if (typeof val === 'boolean') return val ? '1' : '0';
  return `'${String(val).replace(/'/g, "''")}'`;
}

/** Empreinte déterministe de la définition d'un champ — sert à détecter toute dérive
 *  entre ce qui est déclaré (admin_field_changes) et le schéma réel de la base. */
export function computeChecksum(input: DynamicFieldInput): string {
  const canonical = JSON.stringify({
    name: input.name,
    type: input.type,
    length: input.length ?? null,
    decimalScale: input.decimalScale ?? null,
    nullable: input.nullable,
    defaultValue: input.defaultValue ?? null,
    targetTable: input.targetTable ?? 'dossiers',
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/** Backup ciblé de la table avant tout ALTER TABLE (mysqldump du sous-ensemble concerné). */
export async function backupTable(targetTable: string, label: string): Promise<string> {
  const dir = process.env.BACKUP_DIR || path.join(process.cwd(), 'backups');
  const fname = `backup_${targetTable}_${label}_${Date.now()}.sql`;
  const fpath = path.join(dir, fname);
  await execFileAsync('mkdir', ['-p', dir]);
  await execFileAsync('mysqldump', [
    '-u', process.env.DB_USER || 'root',
    `-p${process.env.DB_PASSWORD || ''}`,
    process.env.DB_NAME || '',
    targetTable,
    '--result-file', fpath,
  ]);
  return fpath;
}

/** Applique un ADD COLUMN. Le nom/type doivent avoir été validés au préalable. */
export async function applyAddColumn(input: DynamicFieldInput): Promise<void> {
  const table = input.targetTable ?? 'dossiers';
  const nullSql = input.nullable ? 'NULL' : 'NOT NULL';
  const defaultSql = input.defaultValue !== undefined && input.defaultValue !== null
    ? ` DEFAULT ${escapeSqlLiteral(input.defaultValue)}`
    : '';
  const sql = `ALTER TABLE \`${table}\` ADD COLUMN \`${input.name}\` ${columnTypeSql(input)} ${nullSql}${defaultSql}`;
  await db.exec(sql);
}

/** Applique un DROP COLUMN (phase 2 ou suppression forcée). */
export async function applyDropColumn(targetTable: string, name: string): Promise<void> {
  await db.exec(`ALTER TABLE \`${targetTable}\` DROP COLUMN \`${name}\``);
}

export async function listFields(includeHidden = true): Promise<DynamicFieldRow[]> {
  const sql = includeHidden
    ? `SELECT * FROM admin_field_changes WHERE status != 'dropped' ORDER BY target_table, position, id`
    : `SELECT * FROM admin_field_changes WHERE status = 'active' ORDER BY target_table, position, id`;
  return db.query<DynamicFieldRow>(sql);
}

export async function getField(name: string, targetTable = 'dossiers'): Promise<DynamicFieldRow | null> {
  const rows = await db.query<DynamicFieldRow>(
    `SELECT * FROM admin_field_changes WHERE name = ? AND target_table = ? LIMIT 1`,
    [name, targetTable]
  );
  return rows[0] ?? null;
}

export async function logChange(fieldName: string, targetTable: string, action: string, detail: string, performedBy: string): Promise<void> {
  await db.exec(
    `INSERT INTO admin_field_change_log (field_name, target_table, action, detail, performed_by, ts) VALUES (?,?,?,?,?,?)`,
    [fieldName, targetTable, action, detail, performedBy, db.nowSec()]
  );
}
