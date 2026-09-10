// Reopen a DEAD Browser preflight task (audit F-1): the order is still waiting
// before any payment, the operator has looked at why the preflight kept failing
// (session, checkout page, network) and wants the resident lane to try again.
//
//   node scripts/reopen-browser-preflight.mjs <public-no> [--dry-run] [--reason "..."]
//   Needs DATABASE_URL (run on the production host with /etc/pojia/runtime.env sourced,
//   or through the 13306 tunnel). Refuses when the order is not in a pre-payment state
//   or when any payment evidence exists.
import mysql from 'mysql2/promise';

const [publicNo, ...rest] = process.argv.slice(2);
if (!publicNo) { console.error('usage: reopen-browser-preflight <public-no> [--dry-run] [--reason "..."]'); process.exit(2); }
const dryRun = rest.includes('--dry-run');
const reasonIndex = rest.indexOf('--reason');
const reason = reasonIndex >= 0 ? String(rest[reasonIndex + 1] || '').trim() : 'operator reopened the Browser preflight after reviewing the failures';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

const REOPENABLE = ['CREATED', 'WAITING_FOR_CARD', 'CARD_READY'];
const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [[order]] = await connection.query(
    'SELECT id, status, version FROM orders WHERE BINARY public_no = ? LIMIT 1 FOR UPDATE', [publicNo]);
  if (!order) throw new Error('order not found');
  if (!REOPENABLE.includes(order.status)) throw new Error(`order is ${order.status}; only ${REOPENABLE.join('/')} can reopen a preflight`);
  const [[evidence]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM recharge_attempts ra WHERE ra.order_id = o.id AND ra.funds_risk_state IN ('ACTIVE','UNKNOWN','SETTLED')) AS live_or_paid_attempts,
       (SELECT COUNT(*) FROM browser_operations bo INNER JOIN browser_runs br ON br.id = bo.browser_run_id
          INNER JOIN recharge_attempts bra ON bra.id = br.recharge_attempt_id
          WHERE bra.order_id = o.id AND bo.operation_type = 'PAYMENT_SUBMIT') AS payment_submits
     FROM orders o WHERE o.id = ?`, [order.id]);
  const blockers = Object.entries(evidence).filter(([, v]) => Number(v) > 0);
  if (blockers.length) throw new Error(`payment evidence present, refusing: ${JSON.stringify(Object.fromEntries(blockers))}`);
  const [[task]] = await connection.query(
    `SELECT id, status, attempts, max_attempts, last_error_code FROM tasks
     WHERE order_id = ? AND task_type = 'BROWSER_PREFLIGHT' LIMIT 1 FOR UPDATE`, [order.id]);
  if (!task) throw new Error('order has no BROWSER_PREFLIGHT task');
  if (task.status !== 'DEAD') throw new Error(`preflight task is ${task.status}, not DEAD; nothing to reopen`);
  const [reopened] = await connection.query(
    `UPDATE tasks SET status = 'PENDING', attempts = 0, available_at = CURRENT_TIMESTAMP(3),
       leased_by = NULL, leased_until = NULL, last_error_code = NULL, last_error_message = NULL,
       completed_at = NULL, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND status = 'DEAD'`, [task.id]);
  if (Number(reopened.affectedRows) !== 1) throw new Error('preflight task changed concurrently');
  const [alerts] = await connection.query(
    `UPDATE operator_alerts SET status = 'RESOLVED', acknowledged_at = COALESCE(acknowledged_at, CURRENT_TIMESTAMP(3)),
       updated_at = CURRENT_TIMESTAMP(3)
     WHERE status = 'OPEN' AND alert_type = 'BROWSER_HUMAN_REQUIRED' AND order_id = ?`, [order.id]);
  await connection.query(
    `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
     VALUES (?, ?, ?, 'ADMIN', 'reopen-browser-preflight', ?, ?)`,
    [order.id, order.status, order.status, reason, JSON.stringify({ reopenBrowserPreflight: true, taskId: task.id, previousAttempts: task.attempts, previousError: task.last_error_code, resolvedAlerts: alerts.affectedRows })]);
  const summary = { publicNo, dryRun, taskId: task.id, previousAttempts: task.attempts, previousError: task.last_error_code, resolvedAlerts: alerts.affectedRows, next: 'the resident lane claims the preflight on its next tick' };
  if (dryRun) { await connection.rollback(); console.log('DRY RUN (rolled back)', JSON.stringify(summary)); }
  else { await connection.commit(); console.log('REOPENED', JSON.stringify(summary)); }
} catch (error) {
  await connection.rollback().catch(() => {});
  console.error('refused/failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
