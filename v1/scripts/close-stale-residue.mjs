// Close leftovers on TERMINAL orders only: Browser dispatch jobs still QUEUED/CLAIMED and
// card assignments still ACTIVE. Such rows can never be claimed (claim requires the order
// to be RECHARGE_PROCESSING) nor released by any worker, but they show as 排队中/已领取 on
// the Browser control panel and inflate the "已分配" card count. They were left by the
// 2026-09-08 manual SQL closeouts and by early close-rehearsal-order runs.
//
//   node scripts/close-stale-residue.mjs [--dry-run] [--reason "..."]
//   Needs DATABASE_URL (run on the production host with /etc/pojia/runtime.env sourced).
//
// Refuses an order whose funds attempt is still ACTIVE/UNKNOWN or that still has an open
// Browser run. Never touches the consumption ledger (capacity stays as recorded).
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const { releaseCardForFailedOrderInTransaction } = await import(join(HERE, '../src/db/repositories/card-release-repository.js'));

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const reasonIndex = args.indexOf('--reason');
const reason = reasonIndex >= 0 ? String(args[reasonIndex + 1] || '').trim() : 'stale residue on terminal order closed by operator';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

const TERMINAL = ['RECHARGE_SUCCESS', 'RECHARGE_FAILED', 'CLOSED'];
const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
const connection = await pool.getConnection();
const now = new Date();
const summary = { dryRun, closed: [], refused: [] };
try {
  await connection.beginTransaction();
  const [orders] = await connection.query(
    `SELECT o.id, o.public_no, o.status FROM orders o
     WHERE o.status IN (?)
       AND (EXISTS (SELECT 1 FROM browser_dispatch_jobs j WHERE j.order_id = o.id AND j.status IN ('QUEUED','CLAIMED'))
         OR EXISTS (SELECT 1 FROM card_assignment_history h WHERE h.order_id = o.id AND h.status = 'ACTIVE'))
     ORDER BY o.created_at FOR UPDATE`, [TERMINAL]);
  for (const order of orders) {
    const [[evidence]] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM recharge_attempts ra WHERE ra.order_id = o.id AND ra.funds_risk_state IN ('ACTIVE','UNKNOWN')) AS live_attempts,
         (SELECT COUNT(*) FROM browser_runs br INNER JOIN recharge_attempts bra ON bra.id = br.recharge_attempt_id
            WHERE bra.order_id = o.id AND (br.active_account_key_hmac IS NOT NULL OR br.payment_state = 'PAYMENT_SUBMITTING')) AS open_runs,
         (SELECT GROUP_CONCAT(CONCAT(j.id, ':', j.status)) FROM browser_dispatch_jobs j WHERE j.order_id = o.id AND j.status IN ('QUEUED','CLAIMED')) AS jobs,
         (SELECT GROUP_CONCAT(CONCAT(c.last4, ':', h.id)) FROM card_assignment_history h INNER JOIN cards c ON c.id = h.card_id
            WHERE h.order_id = o.id AND h.status = 'ACTIVE') AS assignments
       FROM orders o WHERE o.id = ?`, [order.id]);
    const entry = { publicNo: order.public_no, status: order.status, jobs: evidence.jobs, assignments: evidence.assignments };
    if (Number(evidence.live_attempts) > 0 || Number(evidence.open_runs) > 0) {
      summary.refused.push({ ...entry, liveAttempts: evidence.live_attempts, openRuns: evidence.open_runs });
      continue;
    }
    // A paid order's job ended in success; anything else is cancelled, mirroring the
    // executor's own terminal writes (browser-execution-repository).
    const jobStatus = order.status === 'RECHARGE_SUCCESS' ? 'COMPLETED' : 'CANCELLED';
    const [jobs] = await connection.query(
      `UPDATE browser_dispatch_jobs
       SET status = ?, last_error_code = CASE WHEN ? = 'CANCELLED' THEN 'STALE_ON_TERMINAL_ORDER' ELSE last_error_code END,
           completed_at = COALESCE(completed_at, ?), lease_owner = NULL, lease_token_hash = NULL, lease_until = NULL, updated_at = ?
       WHERE order_id = ? AND status IN ('QUEUED','CLAIMED')`,
      [jobStatus, jobStatus, now, now, order.id]);
    const card = evidence.assignments
      ? await releaseCardForFailedOrderInTransaction(connection, { orderId: order.id, releasedBy: 'admin:close-stale-residue', reason, now })
      : null;
    await connection.query(
      `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json, created_at)
       VALUES (?, ?, ?, 'ADMIN', 'close-stale-residue', ?, ?, ?)`,
      [order.id, order.status, order.status, reason, JSON.stringify({ closeStaleResidue: true, ...entry, jobStatus, card }), now]);
    summary.closed.push({ ...entry, jobStatus, dispatchJobs: jobs.affectedRows, card });
  }
  if (dryRun) { await connection.rollback(); console.log('DRY RUN (rolled back)', JSON.stringify(summary, null, 1)); }
  else { await connection.commit(); console.log('CLOSED', JSON.stringify(summary, null, 1)); }
} catch (error) {
  await connection.rollback().catch(() => {});
  console.error('failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
