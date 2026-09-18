import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCardSupplyScheduler, estimateIssueFeeCents, walletPreflight, SUPPLY_FAULT_RETRY_MS
} from '../src/services/card-supply-scheduler-service.js';

const HNSKJ_ID = '00000000-0000-4000-8000-000000000101';
const BACKUP_ID = '00000000-0000-4000-8000-000000000103';
const PLUS = '00000000-0000-4000-8000-000000000201';
const PRO20 = '00000000-0000-4000-8000-000000000206';

// 生产 2026-09-17 实值：101 hnskj / 103 备用卡台 A（053 迁移后的能力列）。
function accountRow(id, overrides = {}) {
  const backup = id === BACKUP_ID;
  return {
    id, provider_code: backup ? 'manual_excel' : 'hnskj', account_code: backup ? 'backup-a' : 'legacy-primary',
    display_name: backup ? '备用卡台 A' : 'HNSKJ', environment: 'PRODUCTION', purpose: 'CARD',
    source_adapter: backup ? 'backup_card_export_v1' : 'hnskj_api_v1', open_adapter: backup ? 'highvcc_api_v1' : 'hnskj_api_v1',
    default_card_segment: backup ? '708' : '23', wallet_floor: backup ? '20.000000' : '30.000000', wallet_alert_threshold: '50.000000',
    supply_fault_state: 'OK', supply_fault_reason: null, supply_fault_at: null,
    supports_api_recharge: backup ? 0 : 1, supports_browser_recharge: 1, supports_api_sync: backup ? 0 : 1,
    supports_auto_open: 1, supports_auto_funding: backup ? 0 : 1, operational_enabled: 1,
    read_enabled: backup ? 0 : 1, write_enabled: 0, circuit_state: 'CLOSED', retry_after_until: null, last_full_snapshot_at: null,
    ...overrides
  };
}
function policyRows() {
  const rows = [];
  for (const id of [HNSKJ_ID, BACKUP_ID]) {
    rows.push({ provider_account_id: id, product_code: 'plus', target_available: 2, open_card_amount: '50.000000', daily_open_limit: 20, card_segment: null });
    rows.push({ provider_account_id: id, product_code: 'pro_20x', target_available: 0, open_card_amount: '150.000000', daily_open_limit: 20, card_segment: null });
  }
  return rows;
}
function selectionRows({ plusBrowser = BACKUP_ID } = {}) {
  return [
    { product_id: PLUS, product_code: 'chatgpt_plus', legacy_plan_type: 'plus', executor_kind: 'API', provider_account_id: HNSKJ_ID, locked: 1, version: 1, updated_by: 'm', updated_at: null },
    { product_id: PLUS, product_code: 'chatgpt_plus', legacy_plan_type: 'plus', executor_kind: 'BROWSER', provider_account_id: plusBrowser, locked: 0, version: 8, updated_by: 'admin', updated_at: null },
    { product_id: PRO20, product_code: 'chatgpt_pro_20x', legacy_plan_type: 'pro_20x', executor_kind: 'BROWSER', provider_account_id: BACKUP_ID, locked: 0, version: 1, updated_by: 'm', updated_at: null }
  ];
}

/**
 * 按 SQL 片段路由的假库。available / waiting / today 可按台给数；alerts / jobs 记下来断言。
 */
