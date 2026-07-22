// ============================================================================
// KYC V4 – Types partagés (MySQL)
// ============================================================================

export type Role = 'agent' | 'superviseur' | 'admin';
export type DossierStatut = 'en_attente' | 'en_cours' | 'accepte' | 'rejete';
export type PresenceStatut = 'online' | 'pause' | 'offline';

// ── Modèles DB ────────────────────────────────────────────────────────────────

export interface Compte {
  id: number;
  matricule: string;
  nom: string;
  prenom: string;
  role: Role;
  password_hash: string;
  phone_number: string | null;
  phone_verified_at: number | null;
  phone_verification_code: string | null;
  phone_verification_expires_at: number | null;
  actif: number;
  must_change_password: number;
  failed_login_count: number;
  locked_until: number | null;
  created_at: number;
  updated_at: number;
  last_login_at: number | null;
}

export interface Session {
  id: number;
  jti: string;
  matricule: string;
  ip: string;
  user_agent: string;
  revoked: number;
  expires_at: number;
  created_at: number;
}

export interface Dossier {
  id: string;
  numero_mtn: string;
  wa_agent: string | null;
  username_agent: string | null;
  fonction_agent: string | null;
  zone_agent: string | null;
  ligne: string | null;
  date: string;
  heure_reception: string | null;
  statut: DossierStatut;
  photo_recto: string | null;
  photo_verso: string | null;
  photo_live: string | null;
  score_visage: number | null;
  visage_match: number | null;
  visage_motif: string | null;
  visage_verifie_le: number | null;
  liveness_status: string | null;
  liveness_confidence: number | null;
  liveness_verifie_le: number | null;
  agent_saisie: string | null;
  heure_prise: string | null;
  heure_cloture: string | null;
  raison_rejet: string | null;
  resultat_crm: string | null;
  assigne_a: string | null;
  assigne_le: number | null;
  note_superviseur: string | null;
  note: string | null;
  gsm_complete: number;
  transfert_message: string | null;
  transfert_par: string | null;
  // ── Infos titulaire pour l'enregistrement SIM (agent terrain + OCR CNI) ───
  nom_titulaire: string | null;
  prenom_titulaire: string | null;
  date_naissance: string | null;
  lieu_naissance: string | null;
  autre_numero: string | null;
  nom_pere: string | null;
  nom_mere: string | null;
  adresse_complete: string | null;
  numero_cni: string | null;
  sexe: string | null;
  nationalite: string | null;
  profession: string | null;
  country: string | null;
  ocr_overrides: string | null;
  flow_step: number | null;
  acquisition_status: string | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  // champ calculé
  touch_time?: number | null;
  masque?: boolean;
}

export interface GsmRecord {
  id: number;
  numero: string;
  agent_ctrl: string;
  date_saisie: string;
  heure_saisie: string | null;
  coach: string | null;
  type_id: string | null;
  constat: string | null;
  piece: string | null;
  verbatim: string | null;
  action: string | null;
  statut_final: string | null;
  traitement: string | null;
  raison: string | null;
  nom_client: string | null;
  capture_a: string | null;
  capture_p: string | null;
  capture_aa: string | null;
  dossier_id: string | null;
  observations: string | null;
  created_at: number;
}

export interface PlanningEntry {
  id: string;
  matricule: string;
  nom: string;
  statut: string;
  quartier: string;
  date: string;
  type: string;
  horaire: string;
  heure_debut: string;
  heure_fin: string;
  activite: string;
  lieu: string;
  updated_at: number;
}

export interface PlanningManager {
  id: number;
  semaine: string;
  titre: string;
  data: string;
  updated_at: number;
}

export interface NoteQualite {
  id: string;
  matricule: string;
  nom: string;
  statut: string;
  campagne: string;
  equipe: string;
  mois: number;
  annee: number;
  note_w1: number | null;
  note_w2: number | null;
  note_w3: number | null;
  note_w4: number | null;
  statut_w1: string | null;
  statut_w2: string | null;
  statut_w3: string | null;
  statut_w4: string | null;
  commentaire_w4: string | null;
  moyenne: number | null;
  tl: string | null;
  backup: string | null;
  updated_at: number;
}

export interface PresenceRow {
  id: number;
  nom: string;
  statut: PresenceStatut;
  ts: number;
  pause_debut: number | null;
  dispo_depuis: number | null;
  updated_at: number;
}

export interface ConfigRow {
  cle: string;
  valeur: string;
  updated_at: number;
}

export interface AuditLog {
  id: number;
  user_matricule: string | null;
  action: string;
  details: string | null;
  ip: string | null;
  user_agent: string | null;
  created_at: number;
}

// ── JWT ───────────────────────────────────────────────────────────────────────

export interface JwtPayload {
  matricule: string;
  role: Role;
  jti: string;
  iat?: number;
  exp?: number;
}

export interface AuthenticatedUser {
  matricule: string;
  nom: string;
  prenom: string;
  role: Role;
  jti: string;
}

