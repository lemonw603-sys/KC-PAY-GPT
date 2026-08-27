CREATE TABLE IF NOT EXISTS operator_alerts (
  id CHAR(36) PRIMARY KEY,
  alert_type VARCHAR(64) NOT NULL,
  dedupe_key VARCHAR(191) NOT NULL,
  order_id CHAR(36) NULL,
  refund_case_id CHAR(36) NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'warning',
  title VARCHAR(255) NOT NULL,
  message VARCHAR(2000) NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  acknowledged_at TIMESTAMP(3) NULL,
  UNIQUE KEY uq_operator_alert_dedupe (dedupe_key),
  KEY idx_operator_alert_status (status, created_at),
  CONSTRAINT fk_operator_alert_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_operator_alert_refund FOREIGN KEY (refund_case_id) REFERENCES refund_cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