function fakePool({
  enabled = true, accounts = [accountRow(HNSKJ_ID), accountRow(BACKUP_ID)], selections = selectionRows(),
  available = {}, waiting = {}, today = {}, fees = {}, activeJob = false, unresolved = false
} = {}) {
  const queries = []; const alerts = []; const resolved = []; const jobs = []; const faults = [];
  const key = (account, product) => `${account}:${product}`;
  async function query(sql, params = []) {
    const text = String(sql);
    queries.push({ sql: text.replace(/\s+/g, ' ').trim(), params });
    if (text.includes("setting_key = 'card_auto_replenishment_enabled'")) return [[{ setting_key: 'card_auto_replenishment_enabled', setting_value: enabled ? 'true' : 'false' }]];
    if (text.includes('FROM provider_accounts pa')) return [accounts];
    if (text.includes('FROM card_source_selections s')) return [selections];
    if (text.includes('FROM card_supply_policies')) return [policyRows()];
    if (text.includes('FROM products WHERE status')) return [[
      { id: PLUS, product_code: 'chatgpt_plus', legacy_plan_type: 'plus' },
      { id: PRO20, product_code: 'chatgpt_pro_20x', legacy_plan_type: 'pro_20x' }
    ]];
    if (text.includes('SELECT COUNT(*) AS count FROM cards')) {
      const product = /minimum_required_card_balance:([a-z0-9_]+)/.exec(text)?.[1] || 'plus';
      return [[{ count: available[key(params[0], product)] ?? 0 }]];
    }
    if (text.includes('SELECT COUNT(*) AS count, MIN(o.created_at)')) {
      const product = params[0] === PLUS ? 'plus' : 'pro_20x';
      return [[{ count: waiting[key(params[1], product)] ?? 0, oldest: null }]];
    }
    if (text.includes('SELECT o.id FROM orders o')) {
      const product = params[0] === PLUS ? 'plus' : 'pro_20x';
      return [(waiting[key(params[1], product)] ?? 0) > 0 ? [{ id: `order-${product}` }] : []];
    }
    if (text.includes('SUM(requested_count - opened_count)')) return [[{ count: 0 }]];
    if (text.includes('INSERT INTO operator_alerts')) { alerts.push({ type: params[0], key: params[1], severity: params[3], message: params[5] }); return [{ affectedRows: 1 }]; }
    if (text.startsWith('UPDATE operator_alerts')) { resolved.push(params[0]); return [{ affectedRows: 0 }]; }
    if (text.includes("SELECT id FROM card_stock_jobs WHERE status IN ('PENDING','RUNNING')")) return [activeJob ? [{ id: 'job-active' }] : []];
    if (text.includes("status = 'REVIEW_REQUIRED'")) return [unresolved ? [{ id: 'job-review' }] : []];
    if (text.includes('SUM(CASE') && text.includes('WHERE provider_account_id = ?')) return [[{ count: today[params[0]] ?? 0 }]];
    if (text.includes('FROM card_transactions ct')) return [(fees[params[0]] || []).map((amount) => ({ amount }))];
    if (text.startsWith('UPDATE provider_accounts SET supply_fault_state = \'FAULT\'')) { faults.push({ id: params[2], reason: params[0] }); return [{ affectedRows: 1 }]; }
    // 第⑤步：markSupplyFault 现在还要读账户名，好把「哪个卡台坏了」写进告警文案。
    if (text.startsWith('SELECT display_name, provider_code FROM provider_accounts')) return [[{ display_name: `账户 ${params[0]}`, provider_code: 'test' }]];
    if (text.includes('INSERT INTO card_stock_jobs')) { jobs.push({ id: params[0], opener: params[1], product: params[2], fallbackFor: params[3], segment: params[4], amount: params[5], estimatedTotal: params[6], rules: JSON.parse(params[7]) }); return [{ affectedRows: 1 }]; }
    throw new Error(`unexpected query: ${text.slice(0, 100)}`);
  }
  const connection = { query, async beginTransaction() {}, async commit() {}, async rollback() {}, release() {} };
  return { queries, alerts, resolved, jobs, faults, query, async getConnection() { return connection; } };
}

/** 假适配器，钱包用生产真实数（2026-09-17 16:21 UTC hnskj $89.48；15:52 UTC highvcc $23.68）。 */
function fakeAdapters({ hnskjBalance = '89.48', highvccBalance = '23.68', highvccToken = true, hnskjPurchaseEnabled = true } = {}) {
  const calls = [];
  const adapters = {
    hnskj_api_v1: {
      async canOpen() { return { ok: true }; },
      async readWallet(account) { calls.push(['wallet', account.id]); return { availableBalance: hnskjBalance, currency: 'USD', purchaseEnabled: hnskjPurchaseEnabled, snapshot: {} }; },
      preflight(account, input) { calls.push(['preflight', account.id, input.segment, input.amount]); return { cardType: { name: '新—VISA-测试' } }; }
    },
    highvcc_api_v1: {
      async canOpen() { return highvccToken ? { ok: true } : { ok: false, reason: 'HIGHVCC_TOKEN_MISSING' }; },
      async readWallet(account) { calls.push(['wallet', account.id]); return { availableBalance: highvccBalance, currency: 'USD', purchaseEnabled: true }; },
      preflight() { return null; }
    }
  };
  return { calls, has: (code) => Boolean(adapters[code]), for: (code) => adapters[code] || null };
}

