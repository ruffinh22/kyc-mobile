// ============================================================================
// Champs dynamiques du dossier — pilotés par l'admin
// ----------------------------------------------------------------------------
// L'admin peut : activer/désactiver ou renommer un champ "standard" (colonne
// SQL fixe déjà existante sur `dossiers`), ou créer/supprimer un champ
// "custom" — ce qui déclenche une VRAIE migration (ALTER TABLE ADD/DROP
// COLUMN) sur la table `dossiers`, immédiatement, pas seulement une entrée
// de configuration. Les agents (terrain via AcquisitionPage, ou lors d'une
// réattribution) ne voient et ne peuvent renseigner que les champs actifs.
// ============================================================================

import crypto from 'crypto';
import { getPool, nowSec, audit } from './index';
import type { RowDataPacket, ResultSetHeader } from 'mysql2/promise';

export type ChampType = 'texte' | 'nombre' | 'date' | 'liste' | 'case';

export interface ChampDossier {
  id: number;
  nullable?: boolean;
  cle: string;
  label: string;
  type: ChampType;
  options: string[] | null;
  obligatoire: boolean;
  actif: boolean;
  standard: boolean;
  ordre: number;
  placeholder: string | null;
  cree_par: string | null;
  created_at: number;
  updated_at: number;
}

const VALID_TYPES: ChampType[] = ['texte', 'nombre', 'date', 'liste', 'case'];
const CUSTOM_PREFIX = 'custom_';
const MAX_LABEL_LEN = 100;
const MAX_PLACEHOLDER_LEN = 120;

// Types "saisie libre" pour lesquels un placeholder a un sens (indication de
// format attendu dans un input). Une liste (dropdown) ou une case à cocher
// n'ont pas de saisie libre à guider : le placeholder y est ignoré côté
// serveur, quoi qu'envoie le client, pour ne jamais stocker une donnée
// inutilisable côté formulaire.
const PLACEHOLDER_CAPABLE_TYPES = new Set<ChampType>(['texte', 'nombre', 'date']);

// Colonnes de `dossiers` déjà prises (fixes + techniques) : la génération du
// nom de colonne custom doit impérativement les éviter.
const RESERVED_COLUMNS = new Set([
  'id', 'numero_mtn', 'wa_agent', 'username_agent', 'fonction_agent', 'zone_agent', 'ligne',
  'date', 'heure_reception', 'statut', 'photo_recto', 'photo_verso', 'photo_live', 'photo_signature',
  'score_visage', 'visage_match', 'visage_motif', 'visage_verifie_le',
  'liveness_status', 'liveness_confidence', 'liveness_verifie_le',
  'agent_saisie', 'heure_prise', 'heure_cloture', 'raison_rejet', 'resultat_crm',
  'assigne_a', 'assigne_le', 'note_superviseur', 'note', 'gsm_complete',
  'transfert_message', 'transfert_par', 'nom_titulaire', 'prenom_titulaire',
  'date_naissance', 'lieu_naissance', 'autre_numero', 'nom_pere', 'nom_mere',
  'adresse_complete', 'numero_cni', 'sexe', 'nationalite', 'profession', 'type_piece',
  'date_expiration', 'signature_mode', 'country', 'ocr_overrides', 'flow_step',
  'acquisition_status', 'created_at', 'updated_at', 'closed_at',
  'traitement_demarre_le', 'derniere_activite_le', 'reattribue', 'reattribue_le',
  'reattribue_par', 'nb_reattributions',
]);

/** Empreinte déterministe de la définition d'un champ — permet de détecter
 *  toute dérive entre ce qui est déclaré (dossier_champs) et le schéma réel
 *  de la table `dossiers` (ex: colonne modifiée/supprimée hors de ce module). */
export function computeChecksum(cle: string, type: ChampType, sqlType: string): string {
  return crypto.createHash('sha256').update(JSON.stringify({ cle, type, sqlType })).digest('hex');
}

