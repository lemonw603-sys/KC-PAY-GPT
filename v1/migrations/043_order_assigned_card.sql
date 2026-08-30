-- Make the order -> card relationship authoritative on the order side so one
-- card can serve several orders. Keep cards.order_id as a legacy first-order
-- pointer for compatibility; new runtime code reads orders.assigned_card_id.
SET @order_card_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND COLUMN_NAME='assigned_card_id'),
  'DO 0',
  'ALTER TABLE orders ADD COLUMN assigned_card_id CHAR(36) NULL AFTER fulfillment_route_id'
);
PREPARE order_card_stmt FROM @order_card_ddl;
EXECUTE order_card_stmt;
DEALLOCATE PREPARE order_card_stmt;

UPDATE orders o INNER JOIN cards c ON c.order_id = o.id
SET o.assigned_card_id = c.id
WHERE o.assigned_card_id IS NULL;

SET @order_card_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND INDEX_NAME='idx_orders_assigned_card'),
  'DO 0',
  'ALTER TABLE orders ADD INDEX idx_orders_assigned_card (assigned_card_id, status)'
);
PREPARE order_card_stmt FROM @order_card_ddl;
EXECUTE order_card_stmt;
DEALLOCATE PREPARE order_card_stmt;

SET @order_card_ddl = IF(
  EXISTS(SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='orders' AND CONSTRAINT_NAME='fk_orders_assigned_card'),
  'DO 0',
  'ALTER TABLE orders ADD CONSTRAINT fk_orders_assigned_card FOREIGN KEY (assigned_card_id) REFERENCES cards(id) ON DELETE SET NULL'
);
PREPARE order_card_stmt FROM @order_card_ddl;
EXECUTE order_card_stmt;
DEALLOCATE PREPARE order_card_stmt;