test('水位：可分配低于水位就按该台策略开一张，并把库存偏低告警按台×产品打开', async () => {
  const pool = fakePool({ available: { [`${HNSKJ_ID}:plus`]: 0, [`${BACKUP_ID}:plus`]: 2 } });
  const adapters = fakeAdapters();
  const result = await createCardSupplyScheduler({ pool, adapters }).run();
  assert.equal(result.reason, 'SCHEDULED');
  assert.equal(pool.jobs.length, 1);
  const job = pool.jobs[0];
  assert.equal(job.opener, HNSKJ_ID);
  assert.equal(job.product, 'plus');
  assert.equal(job.fallbackFor, null);
  assert.equal(job.segment, '23', '卡段来自账户默认卡段（生产 default_card_type_id=23）');
  assert.equal(job.amount, '50.000000', '开卡金额来自策略表（D-247 Plus $50），不是旧的全局 $16');
  // 没有 CARD_ISSUE_FEE 观察 → 用保守上限 10%+$1 = $6；89.48 − 50 − 6 = 33.48 ≥ 30 底线。
  assert.deepEqual(job.rules.feeEstimate, { cents: 600, source: 'PLAUSIBLE_UPPER_BOUND' });
  assert.equal(job.rules.preflight.projected, '33.48');
  assert.equal(job.estimatedTotal, '56.00');
  assert.deepEqual(adapters.calls.find((c) => c[0] === 'preflight'), ['preflight', HNSKJ_ID, '23', '50.000000']);
  const low = pool.alerts.filter((a) => a.type === 'CARD_STOCK_LOW');
  assert.deepEqual(low.map((a) => a.key), [`card-stock-low:${HNSKJ_ID}:plus`]);
  assert.ok(pool.resolved.includes(`card-stock-low:${BACKUP_ID}:plus`), '够水位的那台把告警关掉');
  assert.equal(result.decisions.find((d) => d.providerAccountId === HNSKJ_ID && d.productCode === 'plus').deficit, 2);
});

test('日限：该台今天已开到上限就不开，也不建 job', async () => {
  const pool = fakePool({ available: { [`${HNSKJ_ID}:plus`]: 0, [`${BACKUP_ID}:plus`]: 2 }, today: { [HNSKJ_ID]: 20 } });
  const result = await createCardSupplyScheduler({ pool, adapters: fakeAdapters() }).run();
  assert.equal(result.reason, 'DAILY_LIMIT');
  assert.deepEqual(result.outcome, { scheduled: false, reason: 'DAILY_LIMIT', opener: HNSKJ_ID, usedToday: 20, dailyLimit: 20 });
  assert.equal(pool.jobs.length, 0);
});

test('钱包预检：余额 − 金额 − 手续费低于硬底线就不开，推一条 critical 告警', async () => {
  // hnskj 钱包 $60：60 − 50 − 6 = 4 < 30 底线。
  const pool = fakePool({ available: { [`${HNSKJ_ID}:plus`]: 0, [`${BACKUP_ID}:plus`]: 2 } });
  const result = await createCardSupplyScheduler({ pool, adapters: fakeAdapters({ hnskjBalance: '60.00' }) }).run();
  assert.equal(result.reason, 'WALLET_BELOW_FLOOR');
  assert.equal(pool.jobs.length, 0);
  const alert = pool.alerts.find((a) => a.type === 'CARD_SUPPLY_WALLET_LOW');
  assert.equal(alert.severity, 'critical');
  assert.match(alert.message, /扣完剩 4\.00，低于硬底线 30\.00/);
  assert.equal(result.outcome.preflight.ok, false);
});

