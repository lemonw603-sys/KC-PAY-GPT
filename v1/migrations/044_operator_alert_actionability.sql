UPDATE operator_alerts a
INNER JOIN orders o
  ON a.alert_type = 'ORDER_WAITING_FOR_CARD'
 AND a.dedupe_key = CONCAT('order-waiting-card:', o.id)
SET a.order_id = o.id
WHERE a.order_id IS NULL;

UPDATE operator_alerts a
INNER JOIN orders o ON o.id = a.order_id
SET a.status = 'RESOLVED',
    a.acknowledged_at = COALESCE(a.acknowledged_at, CURRENT_TIMESTAMP(3)),
    a.updated_at = CURRENT_TIMESTAMP(3)
WHERE a.alert_type = 'ORDER_WAITING_FOR_CARD'
  AND a.status = 'OPEN'
  AND o.status NOT IN ('CREATED','WAITING_FOR_CARD','CARD_PURCHASING','CARD_PROVISIONING');

UPDATE operator_alerts
SET status='RESOLVED',
    acknowledged_at=COALESCE(acknowledged_at, CURRENT_TIMESTAMP(3)),
    updated_at=CURRENT_TIMESTAMP(3)
WHERE alert_type='CARD_STOCK_LOW' AND status='OPEN'
  AND EXISTS (
    SELECT 1 FROM app_settings
    WHERE setting_key='card_auto_replenishment_enabled' AND setting_value='true'
  );

INSERT INTO app_settings (setting_key, setting_value)
VALUES ('worker_recharge_writes_enabled', 'false')
ON DUPLICATE KEY UPDATE setting_key=VALUES(setting_key);
