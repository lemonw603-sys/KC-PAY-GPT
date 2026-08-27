-- Additive ledger for future one-card-multiple-recharges capacity.
-- This migration records reservations separately from Provider transaction sync.
CREATE TABLE IF NOT EXISTS card_consumption_ledger (
  id CHAR(36) PRIMARY KEY,
  card_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  product_id CHAR(36) NULL,
  provider_transaction_id VARCHAR(191) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'RESERVED',
  amount DECIMAL(18,6) NULL,
  currency CHAR(3) NULL,
  reserved_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  consumed_at TIMESTAMP(3) NULL,
  released_at TIMESTAMP(3) NULL,
  release_reason VARCHAR(500) NULL,
  evidence_json JSON NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_card_consumption_order (card_id, order_id),
  UNIQUE KEY uq_card_consumption_provider_tx (card_id, provider_transaction_id),
  KEY idx_card_consumption_card_status (card_id, status, reserved_at),
  KEY idx_card_consumption_order (order_id),
  CONSTRAINT chk_card_consumption_status CHECK (status IN ('RESERVED','CONSUMED','RELEASED','RECONCILIATION')),
  CONSTRAINT fk_card_consumption_card FOREIGN KEY (card_id) REFERENCES cards(id),
  CONSTRAINT fk_card_consumption_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_card_consumption_product FOREIGN KEY (product_id) REFERENCES products(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
