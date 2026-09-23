// 每周自检 · 服务器侧只读探针（由 scripts/weekly-check.sh 经 SSH 调用，在 /opt/pojia/current/v1 下跑）。
// 只用正式连接池与正式规则读数，不写库、不打印邮箱/Session/卡号。输出一行 JSON。
//   node scripts/weekly-readonly-probe.mjs
// 「需要我处理」的数量调的是后台同一份 listOrders 规则（不在这里另抄一份谓词，见 CLAUDE.md「判断工具不许抄业务规则」）。
import fs from 'node:fs';

for (const f of ['/etc/pojia/runtime.env', '/etc/pojia/admin.env', '/etc/pojia/card-read.env']) {
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)=(.*)$/); if (!m) continue;
    let v = m[2].trim(); if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
const { loadConfig } = await import('../src/config.js');
const { createDatabasePool } = await import('../src/db/pool.js');
const { createAdminReadService } = await import('../src/services/admin-read-service.js');
const { eligibleInventoryCardSql } = await import('../src/services/card-inventory-eligibility.js');

const config = loadConfig();
const pool = createDatabasePool(config.database);
const out = { at: new Date().toISOString() };
const one = async (sql, values = []) => { const [rows] = await pool.query(sql, values); return rows[0] ?? null; };
const setting = async (key) => (await one('SELECT setting_value AS v FROM app_settings WHERE setting_key = ? LIMIT 1', [key]))?.v ?? null;
const ageMin = (iso) => (iso ? Math.round((Date.now() - new Date(iso).getTime()) / 60000) : null);
try {
  const svc = createAdminReadService({ pool, sessionEncryptionKey: config.sessionEncryptionKey, cdkHashKey: config.cdkHashKey, panHmacKey: config.cardIntakePanHmacKey });
  const list = await svc.listOrders({ page: 1, pageSize: 1, includeSummary: true, groupByCdk: true, timeField: 'CREATED', status: 'REVIEW_REQUIRED' });
  out.buckets = list.summary?.buckets ?? null;

  out.switches = {
    browser_payment_writes_enabled: await setting('browser_payment_writes_enabled'),
    accept_new_orders: await setting('accept_new_orders'),
    intake_executor_heartbeat_check: (await setting('intake_executor_heartbeat_check')) ?? 'unset=on',
  };
  out.heartbeats = {
    browserWorkerAgeMin: ageMin(await setting('browser_worker_heartbeat_at')),
    dailyReconciliationAgeMin: ageMin(await setting('daily_reconciliation_heartbeat_at')),
  };
  out.activeRuns = Number((await one('SELECT COUNT(*) AS n FROM browser_runs WHERE active_account_key_hmac IS NOT NULL')).n);
  out.paymentUnknownOpen = Number((await one(`SELECT COUNT(*) AS n FROM orders WHERE status IN ('SUBMIT_UNKNOWN','RECONCILIATION_REQUIRED')`)).n);
  // 到期收口服务应在到期后很快把等 Session 单关掉；超期 30 分钟还在等 = 收口没跑
  out.sessionWaitOverdue = Number((await one(`SELECT COUNT(*) AS n FROM orders WHERE status = 'WAITING_FOR_SESSION' AND session_repair_expires_at IS NOT NULL AND session_repair_expires_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 30 MINUTE)`)).n);
  out.staleNonTerminal = Number((await one(`SELECT COUNT(*) AS n FROM orders WHERE status NOT IN ('RECHARGE_SUCCESS','RECHARGE_FAILED','CLOSED','WAITING_FOR_SESSION') AND updated_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 24 HOUR)`)).n);
  out.tasks = {
    // 只算非终态订单的任务：终态单上的残留 PENDING（如 09-10 一个 CLOSED 单的 BROWSER_PREFLIGHT）不堵队列，另计为「残留」
    pendingOver1h: Number((await one(`SELECT COUNT(*) AS n FROM tasks t INNER JOIN orders o ON o.id = t.order_id WHERE t.status = 'PENDING' AND t.available_at < DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR) AND o.status NOT IN ('RECHARGE_SUCCESS','RECHARGE_FAILED','CLOSED')`)).n),
    leftoverOnTerminal: Number((await one(`SELECT COUNT(*) AS n FROM tasks t INNER JOIN orders o ON o.id = t.order_id WHERE t.status IN ('PENDING','RUNNING') AND o.status IN ('RECHARGE_SUCCESS','RECHARGE_FAILED','CLOSED')`)).n),
    runningLeaseExpired: Number((await one(`SELECT COUNT(*) AS n FROM tasks WHERE status = 'RUNNING' AND leased_until < CURRENT_TIMESTAMP(3)`)).n),
  };
  const minBal = await setting('default_minimum_required_card_balance');
  out.cards = { plusMinBalance: minBal, eligible: null };
  if (minBal && /^[0-9.]+$/.test(minBal)) {
    out.cards.eligible = Number((await one(`SELECT COUNT(*) AS n FROM cards c WHERE ${eligibleInventoryCardSql('c', minBal)}`)).n);
  }
  const [snaps] = await pool.query(`SELECT pa.provider_code, MAX(s.created_at) AS last_at FROM provider_balance_snapshots s INNER JOIN provider_accounts pa ON pa.id = s.provider_account_id WHERE pa.purpose = 'CARD' GROUP BY pa.provider_code`);
  out.walletSnapshotAgeMin = Object.fromEntries(snaps.map((r) => [r.provider_code, ageMin(r.last_at)]));
  const week = await one(`SELECT
      SUM(status = 'RECHARGE_SUCCESS') AS success, SUM(status IN ('RECHARGE_FAILED','CLOSED')) AS failed,
      SUM(status IN ('SUBMIT_UNKNOWN','RECONCILIATION_REQUIRED')) AS unknown, COUNT(*) AS total
    FROM orders WHERE created_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)`);
  out.last7d = { total: Number(week.total), success: Number(week.success || 0), failed: Number(week.failed || 0), unknown: Number(week.unknown || 0) };
  out.ok = true;
} catch (error) {
  out.ok = false; out.error = String(error?.message || error).slice(0, 200);
} finally {
  await pool.end().catch(() => undefined);
}
console.log(JSON.stringify(out));
