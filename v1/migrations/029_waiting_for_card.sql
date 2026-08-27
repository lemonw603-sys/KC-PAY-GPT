-- Stage 4: explicit waiting and automatic replenishment policy.
INSERT INTO app_settings (setting_key, setting_value) VALUES
  ('card_auto_replenishment_enabled', 'false'),
  ('card_replenishment_daily_limit', '5')
ON DUPLICATE KEY UPDATE setting_key = VALUES(setting_key);

SET @has_job_source := (
  SELECT COUNT(*) FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'card_stock_jobs' AND column_name = 'job_source'
);
SET @sql := IF(@has_job_source = 0,
  "ALTER TABLE card_stock_jobs ADD COLUMN job_source VARCHAR(16) NOT NULL DEFAULT 'MANUAL' AFTER status",
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @has_source_created_index := (
  SELECT COUNT(*) FROM information_schema.statistics
  WHERE table_schema = DATABASE() AND table_name = 'card_stock_jobs'
    AND index_name = 'idx_card_stock_jobs_source_created'
);
SET @sql := IF(@has_source_created_index = 0,
  'ALTER TABLE card_stock_jobs ADD INDEX idx_card_stock_jobs_source_created (job_source, created_at)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
