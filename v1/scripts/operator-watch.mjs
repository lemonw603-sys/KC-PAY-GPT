// 运营巡视告警（D-175/D-177）。只读判断 + 只写告警行：不碰订单、不碰卡、不碰付款。
//
// 管的是"没有任何人会告诉你"的那几件事：客户排队没人处理、付款结果一直没落定、
// 以及可分配卡见底。
//
// 补的是唯一没人能发现的缺口：本机 Mac 睡了 / 比特浏览器关了 / 隧道断了 / 没人在，
// 客户的单就静静躺在队列里。没有 run 产生，也就没有任何既有告警会响。服务器是常开的，
// 只有它能发现"根本没人在干活"。
//
//   node scripts/operator-watch.mjs [--minutes N] [--dry-run]
//   需要 DATABASE_URL。由 pojia-operator-watch.timer 每分钟触发。
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const HERE = dirname(fileURLToPath(import.meta.url));
const { upsertBrowserAlertInTransaction } = await import(join(HERE, '../src/db/repositories/browser-alert-repository.js'));
// 资格口径只有一份权威实现，这里复用它，不另拼 SQL——自拼过一次就报错过一次。
const { eligibleInventoryCardSql } = await import(join(HERE, '../src/services/card-inventory-eligibility.js'));

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
  // 第三件：可分配卡见底。等客户撞上「订单正在等卡」已经晚了——那时客户在等，
  // 而开一张卡要人去卡台操作。门槛沿用 Plus 的 16 美元，与分卡时同一口径。
  const [[stock]] = await connection.query(
    `SELECT COUNT(*) AS n FROM cards WHERE ${eligibleInventoryCardSql('cards', '?')}`, ['16']
  );
  const eligibleCards = Number(stock?.n) || 0;
  if (!dryRun) {
    if (eligibleCards === 0) {
      await connection.query(
        `INSERT INTO operator_alerts (id, alert_type, dedupe_key, severity, title, message, status)
         VALUES (UUID(), 'CARD_STOCK_EMPTY', 'card-stock:no-eligible', 'critical',
                 '没有可用卡了，下一个客户会卡住',
                 '合格卡 0 张。现在来的客户会停在等卡，不会扣款也不会失败，但会一直等。请去备用卡台开一张（记得看卡段后面的拒付战绩，别再选 513989）。', 'OPEN')
         ON DUPLICATE KEY UPDATE message = VALUES(message),
           status = IF(status = 'RESOLVED', 'OPEN', status),
           acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`
      );
    } else {
      // 有卡了就收掉，下次见底才会重新响——否则这条告警只会响一次，此后永远静默。
      await connection.query(
        `UPDATE operator_alerts SET status='RESOLVED', acknowledged_at=CURRENT_TIMESTAMP(3)
          WHERE dedupe_key='card-stock:no-eligible' AND status='OPEN'`
      );
    }
  }

  await connection.commit();
  console.log(JSON.stringify({ dryRun, thresholdMinutes: minutes, eligibleCards, stalled: found }));
} catch (error) {
  await connection.rollback().catch(() => undefined);
  console.error(String(error?.message || error));
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
