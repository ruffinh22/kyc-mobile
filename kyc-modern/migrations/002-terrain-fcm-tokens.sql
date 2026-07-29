-- Migration : persistance des tokens FCM terrain
-- À exécuter une fois sur la base MySQL/MariaDB.

CREATE TABLE IF NOT EXISTS terrain_fcm_tokens (
  numero      VARCHAR(32)  NOT NULL PRIMARY KEY,
  fcm_token   VARCHAR(255) NOT NULL,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
