ALTER TABLE cards
  MODIFY COLUMN order_id CHAR(36) NULL,
  MODIFY COLUMN funded_amount DECIMAL(18,6) NULL,
  ADD COLUMN inventory_status VARCHAR(24) NOT NULL DEFAULT 'ASSIGNED' AFTER order_id,
  ADD COLUMN assigned_at TIMESTAMP(3) NULL AFTER inventory_status,
  ADD KEY idx_cards_inventory_pick
    (inventory_status, card_type_id, status, current_balance, created_at);

UPDATE cards
SET inventory_status = 'ASSIGNED',
    assigned_at = COALESCE(assigned_at, created_at)
WHERE order_id IS NOT NULL;

INSERT IGNORE INTO app_settings (setting_key, setting_value)
VALUES ('card_stock_low_threshold', '5');
