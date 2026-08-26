CREATE TABLE IF NOT EXISTS card_assignment_history (
  id CHAR(36) PRIMARY KEY,
  card_id CHAR(36) NOT NULL,
  order_id CHAR(36) NOT NULL,
  assignment_kind VARCHAR(32) NOT NULL DEFAULT 'NORMAL',
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  assigned_by VARCHAR(128) NOT NULL,
  assignment_reason VARCHAR(500) NULL,
  assigned_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  released_by VARCHAR(128) NULL,
  release_reason VARCHAR(500) NULL,
  released_at TIMESTAMP(3) NULL,
  evidence_json JSON NULL,
  active_card_id CHAR(36) GENERATED ALWAYS AS (
    CASE WHEN status = 'ACTIVE' THEN card_id ELSE NULL END
  ) STORED,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_card_assignment_active_card (active_card_id),
  KEY idx_card_assignment_card_time (card_id, assigned_at),
  KEY idx_card_assignment_order_time (order_id, assigned_at),
  CONSTRAINT chk_card_assignment_status CHECK (status IN ('ACTIVE', 'RELEASED')),
  CONSTRAINT chk_card_assignment_kind CHECK (assignment_kind IN ('NORMAL', 'PURCHASED_FOR_ORDER', 'SPECIAL_REUSE', 'LEGACY_BACKFILL')),
  CONSTRAINT fk_card_assignment_card FOREIGN KEY (card_id) REFERENCES cards(id),
  CONSTRAINT fk_card_assignment_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_payments (
  id CHAR(36) PRIMARY KEY,
  cdk_id CHAR(36) NOT NULL,
  order_id CHAR(36) NULL,
  payment_channel VARCHAR(32) NOT NULL,
  payment_status VARCHAR(16) NOT NULL DEFAULT 'PAID',
  amount DECIMAL(18, 6) NULL,
  currency VARCHAR(8) NULL,
  paid_at TIMESTAMP(3) NULL,
  external_reference_hmac CHAR(64) NULL,
  external_reference_masked VARCHAR(128) NULL,
  operator_note VARCHAR(500) NULL,
  recorded_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_customer_payments_cdk (cdk_id, created_at),
  KEY idx_customer_payments_order (order_id, created_at),
  KEY idx_customer_payments_paid_at (paid_at),
  KEY idx_customer_payments_reference (external_reference_hmac),
  CONSTRAINT chk_customer_payment_status CHECK (payment_status IN ('PAID', 'REFUNDED', 'VOIDED')),
  CONSTRAINT fk_customer_payments_cdk FOREIGN KEY (cdk_id) REFERENCES cdks(id),
  CONSTRAINT fk_customer_payments_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_notes (
  id CHAR(36) PRIMARY KEY,
  order_id CHAR(36) NOT NULL,
  note_text VARCHAR(2000) NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_order_notes_order_time (order_id, created_at),
  CONSTRAINT fk_order_notes_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_tags (
  order_id CHAR(36) NOT NULL,
  tag VARCHAR(64) NOT NULL,
  created_by VARCHAR(128) NOT NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (order_id, tag),
  KEY idx_order_tags_tag_time (tag, created_at),
  CONSTRAINT fk_order_tags_order FOREIGN KEY (order_id) REFERENCES orders(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO customer_payments
  (id, cdk_id, order_id, payment_channel, payment_status, paid_at,
   operator_note, recorded_by)
SELECT UUID(), c.id, c.order_id, 'EXTERNAL_UNSPECIFIED', 'PAID', NULL,
       'payment is confirmed by CDK issuance; actual payment time was not historically recorded',
       'migration:024'
FROM cdks c
WHERE NOT EXISTS (
  SELECT 1 FROM customer_payments p WHERE p.cdk_id = c.id
)
  AND NOT EXISTS (
  SELECT 1 FROM order_compensations oc WHERE oc.replacement_cdk_id = c.id
);

INSERT INTO card_assignment_history
  (id, card_id, order_id, assignment_kind, status, assigned_by,
   assignment_reason, assigned_at, released_by, release_reason, released_at,
   evidence_json)
SELECT UUID(), c.id, oe.order_id, 'LEGACY_BACKFILL', 'RELEASED', 'migration:024',
       'recovered from a pre-submission cancellation event', oe.created_at,
       'migration:024', oe.reason, oe.created_at,
       JSON_OBJECT('source', 'order_events.metadata_json.cardId', 'eventId', oe.id,
         'migration', '024_traceability_center')
FROM order_events oe
INNER JOIN cards c
  ON c.id = JSON_UNQUOTE(JSON_EXTRACT(oe.metadata_json, '$.cardId'))
WHERE oe.to_status = 'CLOSED'
  AND oe.reason = 'order cancelled before recharge; card returned to inventory'
  AND NOT EXISTS (
    SELECT 1 FROM card_assignment_history h
    WHERE h.card_id = c.id AND h.order_id = oe.order_id
  );

UPDATE cards c
SET c.inventory_status = 'HELD_FOR_REVIEW', c.updated_at = CURRENT_TIMESTAMP(3)
WHERE c.order_id IS NULL AND c.inventory_status = 'AVAILABLE'
  AND EXISTS (
    SELECT 1 FROM card_assignment_history h
    WHERE h.card_id = c.id AND h.status = 'RELEASED'
  );

INSERT INTO card_assignment_history
  (id, card_id, order_id, assignment_kind, status, assigned_by,
   assignment_reason, assigned_at, evidence_json)
SELECT UUID(), c.id, c.order_id, 'LEGACY_BACKFILL', 'ACTIVE', 'migration:024',
       'backfilled from the authoritative current cards.order_id relationship',
       COALESCE(c.assigned_at, c.created_at),
       JSON_OBJECT('source', 'cards.order_id', 'migration', '024_traceability_center')
FROM cards c
WHERE c.order_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM card_assignment_history h
    WHERE h.card_id = c.id AND h.status = 'ACTIVE'
  );

SET @traceability_pan_hmac_index_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'cards'
    AND INDEX_NAME = 'idx_cards_pan_hmac'
);
SET @traceability_ddl := IF(
  @traceability_pan_hmac_index_exists = 0,
  'ALTER TABLE cards ADD INDEX idx_cards_pan_hmac (pan_hmac)',
  'SELECT 1'
);
PREPARE traceability_stmt FROM @traceability_ddl;
EXECUTE traceability_stmt;
DEALLOCATE PREPARE traceability_stmt;

SET @traceability_pan_hmac_version_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'cards'
    AND COLUMN_NAME = 'pan_hmac_version'
);
SET @traceability_ddl := IF(
  @traceability_pan_hmac_version_exists = 0,
  'ALTER TABLE cards ADD COLUMN pan_hmac_version SMALLINT NULL AFTER pan_hmac',
  'SELECT 1'
);
PREPARE traceability_stmt FROM @traceability_ddl;
EXECUTE traceability_stmt;
DEALLOCATE PREPARE traceability_stmt;

UPDATE cards SET pan_hmac_version = 1
WHERE pan_hmac IS NOT NULL AND pan_hmac_version IS NULL;