// La table `dossier_champs` existe déjà (migration initiale, hors de ce
// fichier) : `placeholder` est une colonne ajoutée après coup. On la crée
// paresseusement et de façon idempotente au premier accès, plutôt que de
// supposer qu'une migration externe a déjà tourné — évite un déploiement
// cassé si le fichier de migration historique n'a pas été mis à jour.
let placeholderColumnEnsured = false;
let nullableColumnEnsured = false;
async function ensurePlaceholderColumn(pool: ReturnType<typeof getPool>): Promise<void> {
  if (placeholderColumnEnsured) return;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'dossier_champs' AND column_name = 'placeholder'`
  );
  const exists = ((rows[0] as RowDataPacket)?.n as number) > 0;
  if (!exists) {
    await pool.execute(`ALTER TABLE dossier_champs ADD COLUMN placeholder VARCHAR(${MAX_PLACEHOLDER_LEN}) DEFAULT NULL`);
  }
  placeholderColumnEnsured = true;
}

async function ensureNullableColumn(pool: ReturnType<typeof getPool>): Promise<void> {
  if (nullableColumnEnsured) return;
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'dossier_champs' AND column_name = 'nullable'`
  );
  const exists = ((rows[0] as RowDataPacket)?.n as number) > 0;
  if (!exists) {
    await pool.execute(`ALTER TABLE dossier_champs ADD COLUMN nullable TINYINT(1) DEFAULT 1`);
  }
  nullableColumnEnsured = true;
}

async function ensureMigrationLogTable(pool: ReturnType<typeof getPool>): Promise<void> {
  await pool.execute(`CREATE TABLE IF NOT EXISTS dossier_champs_migrations (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    champ_id INT NOT NULL,
    cle VARCHAR(255) NOT NULL,
    action VARCHAR(20) NOT NULL,
    sql_executed TEXT NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    performed_by VARCHAR(50),
    created_at INT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

/** Trace chaque ALTER TABLE réel déclenché par ce module — l'équivalent
 *  "fichier de migration" du second système (dynamicFields.ts), mais stocké
 *  en base pour rester dans une seule source de vérité auditable. */
async function logMigration(champId: number, cle: string, action: 'ADD_COLUMN' | 'DROP_COLUMN', sqlExecuted: string, checksum: string, matricule: string): Promise<void> {
  const pool = getPool();
  await ensureMigrationLogTable(pool);
  await pool.execute(
    'INSERT INTO dossier_champs_migrations (champ_id, cle, action, sql_executed, checksum, performed_by, created_at) VALUES (?,?,?,?,?,?,?)',
    [champId, cle, action, sqlExecuted, checksum, matricule, nowSec()]
  );
}

function sqlTypeFor(type: ChampType): string {
  switch (type) {
    case 'nombre': return 'DECIMAL(18,2) DEFAULT NULL';
    case 'date':   return 'VARCHAR(20) DEFAULT NULL';
    case 'liste':  return 'VARCHAR(255) DEFAULT NULL';
    case 'case':   return 'TINYINT(1) DEFAULT NULL';
    case 'texte':
    default:       return 'VARCHAR(255) DEFAULT NULL';
  }
}

function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // accents
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'champ';
}

async function generateUniqueColumnName(label: string): Promise<string> {
  const base = `${CUSTOM_PREFIX}${slugify(label)}`;
  let candidate = base;
  let n = 1;
  // Vérifie l'absence de collision avec les colonnes fixes ET les champs
  // déjà enregistrés (standard ou custom).
  const existing = await listChamps();
  const takenKeys = new Set([...RESERVED_COLUMNS, ...existing.map(c => c.cle)]);
  while (takenKeys.has(candidate)) {
    n += 1;
    candidate = `${base}_${n}`.slice(0, 64);
  }
  return candidate;
}

function rowToChamp(r: RowDataPacket): ChampDossier {
  let options: string[] | null = null;
  if (r.options) {
    try { options = JSON.parse(r.options as string); } catch { options = null; }
  }
  return {
    id: r.id, cle: r.cle, label: r.label, type: r.type as ChampType, options,
    obligatoire: !!r.obligatoire, actif: !!r.actif, standard: !!r.standard,
    ordre: r.ordre, placeholder: r.placeholder ?? null, cree_par: r.cree_par ?? null,
    nullable: r.nullable === undefined ? true : !!r.nullable,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

export async function listChamps(): Promise<ChampDossier[]> {
  const pool = getPool();
  await ensurePlaceholderColumn(pool);
  await ensureNullableColumn(pool);
  const [rows] = await pool.execute<RowDataPacket[]>(
    'SELECT * FROM dossier_champs ORDER BY ordre ASC, id ASC'
  );
  return rows.map(rowToChamp);
}

export async function listChampsActifs(): Promise<ChampDossier[]> {
  return (await listChamps()).filter(c => c.actif);
}

/** Colonnes custom actives — utilisé par updateDossier() pour étendre dynamiquement
 *  la liste des colonnes modifiables sans jamais toucher au code appelant. */
export async function listActiveCustomColumnKeys(): Promise<string[]> {
  return (await listChamps()).filter(c => !c.standard).map(c => c.cle);
}

export async function createChampCustom(data: {
  label: string; type: ChampType; options?: string[] | null;
  obligatoire?: boolean; placeholder?: string | null; nullable?: boolean; matricule: string;
}): Promise<ChampDossier> {
  const label = data.label.trim().slice(0, MAX_LABEL_LEN);
  if (!label) throw new Error('Le libellé du champ est obligatoire');
  if (!VALID_TYPES.includes(data.type)) throw new Error('Type de champ invalide');
  if (data.type === 'liste' && (!data.options || data.options.filter(o => o.trim()).length < 2)) {
    throw new Error('Une liste doit avoir au moins 2 options');
  }

  const cle = await generateUniqueColumnName(label);
  const pool = getPool();
  await ensurePlaceholderColumn(pool);
  await ensureNullableColumn(pool);

  // 1) Vraie migration : on ajoute réellement la colonne à `dossiers`.
  const sqlType = sqlTypeFor(data.type);
  const isNullable = data.nullable !== false; // default true
  let alterSql: string;
  if (isNullable) {
    // sqlType already contains DEFAULT NULL in current helpers
    alterSql = `ALTER TABLE dossiers ADD COLUMN \`${cle}\` ${sqlType}`;
  } else {
    // create NOT NULL with a safe default depending on type
    const base = sqlType.replace(/\s+DEFAULT\s+NULL$/i, '');
    let defaultVal = "''";
    if (data.type === 'nombre') defaultVal = '0';
    if (data.type === 'case') defaultVal = '0';
    alterSql = `ALTER TABLE dossiers ADD COLUMN \`${cle}\` ${base} NOT NULL DEFAULT ${defaultVal}`;
  }
  await pool.execute(alterSql);

  // 2) Métadonnée du champ (label affiché, type, options, ordre, placeholder...).
  const now = nowSec();
  const [maxOrdreRows] = await pool.execute<RowDataPacket[]>('SELECT COALESCE(MAX(ordre),0) AS m FROM dossier_champs');
  const ordre = ((maxOrdreRows[0] as RowDataPacket).m as number) + 10;
  const options = data.type === 'liste' ? JSON.stringify((data.options || []).map(o => o.trim()).filter(Boolean)) : null;
  // Un placeholder n'a de sens que pour une saisie libre (texte/nombre/date) :
  // silencieusement ignoré pour liste/case, plutôt que de faire échouer la
  // création pour un détail cosmétique envoyé à tort par le client.
  const placeholder = PLACEHOLDER_CAPABLE_TYPES.has(data.type)
    ? ((data.placeholder ?? '').trim().slice(0, MAX_PLACEHOLDER_LEN) || null)
    : null;

  const [res] = await pool.execute<ResultSetHeader>(
    `INSERT INTO dossier_champs (cle, label, type, options, obligatoire, actif, standard, ordre, placeholder, nullable, cree_par, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?)`,
    [cle, label, data.type, options, data.obligatoire ? 1 : 0, ordre, placeholder, isNullable ? 1 : 0, data.matricule, now, now]
  );

  audit(data.matricule, 'CHAMP_DOSSIER_CREE', `cle=${cle} label=${label} type=${data.type}`);
  await logMigration(res.insertId, cle, 'ADD_COLUMN', alterSql, computeChecksum(cle, data.type, sqlType), data.matricule);

  const champ = (await listChamps()).find(c => c.id === res.insertId);
  if (!champ) throw new Error('Champ créé mais introuvable après insertion');
  return champ;
}

