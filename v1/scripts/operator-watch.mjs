// 运营巡视告警（D-175/D-177）。只读判断 + 只写告警行：不碰订单、不碰卡、不碰付款。
//
// 管的是"没有任何人会告诉你"的那几件事：客户排队没人处理、付款结果一直没落定、
// 停在付款前没人处理（D-390）、以及可分配卡见底。订单结束后它的「客户卡住了」自动收掉。
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
const { EXECUTOR_HEARTBEAT_MAX_AGE_MS, EXECUTOR_HEARTBEAT_SETTING } = await import(join(HERE, '../src/db/repositories/order-intake-repository.js'));
// 资格口径只有一份权威实现，这里复用它，不另拼 SQL——自拼过一次就报错过一次。
const { usableCardSql } = await import(join(HERE, '../src/services/card-inventory-eligibility.js'));
const { PRE_PAYMENT_STUCK_SQL, RESOLVE_FINISHED_STALLED_SQL, resolveFinishedOrderAlertsSql, preStuckAlert,
  API_PROCESSING_STUCK_SQL, RESOLVE_API_STALLED_SQL, apiStuckAlert } = await import(join(HERE, '../src/db/repositories/stalled-order-queries.js'));
const { recordSucceededOrders, resolveDeliveredSuccessAlertsSql } = await import(join(HERE, '../src/db/repositories/order-success-push.js'));
const { stuckTopUpsWithoutAlertSql, upsertTopUpAlert } = await import(join(HERE, '../src/db/repositories/card-top-up-repository.js'));

