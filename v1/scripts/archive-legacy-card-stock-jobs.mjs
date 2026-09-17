// 归档旧架构（2026-09-05 前每分钟自动开卡）留下的 card_stock_jobs REVIEW_REQUIRED 残留。
// 它们命中 scheduleAutomaticJob / 供卡调度器的「花过钱没人核对」检查（PROVIDER/SCHEMA/TIMEOUT
// 类 930 条），自动开卡一打开就永远 FUNDS_REVIEW_REQUIRED（D-247 面二③）。
//
//   node scripts/archive-legacy-card-stock-jobs.mjs                # dry-run：只列清单，不写
//   node scripts/archive-legacy-card-stock-jobs.mjs --apply        # 归档（status → ARCHIVED_LEGACY，不删行）
//   Needs DATABASE_URL（生产主机 source /etc/pojia/runtime.env）。
//
// 只归档同时满足的行：status='REVIEW_REQUIRED' · opened_count=0（没开出过卡，不可能是「钱扣了卡没入库」）·
// created_at 早于 --before（默认 2026-09-06 00:00 UTC，残留最新一条是 09-05 22:32）。
// 归档不改 error_code/error_message（那是当时的观察），只写 archived_at + archive_reason。
import mysql from 'mysql2/promise';
import { ARCHIVED_LEGACY_STATUS, unresolvedPaidJobsSql } from '../src/services/card-stock-job-service.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const beforeIndex = args.indexOf('--before');
const before = beforeIndex >= 0 ? String(args[beforeIndex + 1] || '') : '2026-09-06 00:00:00';
const reason = 'legacy per-minute auto-open architecture residue (D-247 面二③); opened_count=0; archived, not deleted';
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }
if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(before)) { console.error('--before must be YYYY-MM-DD HH:MM:SS (UTC)'); process.exit(2); }

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [candidates] = await connection.query(
    `SELECT id, job_source, error_code, opened_count, created_at FROM card_stock_jobs
      WHERE status = 'REVIEW_REQUIRED' AND opened_count = 0 AND created_at < ?
      ORDER BY created_at ASC FOR UPDATE`, [before]
  );
  const [excluded] = await connection.query(
    `SELECT id, error_code, opened_count, created_at FROM card_stock_jobs
      WHERE status = 'REVIEW_REQUIRED' AND NOT (opened_count = 0 AND created_at < ?)`, [before]
  );
  const byCode = {};
  for (const row of candidates) byCode[row.error_code || 'NULL'] = (byCode[row.error_code || 'NULL'] || 0) + 1;
  const [blockingBefore] = await connection.query(unresolvedPaidJobsSql());
  const summary = {
    mode: apply ? 'apply' : 'dry-run', before, candidates: candidates.length, byErrorCode: byCode,
    oldest: candidates[0]?.created_at || null, newest: candidates.at(-1)?.created_at || null,
    excludedStillReviewRequired: excluded.map((row) => ({ id: row.id, error_code: row.error_code, opened_count: row.opened_count, created_at: row.created_at })),
    blockingSchedulerBefore: blockingBefore.length
  };
  if (!apply) {
    await connection.rollback();
    console.log(JSON.stringify(summary, null, 2));
  } else {
    const [result] = await connection.query(
      `UPDATE card_stock_jobs SET status = ?, archived_at = CURRENT_TIMESTAMP(3), archive_reason = ?
        WHERE status = 'REVIEW_REQUIRED' AND opened_count = 0 AND created_at < ?`,
      [ARCHIVED_LEGACY_STATUS, reason, before]
    );
    if (Number(result.affectedRows) !== candidates.length) {
      await connection.rollback();
      throw new Error(`expected ${candidates.length} rows, update touched ${result.affectedRows}; rolled back`);
    }
    await connection.commit();
    const [blockingAfter] = await pool.query(unresolvedPaidJobsSql());
    const [[archived]] = await pool.query(`SELECT COUNT(*) AS n FROM card_stock_jobs WHERE status = ?`, [ARCHIVED_LEGACY_STATUS]);
    console.log(JSON.stringify({ ...summary, archived: result.affectedRows, archivedTotal: Number(archived.n), blockingSchedulerAfter: blockingAfter.length }, null, 2));
  }
} catch (error) {
  try { await connection.rollback(); } catch { /* already rolled back */ }
  console.error('failed:', error.code || error.constructor.name, '-', error.message);
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
