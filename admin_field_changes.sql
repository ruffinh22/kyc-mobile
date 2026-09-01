-- Table d'audit et de pilotage des champs dynamiques.
-- Une ligne = un champ créé par un admin sur une table cible (par défaut `dossiers`).
-- Le cycle de vie (voir backend/routes/admin/fields.ts) est piloté par `status`.

CREATE TABLE IF NOT EXISTS admin_field_changes (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  name               VARCHAR(64)  NOT NULL,          -- nom de la colonne SQL (snake_case)
  label              VARCHAR(255) NOT NULL,          -- libellé affiché dans les formulaires
  type               VARCHAR(32)  NOT NULL,          -- VARCHAR | TEXT | INT | BIGINT | DATE | DATETIME | BOOLEAN | DECIMAL
  length             INT          NULL,              -- pour VARCHAR/DECIMAL(precision)
  decimal_scale      INT          NULL,              -- pour DECIMAL(precision, scale)
  nullable           TINYINT(1)   NOT NULL DEFAULT 1,
  default_value      VARCHAR(255) NULL,
  position           INT          NULL,              -- ordre d'affichage dans le formulaire
  target_table       VARCHAR(64)  NOT NULL DEFAULT 'dossiers',
  status             ENUM('active','hidden','drop_scheduled','dropped') NOT NULL DEFAULT 'active',
  hidden_at          INT          NULL,              -- ts epoch sec du passage en hidden
  drop_scheduled_at  INT          NULL,              -- ts epoch sec auquel le DROP automatique doit s'exécuter
  dropped_at         INT          NULL,
  migration_file     VARCHAR(255) NOT NULL,          -- backend/migrations/<fichier>.ts correspondant
  checksum           VARCHAR(64)  NOT NULL,          -- sha256(nom+type+contraintes) — détection de dérive
  backup_file        VARCHAR(255) NULL,              -- dernier backup ciblé associé à ce champ
  created_by         VARCHAR(32)  NOT NULL,
  created_at         INT          NOT NULL,
  updated_at         INT          NOT NULL,
  UNIQUE KEY uniq_field_table (name, target_table)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Journal détaillé de chaque opération (création, masquage, drop, rollback, échec)
-- distinct de admin_field_changes (qui ne garde que l'état courant du champ).
CREATE TABLE IF NOT EXISTS admin_field_change_log (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  field_name   VARCHAR(64)  NOT NULL,
  target_table VARCHAR(64)  NOT NULL,
  action       ENUM('create','hide','unhide','schedule_drop','force_drop','apply_drop','rollback','apply_failed') NOT NULL,
  detail       TEXT NULL,
  performed_by VARCHAR(32) NOT NULL,
  ts           INT NOT NULL,
  KEY idx_field (field_name, target_table),
  KEY idx_ts (ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
