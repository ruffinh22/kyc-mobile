// ============================================================================
// KYC V4 – Couche d'accès MySQL (mysql2/promise)
// ============================================================================

import mysql, { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import {
  Compte, Session, Dossier, GsmRecord, PlanningEntry, PlanningManager,
  NoteQualite, PresenceRow, ConfigRow, AuditLog, Role
} from '../types';

let pool: Pool;

// ── Initialisation ────────────────────────────────────────────────────────────

export async function initDb(): Promise<void> {
  pool = mysql.createPool({
    host:             process.env.DB_HOST     || '127.0.0.1',
    port:             parseInt(process.env.DB_PORT || '3306', 10),
    user:             process.env.DB_USER     || 'kyc_user',
    password:         process.env.DB_PASS     || '',
    database:         process.env.DB_NAME     || 'kyc_v4',
    waitForConnections: true,
    connectionLimit:  parseInt(process.env.DB_POOL_LIMIT || '10', 10),
    queueLimit: 0,
    enableKeepAlive: true,
    timezone: '+00:00',
    charset: 'utf8mb4',
  });

  const conn = await pool.getConnection();
  await conn.ping();
  conn.release();
  console.log('[DB] MySQL connecté :', process.env.DB_NAME);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type P = any[];

async function query<T extends RowDataPacket>(sql: string, params: P = []): Promise<T[]> {
  const [rows] = await pool.execute<T[]>(sql, params);
  return rows;
}

async function queryOne<T extends RowDataPacket>(sql: string, params: P = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

async function exec(sql: string, params: P = []): Promise<ResultSetHeader> {
  const [result] = await pool.execute<ResultSetHeader>(sql, params);
  return result;
}

function escapeIdentifier(identifier: string): string {
  return `\`${identifier.replace(/`/g, '')}\``;
}

async function countTableRows(table: string, whereClause = '', params: P = []): Promise<number> {
  const tableName = escapeIdentifier(table);
  try {
    const rows = await query<RowDataPacket>(
      `SELECT COUNT(*) AS n FROM ${tableName} ${whereClause}`,
      params
    );
    return rows[0]?.['n'] ?? 0;
  } catch (err: any) {
    if (err?.code === 'ER_NO_SUCH_TABLE') {
      return 0;
    }
    throw err;
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

// ── Comptes ───────────────────────────────────────────────────────────────────

export async function getCompteByMatricule(matricule: string): Promise<Compte | null> {
  return queryOne<Compte & RowDataPacket>(
    'SELECT * FROM comptes WHERE matricule = ?', [matricule]
  );
}

export async function getAllComptes(): Promise<Compte[]> {
  return query<Compte & RowDataPacket>('SELECT * FROM comptes ORDER BY nom, prenom');
}

export async function getComptesByRole(role: Role): Promise<Compte[]> {
  return query<Compte & RowDataPacket>(
    'SELECT * FROM comptes WHERE role = ? AND actif = 1 ORDER BY prenom, nom', [role]
  );
}

export async function createCompte(data: {
  matricule: string; nom: string; prenom: string;
  role: Role; password_hash: string;
}): Promise<number> {
  const r = await exec(
    'INSERT INTO comptes (matricule, nom, prenom, role, password_hash, created_at, updated_at) VALUES (?,?,?,?,?,?,?)',
    [data.matricule, data.nom, data.prenom, data.role, data.password_hash, nowSec(), nowSec()]
  );
  return r.insertId;
}

export async function updateCompte(
  matricule: string,
  fields: Partial<Pick<Compte, 'nom' | 'prenom' | 'role' | 'actif' | 'must_change_password'>>
): Promise<void> {
  const sets: string[] = ['updated_at=?'];
  const vals: unknown[] = [nowSec()];
  if (fields.nom !== undefined)               { sets.push('nom=?');                  vals.push(fields.nom); }
  if (fields.prenom !== undefined)            { sets.push('prenom=?');               vals.push(fields.prenom); }
  if (fields.role !== undefined)              { sets.push('role=?');                 vals.push(fields.role); }
  if (fields.actif !== undefined)             { sets.push('actif=?');                vals.push(fields.actif); }
  if (fields.must_change_password !== undefined) { sets.push('must_change_password=?'); vals.push(fields.must_change_password); }
  vals.push(matricule);
  await exec(`UPDATE comptes SET ${sets.join(',')} WHERE matricule=?`, vals);
}

export async function updatePasswordHash(matricule: string, hash: string): Promise<void> {
  await exec(
    'UPDATE comptes SET password_hash=?, must_change_password=0, failed_login_count=0, updated_at=? WHERE matricule=?',
    [hash, nowSec(), matricule]
  );
}

export async function incrementFailedLogin(matricule: string): Promise<void> {
  await exec(
    'UPDATE comptes SET failed_login_count=failed_login_count+1, updated_at=? WHERE matricule=?',
    [nowSec(), matricule]
  );
}

export async function resetFailedLogin(matricule: string): Promise<void> {
  await exec(
    'UPDATE comptes SET failed_login_count=0, locked_until=NULL, last_login_at=?, updated_at=? WHERE matricule=?',
    [nowSec(), nowSec(), matricule]
  );
}

export async function lockAccount(matricule: string, durationSec: number): Promise<void> {
  await exec(
    'UPDATE comptes SET locked_until=?, updated_at=? WHERE matricule=?',
    [nowSec() + durationSec, nowSec(), matricule]
  );
}

// ── Sessions ──────────────────────────────────────────────────────────────────

export async function insertSession(
  jti: string, matricule: string, ip: string, ua: string, expiresAt: number
): Promise<void> {
  await exec(
    'INSERT INTO sessions_v3 (jti, matricule, ip, user_agent, expires_at, created_at) VALUES (?,?,?,?,?,?)',
    [jti, matricule, ip, ua, expiresAt, nowSec()]
  );
}

export async function isSessionValid(jti: string): Promise<boolean> {
  const row = await queryOne<RowDataPacket>(
    'SELECT jti FROM sessions_v3 WHERE jti=? AND revoked=0 AND expires_at>?',
    [jti, nowSec()]
  );
  return row !== null;
}

export async function revokeSession(jti: string): Promise<void> {
  await exec('UPDATE sessions_v3 SET revoked=1 WHERE jti=?', [jti]);
}

export async function revokeAllSessions(matricule: string): Promise<void> {
  await exec('UPDATE sessions_v3 SET revoked=1 WHERE matricule=? AND revoked=0', [matricule]);
}

export async function getAllActiveSessions(): Promise<Session[]> {
  return query<Session & RowDataPacket>(
    'SELECT * FROM sessions_v3 WHERE revoked=0 AND expires_at>? ORDER BY created_at DESC',
    [nowSec()]
  );
}

// ── Dossiers ──────────────────────────────────────────────────────────────────

export async function getDossierById(id: string): Promise<Dossier | null> {
  return queryOne<Dossier & RowDataPacket>('SELECT * FROM dossiers WHERE id=?', [id]);
}

export async function getDossiers(params: {
  date?: string | null; debut?: string | null; fin?: string | null;
  statut?: string | null; agent?: string | null; search?: string | null;
  limit?: number; offset?: number;
}): Promise<{ rows: Dossier[]; total: number }> {
  let where = 'WHERE 1=1';
  const p: unknown[] = [];

  if (params.date) { where += ' AND date=?'; p.push(params.date); }
  if (params.debut) { where += ' AND date>=?'; p.push(params.debut); }
  if (params.fin)   { where += ' AND date<=?'; p.push(params.fin); }
  if (params.statut) { where += ' AND statut=?'; p.push(params.statut); }
  if (params.agent) {
    where += " AND (statut='en_attente' OR agent_saisie=?)";
    p.push(params.agent);
  }
  if (params.search) {
    where += ' AND (numero_mtn LIKE ? OR username_agent LIKE ? OR id LIKE ?)';
    const s = `%${params.search}%`;
    p.push(s, s, s);
  }

  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM dossiers ${where}`, p as P
  );
  const total = (countRows[0] as RowDataPacket)['n'] as number;

  const limit  = Math.max(0, Math.floor(params.limit ?? 100));
  const offset = Math.max(0, Math.floor(params.offset ?? 0));
  const rows = await query<Dossier & RowDataPacket>(
    `SELECT * FROM dossiers ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    p
  );

  return { rows, total };
}

export async function getDossierStats(date: string): Promise<{
  en_attente: number; en_cours: number; accepte: number; rejete: number; total: number;
}> {
  const rows = await query<RowDataPacket>(
    'SELECT statut, COUNT(*) AS n FROM dossiers WHERE date=? GROUP BY statut', [date]
  );
  const s = { en_attente: 0, en_cours: 0, accepte: 0, rejete: 0, total: 0 };
  for (const r of rows) {
    const st = r['statut'] as string;
    const n  = r['n'] as number;
    if (st in s) (s as Record<string, number>)[st] = n;
    s.total += n;
  }
  return s;
}

export async function createDossier(data: {
  id: string; numero_mtn: string; wa_agent?: string; username_agent?: string;
  fonction_agent?: string; zone_agent?: string; date: string;
  heure_reception: string; photo_recto?: string; photo_verso?: string; photo_live?: string;
  score_visage?: number | null; visage_match?: number | null; visage_motif?: string;
  visage_verifie_le?: number | null;
}): Promise<void> {
  const now = nowSec();
  await exec(
    `INSERT INTO dossiers (id, numero_mtn, wa_agent, username_agent, fonction_agent, zone_agent,
      date, heure_reception, photo_recto, photo_verso, photo_live, score_visage, visage_match,
      visage_motif, visage_verifie_le, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?, ?)`,
    [
      data.id, data.numero_mtn, data.wa_agent ?? null, data.username_agent ?? null,
      data.fonction_agent ?? null, data.zone_agent ?? null,
      data.date, data.heure_reception,
      data.photo_recto ?? null, data.photo_verso ?? null, data.photo_live ?? null,
      data.score_visage ?? null, data.visage_match ?? null, data.visage_motif ?? null,
      data.visage_verifie_le ?? null, now, now,
    ]
  );
}

export async function updateDossier(
  id: string,
  fields: Partial<Dossier>
): Promise<void> {
  const allowed = [
    'statut', 'agent_saisie', 'heure_prise', 'heure_cloture', 'raison_rejet',
    'resultat_crm', 'assigne_a', 'assigne_le', 'closed_at', 'transfert_message',
    'transfert_par', 'gsm_complete', 'note', 'note_superviseur',
    'numero_mtn', 'wa_agent', 'username_agent', 'fonction_agent', 'zone_agent',
    'date', 'heure_reception', 'photo_recto', 'photo_verso', 'photo_live',
    'score_visage', 'visage_match', 'visage_motif', 'visage_verifie_le',
  ];
  const sets: string[] = ['updated_at=?'];
  const vals: unknown[] = [nowSec()];
  for (const key of allowed) {
    if (key in fields) {
      sets.push(`${key}=?`);
      vals.push((fields as Record<string, unknown>)[key]);
    }
  }
  vals.push(id);
  await exec(`UPDATE dossiers SET ${sets.join(',')} WHERE id=?`, vals);
}

// ── GSM ───────────────────────────────────────────────────────────────────────

export async function getGsmSaisies(params: {
  agent?: string; dossier_id?: string; date?: string;
  debut?: string; fin?: string; limit?: number;
}): Promise<GsmRecord[]> {
  let where = 'WHERE 1=1';
  const p: unknown[] = [];
  if (params.agent)     { where += ' AND agent_ctrl=?';   p.push(params.agent); }
  if (params.dossier_id){ where += ' AND dossier_id=?';   p.push(params.dossier_id); }
  if (params.date)      { where += ' AND date_saisie=?';  p.push(params.date); }
  if (params.debut)     { where += ' AND date_saisie>=?'; p.push(params.debut); }
  if (params.fin)       { where += ' AND date_saisie<=?'; p.push(params.fin); }
  const limit = params.limit ?? 500;
  return query<GsmRecord & RowDataPacket>(
    `SELECT * FROM gsm ${where} ORDER BY date_saisie DESC, created_at DESC LIMIT ?`,
    [...p, limit]
  );
}

export async function getGsmById(id: number): Promise<GsmRecord | null> {
  return queryOne<GsmRecord & RowDataPacket>('SELECT * FROM gsm WHERE id=?', [id]);
}

export async function createGsm(data: Omit<GsmRecord, 'id' | 'created_at'>): Promise<number> {
  const r = await exec(
    `INSERT INTO gsm (numero, agent_ctrl, date_saisie, heure_saisie, coach, type_id,
      constat, piece, verbatim, action, statut_final, traitement, raison, nom_client,
      observations, dossier_id, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      data.numero, data.agent_ctrl, data.date_saisie, data.heure_saisie ?? null,
      data.coach ?? null, data.type_id ?? null, data.constat ?? null, data.piece ?? null,
      data.verbatim ?? null, data.action ?? null, data.statut_final ?? null,
      data.traitement ?? null, data.raison ?? null, data.nom_client ?? null,
      data.observations ?? null, data.dossier_id ?? null, nowSec(),
    ]
  );
  return r.insertId;
}

export async function updateGsm(id: number, fields: Partial<GsmRecord>): Promise<void> {
  const allowed = ['coach', 'type_id', 'constat', 'piece', 'verbatim', 'action',
    'statut_final', 'traitement', 'raison', 'nom_client', 'observations',
    'capture_a', 'capture_p', 'capture_aa'];
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const key of allowed) {
    if (key in fields) { sets.push(`${key}=?`); vals.push((fields as Record<string, unknown>)[key]); }
  }
  if (!sets.length) return;
  vals.push(id);
  await exec(`UPDATE gsm SET ${sets.join(',')} WHERE id=?`, vals);
}

export async function deleteGsm(id: number): Promise<void> {
  await exec('DELETE FROM gsm WHERE id=?', [id]);
}

export async function getGsmStats(matricule: string): Promise<{
  total: number; aujourdhui: number; sept_jours: number; mois_paie: number;
  libelle_mois_paie: string; dernieres: GsmRecord[];
}> {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const today = ymd(now);
  const il7 = new Date(now); il7.setDate(il7.getDate() - 6);
  const debut7 = ymd(il7);

  let debutPaie: Date, finPaie: Date;
  if (now.getDate() >= 15) {
    debutPaie = new Date(now.getFullYear(), now.getMonth(), 15);
    finPaie   = new Date(now.getFullYear(), now.getMonth() + 1, 14);
  } else {
    debutPaie = new Date(now.getFullYear(), now.getMonth() - 1, 15);
    finPaie   = new Date(now.getFullYear(), now.getMonth(), 14);
  }
  const MOIS = ['Janv','Févr','Mars','Avr','Mai','Juin','Juil','Août','Sept','Oct','Nov','Déc'];
  const libelle = `${MOIS[finPaie.getMonth()]} ${finPaie.getFullYear()}`;

  const count = async (cond: string, params: unknown[]) => {
    const rows = await query<RowDataPacket>(
      `SELECT COUNT(*) AS n FROM gsm WHERE agent_ctrl=? ${cond}`, [matricule, ...params]
    );
    return rows[0]?.['n'] ?? 0;
  };

  const [total, aujourdhui, sept_jours, mois_paie, dernieres] = await Promise.all([
    count('', []),
    count('AND date_saisie=?', [today]),
    count('AND date_saisie>=? AND date_saisie<=?', [debut7, today]),
    count('AND date_saisie>=? AND date_saisie<=?', [ymd(debutPaie), ymd(finPaie)]),
    query<GsmRecord & RowDataPacket>(
      'SELECT id, numero, date_saisie, constat, statut_final FROM gsm WHERE agent_ctrl=? ORDER BY created_at DESC LIMIT 5',
      [matricule]
    ),
  ]);

  return { total, aujourdhui, sept_jours, mois_paie, libelle_mois_paie: libelle, dernieres };
}

export async function getGsmPerfs(matricule: string, debut: string, fin: string): Promise<{
  evolution: { jour: string; n: number }[];
  stats: { total: number; jours_travailles: number; jours_periode: number; moyenne: number; meilleur_jour: { jour: string | null; n: number } };
}> {
  const rows = await query<RowDataPacket>(
    'SELECT date_saisie AS jour, COUNT(*) AS n FROM gsm WHERE agent_ctrl=? AND date_saisie>=? AND date_saisie<=? GROUP BY date_saisie ORDER BY date_saisie',
    [matricule, debut, fin]
  );
  const evolution = rows.map(r => ({ jour: r['jour'] as string, n: r['n'] as number }));
  let total = 0;
  let meilleur = { jour: null as string | null, n: 0 };
  for (const e of evolution) {
    total += e.n;
    if (e.n > meilleur.n) meilleur = { jour: e.jour, n: e.n };
  }
  const jours_travailles = evolution.length;
  const d1 = new Date(debut + 'T00:00:00');
  const d2 = new Date(fin   + 'T00:00:00');
  const jours_periode = Math.max(1, Math.round((d2.getTime() - d1.getTime()) / 86400000) + 1);
  const moyenne = jours_travailles > 0 ? Math.round(total / jours_travailles * 10) / 10 : 0;
  return { evolution, stats: { total, jours_travailles, jours_periode, moyenne, meilleur_jour: meilleur } };
}

// ── GSM Compilation (sup) ─────────────────────────────────────────────────────

export async function getGsmCompilation(debut?: string | null, fin?: string | null): Promise<GsmRecord[]> {
  let where = 'WHERE 1=1';
  const p: unknown[] = [];
  if (debut) { where += ' AND date_saisie>=?'; p.push(debut); }
  if (fin)   { where += ' AND date_saisie<=?'; p.push(fin); }
  return query<GsmRecord & RowDataPacket>(
    `SELECT * FROM gsm ${where} ORDER BY date_saisie DESC, created_at DESC LIMIT 5000`, p
  );
}

// ── Planning ──────────────────────────────────────────────────────────────────

export async function getPlanningAgent(matricule: string, debut: string, fin: string): Promise<PlanningEntry[]> {
  return query<PlanningEntry & RowDataPacket>(
    'SELECT * FROM planning WHERE matricule=? AND date>=? AND date<=? ORDER BY date',
    [matricule, debut, fin]
  );
}

export async function getPlanningAll(debut?: string | null, fin?: string | null): Promise<PlanningEntry[]> {
  let where = 'WHERE 1=1';
  const p: unknown[] = [];
  if (debut) { where += ' AND date>=?'; p.push(debut); }
  if (fin)   { where += ' AND date<=?'; p.push(fin); }
  return query<PlanningEntry & RowDataPacket>(
    `SELECT * FROM planning ${where} ORDER BY date, matricule`, p
  );
}

export async function upsertPlanningEntries(entries: Omit<PlanningEntry, 'updated_at'>[]): Promise<number> {
  let count = 0;
  for (const e of entries) {
    if (!e.id || !e.date) continue;
    await exec(
      `INSERT INTO planning (id, matricule, nom, statut, quartier, date, type, horaire, heure_debut, heure_fin, activite, lieu, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE matricule=VALUES(matricule), nom=VALUES(nom), statut=VALUES(statut),
       quartier=VALUES(quartier), date=VALUES(date), type=VALUES(type), horaire=VALUES(horaire),
       heure_debut=VALUES(heure_debut), heure_fin=VALUES(heure_fin), activite=VALUES(activite),
       lieu=VALUES(lieu), updated_at=VALUES(updated_at)`,
      [e.id, e.matricule, e.nom, e.statut, e.quartier, e.date, e.type, e.horaire,
       e.heure_debut, e.heure_fin, e.activite, e.lieu, nowSec()]
    );
    count++;
  }
  return count;
}

// ── Planning Manager ──────────────────────────────────────────────────────────

export async function getPlanningManager(semaine: string): Promise<PlanningManager | null> {
  return queryOne<PlanningManager & RowDataPacket>(
    'SELECT * FROM planning_managers WHERE semaine=?', [semaine]
  );
}

export async function listPlanningManagerSemaines(): Promise<string[]> {
  const rows = await query<RowDataPacket>(
    'SELECT semaine FROM planning_managers ORDER BY semaine DESC LIMIT 52'
  );
  return rows.map(r => r['semaine'] as string);
}

export async function upsertPlanningManager(semaine: string, titre: string, data: string): Promise<void> {
  await exec(
    `INSERT INTO planning_managers (semaine, titre, data, updated_at) VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE titre=VALUES(titre), data=VALUES(data), updated_at=VALUES(updated_at)`,
    [semaine, titre, data, nowSec()]
  );
}

// ── Notes qualité ─────────────────────────────────────────────────────────────

export async function getNotesQualite(params: {
  matricule?: string; mois?: number; annee?: number; campagne?: string;
}): Promise<NoteQualite[]> {
  let where = 'WHERE 1=1';
  const p: unknown[] = [];
  if (params.matricule) { where += ' AND matricule=?'; p.push(params.matricule); }
  if (params.mois)      { where += ' AND mois=?';      p.push(params.mois); }
  if (params.annee)     { where += ' AND annee=?';     p.push(params.annee); }
  if (params.campagne)  { where += ' AND campagne=?';  p.push(params.campagne); }
  return query<NoteQualite & RowDataPacket>(
    `SELECT * FROM notes_qualite ${where} ORDER BY annee DESC, mois DESC`, p
  );
}

export async function upsertNotesQualite(notes: NoteQualite[]): Promise<number> {
  let count = 0;
  for (const n of notes) {
    if (!n.id) continue;
    await exec(
      `INSERT INTO notes_qualite
        (id, matricule, nom, statut, campagne, equipe, mois, annee,
         note_w1, note_w2, note_w3, note_w4, statut_w1, statut_w2, statut_w3, statut_w4,
         commentaire_w4, moyenne, tl, backup, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         matricule=VALUES(matricule), nom=VALUES(nom), statut=VALUES(statut),
         campagne=VALUES(campagne), equipe=VALUES(equipe), mois=VALUES(mois), annee=VALUES(annee),
         note_w1=VALUES(note_w1), note_w2=VALUES(note_w2), note_w3=VALUES(note_w3), note_w4=VALUES(note_w4),
         statut_w1=VALUES(statut_w1), statut_w2=VALUES(statut_w2), statut_w3=VALUES(statut_w3), statut_w4=VALUES(statut_w4),
         commentaire_w4=VALUES(commentaire_w4), moyenne=VALUES(moyenne), tl=VALUES(tl), backup=VALUES(backup),
         updated_at=VALUES(updated_at)`,
      [n.id, n.matricule, n.nom, n.statut, n.campagne, n.equipe, n.mois, n.annee,
       n.note_w1, n.note_w2, n.note_w3, n.note_w4, n.statut_w1, n.statut_w2, n.statut_w3, n.statut_w4,
       n.commentaire_w4, n.moyenne, n.tl, n.backup, nowSec()]
    );
    count++;
  }
  return count;
}

// ── Présence ──────────────────────────────────────────────────────────────────

export async function upsertPresence(
  matricule: string,
  statut: 'online' | 'pause' | 'offline',
  extra?: { pause_debut?: number | null; dispo_depuis?: number | null }
): Promise<void> {
  const sets: Record<string, unknown> = { statut, ts: nowSec(), updated_at: nowSec() };
  if (extra?.pause_debut !== undefined)  sets.pause_debut  = extra.pause_debut;
  if (extra?.dispo_depuis !== undefined) sets.dispo_depuis = extra.dispo_depuis;

  const cols = ['nom', ...Object.keys(sets)];
  const vals = [matricule, ...Object.values(sets)];
  const placeholders = vals.map(() => '?').join(',');
  const updates = Object.keys(sets).map(k => `${k}=VALUES(${k})`).join(',');

  await exec(
    `INSERT INTO presence (${cols.join(',')}) VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updates}`,
    vals
  );
}

export async function getPresenceResume(heartbeatThreshold = 120): Promise<{
  en_ligne: number; en_pause: number; detail: Record<string, string>;
}> {
  const limite = nowSec() - heartbeatThreshold;
  const rows = await query<RowDataPacket>(
    "SELECT nom, statut FROM presence WHERE statut IN ('online','pause') AND ts>=?", [limite]
  );
  let en_ligne = 0, en_pause = 0;
  const detail: Record<string, string> = {};
  for (const r of rows) {
    detail[r['nom'] as string] = r['statut'] as string;
    if (r['statut'] === 'online') en_ligne++;
    else en_pause++;
  }
  return { en_ligne, en_pause, detail };
}

export async function getPresenceAll(): Promise<PresenceRow[]> {
  return query<PresenceRow & RowDataPacket>(
    'SELECT * FROM presence ORDER BY statut, nom'
  );
}

// ── Config ────────────────────────────────────────────────────────────────────

export async function getConfig(cle: string): Promise<string | null> {
  const row = await queryOne<ConfigRow & RowDataPacket>('SELECT valeur FROM config WHERE cle=?', [cle]);
  return row?.valeur ?? null;
}

export async function setConfig(cle: string, valeur: string): Promise<void> {
  await exec(
    'INSERT INTO config (cle, valeur, updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE valeur=VALUES(valeur), updated_at=VALUES(updated_at)',
    [cle, valeur, nowSec()]
  );
}

export async function getAllConfig(): Promise<ConfigRow[]> {
  return query<ConfigRow & RowDataPacket>('SELECT * FROM config ORDER BY cle');
}

// ── Audit ─────────────────────────────────────────────────────────────────────

export function audit(
  matricule: string | null, action: string, details?: string,
  ip?: string, ua?: string
): void {
  exec(
    'INSERT INTO audit_log (user_matricule, action, details, ip, user_agent, created_at) VALUES (?,?,?,?,?,?)',
    [matricule ?? null, action, details ?? null, ip ?? null, ua ?? null, nowSec()]
  ).catch(err => console.error('[AUDIT ERROR]', err));
}

export async function getAuditLogs(params: {
  matricule?: string; action?: string; debut?: number; fin?: number;
  limit?: number; offset?: number;
}): Promise<{ rows: AuditLog[]; total: number }> {
  let where = 'WHERE 1=1';
  const p: unknown[] = [];
  if (params.matricule) { where += ' AND user_matricule=?'; p.push(params.matricule); }
  if (params.action)    { where += ' AND action LIKE ?';    p.push(`%${params.action}%`); }
  if (params.debut)     { where += ' AND created_at>=?';    p.push(params.debut); }
  if (params.fin)       { where += ' AND created_at<=?';    p.push(params.fin); }

  const [countRows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM audit_log ${where}`, p as P
  );
  const total = (countRows[0] as RowDataPacket)['n'] as number;
  const limit  = params.limit  ?? 200;
  const offset = params.offset ?? 0;
  const rows = await query<AuditLog & RowDataPacket>(
    `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
    p
  );
  return { rows, total };
}

// ── Distribution ──────────────────────────────────────────────────────────────

export async function getDistributionMode(): Promise<'auto' | 'manuel'> {
  const v = await getConfig('distribution_mode');
  return v === 'auto' ? 'auto' : 'manuel';
}

export async function getOldestPendingDossier(): Promise<Dossier | null> {
  return queryOne<Dossier & RowDataPacket>(
    "SELECT * FROM dossiers WHERE statut='en_attente' ORDER BY created_at ASC LIMIT 1"
  );
}

export async function getOldestAvailableAgent(ts: number): Promise<{ nom: string } | null> {
  return queryOne<RowDataPacket>(
    `SELECT p.nom FROM presence p
     WHERE p.statut='online' AND p.ts>=?
     AND NOT EXISTS (
       SELECT 1 FROM dossiers d
       WHERE d.agent_saisie=p.nom AND d.statut='en_cours'
     )
     ORDER BY p.dispo_depuis IS NULL, p.dispo_depuis ASC
     LIMIT 1`,
    [ts]
  ) as Promise<{ nom: string } | null>;
}

// ── Habilitations ─────────────────────────────────────────────────────────────

export async function getHabilitations(): Promise<Record<string, Record<string, string>>> {
  const val = await getConfig('habilitations_sup');
  if (!val) return {};
  try { return JSON.parse(val); } catch { return {}; }
}

export async function setHabilitations(data: Record<string, Record<string, string>>): Promise<void> {
  await setConfig('habilitations_sup', JSON.stringify(data));
}

// ── Referentiels GSM ──────────────────────────────────────────────────────────

export async function getReferentiels(): Promise<Record<string, string[]>> {
  const val = await getConfig('referentiels_gsm');
  if (!val) return {};
  try { return JSON.parse(val); } catch { return {}; }
}

export async function setReferentiels(data: Record<string, string[]>): Promise<void> {
  await setConfig('referentiels_gsm', JSON.stringify(data));
}

// ── Purge ─────────────────────────────────────────────────────────────────────

export async function purgeCount(action: string, du?: string, au?: string): Promise<number> {
  let where = '';
  const p: unknown[] = [];
  if (du) { where += ' AND date>=?'; p.push(du); }
  if (au) { where += ' AND date<=?'; p.push(au); }

  let sql: string;
  switch (action) {
    case 'images_cni':
      sql = `SELECT COUNT(*) AS n FROM dossiers WHERE (photo_recto IS NOT NULL OR photo_verso IS NOT NULL OR photo_live IS NOT NULL)${where}`;
      break;
    case 'captures_gsm':
      sql = `SELECT COUNT(*) AS n FROM gsm WHERE (capture_a IS NOT NULL OR capture_p IS NOT NULL OR capture_aa IS NOT NULL)`;
      break;
    case 'saisies_gsm':
      sql = `SELECT COUNT(*) AS n FROM gsm WHERE 1=1`;
      break;
    case 'dossiers':
      sql = `SELECT COUNT(*) AS n FROM dossiers WHERE 1=1${where}`;
      break;
    default:
      return 0;
  }
  const rows = await query<RowDataPacket>(sql, p);
  return rows[0]?.['n'] ?? 0;
}

export async function purgeExecute(
  action: string, codeSecret: string, du?: string, au?: string
): Promise<{ count: number }> {
  const storedCode = await getConfig('code_purge');
  if (!storedCode || storedCode !== codeSecret) {
    throw new Error('Code secret incorrect');
  }
  let where = '';
  const p: unknown[] = [];
  if (du) { where += ' AND date>=?'; p.push(du); }
  if (au) { where += ' AND date<=?'; p.push(au); }

  let r: ResultSetHeader;
  switch (action) {
    case 'images_cni':
      r = await exec(
        `UPDATE dossiers SET photo_recto=NULL, photo_verso=NULL, photo_live=NULL WHERE (photo_recto IS NOT NULL OR photo_verso IS NOT NULL OR photo_live IS NOT NULL)${where}`,
        p
      );
      break;
    case 'captures_gsm':
      r = await exec(
        'UPDATE gsm SET capture_a=NULL, capture_p=NULL, capture_aa=NULL WHERE (capture_a IS NOT NULL OR capture_p IS NOT NULL OR capture_aa IS NOT NULL)',
        []
      );
      break;
    case 'saisies_gsm':
      r = await exec('DELETE FROM gsm WHERE 1=1', []);
      break;
    case 'dossiers':
      r = await exec(`DELETE FROM dossiers WHERE 1=1${where}`, p);
      break;
    default:
      throw new Error('Action inconnue');
  }
  return { count: r.affectedRows };
}

// ── Stockage ──────────────────────────────────────────────────────────────────

export async function getStorageStats(): Promise<{
  dossiers: number; gsm: number; photos_cni: number; captures_gsm: number;
  planning: number; notes: number;
}> {
  const counts = await Promise.all([
    countTableRows('dossiers'),
    countTableRows('gsm'),
    countTableRows('dossiers', 'WHERE photo_recto IS NOT NULL OR photo_verso IS NOT NULL'),
    countTableRows('gsm', 'WHERE capture_a IS NOT NULL OR capture_p IS NOT NULL OR capture_aa IS NOT NULL'),
    countTableRows('planning'),
    countTableRows('notes_qualite'),
  ]);
  return {
    dossiers:    counts[0],
    gsm:         counts[1],
    photos_cni:  counts[2],
    captures_gsm: counts[3],
    planning:    counts[4],
    notes:       counts[5],
  };
}

export { pool };
