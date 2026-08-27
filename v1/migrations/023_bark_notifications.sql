CREATE TABLE IF NOT EXISTS alert_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  alert_id CHAR(36) NOT NULL,
  channel VARCHAR(24) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'PENDING',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMP(3) NULL,
  locked_at TIMESTAMP(3) NULL,
  sent_at TIMESTAMP(3) NULL,
  source_updated_at TIMESTAMP(3) NULL,
  last_error VARCHAR(1000) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_alert_notification_channel (alert_id, channel),
  KEY idx_alert_notification_dispatch (channel, status, next_attempt_at, id),
  CONSTRAINT fk_alert_notification_alert FOREIGN KEY (alert_id) REFERENCES operator_alerts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @bark_alert_updated_at_ddl = IF(
  EXISTS(
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'operator_alerts'
      AND COLUMN_NAME = 'updated_at'
  ),
  'DO 0',
  'ALTER TABLE operator_alerts ADD COLUMN updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) AFTER created_at'
);
PREPARE bark_alert_updated_at_stmt FROM @bark_alert_updated_at_ddl;
EXECUTE bark_alert_updated_at_stmt;
DEALLOCATE PREPARE bark_alert_updated_at_stmt;

UPDATE operator_alerts SET updated_at = COALESCE(updated_at, created_at)
WHERE updated_at IS NULL;
