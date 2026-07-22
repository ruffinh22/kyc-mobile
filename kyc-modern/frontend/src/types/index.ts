export type Role = 'agent' | 'superviseur' | 'admin';
export type DossierStatut = 'en_attente' | 'en_cours' | 'accepte' | 'rejete';

export interface User { matricule: string; nom: string; prenom: string; role: Role; must_change_password?: boolean }

export interface Dossier {
  id: string; numero_mtn: string; wa_agent: string | null; username_agent: string | null;
  fonction_agent: string | null; zone_agent: string | null; ligne: string | null;
  date: string; heure_reception: string | null; statut: DossierStatut;
  photo_recto: string | null; photo_verso: string | null; photo_live: string | null;
  score_visage: number | null; visage_match: number | null; visage_motif: string | null;
  acquisition_status: string | null;
  liveness_status: string | null; liveness_confidence: number | null; liveness_verifie_le: number | null;
  agent_saisie: string | null; heure_prise: string | null; heure_cloture: string | null;
  raison_rejet: string | null; resultat_crm: string | null;
  note: string | null; note_superviseur: string | null;
  gsm_complete: number; transfert_message: string | null; transfert_par: string | null;
  created_at: number; closed_at: number | null; assigne_le: number | null;
  touch_time?: number | null; masque?: boolean;
}

export interface DossierStats { en_attente: number; en_cours: number; accepte: number; rejete: number; total: number }

export interface GsmRecord {
  id: number; numero: string; agent_ctrl: string; date_saisie: string; heure_saisie: string | null;
  coach: string | null; type_id: string | null; constat: string | null; piece: string | null;
  verbatim: string | null; action: string | null; statut_final: string | null;
  traitement: string | null; raison: string | null; nom_client: string | null;
  capture_a: string | null; capture_p: string | null; capture_aa: string | null;
  dossier_id: string | null; created_at: number;
}

export interface GsmStats {
  total: number; aujourdhui: number; sept_jours: number; mois_paie: number;
  libelle_mois_paie: string; dernieres: GsmRecord[];
}

export interface PlanningEntry {
  id: string; matricule: string; nom: string; statut: string; quartier: string;
  date: string; type: string; horaire: string; heure_debut: string; heure_fin: string;
  activite: string; lieu: string;
}

export interface NoteQualite {
  id: string; matricule: string; nom: string; statut: string; campagne: string;
  equipe: string; mois: number; annee: number;
  note_w1: number | null; note_w2: number | null; note_w3: number | null; note_w4: number | null;
  statut_w1: string | null; statut_w2: string | null; statut_w3: string | null; statut_w4: string | null;
  commentaire_w4: string | null; moyenne: number | null; tl: string | null;
}

export interface Compte {
  matricule: string; nom: string; prenom: string; role: Role;
  actif: boolean; must_change_password: boolean; failed_login_count: number;
  locked_until: number | null; last_login_at: number | null; created_at: number;
}

export interface Session { id: number; jti: string; matricule: string; ip: string; user_agent: string; expires_at: number; created_at: number }

export interface AuditLog { id: number; user_matricule: string | null; action: string; details: string | null; ip: string | null; created_at: number }

export interface PresenceResume { en_ligne: number; en_pause: number; detail: Record<string, string> }

export interface AdminStats {
  dossiers_today: DossierStats; presence: PresenceResume;
  comptes: { total: number; actifs: number; agents: number; superviseurs: number; admins: number };
  storage: { dossiers: number; gsm: number; photos_cni: number; captures_gsm: number; planning: number; notes: number };
}
