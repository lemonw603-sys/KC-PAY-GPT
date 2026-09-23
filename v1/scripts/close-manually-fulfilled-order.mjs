// Close an order that the operator fulfilled OUTSIDE the system (e.g. paid by hand with
// the 上号器) while the system had not paid anything. The customer got the service, so the
// CDK stays REDEEMED and the order ends RECHARGE_SUCCESS with 取消续费 left for operator
// review; the assigned card is released (default: card NOT used) or consumed (--card-used).
//
//   node scripts/close-manually-fulfilled-order.mjs <public-no> [--card-used] [--dry-run] [--reason "..."]
//   Needs DATABASE_URL (run on the production host with /etc/pojia/runtime.env sourced).
//   Refuses when ANY system payment evidence exists (that case is a reconcile, not a closeout).
//
// RECHARGE_FAILED (pre-payment terminal, D-131): the abort already released the card and
// the ledger and handed the CDK back. Closing such an order as manually fulfilled binds the
// CDK to it again, and refuses when the CDK is no longer free (another order took it, or it
// was revoked). --card-used is not accepted for these orders: their ledger row is RELEASED
// and cannot be turned into CONSUMED safely by a script.
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// 2026-09-24（D-356 ⑤）：守卫与写入提到 services/manual-fulfillment-service.js，后台按钮与本脚本共用；
// 这里只剩参数解析与调用，不再保留第二份规则。
const HERE = dirname(fileURLToPath(import.meta.url));
const { createManualFulfillmentService } = await import(join(HERE, '../src/services/manual-fulfillment-service.js'));

const [publicNo, ...rest] = process.argv.slice(2);
if (!publicNo) { console.error('usage: close-manually-fulfilled-order <public-no> [--card-used] [--dry-run] [--reason "..."]'); process.exit(2); }
const dryRun = rest.includes('--dry-run');
const cardUsed = rest.includes('--card-used');
const reasonIndex = rest.indexOf('--reason');
const reason = reasonIndex >= 0 ? String(rest[reasonIndex + 1] || '').trim() : '';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
try {
  const service = createManualFulfillmentService({ pool });
  const summary = await service.closeManuallyFulfilled(publicNo, { cardUsed, reason, actorId: 'close-manually-fulfilled', dryRun });
  console.log(dryRun ? 'DRY RUN (rolled back)' : 'CLOSED', JSON.stringify(summary));
} catch (error) {
  console.error('refused/failed:', error?.code ? `${error.code} ${error.message}` : (error?.message || error), error?.detail ? JSON.stringify(error.detail) : '');
  process.exitCode = 1;
} finally {
  await pool.end();
}
