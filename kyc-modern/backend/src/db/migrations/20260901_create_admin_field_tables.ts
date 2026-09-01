import type { Pool } from 'mysql2/promise';

export const migration = {
  name: '20260901_create_admin_field_tables',
  async up(pool: Pool) {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS admin_field_changes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(64) NOT NULL,
        label VARCHAR(255) NOT NULL,
        type VARCHAR(32) NOT NULL,
        length INT DEFAULT NULL,
        decimal_scale INT DEFAULT NULL,
        nullable TINYINT(1) NOT NULL DEFAULT 1,
        default_value VARCHAR(255) DEFAULT NULL,
        position INT DEFAULT NULL,
        target_table VARCHAR(64) NOT NULL DEFAULT 'dossiers',
        status ENUM('active','hidden','drop_scheduled','dropped') NOT NULL DEFAULT 'active',
        hidden_at INT DEFAULT NULL,
        drop_scheduled_at INT DEFAULT NULL,
        dropped_at INT DEFAULT NULL,
        migration_file VARCHAR(255) NOT NULL,
        checksum VARCHAR(64) NOT NULL,
        backup_file VARCHAR(255) DEFAULT NULL,
        created_by VARCHAR(32) NOT NULL,
        created_at INT NOT NULL,
        updated_at INT NOT NULL,
        UNIQUE KEY uniq_field_table (name, target_table)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS admin_field_change_log (
        id INT AUTO_INCREMENT PRIMARY KEY,
        field_name VARCHAR(64) NOT NULL,
        target_table VARCHAR(64) NOT NULL,
        action ENUM('create','hide','unhide','schedule_drop','force_drop','apply_drop','rollback','apply_failed') NOT NULL,
        detail TEXT DEFAULT NULL,
        performed_by VARCHAR(32) NOT NULL,
        ts INT NOT NULL,
        KEY idx_field (field_name, target_table),
        KEY idx_ts (ts)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
  },
  async down(pool: Pool) {
    await pool.execute('DROP TABLE IF EXISTS admin_field_change_log');
    await pool.execute('DROP TABLE IF EXISTS admin_field_changes');
  },
};
