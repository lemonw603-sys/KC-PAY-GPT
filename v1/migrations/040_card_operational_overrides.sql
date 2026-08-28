-- Minimal operator-owned card allocation rules.  This covers cards already
-- materialized in `cards` and Provider cards still present only in discovery.
CREATE TABLE IF NOT EXISTS card_operational_overrides (
  id CHAR(36) PRIMARY KEY,
  provider_account_id CHAR(36) NOT NULL,
  external_card_id VARCHAR(191) NOT NULL,
  allocation_policy VARCHAR(24) NOT NULL,
  product_code VARCHAR(32) NULL,
  reason VARCHAR(500) NOT NULL,
  set_by VARCHAR(128) NOT NULL,
  set_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_card_operational_override (provider_account_id, external_card_id),
  KEY idx_card_operational_override_policy (provider_account_id, allocation_policy),
  CONSTRAINT chk_card_operational_override_policy
    CHECK (allocation_policy IN ('NORMAL','PRODUCT_ONLY','RETIRED'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
