// 归档 card_sync_jobs 的历史 REVIEW_REQUIRED 残留（D-269 ⑤，Lemon 同意像 965 条那样归档）。
// 两类来源都已堵住：hnskj 旧 $0 卡的 REFUND_WATCH 同步失败（卡台已作废，卡本身随第④步标 RETIRED、scheduler 不再排）；
// highvcc（MANUAL_IMPORT）卡被排进 hnskj 同步（scheduler 第④步起排除）。
//
//   node scripts/archive-legacy-card-sync-jobs.mjs            # dry-run：只列清单，不写
//   node scripts/archive-legacy-card-sync-jobs.mjs --apply    # status → ARCHIVED_LEGACY，不删行；error_code/error_message 原样留作观察
//   Needs DATABASE_URL。只归档 status='REVIEW_REQUIRED' 且 created_at 早于 --before（默认 2026-09-18 00:00:00 UTC）。
import mysql from 'mysql2/promise';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const beforeIndex = args.indexOf('--before');
const before = beforeIndex >= 0 ? String(args[beforeIndex + 1] || '') : '2026-09-18 00:00:00';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(before)) { console.error('--before must be YYYY-MM-DD HH:MM:SS (UTC)'); process.exit(2); }

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [byAccount] = await connection.query(
    `SELECT c.provider_account_id, c.sync_tier, j.error_code, COUNT(*) AS n, MIN(j.created_at) oldest, MAX(j.created_at) newest
       FROM card_sync_jobs j INNER JOIN cards c ON c.id = j.card_id
      WHERE j.status = 'REVIEW_REQUIRED' AND j.created_at < ? GROUP BY 1,2,3 ORDER BY 1,2,3`, [before]);
  const [[total]] = await connection.query(
    `SELECT COUNT(*) AS n FROM card_sync_jobs WHERE status = 'REVIEW_REQUIRED' AND created_at < ?`, [before]);
  const [[excluded]] = await connection.query(
    `SELECT COUNT(*) AS n FROM card_sync_jobs WHERE status = 'REVIEW_REQUIRED' AND created_at >= ?`, [before]);
  const summary = { mode: apply ? 'apply' : 'dry-run', before, candidates: Number(total.n), excludedNewer: Number(excluded.n),
    byAccountTierError: byAccount.map((r) => ({ account: r.provider_account_id, tier: r.sync_tier, error: r.error_code, n: Number(r.n), oldest: r.oldest, newest: r.newest })) };
  if (!apply) { await connection.rollback(); console.log(JSON.stringify(summary, null, 2)); }
  else {
    const [result] = await connection.query(
      `UPDATE card_sync_jobs SET status = 'ARCHIVED_LEGACY', updated_at = CURRENT_TIMESTAMP(3)
        WHERE status = 'REVIEW_REQUIRED' AND created_at < ?`, [before]);
    if (Number(result.affectedRows) !== Number(total.n)) { await connection.rollback(); throw new Error(`expected ${total.n} rows, touched ${result.affectedRows}; rolled back`); }
    await connection.commit();
    const [[after]] = await pool.query(`SELECT COUNT(*) AS n FROM card_sync_jobs WHERE status = 'REVIEW_REQUIRED'`);
    console.log(JSON.stringify({ ...summary, archived: result.affectedRows, reviewRequiredAfter: Number(after.n) }, null, 2));
  }
} catch (error) {
  try { await connection.rollback(); } catch { /* already */ }
  console.error('failed:', error.code || error.constructor.name, '-', error.message); process.exitCode = 1;
} finally { connection.release(); await pool.end(); }
