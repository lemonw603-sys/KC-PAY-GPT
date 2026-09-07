// Operator alerts for Browser-route terminal moments. One row per (type, order):
// re-raising an already resolved alert reopens it. Every OPEN row is pushed to
// Bark by pojia-bark-notifications; only warning/critical show on the home page.

export const BROWSER_ALERT_TYPES = Object.freeze({
  BROWSER_PAYMENT_CONFIRMED: 'info',
  BROWSER_ORDER_COMPLETED: 'info',
  BROWSER_ORDER_FAILED: 'warning',
  BROWSER_PAYMENT_UNKNOWN: 'critical',
  BROWSER_HUMAN_REQUIRED: 'critical',
  BROWSER_UPGRADE_HANDOFF: 'warning'
});

export async function upsertBrowserAlertInTransaction(connection, { type, orderId, title, message }) {
  const severity = BROWSER_ALERT_TYPES[type];
  if (!severity) throw new Error(`unknown browser alert type: ${type}`);
  if (typeof orderId !== 'string' || !orderId) throw new Error('orderId is required');
  const dedupeKey = `browser-${type.toLowerCase()}:${orderId}`;
  await connection.query(
    `INSERT INTO operator_alerts
     (id, alert_type, dedupe_key, order_id, severity, title, message, status)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'OPEN')
     ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
       order_id = VALUES(order_id), message = VALUES(message),
       status = IF(status = 'RESOLVED', 'OPEN', status),
       acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`,
    [type, dedupeKey, orderId, severity, String(title).slice(0, 255), String(message).slice(0, 2000)]
  );
  return { type, severity, dedupeKey };
}
