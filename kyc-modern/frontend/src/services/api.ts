import type { Dossier, DossierStats, GsmRecord, GsmStats, PlanningEntry, NoteQualite, Compte, Session, AuditLog, AdminStats, PresenceResume, User } from '../types';

const configuredBase = (import.meta.env.VITE_API_BASE_URL || '').trim();

function resolveApiBase(): string {
  if (!configuredBase) {
    return typeof window !== 'undefined' ? window.location.origin : '';
  }

  const isLocalConfiguredHost = /^(http:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/i.test(configuredBase);
  if (isLocalConfiguredHost && typeof window !== 'undefined') {
    const host = window.location.hostname;
    const isRemoteHost = host !== 'localhost' && host !== '127.0.0.1' && host !== '0.0.0.0';
    if (isRemoteHost) {
      return window.location.origin;
    }
  }

  return configuredBase;
}

const BASE = resolveApiBase();
let _token: string | null = null;

export function setToken(t: string | null) {
  _token = t;
  if (typeof document !== 'undefined') {
    if (t) {
      document.cookie = `kyc_token=${encodeURIComponent(t)}; path=/;`;
    } else {
      document.cookie = 'kyc_token=; path=/; max-age=0';
    }
  }
}
export function getToken() { return _token; }

export class ApiError extends Error {
  constructor(public message: string, public status: number, public details?: string[]) {
    super(message); this.name = 'ApiError';
  }
}

export async function apiFetch<T>(endpoint: string, opts: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = opts;
  const isForm = rest.body instanceof FormData;
  const headers: Record<string, string> = {};
  if (json !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (_token) {
    headers['Authorization'] = `Bearer ${_token}`;
    console.log('[apiFetch] Token présent, longueur:', _token.length);
  } else {
    console.warn('[apiFetch] Aucun token disponible');
  }
  const res = await fetch(`${BASE}${endpoint}`, {
    credentials: 'include', headers, body: json !== undefined ? JSON.stringify(json) : rest.body, ...rest,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    console.error('[apiFetch] Erreur:', res.status, body);
    throw new ApiError(body?.error || res.statusText || 'Erreur API', res.status, body?.details);
  }
  return body as T;
}

// ── Auth ──────────────────────────────────────────────────────────────────────
export async function login(matricule: string, password: string) {
  const d = await apiFetch<{ success: boolean; token: string; must_change_password: boolean; user: { matricule: string; nom: string; prenom: string; role: string } }>('/api/auth/login', { method: 'POST', json: { matricule, password } });
  setToken(d.token); return d;
}
export async function logout() { try { await apiFetch('/api/auth/logout', { method: 'POST' }); } finally { setToken(null); } }
export async function getMe() { return apiFetch<{ user: User }>('/api/auth/me'); }
export async function changePassword(current_password: string, new_password: string) {
  return apiFetch<{ success: boolean }>('/api/auth/change-password', { method: 'POST', json: { current_password, new_password } });
}

// ── Dossiers ──────────────────────────────────────────────────────────────────
export async function getDossiers(p: { date?: string; debut?: string; fin?: string; statut?: string; agent?: string; search?: string; limit?: number; offset?: number } = {}) {
  const qs = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
  return apiFetch<{ success: boolean; total: number; count: number; dossiers: Dossier[] }>(`/api/dossiers?${qs}`);
}
export async function getDossierStats(date?: string) { return apiFetch<DossierStats>(`/api/dossiers/stats${date ? `?date=${date}` : ''}`); }
export async function getDossier(id: string) { return apiFetch<{ dossier: Dossier }>(`/api/dossiers/${id}`); }
export async function prendreEnCharge(id: string) { return apiFetch<{ success: boolean }>(`/api/dossiers/${id}/prendre`, { method: 'POST' }); }
export async function accepterDossier(id: string, resultat_crm?: string) { return apiFetch<{ success: boolean }>(`/api/dossiers/${id}/accepter`, { method: 'POST', json: { resultat_crm } }); }
export async function rejeterDossier(id: string, raison: string) { return apiFetch<{ success: boolean }>(`/api/dossiers/${id}/rejeter`, { method: 'POST', json: { raison } }); }
export async function reprendreFaceVerify(id: string) { return apiFetch<{ success: boolean; message: string }>(`/api/dossiers/${id}/reprendre-face-verify`, { method: 'POST' }); }
export async function transfererDossier(id: string, cible: string, message?: string) { return apiFetch<{ success: boolean }>(`/api/dossiers/${id}/transferer`, { method: 'POST', json: { cible, message } }); }
export async function verifierVisage(id: string) { return apiFetch<{ score: number; match: boolean; motif: string }>(`/api/dossiers/${id}/verifier-visage`, { method: 'POST' }); }
export function photoUrl(id: string, type: 'recto' | 'verso' | 'live') { return `${BASE}/api/dossiers/${id}/photo/${type}`; }
export function photoUrlWithToken(id: string, type: 'recto' | 'verso' | 'live') {
  const base = `${BASE}/api/dossiers/${id}/photo/${type}`;
  // Prefer in-memory token, fallback to cookie or localStorage when available
  const token = _token || (typeof document !== 'undefined' ? (
    // try cookie
    (document.cookie || '').split(';').map(s => s.trim()).reduce((acc, cur) => {
      if (!acc && cur.startsWith('kyc_token=')) return decodeURIComponent(cur.split('=')[1] || '');
      return acc;
    }, '') || localStorage.getItem('kyc4-token') || ''
  ) : '');
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}
export async function getDossiersHistorique(p: { debut?: string; fin?: string; statut?: string; agent?: string; search?: string; limit?: number; offset?: number } = {}) {
  const qs = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
  return apiFetch<{ success: boolean; total: number; count: number; dossiers: Dossier[] }>(`/api/dossiers/historique?${qs}`);
}
export async function getAdminReporting(p: { debut?: string; fin?: string; statut?: string; agent?: string; search?: string } = {}) {
  const qs = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
  return apiFetch<{ success: boolean; total: number; count: number; dossiers: Dossier[]; stats: Record<string, number>; byAgent: Array<{ agent: string; total: number; accepte: number; rejete: number; en_cours: number }> }>(`/api/admin/reporting?${qs}`);
}
export async function submitDossierPublic(formData: FormData) { return apiFetch<{ success: boolean; id: string; ref: string; numero: string }>('/api/public/dossiers', { method: 'POST', body: formData }); }

// ── Face Verify (terrain public) ──────────────────────────────────────────────
export async function verifyFaceRealtime(videoFrame: Blob, recto_path: string): Promise<{ success: boolean; score: number; match: boolean | null; motif: string; message: string }> {
  const fd = new FormData();
  fd.append('video_frame', videoFrame, 'live-front.jpg');
  fd.append('recto_path', recto_path);
  return apiFetch('/api/dossiers/verify-face-realtime', { method: 'POST', body: fd });
}

export async function completeWithFaceVerify(formData: FormData): Promise<{
  success: boolean; id: string; numero: string;
  score_visage: number | null; visage_motif: string; message: string;
}> {
  return apiFetch('/api/dossiers/complete-with-face-verify', { method: 'POST', body: formData });
}

export async function getPublicDossiers(wa_agent: string): Promise<{
  success: boolean; count: number; dossiers: unknown[]; stats: Record<string, number>;
}> {
  const wa = wa_agent.replace(/\D/g, '');
  return apiFetch(`/api/public/dossiers?wa_agent=${wa}`);
}

export async function callTerrain(numero: string, numeroMtn: string): Promise<{ success: boolean; message: string }> {
  return apiFetch<{ success: boolean; message: string }>('/api/call/test', {
    method: 'POST',
    json: { numero, numeroMtn },
  });
}

export async function prepareVerifySession(data: {
  numero_mtn: string; country: string; recto_path: string; verso_path: string;
  wa_agent: string; username_agent: string; fonction_agent: string; zone_agent: string;
}): Promise<{ success: boolean; sessionId: string; redirectUrl?: string }> {
  return apiFetch('/api/dossiers/prepare-verify-session', { method: 'POST', json: data });
}

// ── GSM ───────────────────────────────────────────────────────────────────────
export async function getGsmMonTableau() { return apiFetch<GsmStats & { success: boolean }>('/api/gsm/mon-tableau'); }
export async function getGsmMesSaisies(date?: string) { return apiFetch<{ success: boolean; count: number; saisies: GsmRecord[] }>(`/api/gsm/mes-saisies${date ? `?date=${date}` : ''}`); }
export async function getGsmMesHistorique(debut?: string, fin?: string) {
  const qs = new URLSearchParams(); if (debut) qs.set('debut', debut); if (fin) qs.set('fin', fin);
  return apiFetch<{ success: boolean; count: number; saisies: GsmRecord[] }>(`/api/gsm/mes-historique?${qs}`);
}
export async function getGsmMesPerfs(debut: string, fin: string) { return apiFetch<{ success: boolean; evolution: { jour: string; n: number }[]; stats: unknown }>(`/api/gsm/mes-perfs?debut=${debut}&fin=${fin}`); }
export async function createGsmLibre(data: Record<string, string | undefined>) { return apiFetch<{ success: boolean; id: number }>('/api/gsm/libre', { method: 'POST', json: data }); }
export async function updateGsm(id: number, data: Record<string, unknown>) { return apiFetch<{ success: boolean }>(`/api/gsm/${id}`, { method: 'PUT', json: data }); }
export async function deleteGsm(id: number) { return apiFetch<{ success: boolean }>(`/api/gsm/${id}`, { method: 'DELETE' }); }
export async function uploadGsmCaptures(id: number, formData: FormData) { return apiFetch<{ success: boolean; uploads: Record<string, string> }>(`/api/gsm/${id}/captures`, { method: 'POST', body: formData }); }
export async function getGsmCompilation(debut?: string, fin?: string) {
  const qs = new URLSearchParams(); if (debut) qs.set('debut', debut); if (fin) qs.set('fin', fin);
  return apiFetch<{ success: boolean; count: number; saisies: GsmRecord[] }>(`/api/gsm/compilation?${qs}`);
}
export async function exportGsmCaptures(params: { numero?: string; du?: string; au?: string } = {}) {
  const qs = new URLSearchParams(); Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
  return apiFetch<{ success: boolean; count: number; saisies: Array<{ id: number | string; numero: string; date_saisie: string; captures: Array<{ field: string; filename: string; url: string }> }> }>(`/api/gsm/export-captures${qs.toString() ? `?${qs}` : ''}`);
}
export async function exportGsmCsv(params: { numero?: string; du?: string; au?: string } = {}) {
  const qs = new URLSearchParams(); Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, v); });
  return apiFetch<string>(`/api/gsm/export-csv${qs.toString() ? `?${qs}` : ''}`);
}
export async function getReferentiels() { return apiFetch<{ success: boolean; referentiels: Record<string, string[]> }>('/api/gsm/referentiels'); }

