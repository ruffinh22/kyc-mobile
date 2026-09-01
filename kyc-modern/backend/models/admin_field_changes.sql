-- Table to track admin-created dynamic fields and their migrations
CREATE TABLE IF NOT EXISTS admin_field_changes (
  id INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `type` VARCHAR(50) NOT NULL,
  `length` INT DEFAULT NULL,
  `nullable` TINYINT(1) NOT NULL DEFAULT 1,
  `default_value` TEXT DEFAULT NULL,
  `label` VARCHAR(255) DEFAULT NULL,
  `position` INT DEFAULT NULL,
  `hidden` TINYINT(1) NOT NULL DEFAULT 0,
  `created_by` VARCHAR(100) DEFAULT NULL,
  `migration_file` VARCHAR(255) DEFAULT NULL,
  `checksum` VARCHAR(128) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY ux_admin_field_name (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
