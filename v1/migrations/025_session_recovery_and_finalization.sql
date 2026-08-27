SET @has_customer_action_code := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'customer_action_code'
);
SET @sql := IF(@has_customer_action_code = 0,
  'ALTER TABLE orders ADD COLUMN customer_action_code VARCHAR(64) NULL AFTER failure_reason',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_session_replacement_count := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'session_replacement_count'
);
SET @sql := IF(@has_session_replacement_count = 0,
  'ALTER TABLE orders ADD COLUMN session_replacement_count TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER customer_action_code',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_session_repair_started_at := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'session_repair_started_at'
);
SET @sql := IF(@has_session_repair_started_at = 0,
  'ALTER TABLE orders ADD COLUMN session_repair_started_at TIMESTAMP(3) NULL AFTER session_replacement_count',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_session_repair_expires_at := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'session_repair_expires_at'
);
SET @sql := IF(@has_session_repair_expires_at = 0,
  'ALTER TABLE orders ADD COLUMN session_repair_expires_at TIMESTAMP(3) NULL AFTER session_repair_started_at',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_last_session_replaced_at := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'last_session_replaced_at'
);
SET @sql := IF(@has_last_session_replaced_at = 0,
  'ALTER TABLE orders ADD COLUMN last_session_replaced_at TIMESTAMP(3) NULL AFTER session_repair_expires_at',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS order_session_replacements (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  replacement_no TINYINT UNSIGNED NOT NULL,
  reason_code VARCHAR(64) NOT NULL,
  previous_customer_email VARCHAR(320) NULL,
  previous_chatgpt_account_id VARCHAR(191) NULL,
  new_customer_email VARCHAR(320) NULL,
  new_chatgpt_account_id VARCHAR(191) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_order_session_replacement_no (order_id, replacement_no),
  KEY idx_order_session_replacements_time (order_id, created_at),
  CONSTRAINT fk_order_session_replacements_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO app_settings (setting_key, setting_value)
VALUES ('session_replacement_window_hours', '72')
ON DUPLICATE KEY UPDATE setting_value = setting_value;