// ── Planning ──────────────────────────────────────────────────────────────────
export async function getPlanningMon(debut: string, fin: string) { return apiFetch<{ success: boolean; count: number; entrees: PlanningEntry[] }>(`/api/planning/mon?debut=${debut}&fin=${fin}`); }
export async function getPlanningAll(debut?: string, fin?: string) {
  const qs = new URLSearchParams(); if (debut) qs.set('debut', debut); if (fin) qs.set('fin', fin);
  return apiFetch<{ success: boolean; count: number; entrees: PlanningEntry[] }>(`/api/planning?${qs}`);
}
export async function importPlanning(entrees: PlanningEntry[]) { return apiFetch<{ success: boolean; count: number }>('/api/planning/import', { method: 'POST', json: { entrees } }); }
export async function getPlanningManager(semaine: string) { return apiFetch<{ success: boolean; data: unknown }>(`/api/planning-managers?semaine=${semaine}`); }
export async function savePlanningManager(semaine: string, titre: string, shifts: unknown[]) { return apiFetch<{ success: boolean }>('/api/planning-managers', { method: 'POST', json: { semaine, titre, shifts } }); }

// ── Notes qualité ─────────────────────────────────────────────────────────────
export async function getNotesQualiteMes() { return apiFetch<{ success: boolean; count: number; notes: NoteQualite[] }>('/api/notes-qualite/mes'); }
export async function getNotesQualiteAll(p: { mois?: number; annee?: number; campagne?: string } = {}) {
  const qs = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => { if (v !== undefined) qs.set(k, String(v)); });
  return apiFetch<{ success: boolean; count: number; notes: NoteQualite[] }>(`/api/notes-qualite?${qs}`);
}
export async function importNotesQualite(notes: NoteQualite[]) { return apiFetch<{ success: boolean; count: number }>('/api/notes-qualite/import', { method: 'POST', json: { notes } }); }

