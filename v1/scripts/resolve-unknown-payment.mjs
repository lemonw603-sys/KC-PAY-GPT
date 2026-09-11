// Record the operator's own verification of a "payment result unknown" / escalated Browser run
// and close it, through the SAME service the admin panel button uses (no hand-written SQL).
//
//   node scripts/resolve-unknown-payment.mjs <public-no> --outcome CHARGED|NOT_CHARGED \
//        --note "what was actually observed" [--renewal-cancelled] [--actor <id>] [--dry-run]
//
//   Needs DATABASE_URL (run on the production host with /etc/pojia/runtime.env sourced).
//   --dry-run prints the current run/order state and the intended outcome, and writes nothing.
//   Every guard of the admin action applies unchanged (state conflicts, confirmed-charge
//   contradiction, Pro hand-off shape); this script only supplies the same inputs.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';

const HERE = dirname(fileURLToPath(import.meta.url));
const { createBrowserAdminService } = await import(join(HERE, '../src/services/browser-admin-service.js'));

const [publicNo, ...rest] = process.argv.slice(2);
const flag = (name) => { const i = rest.indexOf(name); return i >= 0 ? String(rest[i + 1] || '').trim() : ''; };
const outcome = flag('--outcome').toUpperCase();
const note = flag('--note');
const actorId = flag('--actor') || 'brain-cli';
const renewalCancelled = rest.includes('--renewal-cancelled');
const dryRun = rest.includes('--dry-run');

if (!publicNo || !['CHARGED', 'NOT_CHARGED'].includes(outcome) || !note) {
  console.error('usage: resolve-unknown-payment <public-no> --outcome CHARGED|NOT_CHARGED --note "..." [--renewal-cancelled] [--actor <id>] [--dry-run]');
  process.exit(2);
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
try {
  const [[row]] = await pool.query(
    `SELECT o.public_no, o.status AS order_status, o.plan_type, br.id AS run_id, br.status AS run_status,
            br.payment_state, br.verification_state, br.control_state
     FROM orders o
     INNER JOIN recharge_attempts ra ON ra.order_id = o.id
     INNER JOIN browser_runs br ON br.recharge_attempt_id = ra.id
     WHERE BINARY o.public_no = ? ORDER BY br.created_at DESC LIMIT 1`, [publicNo]);
  if (!row) throw new Error('no Browser run found for that order');
  console.log(JSON.stringify({ current: row, intended: { outcome, renewalCancelled, actorId } }, null, 1));
  if (dryRun) { console.log('dry-run: nothing written'); process.exit(0); }

  const service = createBrowserAdminService({ pool });
  const result = await service.controlRun(row.run_id, {
    action: 'RESOLVE_UNKNOWN_PAYMENT',
    operationId: `resolve-unknown:${randomUUID()}`,
    confirmation: `确认核实结果 ${row.run_id}`,
    actorId,
    verifiedOutcome: outcome,
    renewalCancelled,
    evidenceNote: note,
  });
  console.log(JSON.stringify({ applied: result }, null, 1));
} finally {
  await pool.end();
}