export async function updateChamp(id: number, patch: {
  label?: string; obligatoire?: boolean; actif?: boolean; ordre?: number;
  options?: string[] | null; placeholder?: string | null; matricule: string;
}): Promise<ChampDossier> {
  const pool = getPool();
  await ensurePlaceholderColumn(pool);
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM dossier_champs WHERE id=?', [id]);
  if (!rows.length) throw new Error('Champ introuvable');
  const current = rowToChamp(rows[0]);

  const sets: string[] = ['updated_at=?'];
  const vals: unknown[] = [nowSec()];
  if (patch.label !== undefined) { sets.push('label=?'); vals.push(patch.label.trim().slice(0, MAX_LABEL_LEN) || current.label); }
  if (patch.obligatoire !== undefined) { sets.push('obligatoire=?'); vals.push(patch.obligatoire ? 1 : 0); }
  if (patch.actif !== undefined) { sets.push('actif=?'); vals.push(patch.actif ? 1 : 0); }
  if (patch.ordre !== undefined) { sets.push('ordre=?'); vals.push(patch.ordre); }
  if (patch.options !== undefined && current.type === 'liste') {
    sets.push('options=?');
    vals.push(patch.options ? JSON.stringify(patch.options.map(o => o.trim()).filter(Boolean)) : null);
  }
  // Placeholder : modifiable pour un champ standard ET custom, du moment que
  // son type accepte une saisie libre (texte/nombre/date). Envoyé pour un
  // type liste/case, ou chaîne vide, ça efface simplement le placeholder
  // plutôt que d'échouer — cohérent avec le reste de ce endpoint qui est
  // tolérant aux patchs partiels.
  if (patch.placeholder !== undefined) {
    sets.push('placeholder=?');
    vals.push(PLACEHOLDER_CAPABLE_TYPES.has(current.type)
      ? ((patch.placeholder ?? '').trim().slice(0, MAX_PLACEHOLDER_LEN) || null)
      : null);
  }
  vals.push(id);
  await pool.execute(`UPDATE dossier_champs SET ${sets.join(',')} WHERE id=?`, vals);

  audit(patch.matricule, 'CHAMP_DOSSIER_MODIFIE', `id=${id} cle=${current.cle}`);
  const champ = (await listChamps()).find(c => c.id === id);
  if (!champ) throw new Error('Champ introuvable après mise à jour');
  return champ;
}

