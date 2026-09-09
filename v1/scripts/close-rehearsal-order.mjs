// Close a Browser rehearsal order that stopped BEFORE any payment and still holds its
// card (assignment ACTIVE + ledger RESERVED) so the card returns to the pool and the
// CDK goes back to AVAILABLE. Mirrors the admin "取消并释放卡" closeout, but for a
// CARD_READY order whose SUBMIT_RECHARGE already ran once (the admin path refuses those
// as SUBMISSION_RISK even though the rehearsal provably never clicked payment).
//
//   node scripts/close-rehearsal-order.mjs <public-no> [--dry-run] [--reason "..."]
//   Needs DATABASE_URL (run on the production host with /etc/pojia/runtime.env sourced,
//   or through the 13306 tunnel). Refuses when ANY payment evidence exists.
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const { releaseCardForFailedOrderInTransaction } = await import(join(HERE, '../src/db/repositories/card-release-repository.js'));
const { returnCdkForOrderInTransaction } = await import(join(HERE, '../src/db/repositories/cdk-return-repository.js'));
const { transitionCardConsumptionInTransaction } = await import(join(HERE, '../src/services/card-consumption-ledger-service.js'));

const [publicNo, ...rest] = process.argv.slice(2);
if (!publicNo) { console.error('usage: close-rehearsal-order <public-no> [--dry-run] [--reason "..."]'); process.exit(2); }
const dryRun = rest.includes('--dry-run');
const reasonIndex = rest.indexOf('--reason');
const reason = reasonIndex >= 0 ? String(rest[reasonIndex + 1] || '').trim() : 'rehearsal finished; closed before any payment to release the card';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [[order]] = await connection.query(
    'SELECT id, status, version, assigned_card_id, cdk_id FROM orders WHERE BINARY public_no = ? LIMIT 1 FOR UPDATE', [publicNo]);
  if (!order) throw new Error('order not found');
  if (order.status !== 'CARD_READY') throw new Error(`order is ${order.status}; only CARD_READY rehearsal leftovers are closable here`);
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
  const blockers = Object.entries(evidence).filter(([key, value]) => (typeof value === 'number' ? value > 0 : Boolean(value)));
  if (blockers.length) throw new Error(`payment evidence present, refusing: ${JSON.stringify(Object.fromEntries(blockers))}`);

  const ledger = await transitionCardConsumptionInTransaction(connection, {
    orderId: order.id, targetStatus: 'RELEASED', reason: `Order closed before payment: ${reason}`,
    allowedCurrentStatuses: ['RESERVED'], requireActive: false, evidence: { source: 'close_rehearsal_order' },
  });
  const card = await releaseCardForFailedOrderInTransaction(connection, { orderId: order.id, releasedBy: 'admin', reason });
  // The dispatch job would otherwise stay QUEUED forever and show as 排队中 on the control panel.
  const [dispatch] = await connection.query(
    `UPDATE browser_dispatch_jobs SET status = 'CANCELLED', last_error_code = 'CANCELLED_PRE_SUBMISSION',
       completed_at = CURRENT_TIMESTAMP(3), lease_owner = NULL, lease_token_hash = NULL, lease_until = NULL,
       updated_at = CURRENT_TIMESTAMP(3)
     WHERE order_id = ? AND status IN ('QUEUED','CLAIMED')`, [order.id]);
  const [closed] = await connection.query(
    `UPDATE orders SET status = 'CLOSED', assigned_card_id = NULL,
       failure_code = 'CANCELLED_PRE_SUBMISSION', failure_reason = ?,
       version = version + 1, finished_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND version = ?`, [reason, order.id, order.version]);
  if (Number(closed.affectedRows) !== 1) throw new Error('order changed concurrently');
  await connection.query(
    `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
     VALUES (?, 'CARD_READY', 'CLOSED', 'ADMIN', 'admin', ?, ?)`,
    [order.id, reason, JSON.stringify({ closeRehearsalOrder: true, evidence, ledger, card })]);
  const cdk = await returnCdkForOrderInTransaction(connection, {
    orderId: order.id, reason: `order closed after rehearsal before payment: ${reason}`,
    actorType: 'ADMIN', actorId: 'admin', metadata: { closeRehearsalOrder: true },
  });
  const summary = { publicNo, dryRun, evidence, ledger, card, dispatchJobs: dispatch.affectedRows, cdk };
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