test('钱包预检：有真实 CARD_ISSUE_FEE 观察时用它的中位数而不是保守上限', async () => {
  const pool = fakePool({
    available: { [`${HNSKJ_ID}:plus`]: 0, [`${BACKUP_ID}:plus`]: 2 },
    // 第②步 T2 的真实样本形状：开卡 $16 观察到 $0.58。
    fees: { [HNSKJ_ID]: ['0.580000', '0.750000', '0.580000'] }
  });
  await createCardSupplyScheduler({ pool, adapters: fakeAdapters() }).run();
  assert.deepEqual(pool.jobs[0].rules.feeEstimate, { cents: 58, source: 'OBSERVED' });
  assert.equal(pool.jobs[0].estimatedTotal, '50.58');
});

test('钱包低于告警线只告警不停：$45 ≥ 底线 30 + 50 + 6 不成立时才停', async () => {
  const pool = fakePool({ available: { [`${HNSKJ_ID}:plus`]: 0, [`${BACKUP_ID}:plus`]: 2 } });
  const result = await createCardSupplyScheduler({ pool, adapters: fakeAdapters({ hnskjBalance: '95.00' }) }).run();
  assert.equal(result.reason, 'SCHEDULED');
  assert.ok(pool.resolved.includes(`provider-wallet-low:${HNSKJ_ID}`));
  const pool2 = fakePool({ available: { [`${HNSKJ_ID}:plus`]: 0, [`${BACKUP_ID}:plus`]: 2 } });
  const r2 = await createCardSupplyScheduler({ pool: pool2, adapters: fakeAdapters({ hnskjBalance: '48.00' }) }).run();
  assert.equal(r2.reason, 'WALLET_BELOW_FLOOR');
  assert.ok(pool2.alerts.some((a) => a.type === 'PROVIDER_WALLET_LOW' && a.severity === 'warning'));
});

test('故障转台：Browser 需求所在的 highvcc 没 token → 用 hnskj 开一张顶上，job 记 fallback_for', async () => {
  const faultedBackup = accountRow(BACKUP_ID, {
    supply_fault_state: 'FAULT', supply_fault_reason: 'HIGHVCC_TOKEN_EXPIRED', supply_fault_at: new Date(Date.now() - 60_000)
  });
  const pool = fakePool({
    accounts: [accountRow(HNSKJ_ID), faultedBackup],
    available: { [`${HNSKJ_ID}:plus`]: 2, [`${BACKUP_ID}:plus`]: 0 },
    waiting: { [`${BACKUP_ID}:plus`]: 1 }
  });
  const adapters = fakeAdapters({ highvccToken: false });
  const result = await createCardSupplyScheduler({ pool, adapters }).run();
  assert.equal(result.reason, 'SCHEDULED');
  assert.equal(pool.jobs.length, 1);
  assert.equal(pool.jobs[0].opener, HNSKJ_ID);
  assert.equal(pool.jobs[0].fallbackFor, BACKUP_ID);
  assert.equal(pool.jobs[0].rules.demandOrderId, 'order-plus');
  assert.equal(adapters.calls.some((c) => c[0] === 'wallet' && c[1] === BACKUP_ID), false, '故障台一次都不碰');
});

test('故障转台不适用于 API 需求：hnskj 故障、Browser 行指向 highvcc 时，hnskj 的缺口只告警', async () => {
  const faultedHnskj = accountRow(HNSKJ_ID, { supply_fault_state: 'FAULT', supply_fault_reason: 'PROVIDER', supply_fault_at: new Date(Date.now() - 60_000) });
  const pool = fakePool({
    accounts: [faultedHnskj, accountRow(BACKUP_ID)],
    available: { [`${HNSKJ_ID}:plus`]: 0, [`${BACKUP_ID}:plus`]: 2 }
  });
  const result = await createCardSupplyScheduler({ pool, adapters: fakeAdapters() }).run();
  assert.equal(result.reason, 'BLOCKED');
  assert.equal(pool.jobs.length, 0);
  const blocked = pool.alerts.find((a) => a.type === 'CARD_SUPPLY_BLOCKED');
  assert.equal(blocked.severity, 'critical');
  assert.match(blocked.message, /API 路线不转台/);
});