/** Suppression définitive d'un champ custom : DROP COLUMN réel + perte des
 *  valeurs déjà saisies pour ce champ. Impossible sur un champ standard. */
export async function deleteChampCustom(id: number, matricule: string): Promise<void> {
  const pool = getPool();
  const [rows] = await pool.execute<RowDataPacket[]>('SELECT * FROM dossier_champs WHERE id=?', [id]);
  if (!rows.length) throw new Error('Champ introuvable');
  const champ = rowToChamp(rows[0]);
  if (champ.standard) throw new Error('Un champ standard ne peut pas être supprimé, seulement désactivé');
  // --- Backup existing values for this column into a backup table first ---
  await pool.execute(`CREATE TABLE IF NOT EXISTS dossier_champs_backups (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    champ_id INT NOT NULL,
    cle VARCHAR(255) NOT NULL,
    backup_data LONGTEXT,
    backup_by VARCHAR(50),
    created_at INT NOT NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);

  // Retrieve all dossier values for this column (may be many; we serialize as JSON)
  const [dRows] = await pool.execute<RowDataPacket[]>(`SELECT id, \`${champ.cle}\` AS value FROM dossiers`);
  const entries: Array<{ dossier_id: number; value: unknown }> = (dRows || []).map(r => ({ dossier_id: r.id, value: r.value }));
  const now = nowSec();
  try {
    await pool.execute('INSERT INTO dossier_champs_backups (champ_id, cle, backup_data, backup_by, created_at) VALUES (?, ?, ?, ?, ?)', [id, champ.cle, JSON.stringify(entries), matricule, now]);
  } catch (e) {
    // If backup fails we abort to avoid irreversible deletion without backup
    throw new Error('Impossible de sauvegarder les valeurs avant suppression : ' + (e as Error).message);
  }

  // Now perform the destructive operations: drop column and remove metadata
  const dropSql = `ALTER TABLE dossiers DROP COLUMN \`${champ.cle}\``;
  await pool.execute(dropSql);
  await logMigration(champ.id, champ.cle, 'DROP_COLUMN', dropSql, computeChecksum(champ.cle, champ.type, sqlTypeFor(champ.type)), matricule);
  await pool.execute('DELETE FROM dossier_champs WHERE id=?', [id]);

  audit(matricule, 'CHAMP_DOSSIER_SUPPRIME', `id=${id} cle=${champ.cle} label=${champ.label} backup_at=${now}`);
}

// ============================================================================
// Validation dynamique — utilisée par les endpoints publics d'acquisition
// (public-dossiers.ts) pour que le formulaire, l'admin et le serveur ne
// fassent jamais qu'une seule et même source de vérité.
// ============================================================================

/** Vérifie qu'une valeur soumise respecte le type déclaré du champ (liste,
 *  nombre...). Retourne un message d'erreur en français ou null si valide.
 *  N'est PAS responsable du caractère obligatoire (voir checkObligatoires). */
