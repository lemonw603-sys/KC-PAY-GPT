// Operator alerts for Browser-route terminal moments. One row per (type, order):
// re-raising an already resolved alert reopens it. Every OPEN row is pushed to
// Bark by pojia-bark-notifications; only warning/critical show on the home page.

export const BROWSER_ALERT_TYPES = Object.freeze({
  BROWSER_PAYMENT_CONFIRMED: 'info',
  BROWSER_ORDER_COMPLETED: 'info',
  BROWSER_ORDER_FAILED: 'warning',
  BROWSER_PAYMENT_UNKNOWN: 'critical',
  BROWSER_HUMAN_REQUIRED: 'critical',
  BROWSER_UPGRADE_HANDOFF: 'warning',
  // D-175（Lemon 要的两个节点）：客户刚提交、以及客户卡在队列里没人处理。
  BROWSER_ORDER_SUBMITTED: 'info',
  BROWSER_ORDER_STALLED: 'critical'
});

export async function upsertBrowserAlertInTransaction(connection, { type, orderId, title, message }) {
  const severity = BROWSER_ALERT_TYPES[type];
  if (!severity) throw new Error(`unknown browser alert type: ${type}`);
  if (typeof orderId !== 'string' || !orderId) throw new Error('orderId is required');
  const dedupeKey = `browser-${type.toLowerCase()}:${orderId}`;
  // The phone push carries only title + message, nothing else. Without the order
  // number the operator gets "something went wrong" with no way to tell WHICH
  // customer, which is how these alerts read before 2026-09-11. Attach it here so
  // every browser alert gets it, rather than remembering at each call site.
  // Decorating an alert must never be able to stop it: an alert is a safety signal,
  // and a failed lookup is not a reason for the operator to hear nothing.
  let publicNo = null;
  try {
    const result = await connection.query('SELECT public_no FROM orders WHERE id = ? LIMIT 1', [orderId]);
    const rows = Array.isArray(result) ? result[0] : null;
    if (Array.isArray(rows) && rows[0]?.public_no) publicNo = String(rows[0].public_no);
  } catch { publicNo = null; }
  const body = publicNo ? `订单 ${publicNo}｜${message}` : String(message);
  await connection.query(
    `INSERT INTO operator_alerts
     (id, alert_type, dedupe_key, order_id, severity, title, message, status)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'OPEN')
     ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
       order_id = VALUES(order_id), message = VALUES(message),
       status = IF(status = 'RESOLVED', 'OPEN', status),
       acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`,
    [type, dedupeKey, orderId, severity, String(title).slice(0, 255), body.slice(0, 2000)]
  );
  return { type, severity, dedupeKey };
}
