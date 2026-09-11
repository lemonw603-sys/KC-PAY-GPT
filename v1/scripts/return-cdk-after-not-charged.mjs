// One-off repair for orders closed by 「确认核实结果 → 未扣款」 BEFORE the F-48 fix
// (release 20260911-cdk-return-fix): their close-out meant to hand the CDK back, but the
// submit-click guard silently refused and the caller discarded the result, so the customer
// was left holding a spent CDK for a service they never received.
//
//   node scripts/return-cdk-after-not-charged.mjs <public-no> [--dry-run] [--actor <id>]
//
// Only touches an order that a person already adjudicated as not charged: it must be
// terminal AND carry failure_code HUMAN_VERIFIED_NOT_CHARGED. Everything else is refused.
// The return itself goes through the same repository function the admin close-out uses, so
// the funds-ledger guards still apply and a RETURNED delivery event is recorded.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const HERE = dirname(fileURLToPath(import.meta.url));
const { returnCdkForOrderInTransaction, CDK_RETURN_ORDER_STATUSES } =
  await import(join(HERE, '../src/db/repositories/cdk-return-repository.js'));

const [publicNo, ...rest] = process.argv.slice(2);
const dryRun = rest.includes('--dry-run');
const actorIndex = rest.indexOf('--actor');
const actorId = actorIndex >= 0 ? String(rest[actorIndex + 1] || '').trim() : 'brain-cli';
if (!publicNo) { console.error('usage: return-cdk-after-not-charged <public-no> [--dry-run] [--actor <id>]'); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [[order]] = await connection.query(
    `SELECT o.id, o.public_no, o.status, o.failure_code, c.id AS cdk_id, c.status AS cdk_status
     FROM orders o LEFT JOIN cdks c ON c.id = o.cdk_id
     WHERE BINARY o.public_no = ? LIMIT 1 FOR UPDATE`, [publicNo]);
  if (!order) throw new Error('order not found');
  if (!CDK_RETURN_ORDER_STATUSES.includes(order.status)) {
    throw new Error(`order is ${order.status}; only ${CDK_RETURN_ORDER_STATUSES.join('/')} can hand a CDK back`);
  }
  if (order.failure_code !== 'HUMAN_VERIFIED_NOT_CHARGED') {
    throw new Error(`order failure_code is ${order.failure_code}; this repair is only for a human-verified not-charged closeout`);
  }
  console.log(JSON.stringify({ before: order }, null, 1));
  if (dryRun) { await connection.rollback(); console.log('dry-run: nothing written'); process.exit(0); }

  const result = await returnCdkForOrderInTransaction(connection, {
    orderId: order.id,
    reason: 'F-48 repair: closeout already recorded a human-verified not-charged result',
    actorType: 'ADMIN', actorId, paymentSubmitAdjudicated: true,
    metadata: { repair: 'F-48', publicNo: order.public_no },
  });
  if (!result.returned) throw new Error(`CDK not returned: ${result.reasonCode}`);
  await connection.commit();
  console.log(JSON.stringify({ applied: result }, null, 1));
} catch (error) {
  await connection.rollback().catch(() => undefined);
  console.error(String(error?.message || error));
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