export function validateChampValue(champ: ChampDossier, rawValue: string | undefined): string | null {
  const value = (rawValue ?? '').trim();
  if (!value) return null; // le caractère obligatoire est vérifié séparément
  switch (champ.type) {
    case 'nombre':
      if (Number.isNaN(Number(value))) return `${champ.label} doit être un nombre`;
      return null;
    case 'liste':
      if (champ.options && champ.options.length && !champ.options.includes(value)) {
        return `${champ.label} : valeur non reconnue`;
      }
      return null;
    case 'case':
      if (!['0', '1', 'true', 'false'].includes(value.toLowerCase())) {
        return `${champ.label} : valeur invalide`;
      }
      return null;
    case 'date':
    case 'texte':
    default:
      return null;
  }
}

/** Contrôle "obligatoire" unique pour TOUS les champs actifs — standards et
 *  personnalisés confondus. `fields` est le dictionnaire brut envoyé par le
 *  formulaire (clé = `champ.cle`). `skipCles` permet d'exclure les champs
 *  standards dont la présence/absence est déjà gérée ailleurs avec une
 *  logique conditionnelle propre (ex: date_expiration selon le type de
 *  pièce) — le serveur appelant reste responsable de cette nuance.
 *  Retourne le premier message d'erreur rencontré, ou null si tout est ok. */
export async function checkObligatoires(
  fields: Record<string, string>,
  opts?: { skipCles?: Set<string> }
): Promise<string | null> {
  const actifs = await listChampsActifs();
  const skip = opts?.skipCles ?? new Set<string>();
  for (const c of actifs) {
    if (skip.has(c.cle)) continue;
    const value = fields[c.cle];
    if (c.obligatoire && (!value || !value.trim())) {
      return `${c.label} requis`;
    }
    const typeErr = validateChampValue(c, value);
    if (typeErr) return typeErr;
  }
  return null;
}

// ============================================================================
// Cas particulier "pièce d'identité officielle" — SOURCE UNIQUE, partagée par
// TOUS les points d'entrée qui créent/modifient un dossier :
//   - public-dossiers.ts  (première acquisition terrain)
//   - dossiers.ts         (réattribution GSM)
// Avant cette centralisation, chaque fichier dupliquait sa propre copie de
// OFFICIAL_DOC_TYPES / OFFICIAL_DOC_CONDITIONAL_KEYS, avec un risque réel de
// divergence (ex: la réattribution GSM avait encore "if (!nom_pere?.trim())"
// codé en dur, indépendant de dossier_champs, alors que l'acquisition terrain
// avait déjà été corrigée). Ne plus jamais dupliquer cette logique ailleurs :
// importer checkChampsObligatoiresDynamique() + OFFICIAL_DOC_TYPES d'ici.
//
// NOTE: doit rester cohérent avec OFFICIAL_DOC_TYPES éventuellement dupliqué
// dans routes/ocr.ts (logique d'extraction OCR) — si ce fichier existe et
// définit sa propre liste, il faudrait l'aligner sur celle-ci également.
// ============================================================================

/** Types de pièce d'identité "officielle" et structurée (CNI, passeport...).
 *  Une carte scolaire ou un type non reconnu n'a pas de format standardisé :
 *  on n'exige alors que le strict nécessaire (voir OFFICIAL_DOC_CONDITIONAL_KEYS). */
export const OFFICIAL_DOC_TYPES = new Set(['CNI', 'CEDEAO', 'PASSPORT', 'CIP', 'PERMIS']);

/** Champs standards dont le caractère "obligatoire" (même si activé et coché
 *  en base par l'admin) ne s'applique QUE pour une pièce officielle
 *  structurée — une carte scolaire n'a par exemple pas de date d'expiration. */
export const OFFICIAL_DOC_CONDITIONAL_KEYS = new Set(['date_naissance', 'lieu_naissance', 'date_expiration']);

/** Validation "obligatoire + bien formé" unique pour un dossier (création OU
 *  réattribution), standards et personnalisés confondus. C'est la fonction
 *  que TOUT endpoint qui reçoit un formulaire de dossier doit appeler — plus
 *  aucun "if (!champ?.trim())" codé en dur ailleurs dans le code métier. */
export async function checkChampsObligatoiresDynamique(
  fields: Record<string, string>,
  isOfficialDocType: boolean
): Promise<string | null> {
  const generic = await checkObligatoires(fields, { skipCles: OFFICIAL_DOC_CONDITIONAL_KEYS });
  if (generic) return generic;

  if (isOfficialDocType) {
    const actifs = await listChampsActifs();
    for (const c of actifs) {
      if (!OFFICIAL_DOC_CONDITIONAL_KEYS.has(c.cle) || !c.actif || !c.obligatoire) continue;
      const value = fields[c.cle];
      if (!value || !value.trim()) return `${c.label} requis`;
    }
  }
  return null;
}