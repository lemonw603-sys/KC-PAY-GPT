// 客户卡住告警（D-175）。只读判断 + 只写告警行：不碰订单、不碰卡、不碰付款。
//
// 补的是唯一没人能发现的缺口：本机 Mac 睡了 / 比特浏览器关了 / 隧道断了 / 没人在，
// 客户的单就静静躺在队列里。没有 run 产生，也就没有任何既有告警会响。服务器是常开的，
// 只有它能发现"根本没人在干活"。
//
//   node scripts/stalled-order-watch.mjs [--minutes N] [--dry-run]
//   需要 DATABASE_URL。由 pojia-stalled-order-watch.timer 每分钟触发。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const HERE = dirname(fileURLToPath(import.meta.url));
const { upsertBrowserAlertInTransaction } = await import(join(HERE, '../src/db/repositories/browser-alert-repository.js'));

const args = process.argv.slice(2);
const idx = args.indexOf('--minutes');
// 3 分钟：客户没充成功通常三五分钟内就会来找运营，告警必须比客户快。
const minutes = idx >= 0 ? Math.max(1, Number(args[idx + 1]) || 3) : 3;
const dryRun = args.includes('--dry-run');
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL is required'); process.exit(2); }

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, connectionLimit: 2, timezone: 'Z' });
const connection = await pool.getConnection();
try {
  await connection.beginTransaction();
  const [stalled] = await connection.query(
    `SELECT o.id, o.public_no, d.status AS dispatch_status,
            TIMESTAMPDIFF(MINUTE, d.queued_at, CURRENT_TIMESTAMP(3)) AS waited
       FROM browser_dispatch_jobs d
       INNER JOIN orders o ON o.id = d.order_id
      WHERE d.status = 'QUEUED'
        AND d.queued_at < CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE
        AND o.status NOT IN ('RECHARGE_SUCCESS','RECHARGE_FAILED','CLOSED','CARD_FAILED')`,
    [minutes]
  );
  const found = stalled.map((row) => ({ publicNo: row.public_no, waitedMinutes: Number(row.waited) }));
  if (!dryRun) {
    for (const row of stalled) {
      await upsertBrowserAlertInTransaction(connection, {
        type: 'BROWSER_ORDER_STALLED', orderId: row.id,
        title: '客户卡住了，没人在处理',
        message: `已排队 ${row.waited} 分钟没有被执行。多半是本机没在跑：Mac 睡了、比特浏览器关了、隧道断了，或者付款开关没开。客户很快会来问。`,
      });
    }
  }
  await connection.commit();
  console.log(JSON.stringify({ dryRun, thresholdMinutes: minutes, stalled: found }));
} catch (error) {
  await connection.rollback().catch(() => undefined);
  console.error(String(error?.message || error));
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
