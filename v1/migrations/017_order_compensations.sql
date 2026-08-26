CREATE TABLE IF NOT EXISTS order_compensations (
  id CHAR(36) PRIMARY KEY,
  original_order_id CHAR(36) NOT NULL,
  replacement_cdk_id CHAR(36) NOT NULL,
  code_ciphertext MEDIUMBLOB NOT NULL,
  reason VARCHAR(500) NOT NULL,
  issued_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_order_compensations_original (original_order_id),
  UNIQUE KEY uq_order_compensations_replacement (replacement_cdk_id),
  CONSTRAINT fk_order_compensations_order FOREIGN KEY (original_order_id) REFERENCES orders(id),
  CONSTRAINT fk_order_compensations_cdk FOREIGN KEY (replacement_cdk_id) REFERENCES cdks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