// ── Présence ──────────────────────────────────────────────────────────────────
export async function sendHeartbeat() { return apiFetch<{ success: boolean }>('/api/presence/heartbeat', { method: 'POST' }); }
export async function setPresenceStatut(statut: string) { return apiFetch<{ success: boolean }>('/api/presence/statut', { method: 'POST', json: { statut } }); }
export async function getPresenceResume() { return apiFetch<PresenceResume & { success: boolean }>('/api/presence/resume'); }

// ── Config ────────────────────────────────────────────────────────────────────
export async function getDistributionMode() { return apiFetch<{ success: boolean; mode: string }>('/api/config/distribution-mode'); }
export async function setDistributionMode(mode: string) { return apiFetch<{ success: boolean }>('/api/config/distribution-mode', { method: 'PUT', json: { mode } }); }
export async function getRejectionMotifs() { return apiFetch<{ success: boolean; motifs: string[] }>('/api/config/rejection-motifs'); }
export async function setRejectionMotifs(motifs: string[]) { return apiFetch<{ success: boolean; motifs: string[] }>('/api/config/rejection-motifs', { method: 'PUT', json: { motifs } }); }
export async function getSeuilAlerte() { return apiFetch<{ success: boolean; seuil: number }>('/api/config/seuil-alerte'); }
export async function setSeuilAlerte(seuil: number) { return apiFetch<{ success: boolean }>('/api/config/seuil-alerte', { method: 'PUT', json: { seuil } }); }
export async function getConfigReferentiels() { return apiFetch<{ success: boolean; referentiels: Record<string, string[]> }>('/api/config/referentiels-gsm'); }
export async function setConfigReferentiels(data: Record<string, string[]>) { return apiFetch<{ success: boolean }>('/api/config/referentiels-gsm', { method: 'PUT', json: data }); }
export async function getHabilitations() { return apiFetch<{ success: boolean; habilitations: Record<string, Record<string, string>> }>('/api/config/habilitations'); }
export async function setHabilitations(data: Record<string, Record<string, string>>) { return apiFetch<{ success: boolean }>('/api/config/habilitations', { method: 'PUT', json: data }); }
export async function setPurgeCode(code: string) { return apiFetch<{ success: boolean }>('/api/config/purge-code', { method: 'PUT', json: { code } }); }

