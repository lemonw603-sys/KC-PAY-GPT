-- Auditable manual conclusions for card-balance funding UNKNOWN states.
-- This table never authorizes a new provider call; it only records a
-- step-up-protected human conclusion against an existing attempt.
CREATE TABLE IF NOT EXISTS card_funding_manual_actions (
  id CHAR(36) PRIMARY KEY,
  attempt_id CHAR(36) NOT NULL,
  action VARCHAR(32) NOT NULL,
  actor_id VARCHAR(128) NOT NULL,
  operator_note VARCHAR(2000) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_card_funding_manual_action (attempt_id, id),
  KEY idx_card_funding_manual_attempt (attempt_id, created_at),
  CONSTRAINT fk_card_funding_manual_attempt FOREIGN KEY (attempt_id) REFERENCES card_funding_attempts(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