const args = process.argv.slice(2);
const idx = args.indexOf('--minutes');
// 3 分钟：客户没充成功通常三五分钟内就会来找运营，告警必须比客户快。
const minutes = idx >= 0 ? Math.max(1, Number(args[idx + 1]) || 3) : 3;
// API 单正常约 1 分钟付完款（09-28 真单 49 秒）；15 分钟没结果就叫人（D-414 补记十一）。
const API_STUCK_MINUTES = 15;
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
  // 第三种卡住（D-390，欠账 17）：停在付款前、没有任何程序在处理，客户页却照样显示处理中。
  const [prePaymentStuck] = await connection.query(PRE_PAYMENT_STUCK_SQL, [minutes, minutes, minutes]);
  // 第三种半（D-411 对抗审查 2026-09-30）：付款前补钱没了结、15 分钟了还没叫过人。正常情况下补钱自己的核对任务
  // 3 分钟内就会换卡 / 叫人；走到这里说明那个任务丢了（进程死、任务死、追踪开关关着），客户可能还停在「正在准备支付卡」。
  const [stuckTopUps] = await connection.query(stuckTopUpsWithoutAlertSql(), [minutes + 12]);
  // 第四种卡住（D-414 补记十一）：API 单停在提交中 / 充值处理中超过 15 分钟（正常约 1 分钟付完款）。
  const [apiStuck] = await connection.query(API_PROCESSING_STUCK_SQL, [API_STUCK_MINUTES]);
  const found = {
    stuckTopUps: stuckTopUps.map((row) => ({ last4: row.last4, status: row.status, waitedMinutes: Number(row.waited) })),
    queued: stalled.map((row) => ({ publicNo: row.public_no, waitedMinutes: Number(row.waited) })),
    unresolvedPayment: stuckRuns.map((row) => ({ publicNo: row.public_no, waitedMinutes: Number(row.waited) })),
    prePayment: prePaymentStuck.map((row) => ({ publicNo: row.public_no, waitedMinutes: Number(row.waited) })),
    apiProcessing: apiStuck.map((row) => ({ publicNo: row.public_no, waitedMinutes: Number(row.waited), stillChecking: Boolean(Number(row.still_checking)) })),
  };
  let succeededPushed = 0;
  if (!dryRun) {
    for (const row of stuckTopUps) {
      await upsertTopUpAlert(connection, { topUpId: row.id, orderId: row.order_id, last4: row.last4, amount: row.amount,
        orderWaiting: !Number(row.order_detached),
        detail: `已经 ${row.waited} 分钟没有了结（停在 ${row.status}），自动核对没在跑` });
    }
    for (const row of stalled) {
      await upsertBrowserAlertInTransaction(connection, {
        type: 'BROWSER_ORDER_STALLED', orderId: row.id,
        title: '客户卡住了，没人在处理',
        message: `已排队 ${row.waited} 分钟没有被执行。多半是本机没在跑：Mac 睡了、比特浏览器关了、隧道断了，或者付款开关没开。客户很快会来问。`,
      });
    }
    for (const row of prePaymentStuck) {
      await upsertBrowserAlertInTransaction(connection, preStuckAlert(row));
    }
    for (const row of apiStuck) {
      await upsertBrowserAlertInTransaction(connection, apiStuckAlert(row));
    }
    await connection.query(RESOLVE_API_STALLED_SQL);
    // 订单结束了，它的「客户卡住了」就收掉（D-390）；以前从不自动解除。
    await connection.query(RESOLVE_FINISHED_STALLED_SQL);
    // 订单结束且不再需要人、推送已发完的「浏览器单失败 / 要人工」也收掉（D-405）。
    await connection.query(resolveFinishedOrderAlertsSql());
    // 「充值成功」推送（D-409：每单结束时推一条，两条路线都在这里捡）；推完的收掉。
    succeededPushed = await recordSucceededOrders(connection);
    await connection.query(resolveDeliveredSuccessAlertsSql());
    for (const row of stuckRuns) {
      await upsertBrowserAlertInTransaction(connection, {
        type: 'BROWSER_ORDER_STALLED', orderId: row.id,
        title: '客户卡住了，付款结果一直没落定',
        message: `已点过一次付款、${row.waited} 分钟没有结果，自动核实也没接上（多半是本机执行器中途停了）。系统不会重付。请看客户账号是不是 Plus、卡有没有被扣，然后在后台点「确认核实结果」。`,
      });
    }
  }
  // 第三件：可分配卡见底。等客户撞上「订单正在等卡」已经晚了——那时客户在等，
  // 而开一张卡要人去卡台操作。门槛沿用 Plus 的 16 美元。
  // D-411：「能服务下一单」与调度器水位同一口径（usableCardSql）——只剩一张要补钱的旧卡、钱包也够补时
  // 不算没卡；钱包不够补或「自动开卡」总闸关着时它不算数，照常报没卡。
  const [[stock]] = await connection.query(
    `SELECT COUNT(*) AS n FROM cards WHERE ${usableCardSql('cards', '?', { productCode: 'plus' })}`, ['16']
  );
  const eligibleCards = Number(stock?.n) || 0;
  // 合格卡为 0，未必等于「该补货了」——卡被正在跑的单占着也是 0，那张卡跑完就回来。
  // 我们常态只有一两张卡，于是每提一单就归零一次：告警 RESOLVED→OPEN 翻一次，
  // 手机就响一次，Lemon 每单收一条噪音（2026-09-12，D-190 续）。
  // 真正该响的是「没卡可分，而且没有卡会回来」：没有任何活动占用。
  const [[held]] = await connection.query(
    "SELECT COUNT(*) AS n FROM card_assignment_history WHERE status = 'ACTIVE'"
  );
  const heldByRunningOrders = Number(held?.n) || 0;
  if (!dryRun) {
    if (eligibleCards === 0 && heldByRunningOrders === 0) {
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
      // 有卡、或有卡正被占着（跑完会回来）就收掉，下次真见底才重新响。
      await connection.query(
        `UPDATE operator_alerts SET status='RESOLVED', acknowledged_at=CURRENT_TIMESTAMP(3)
          WHERE dedupe_key='card-stock:no-eligible' AND status='OPEN'`
      );
    }
  }

  // 第四件（D-352 块 3 ③，2026-09-23）：接单路线的执行器心跳断了。下单入口此时会拒客户
  // （EXECUTOR_UNAVAILABLE，D-352 块 3 ②），客户看到「暂停接单」；这条是叫人的那一半——
  // Mac 睡了 / 比特浏览器关了 / 隧道断了 / v1 worker 挂了，只有人能把它拉起来。
  // 阈值与下单入口一致取 120s（EXECUTOR_HEARTBEAT_MAX_AGE_MS），巡检每分钟跑一次。
  const [routeRows] = await connection.query(
    `SELECT DISTINCT executor_kind FROM fulfillment_routes WHERE accepts_new_orders = 1 AND retired_at IS NULL`
  );
  const [heartbeatRows] = await connection.query(
    `SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN (?, ?)`,
    [EXECUTOR_HEARTBEAT_SETTING.BROWSER, EXECUTOR_HEARTBEAT_SETTING.API]
  );
  const heartbeats = new Map(heartbeatRows.map((row) => [row.setting_key, row.setting_value]));
  const executors = {};
  for (const row of routeRows) {
    const kind = String(row.executor_kind || '').toUpperCase();
    const key = EXECUTOR_HEARTBEAT_SETTING[kind];
    if (!key) continue;
    const at = Date.parse(String(heartbeats.get(key) || ''));
    const ageMs = Number.isFinite(at) ? Date.now() - at : null;
    const offline = ageMs == null || ageMs > EXECUTOR_HEARTBEAT_MAX_AGE_MS;
    executors[kind] = { offline, ageSeconds: ageMs == null ? null : Math.round(ageMs / 1000) };
    if (dryRun) continue;
    const dedupeKey = `executor-offline:${kind}`;
    if (offline) {
      const label = kind === 'BROWSER' ? '本机 Browser 执行器' : 'v1 任务 worker';
      await connection.query(
        `INSERT INTO operator_alerts (id, alert_type, dedupe_key, severity, title, message, status)
         VALUES (UUID(), 'EXECUTOR_OFFLINE', ?, 'critical', ?, ?, 'OPEN')
         ON DUPLICATE KEY UPDATE message = VALUES(message),
           status = IF(status = 'RESOLVED', 'OPEN', status),
           acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`,
        [dedupeKey, `${label}停了，客户正在被拒单`,
          `${label}心跳${ageMs == null ? '从未写入' : `已 ${Math.round(ageMs / 1000)} 秒没更新`}。这条路线现在接不了单：客户提交会看到「系统维护，暂时无法接单」，卡密不消耗。`
          + (kind === 'BROWSER' ? '请看 Mac 是否睡了、比特浏览器是否开着、隧道是否在（ready-check.sh），拉起后本条自动解除。' : '请看服务器 pojia-worker 服务，拉起后本条自动解除。')]
      );
    } else {
      await connection.query(
        `UPDATE operator_alerts SET status='RESOLVED', acknowledged_at=CURRENT_TIMESTAMP(3)
          WHERE dedupe_key=? AND status='OPEN'`, [dedupeKey]
      );
    }
  }

  await connection.commit();
  console.log(JSON.stringify({ dryRun, thresholdMinutes: minutes, eligibleCards, heldByRunningOrders,
    cardStockAlert: eligibleCards === 0 && heldByRunningOrders === 0 ? 'OPEN' : 'RESOLVED', stalled: found, succeededPushed, executors }));
} catch (error) {
  await connection.rollback().catch(() => undefined);
  console.error(String(error?.message || error));
  process.exitCode = 1;
} finally {
  connection.release();
  await pool.end();
}
