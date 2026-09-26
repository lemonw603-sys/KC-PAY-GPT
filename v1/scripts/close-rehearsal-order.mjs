// Close a Browser rehearsal order that stopped BEFORE any payment and still holds its
// card (assignment ACTIVE + ledger RESERVED) so the card returns to the pool and the
// CDK goes back to AVAILABLE. Mirrors the admin "取消并释放卡" closeout, but for a
// CARD_READY order whose SUBMIT_RECHARGE already ran once (the admin path refuses those
// as SUBMISSION_RISK even though the rehearsal provably never clicked payment).
//
//   node scripts/close-rehearsal-order.mjs <public-no> [--dry-run] [--reason "..."] [--skip-cdk-return]
//
// --skip-cdk-return：只用于运维自己为演练生成的一次性码。退回会写 cdk_delivery_events，
// 它有外键指向 cdk_batches；用底层 storeCdkBatch 造的码没有批次行，退回会直接失败。
// 跳过后这张码停在 REDEEMED 且订单 CLOSED，等于死码，不会被任何人再兑换。**客户的码一律不要用它**，
// 客户码必须退回成 AVAILABLE 才能重兑。
//   Needs DATABASE_URL (run on the production host with /etc/pojia/runtime.env sourced,
//   or through the 13306 tunnel). Refuses when ANY payment evidence exists.
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// 判断与写库都在共用模块里（D-394：后台「放弃并放卡」按钮用的是同一份，不再各写一套）。
const { closePrePaymentOrderInTransaction } = await import(join(HERE, '../src/services/pre-payment-closeout-service.js'));

const [publicNo, ...rest] = process.argv.slice(2);
if (!publicNo) { console.error('usage: close-rehearsal-order <public-no> [--dry-run] [--reason "..."]'); process.exit(2); }
const dryRun = rest.includes('--dry-run');
const skipCdkReturn = rest.includes('--skip-cdk-return');
const reasonIndex = rest.indexOf('--reason');
const reason = reasonIndex >= 0 ? String(rest[reasonIndex + 1] || '').trim() : 'rehearsal finished; closed before any payment to release the card';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  // 两种演练残单（CARD_READY 旧形态 / RECHARGE_PROCESSING 付款前 fail-closed）的判据与收口顺序见共用模块。
  // 演练收口带 closeRehearsalOrder:true：经营成功率（D-339）靠它排除演练。真实客户单请用后台「放弃并放卡」。
  const summary = await closePrePaymentOrderInTransaction(connection, {
    publicNo, reason, actorId: 'admin', runErrorCode: 'REHEARSAL_CLOSED', failureCode: 'CANCELLED_PRE_SUBMISSION',
    source: 'close_rehearsal_order', skipCdkReturn, eventMetadata: { closeRehearsalOrder: true },
  });
  const out = { ...summary, dryRun };
  if (dryRun) { await connection.rollback(); console.log('DRY RUN (rolled back)', JSON.stringify(out)); }
  else { await connection.commit(); console.log('CLOSED', JSON.stringify(out)); }
} catch (error) {
  await connection.rollback().catch(() => {});
  console.error('refused/failed:', error?.message || error);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
