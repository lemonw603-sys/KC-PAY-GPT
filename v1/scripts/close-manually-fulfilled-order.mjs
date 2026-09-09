// Close an order that the operator fulfilled OUTSIDE the system (e.g. paid by hand with
// the 上号器) while the system had not paid anything. The customer got the service, so the
// CDK stays REDEEMED and the order ends RECHARGE_SUCCESS with 取消续费 left for operator
// review; the assigned card is released (default: card NOT used) or consumed (--card-used).
//
//   node scripts/close-manually-fulfilled-order.mjs <public-no> [--card-used] [--dry-run] [--reason "..."]
//   Needs DATABASE_URL (run on the production host with /etc/pojia/runtime.env sourced).
//   Refuses when ANY system payment evidence exists (that case is a reconcile, not a closeout).
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const { releaseCardForFailedOrderInTransaction } = await import(join(HERE, '../src/db/repositories/card-release-repository.js'));
const { transitionCardConsumptionInTransaction } = await import(join(HERE, '../src/services/card-consumption-ledger-service.js'));

const [publicNo, ...rest] = process.argv.slice(2);
if (!publicNo) { console.error('usage: close-manually-fulfilled-order <public-no> [--card-used] [--dry-run] [--reason "..."]'); process.exit(2); }
const dryRun = rest.includes('--dry-run');
const cardUsed = rest.includes('--card-used');
const reasonIndex = rest.indexOf('--reason');
const reason = reasonIndex >= 0 ? String(rest[reasonIndex + 1] || '').trim() : 'fulfilled manually outside the system by operator; system made no payment';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

const CLOSABLE = ['CREATED', 'CARD_READY', 'WAITING_FOR_SESSION'];
const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [[order]] = await connection.query(
    'SELECT id, status, version, assigned_card_id, cdk_id FROM orders WHERE BINARY public_no = ? LIMIT 1 FOR UPDATE', [publicNo]);
  if (!order) throw new Error('order not found');
  if (!CLOSABLE.includes(order.status)) throw new Error(`order is ${order.status}; only ${CLOSABLE.join('/')} can be closed as manually fulfilled`);
  const [[evidence]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM recharge_attempts ra WHERE ra.order_id = o.id AND ra.funds_risk_state IN ('ACTIVE','UNKNOWN','SETTLED')) AS live_or_paid_attempts,
       (SELECT COUNT(*) FROM card_consumption_ledger l WHERE l.order_id = o.id AND l.status IN ('CONSUMED','RECONCILIATION')) AS consumed_ledger,
       (SELECT COUNT(*) FROM browser_runs br INNER JOIN recharge_attempts bra ON bra.id = br.recharge_attempt_id
          WHERE bra.order_id = o.id AND br.payment_state <> 'NOT_STARTED') AS runs_past_arming,
       (SELECT COUNT(*) FROM browser_operations bo INNER JOIN browser_runs br ON br.id = bo.browser_run_id
          INNER JOIN recharge_attempts bra ON bra.id = br.recharge_attempt_id
          WHERE bra.order_id = o.id AND bo.operation_type = 'PAYMENT_SUBMIT') AS payment_submits,
       (SELECT COUNT(*) FROM browser_runs br INNER JOIN recharge_attempts bra ON bra.id = br.recharge_attempt_id
          WHERE bra.order_id = o.id AND br.active_account_key_hmac IS NOT NULL) AS open_runs,
       o.recharge_order_no, o.recharge_card_key
     FROM orders o WHERE o.id = ?`, [order.id]);
  const blockers = Object.entries(evidence).filter(([, value]) => (typeof value === 'number' ? value > 0 : Boolean(value)));
  if (blockers.length) throw new Error(`system payment evidence present, refusing: ${JSON.stringify(Object.fromEntries(blockers))}`);

  const [[card]] = await connection.query(
    'SELECT id, last4, sync_tier FROM cards WHERE id = ? LIMIT 1 FOR UPDATE', [order.assigned_card_id]);
  const ledger = await transitionCardConsumptionInTransaction(connection, {
    orderId: order.id, targetStatus: cardUsed ? 'CONSUMED' : 'RELEASED',
    reason: `Order fulfilled manually outside the system; assigned card ${cardUsed ? 'WAS used by hand' : 'was NOT used'}: ${reason}`,
    allowedCurrentStatuses: ['RESERVED'], requireActive: false,
    evidence: { source: 'close_manually_fulfilled_order', cardUsed },
  });
  const release = await releaseCardForFailedOrderInTransaction(connection, { orderId: order.id, releasedBy: 'admin:close-manually-fulfilled', reason });
  if (cardUsed && card) {
    // Mirrors the manual-payment-confirmed path: a hand-used manual card has no API to re-sync.
    await connection.query(
      `UPDATE cards SET inventory_status = 'DEPLETED', current_balance = NULL, last_transaction_synced_at = NULL, updated_at = CURRENT_TIMESTAMP(3)
       WHERE id = ?`, [card.id]);
  }
  const [tasks] = await connection.query(
    `UPDATE tasks SET status = 'DEAD', leased_by = NULL, leased_until = NULL,
       last_error_code = 'FULFILLED_MANUALLY_OUTSIDE', last_error_message = ?, updated_at = CURRENT_TIMESTAMP(3)
     WHERE order_id = ? AND status IN ('PENDING','RUNNING')`, [reason.slice(0, 255), order.id]);
  const [dispatch] = await connection.query(
    `UPDATE browser_dispatch_jobs SET status = 'CANCELLED', last_error_code = 'FULFILLED_MANUALLY_OUTSIDE',
       completed_at = CURRENT_TIMESTAMP(3), lease_owner = NULL, lease_token_hash = NULL, lease_until = NULL, updated_at = CURRENT_TIMESTAMP(3)
     WHERE order_id = ? AND status IN ('QUEUED','CLAIMED')`, [order.id]);
  const [closed] = await connection.query(
    `UPDATE orders SET status = 'RECHARGE_SUCCESS', cancellation_review_required = 1,
       assigned_card_id = CASE WHEN ? THEN assigned_card_id ELSE NULL END,
       failure_code = NULL, failure_reason = NULL, customer_action_code = NULL,
       version = version + 1, finished_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND version = ?`, [cardUsed ? 1 : 0, order.id, order.version]);
  if (Number(closed.affectedRows) !== 1) throw new Error('order changed concurrently');
  await connection.query(
    `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
     VALUES (?, ?, 'RECHARGE_SUCCESS', 'ADMIN', 'close-manually-fulfilled', ?, ?)`,
    [order.id, order.status, reason, JSON.stringify({ closeManuallyFulfilled: true, cardUsed, cardLast4: card?.last4 || null, evidence, ledger, release, deadTasks: tasks.affectedRows, cancelledDispatch: dispatch.affectedRows })]);
  const summary = { publicNo, dryRun, cardUsed, cardLast4: card?.last4 || null, ledger, release, deadTasks: tasks.affectedRows, cancelledDispatch: dispatch.affectedRows, cdk: 'kept REDEEMED', next: 'operator confirms 取消续费 via 「已在账号里取消续费」' };
  if (dryRun) { await connection.rollback(); console.log('DRY RUN (rolled back)', JSON.stringify(summary)); }
  else { await connection.commit(); console.log('CLOSED', JSON.stringify(summary)); }
} catch (error) {
  await connection.rollback().catch(() => {});
  console.error('refused/failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
