-- ============================================================================
-- KYC Congo V4 – Migration MySQL complète
-- Exécuter : mysql -u root -p kyc_v4 < migrations/001-init-mysql.sql
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';

-- Créer la base si elle n'existe pas
CREATE DATABASE IF NOT EXISTS kyc_v4
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE kyc_v4;

-- ── comptes ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS comptes (
  id                   INT UNSIGNED    NOT NULL AUTO_INCREMENT,
  matricule            VARCHAR(30)     NOT NULL,
  nom                  VARCHAR(100)    NOT NULL,
  prenom               VARCHAR(100)    NOT NULL DEFAULT '',
  role                 ENUM('agent','superviseur','admin') NOT NULL DEFAULT 'agent',
  password_hash        VARCHAR(255)    NOT NULL,
  actif                TINYINT(1)      NOT NULL DEFAULT 1,
  must_change_password TINYINT(1)      NOT NULL DEFAULT 0,
  failed_login_count   INT UNSIGNED    NOT NULL DEFAULT 0,
  locked_until         INT UNSIGNED    DEFAULT NULL,
  last_login_at        INT UNSIGNED    DEFAULT NULL,
  created_at           INT UNSIGNED    NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at           INT UNSIGNED    NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_matricule (matricule)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── sessions_v3 ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions_v3 (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  jti        VARCHAR(64)  NOT NULL,
  matricule  VARCHAR(30)  NOT NULL,
  ip         VARCHAR(45)  DEFAULT NULL,
  user_agent TEXT         DEFAULT NULL,
  revoked    TINYINT(1)   NOT NULL DEFAULT 0,
  expires_at INT UNSIGNED NOT NULL,
  created_at INT UNSIGNED NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_jti (jti),
  KEY idx_matricule (matricule),
  KEY idx_revoked_exp (revoked, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── dossiers ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dossiers (
  id                VARCHAR(32)   NOT NULL,
  numero_mtn        VARCHAR(20)   NOT NULL,
  wa_agent          VARCHAR(20)   DEFAULT NULL,
  username_agent    VARCHAR(100)  DEFAULT NULL,
  fonction_agent    VARCHAR(100)  DEFAULT NULL,
  zone_agent        VARCHAR(100)  DEFAULT NULL,
  ligne             VARCHAR(50)   DEFAULT NULL,
  date              DATE          NOT NULL,
  heure_reception   VARCHAR(5)    DEFAULT NULL,
  statut            ENUM('en_attente','en_cours','accepte','rejete') NOT NULL DEFAULT 'en_attente',
  photo_recto       VARCHAR(300)  DEFAULT NULL,
  photo_verso       VARCHAR(300)  DEFAULT NULL,
  photo_live        VARCHAR(300)  DEFAULT NULL,
  score_visage      DECIMAL(5,2)  DEFAULT NULL,
  visage_match      TINYINT(1)    DEFAULT NULL,
  visage_motif      VARCHAR(200)  DEFAULT NULL,
  visage_verifie_le INT UNSIGNED  DEFAULT NULL,
  agent_saisie      VARCHAR(30)   DEFAULT NULL,
  heure_prise       VARCHAR(5)    DEFAULT NULL,
  heure_cloture     VARCHAR(5)    DEFAULT NULL,
  raison_rejet      TEXT          DEFAULT NULL,
  resultat_crm      VARCHAR(200)  DEFAULT NULL,
  assigne_a         VARCHAR(30)   DEFAULT NULL,
  assigne_le        INT UNSIGNED  DEFAULT NULL,
  note_superviseur  TEXT          DEFAULT NULL,
  note              TEXT          DEFAULT NULL,
  gsm_complete      TINYINT(1)    NOT NULL DEFAULT 0,
  transfert_message TEXT          DEFAULT NULL,
  transfert_par     VARCHAR(30)   DEFAULT NULL,
  nom_titulaire     VARCHAR(200)  DEFAULT NULL,
  prenom_titulaire  VARCHAR(200)  DEFAULT NULL,
  date_naissance    VARCHAR(50)   DEFAULT NULL,
  lieu_naissance    VARCHAR(200)  DEFAULT NULL,
  autre_numero      VARCHAR(20)   DEFAULT NULL,
  nom_pere          VARCHAR(200)  DEFAULT NULL,
  nom_mere          VARCHAR(200)  DEFAULT NULL,
  adresse_complete  VARCHAR(500)  DEFAULT NULL,
  numero_cni        VARCHAR(50)   DEFAULT NULL,
  sexe              VARCHAR(20)   DEFAULT NULL,
  nationalite       VARCHAR(100)  DEFAULT NULL,
  profession        VARCHAR(100)  DEFAULT NULL,
  country           VARCHAR(5)    DEFAULT NULL,
  ocr_overrides     VARCHAR(200)  DEFAULT NULL,
  flow_step         TINYINT(1)    DEFAULT 4,
  acquisition_status VARCHAR(30)   DEFAULT 'submitted',
  created_at        INT UNSIGNED  NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  updated_at        INT UNSIGNED  NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  closed_at         INT UNSIGNED  DEFAULT NULL,
  touch_time        INT UNSIGNED  DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_statut       (statut),
  KEY idx_date         (date),
  KEY idx_agent        (agent_saisie),
  KEY idx_wa           (wa_agent),
  KEY idx_created      (created_at),
  KEY idx_date_statut  (date, statut)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── gsm ───────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gsm (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  numero        VARCHAR(20)   NOT NULL,
  agent_ctrl    VARCHAR(30)   NOT NULL,
  date_saisie   DATE          NOT NULL,
  heure_saisie  VARCHAR(5)    DEFAULT NULL,
  coach         VARCHAR(100)  DEFAULT NULL,
  type_id       VARCHAR(100)  DEFAULT NULL,
  constat       VARCHAR(200)  DEFAULT NULL,
  piece         VARCHAR(200)  DEFAULT NULL,
  verbatim      TEXT          DEFAULT NULL,
  action        VARCHAR(200)  DEFAULT NULL,
  statut_final  VARCHAR(100)  DEFAULT NULL,
  traitement    VARCHAR(200)  DEFAULT NULL,
  raison        VARCHAR(200)  DEFAULT NULL,
  nom_client    VARCHAR(200)  DEFAULT NULL,
  capture_a     VARCHAR(300)  DEFAULT NULL,
  capture_p     VARCHAR(300)  DEFAULT NULL,
  capture_aa    VARCHAR(300)  DEFAULT NULL,
  dossier_id    VARCHAR(32)   DEFAULT NULL,
  observations  TEXT          DEFAULT NULL,
  created_at    INT UNSIGNED  NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_agent    (agent_ctrl),
  KEY idx_date     (date_saisie),
  KEY idx_dossier  (dossier_id),
  KEY idx_numero   (numero)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── planning ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS planning (
  id          VARCHAR(64)   NOT NULL,
  matricule   VARCHAR(30)   NOT NULL,
  nom         VARCHAR(100)  NOT NULL DEFAULT '',
  statut      VARCHAR(50)   NOT NULL DEFAULT '',
  quartier    VARCHAR(100)  NOT NULL DEFAULT '',
  date        DATE          NOT NULL,
  type        VARCHAR(50)   NOT NULL DEFAULT '',
  horaire     VARCHAR(50)   NOT NULL DEFAULT '',
  heure_debut VARCHAR(5)    NOT NULL DEFAULT '',
  heure_fin   VARCHAR(5)    NOT NULL DEFAULT '',
  activite    VARCHAR(200)  NOT NULL DEFAULT '',
  lieu        VARCHAR(200)  NOT NULL DEFAULT '',
  updated_at  INT UNSIGNED  NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_matricule (matricule),
  KEY idx_date      (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── planning_managers ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS planning_managers (
  id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  semaine    DATE          NOT NULL,
  titre      VARCHAR(200)  NOT NULL DEFAULT '',
  data       LONGTEXT      DEFAULT NULL,
  updated_at INT UNSIGNED  NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_semaine (semaine)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── notes_qualite ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notes_qualite (
  id             VARCHAR(64)   NOT NULL,
  matricule      VARCHAR(30)   NOT NULL,
  nom            VARCHAR(100)  NOT NULL DEFAULT '',
  statut         VARCHAR(50)   NOT NULL DEFAULT '',
  campagne       VARCHAR(100)  NOT NULL DEFAULT '',
  equipe         VARCHAR(100)  NOT NULL DEFAULT '',
  mois           TINYINT       NOT NULL,
  annee          YEAR          NOT NULL,
  note_w1        DECIMAL(5,2)  DEFAULT NULL,
  note_w2        DECIMAL(5,2)  DEFAULT NULL,
  note_w3        DECIMAL(5,2)  DEFAULT NULL,
  note_w4        DECIMAL(5,2)  DEFAULT NULL,
  statut_w1      VARCHAR(50)   DEFAULT NULL,
  statut_w2      VARCHAR(50)   DEFAULT NULL,
  statut_w3      VARCHAR(50)   DEFAULT NULL,
  statut_w4      VARCHAR(50)   DEFAULT NULL,
  commentaire_w4 TEXT          DEFAULT NULL,
  moyenne        DECIMAL(5,2)  DEFAULT NULL,
  tl             VARCHAR(100)  DEFAULT NULL,
  backup         VARCHAR(100)  DEFAULT NULL,
  updated_at     INT UNSIGNED  NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_matricule (matricule),
  KEY idx_mois_annee (mois, annee),
  KEY idx_campagne   (campagne)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── presence ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS presence (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  nom          VARCHAR(30)   NOT NULL,
  statut       ENUM('online','pause','offline') NOT NULL DEFAULT 'offline',
  ts           INT UNSIGNED  NOT NULL DEFAULT 0,
  pause_debut  INT UNSIGNED  DEFAULT NULL,
  dispo_depuis INT UNSIGNED  DEFAULT NULL,
  updated_at   INT UNSIGNED  NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  UNIQUE KEY uq_nom (nom),
  KEY idx_statut_ts (statut, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── config ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS config (
  cle        VARCHAR(100) NOT NULL,
  valeur     MEDIUMTEXT   NOT NULL,
  updated_at INT UNSIGNED NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (cle)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Valeurs par défaut
INSERT IGNORE INTO config (cle, valeur) VALUES
  ('distribution_mode', 'manuel'),
  ('seuil_alerte',      '10'),
  ('referentiels_gsm',  '{"type_id":["CNI","Passeport","Titre de séjour"],"constat":["OK","NOK","EN ATTENTE"],"piece":["Recto","Verso","Recto/Verso"],"verbatim":["Conforme","Non conforme","Illisible"],"action":["Accepter","Rejeter","Suspendre"],"statut_final":["Traité","Non traité","En cours"],"traitement":["Standard","Express","Prioritaire"],"raison":["Document périmé","Photo floue","Données incomplètes","Doublon","Fraude suspectée"]}'),
  ('habilitations_sup',  '{}'),
  ('code_purge',         '');

-- ── audit_log ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  user_matricule  VARCHAR(30)   DEFAULT NULL,
  action          VARCHAR(100)  NOT NULL,
  details         TEXT          DEFAULT NULL,
  ip              VARCHAR(45)   DEFAULT NULL,
  user_agent      VARCHAR(500)  DEFAULT NULL,
  created_at      INT UNSIGNED  NOT NULL DEFAULT (UNIX_TIMESTAMP()),
  PRIMARY KEY (id),
  KEY idx_matricule  (user_matricule),
  KEY idx_action     (action),
  KEY idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ── Vues utiles ───────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_dossiers_stats_jour AS
SELECT
  date,
  COUNT(*)                                          AS total,
  SUM(statut = 'en_attente')                        AS en_attente,
  SUM(statut = 'en_cours')                          AS en_cours,
  SUM(statut = 'accepte')                           AS accepte,
  SUM(statut = 'rejete')                            AS rejete,
  SUM(photo_recto IS NOT NULL)                      AS avec_photo_recto,
  SUM(visage_match = 1)                             AS visage_ok,
  AVG(score_visage)                                 AS score_moyen
FROM dossiers
GROUP BY date;

CREATE OR REPLACE VIEW v_gsm_perf_journaliere AS
SELECT
  agent_ctrl,
  date_saisie,
  COUNT(*) AS total
FROM gsm
GROUP BY agent_ctrl, date_saisie;

CREATE OR REPLACE VIEW v_agents_actifs AS
SELECT
  p.nom,
  p.statut,
  p.ts,
  p.dispo_depuis,
  c.prenom,
  c.nom AS nom_complet,
  (SELECT COUNT(*) FROM dossiers d WHERE d.agent_saisie = p.nom AND d.statut = 'en_cours') AS dossiers_en_cours
FROM presence p
LEFT JOIN comptes c ON c.matricule = p.nom
WHERE p.statut IN ('online','pause')
  AND p.ts >= UNIX_TIMESTAMP() - 120;