test('故障超过重试窗口后允许再试一次', async () => {
  const stale = accountRow(HNSKJ_ID, { supply_fault_state: 'FAULT', supply_fault_reason: 'PROVIDER', supply_fault_at: new Date(Date.now() - SUPPLY_FAULT_RETRY_MS - 1000) });
  const pool = fakePool({ accounts: [stale, accountRow(BACKUP_ID)], available: { [`${HNSKJ_ID}:plus`]: 0, [`${BACKUP_ID}:plus`]: 2 } });
  const result = await createCardSupplyScheduler({ pool, adapters: fakeAdapters() }).run();
  assert.equal(result.reason, 'SCHEDULED');
});

test('卡台自己说禁开（purchaseEnabled=false）→ 标故障，不建 job', async () => {
  const pool = fakePool({ available: { [`${HNSKJ_ID}:plus`]: 0, [`${BACKUP_ID}:plus`]: 2 } });
  const result = await createCardSupplyScheduler({ pool, adapters: fakeAdapters({ hnskjPurchaseEnabled: false }) }).run();
  assert.equal(result.reason, 'ADAPTER_CANNOT_OPEN');
  assert.deepEqual(pool.faults, [{ id: HNSKJ_ID, reason: 'CARD_STOCK_PURCHASE_DISABLED' }]);
  assert.equal(pool.jobs.length, 0);
});

test('总闸关着：只刷库存告警，不开卡；有 job 在跑或有未核对的付费 job 也不开', async () => {
  const off = fakePool({ enabled: false, available: { [`${HNSKJ_ID}:plus`]: 0, [`${BACKUP_ID}:plus`]: 0 } });
  const r1 = await createCardSupplyScheduler({ pool: off, adapters: fakeAdapters() }).run();
  assert.equal(r1.reason, 'DISABLED');
  assert.equal(off.alerts.filter((a) => a.type === 'CARD_STOCK_LOW').length, 2);
  assert.match(off.alerts[0].message, /总闸关闭/);
  assert.equal(off.jobs.length, 0);

  const busy = fakePool({ activeJob: true, available: { [`${HNSKJ_ID}:plus`]: 0 } });
  assert.equal((await createCardSupplyScheduler({ pool: busy, adapters: fakeAdapters() }).run()).reason, 'JOB_ACTIVE');
  const review = fakePool({ unresolved: true, available: { [`${HNSKJ_ID}:plus`]: 0 } });
  assert.equal((await createCardSupplyScheduler({ pool: review, adapters: fakeAdapters() }).run()).reason, 'FUNDS_REVIEW_REQUIRED');
});

test('Pro 水位 0：没有等卡单就不开；来了一单就按 $150 开一张（订单兜底）', async () => {
  const idle = fakePool({ available: { [`${HNSKJ_ID}:plus`]: 2, [`${BACKUP_ID}:plus`]: 2 } });
  assert.equal((await createCardSupplyScheduler({ pool: idle, adapters: fakeAdapters() }).run()).reason, 'NO_DEMAND');
  const demand = fakePool({
    available: { [`${HNSKJ_ID}:plus`]: 2, [`${BACKUP_ID}:plus`]: 2 },
    waiting: { [`${BACKUP_ID}:pro_20x`]: 1 }
  });
  const result = await createCardSupplyScheduler({ pool: demand, adapters: fakeAdapters({ highvccBalance: '190.00' }) }).run(); // 190 − 150 − 16（10%+$1 保守手续费）= 24 ≥ 20 底线
  assert.equal(result.reason, 'SCHEDULED');
  assert.equal(demand.jobs[0].opener, BACKUP_ID);
  assert.equal(demand.jobs[0].product, 'pro_20x');
  assert.equal(demand.jobs[0].amount, '150.000000');
  assert.equal(demand.jobs[0].segment, '708');
});

test('walletPreflight / estimateIssueFeeCents are integer-cent arithmetic', () => {
  assert.deepEqual(walletPreflight({ availableBalance: '89.48', amount: '50', feeCents: 58, floor: '30' }),
    { ok: true, balance: '89.48', amount: '50.00', fee: '0.58', floor: '30.00', projected: '38.90' });
  assert.equal(walletPreflight({ availableBalance: 'abc', amount: '50', feeCents: 58, floor: '30' }).ok, false);
  assert.deepEqual(estimateIssueFeeCents({ observedCents: null, amountCents: 15000 }), { cents: 1600, source: 'PLAUSIBLE_UPPER_BOUND' });
});
