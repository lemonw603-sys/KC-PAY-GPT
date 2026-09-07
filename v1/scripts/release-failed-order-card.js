// One-off repair: release the card still bound to an order that failed BEFORE any
// payment action (the Browser pre-payment abort did not release assignments until
// 2026-09-08). Refuses when any payment evidence exists.
//   node scripts/release-failed-order-card.js <public-no> [--reason "..."] [--dry-run]
import mysql from 'mysql2/promise';
import { loadConfig } from '../src/config.js';
import { createDatabaseConnectionOptions } from '../src/db/pool.js';
import { releaseCardForFailedOrderInTransaction } from '../src/db/repositories/card-release-repository.js';

function parseArguments(argv) {
  const [publicNo, ...rest] = argv;
  const options = { dryRun: false, reason: 'card released after pre-payment failure (backfill)' };
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--dry-run') options.dryRun = true;
    else if (rest[index] === '--reason' && rest[index + 1] != null) { options.reason = rest[index + 1]; index += 1; }
    else throw new Error(`invalid argument: ${rest[index]}`);
  }
  if (!publicNo) throw new Error('usage: release-failed-order-card <public-no> [--reason "..."] [--dry-run]');
  return { publicNo, options };
}

async function main() {
  const { publicNo, options } = parseArguments(process.argv.slice(2));
  const config = loadConfig();
  const pool = mysql.createPool(createDatabaseConnectionOptions(config.database, { connectionLimit: 2, timezone: 'Z' }));
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[order]] = await connection.query(
      'SELECT id, status, failure_code FROM orders WHERE BINARY public_no = ? LIMIT 1 FOR UPDATE', [publicNo]
    );
    if (!order) throw new Error('order not found');
    if (order.status !== 'RECHARGE_FAILED') throw new Error(`order is ${order.status}, only RECHARGE_FAILED is repairable`);
    const [[evidence]] = await connection.query(
      `SELECT
         (SELECT COUNT(*) FROM recharge_attempts ra WHERE ra.order_id = o.id
            AND ra.funds_risk_state IN ('ACTIVE','UNKNOWN','SETTLED')) AS live_or_paid_attempts,
         (SELECT COUNT(*) FROM card_consumption_ledger l WHERE l.order_id = o.id
            AND l.status IN ('RESERVED','CONSUMED','RECONCILIATION')) AS held_ledger,
         (SELECT COUNT(*) FROM browser_runs br INNER JOIN recharge_attempts bra ON bra.id = br.recharge_attempt_id
            WHERE bra.order_id = o.id
            AND br.payment_state IN ('PAYMENT_SUBMITTING','PAYMENT_UNKNOWN','PAYMENT_CONFIRMED')) AS payment_runs,
         (SELECT COUNT(*) FROM provider_calls pc WHERE pc.order_id = o.id AND pc.provider = 'zzshu'
            AND pc.operation = 'create_direct' AND pc.outcome <> 'DEFINITE_FAILURE') AS provider_calls,
         (SELECT COUNT(*) FROM card_assignment_history ah WHERE ah.order_id = o.id AND ah.status = 'ACTIVE') AS active_assignments
       FROM orders o WHERE o.id = ?`, [order.id]
    );
    console.log('evidence', JSON.stringify(evidence));
    for (const key of ['live_or_paid_attempts', 'held_ledger', 'payment_runs', 'provider_calls']) {
      if (Number(evidence[key]) > 0) throw new Error(`refusing: ${key}=${evidence[key]} (payment evidence present)`);
    }
    if (Number(evidence.active_assignments) === 0) {
      console.log('nothing to release: no ACTIVE assignment');
      await connection.rollback();
      return;
    }
    const result = await releaseCardForFailedOrderInTransaction(connection, {
      orderId: order.id, releasedBy: 'admin:release-failed-order-card', reason: options.reason
    });
    await connection.query(
      `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json, created_at)
       VALUES (?, 'RECHARGE_FAILED', 'RECHARGE_FAILED', 'ADMIN', 'release-failed-order-card', ?, ?, CURRENT_TIMESTAMP(3))`,
      [order.id, options.reason, JSON.stringify({ ...result, failureCode: order.failure_code, backfill: true })]
    );
    if (options.dryRun) {
      await connection.rollback();
      console.log('dry-run (rolled back)', JSON.stringify(result));
    } else {
      await connection.commit();
      console.log('released', JSON.stringify(result));
    }
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
    await pool.end();
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