// ── Appel vidéo agent terrain (WebRTC signaling) ───────────────────────────────
// Construit l'URL du WebSocket de signalisation (/api/signaling) à partir de la
// même base que les appels REST (VITE_API_BASE_URL), en remplaçant http(s) par ws(s).
export function getSignalingWsUrl(): string {
  const httpBase = BASE || (typeof window !== 'undefined' ? window.location.origin : '');
  const withProtocol = httpBase.startsWith('http') ? httpBase : `${typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http'}://${httpBase}`;
  const wsBase = withProtocol.replace(/^http/i, 'ws').replace(/\/$/, '');
  return `${wsBase}/api/signaling`;
}

// Identifiants TURN/STUN pour la traversée NAT (route publique côté serveur).
export async function getTurnCredentials(numero: string) {
  return apiFetch<{ success: boolean; iceServers: RTCIceServer[]; message?: string }>(
    `/api/turn-credentials?numero=${encodeURIComponent(numero)}`
  );
}

// ── Sup ───────────────────────────────────────────────────────────────────────
export async function getAgents() { return apiFetch<{ success: boolean; agents: { matricule: string; nom: string; prenom: string }[] }>('/api/comptes/agents'); }
export async function getSupFileAttente(date?: string) {
  return apiFetch<{ success: boolean; total: number; dossiers: Dossier[] }>(`/api/sup/file-attente${date ? `?date=${date}` : ''}`);
}
export async function getDonneesHeures(date?: string) {
  return apiFetch<{ success: boolean; date: string; heures: { heure: string; total: number; accepte: number; rejete: number; en_cours: number }[] }>(`/api/sup/donnees-heures${date ? `?date=${date}` : ''}`);
}
export async function getSupPerformance(debut: string, fin: string) {
  return apiFetch<{ success: boolean; debut: string; fin: string; agents: { matricule: string; total: number; accepte: number; rejete: number }[] }>(`/api/sup/performance?debut=${debut}&fin=${fin}`);
}

