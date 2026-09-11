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
  // 第二种卡住：点过付款、结果一直没落定，而且连自动核实升级为人工都没发生
  // （多半是 worker 中途死了）。阈值比核实窗口（5 分钟）长，让正常升级先走完，
  // 避免同一单既推这条又推「需要人工」。
  const [stuckRuns] = await connection.query(
    `SELECT o.id, o.public_no,
            TIMESTAMPDIFF(MINUTE, r.updated_at, CURRENT_TIMESTAMP(3)) AS waited
       FROM browser_runs r
       INNER JOIN recharge_attempts ra ON ra.id = r.recharge_attempt_id
       INNER JOIN orders o ON o.id = ra.order_id
      WHERE r.payment_state = 'PAYMENT_UNKNOWN'
        AND r.status <> 'HUMAN_REQUIRED'
        AND r.updated_at < CURRENT_TIMESTAMP(3) - INTERVAL ? MINUTE
        AND o.status NOT IN ('RECHARGE_SUCCESS','RECHARGE_FAILED','CLOSED','CARD_FAILED')`,
    [minutes + 5]
  );
  const found = {
    queued: stalled.map((row) => ({ publicNo: row.public_no, waitedMinutes: Number(row.waited) })),
    unresolvedPayment: stuckRuns.map((row) => ({ publicNo: row.public_no, waitedMinutes: Number(row.waited) })),
  };
  if (!dryRun) {
    for (const row of stalled) {
      await upsertBrowserAlertInTransaction(connection, {
        type: 'BROWSER_ORDER_STALLED', orderId: row.id,
        title: '客户卡住了，没人在处理',
        message: `已排队 ${row.waited} 分钟没有被执行。多半是本机没在跑：Mac 睡了、比特浏览器关了、隧道断了，或者付款开关没开。客户很快会来问。`,
      });
    }
    for (const row of stuckRuns) {
      await upsertBrowserAlertInTransaction(connection, {
        type: 'BROWSER_ORDER_STALLED', orderId: row.id,
        title: '客户卡住了，付款结果一直没落定',
        message: `已点过一次付款、${row.waited} 分钟没有结果，自动核实也没接上（多半是本机执行器中途停了）。系统不会重付。请看客户账号是不是 Plus、卡有没有被扣，然后在后台点「确认核实结果」。`,
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