// ── Admin ─────────────────────────────────────────────────────────────────────
export async function getAdminStats() { return apiFetch<AdminStats & { success: boolean }>('/api/admin/stats'); }
export async function getComptes() { return apiFetch<{ success: boolean; count: number; comptes: Compte[] }>('/api/admin/comptes'); }
export async function createCompte(data: { matricule: string; nom: string; prenom?: string; role: string; password?: string }) { return apiFetch<{ success: boolean; id: number; password_initial?: string }>('/api/admin/comptes', { method: 'POST', json: data }); }
export async function updateCompte(matricule: string, data: Partial<{ nom: string; prenom: string; role: string; actif: boolean; must_change_password: boolean }>) { return apiFetch<{ success: boolean }>(`/api/admin/comptes/${matricule}`, { method: 'PUT', json: data }); }
export async function resetPassword(matricule: string, new_password?: string) { return apiFetch<{ success: boolean; password_initial?: string }>(`/api/admin/comptes/${matricule}/reset-password`, { method: 'POST', json: { new_password } }); }
export async function getSessions() { return apiFetch<{ success: boolean; count: number; sessions: Session[] }>('/api/admin/sessions'); }
export async function revokeSession(jti: string) { return apiFetch<{ success: boolean }>(`/api/admin/sessions/${jti}/revoquer`, { method: 'POST' }); }
export async function getAuditLogs(p: { matricule?: string; action?: string; debut?: string; fin?: string; limit?: number; offset?: number } = {}) {
  const qs = new URLSearchParams(); Object.entries(p).forEach(([k, v]) => { if (v !== undefined) qs.set(k, String(v)); });
  return apiFetch<{ success: boolean; total: number; count: number; logs: AuditLog[] }>(`/api/admin/audit?${qs}`);
}
export async function getStorageStats() { return apiFetch<{ success: boolean; dossiers: number; gsm: number; photos_cni: number; captures_gsm: number; planning: number; notes: number }>('/api/admin/stockage'); }
export async function purgeApercu(action: string, mode: string, du?: string, au?: string) { return apiFetch<{ success: boolean; count: number }>('/api/admin/purge/apercu', { method: 'POST', json: { action, mode, du, au } }); }
export async function purgeExecuter(action: string, code: string, mode: string, du?: string, au?: string) { return apiFetch<{ success: boolean; count: number }>('/api/admin/purge/executer', { method: 'POST', json: { action, code, mode, du, au } }); }