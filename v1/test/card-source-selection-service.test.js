import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countEligibleCards, createCardSourceSelectionService, listCardSourceSelections,
  minimumBalanceSql, runCardSourceSwitchChecks, stockCountingCardSql
} from '../src/services/card-source-selection-service.js';
import { eligibleInventoryCardSql } from '../src/services/card-inventory-eligibility.js';

const HNSKJ_ID = '00000000-0000-4000-8000-000000000101';
const BACKUP_ID = '00000000-0000-4000-8000-000000000103';
const PLUS = '00000000-0000-4000-8000-000000000201';
const PRO5 = '00000000-0000-4000-8000-000000000205';
const PRO20 = '00000000-0000-4000-8000-000000000206';

function accountRow(id, overrides = {}) {
  const backup = id === BACKUP_ID;
  return {
    id, provider_code: backup ? 'manual_excel' : 'hnskj', account_code: backup ? 'backup-a' : 'legacy-primary',
    display_name: backup ? '备用卡台 A' : 'HNSKJ', environment: 'PRODUCTION', purpose: 'CARD',
    source_adapter: backup ? 'backup_card_export_v1' : 'hnskj_api_v1', open_adapter: backup ? 'highvcc_api_v1' : 'hnskj_api_v1',
    default_card_segment: backup ? '708' : '23', wallet_floor: backup ? '20' : '30', wallet_alert_threshold: '50',
    supply_fault_state: 'OK', supply_fault_reason: null, supply_fault_at: null,
    supports_api_recharge: backup ? 0 : 1, supports_browser_recharge: 1, supports_api_sync: backup ? 0 : 1,
    supports_auto_open: 1, supports_auto_funding: backup ? 0 : 1, operational_enabled: 1,
    read_enabled: backup ? 0 : 1, write_enabled: 0, circuit_state: 'CLOSED', retry_after_until: null, last_full_snapshot_at: null,
    ...overrides
  };
}

// 生产 053 迁移后的六行（2026-09-17 实值：Browser 三产品 → 103，API 三产品 → 101 锁定）。
function selectionRows() {
  const product = (id, code, plan) => ({ product_id: id, product_code: code, legacy_plan_type: plan });
  const rows = [];
  for (const [id, code, plan] of [[PLUS, 'chatgpt_plus', 'plus'], [PRO5, 'chatgpt_pro_5x', 'pro_5x'], [PRO20, 'chatgpt_pro_20x', 'pro_20x']]) {
    rows.push({ ...product(id, code, plan), executor_kind: 'API', provider_account_id: HNSKJ_ID, locked: 1, version: 1, updated_by: 'migration-053', updated_at: new Date('2026-09-18T00:00:00Z') });
    rows.push({ ...product(id, code, plan), executor_kind: 'BROWSER', provider_account_id: BACKUP_ID, locked: 0, version: id === PLUS ? 8 : 1, updated_by: 'admin', updated_at: new Date('2026-09-16T09:19:08Z') });
  }
  return rows;
}

/** 按 SQL 片段路由的假连接池；每条查询都记下来，测试断言用。 */
function fakePool({ routes = 1, eligible = 1, accounts = {}, selection = null, orders = 1 } = {}) {
  const queries = [];
  const state = { routes, eligible, accounts, selection, orders };
  async function query(sql, params = []) {
    queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
    const text = String(sql);
    if (text.includes('FROM card_source_selections s') && text.includes('WHERE s.product_id = ?')) {
      const row = state.selection || selectionRows().find((r) => r.product_id === params[0] && r.executor_kind === params[1]);
      return [row ? [row] : []];
    }
    if (text.includes('FROM card_source_selections s')) return [selectionRows()];
    if (text.includes('FROM products')) return [[{ id: PLUS, product_code: 'chatgpt_plus', legacy_plan_type: 'plus' }]];
    if (text.includes('FROM fulfillment_routes')) return [Array.from({ length: state.routes }, (_, i) => ({ id: `route-${i}` }))];
    if (text.includes('FROM provider_accounts pa')) {
      const id = params[0];
      const row = Object.prototype.hasOwnProperty.call(state.accounts, id) ? state.accounts[id] : accountRow(id);
      return [row ? [row] : []];
    }
    if (text.includes('SELECT COUNT(*) AS count FROM cards')) return [[{ count: typeof state.eligible === 'function' ? state.eligible(params) : state.eligible }]];
    if (text.startsWith('UPDATE card_source_selections')) return [{ affectedRows: 1 }];
    if (text.startsWith('UPDATE orders o')) return [{ affectedRows: state.orders }];
    if (text.includes('INSERT INTO card_source_selection_events')) return [{ affectedRows: 1 }];
    throw new Error(`unexpected query: ${text.slice(0, 80)}`);
  }
  const tx = { begin: 0, commit: 0, rollback: 0 };
  const connection = { query, async beginTransaction() { tx.begin += 1; }, async commit() { tx.commit += 1; }, async rollback() { tx.rollback += 1; }, release() {} };
  return { queries, tx, state, query, async getConnection() { return connection; } };
}

test('three products × two executors each resolve their own card source from one table', async () => {
  const rows = await listCardSourceSelections(fakePool());
  assert.equal(rows.length, 6);
  const pick = (plan, kind) => rows.find((r) => r.planType === plan && r.executorKind === kind);
  for (const plan of ['plus', 'pro_5x', 'pro_20x']) {
    assert.equal(pick(plan, 'API').providerAccountId, HNSKJ_ID, `${plan} API → hnskj`);
    assert.equal(pick(plan, 'API').locked, true, `${plan} API row is locked`);
    assert.equal(pick(plan, 'BROWSER').providerAccountId, BACKUP_ID, `${plan} BROWSER → 备用卡台 A`);
    assert.equal(pick(plan, 'BROWSER').locked, false);
  }
  assert.equal(pick('plus', 'BROWSER').version, 8);
});

test('stock count = production eligibility rule minus only the 15-minute freshness clause (never a copied predicate)', async () => {
  const pool = fakePool({ eligible: 2 });
  assert.equal(await countEligibleCards(pool, { providerAccountId: BACKUP_ID, productCode: 'pro_20x' }), 2);
  const sql = pool.queries.at(-1).sql;
  assert.match(sql, /card_max_successful_payments/);
  assert.match(sql, /card_operational_overrides/);
  assert.match(sql, /minimum_required_card_balance:pro_20x/);
  // 5276 每小时只有 15 分钟合格：库存口径不能带这句，否则窗口外调度器会以为缺卡去开（Lemon 2026-09-18）。
  assert.doesNotMatch(sql, /INTERVAL 15 MINUTE/);
  assert.match(sql, /cards\.sync_tier = 'MANUAL_IMPORT' OR cards\.last_transaction_synced_at IS NOT NULL\)/);
  // 除那一句外与分配规则逐字相同：把分配规则里那句换掉后应完全一致。
  const derived = stockCountingCardSql('c', '?', { productCode: 'plus' });
  const original = eligibleInventoryCardSql('c', '?', { productCode: 'plus' });
  assert.notEqual(derived, original);
  assert.equal(original.length - derived.length > 0, true);
  assert.equal(derived.replace(/\s+/g, ' ').split('AND').length, original.replace(/\s+/g, ' ').split('AND').length - 1, '只少了新鲜度里的一个 AND 条件');
  assert.match(minimumBalanceSql('plus'), /default_minimum_required_card_balance/);
  assert.throws(() => minimumBalanceSql('plus; DROP'), TypeError);
});

async function checks(pool, overrides = {}) {
  const connection = await pool.getConnection();
  return runCardSourceSwitchChecks(connection, {
    productId: PLUS, productCode: 'plus', executorKind: 'BROWSER', targetAccountId: HNSKJ_ID,
    expectedVersion: 8, currentVersion: 8, ...overrides
  });
}

test('four checks all pass for a healthy target with stock and a matching version', async () => {
  const result = await checks(fakePool());
  assert.equal(result.ok, true);
  assert.deepEqual(result.checks.map((c) => c.code), ['ROUTE_UNIQUE', 'SOURCE_HEALTHY', 'TARGET_POOL_AVAILABLE', 'VERSION_MATCH']);
  assert.equal(result.checks.every((c) => c.ok), true);
});

test('check ROUTE_UNIQUE rejects when the executor has zero or two live routes', async () => {
  for (const routes of [0, 2]) {
    const result = await checks(fakePool({ routes }));
    assert.equal(result.ok, false);
    const failed = result.checks.find((c) => c.code === 'ROUTE_UNIQUE');
    assert.equal(failed.ok, false);
    assert.match(failed.detail, new RegExp(`有 ${routes} 条`));
  }
});

test('check TARGET_POOL_AVAILABLE rejects an empty target pool and says how many it counted', async () => {
  const result = await checks(fakePool({ eligible: 0 }));
  assert.equal(result.ok, false);
  const failed = result.checks.find((c) => c.code === 'TARGET_POOL_AVAILABLE');
  assert.equal(failed.ok, false);
  assert.match(failed.detail, /可分配 0 张/);
});

test('check SOURCE_HEALTHY rejects an open circuit, a missing capability, or a read-disabled API account — but not backup A read_enabled=0', async () => {
  const open = await checks(fakePool({ accounts: { [HNSKJ_ID]: accountRow(HNSKJ_ID, { circuit_state: 'OPEN' }) } }));
  assert.equal(open.checks.find((c) => c.code === 'SOURCE_HEALTHY').ok, false);
  assert.match(open.checks.find((c) => c.code === 'SOURCE_HEALTHY').detail, /circuit=OPEN/);

  const noApi = await checks(fakePool(), { executorKind: 'API', targetAccountId: BACKUP_ID });
  assert.equal(noApi.checks.find((c) => c.code === 'SOURCE_HEALTHY').ok, false);
  assert.match(noApi.checks.find((c) => c.code === 'SOURCE_HEALTHY').detail, /不支持 API 充值/);

  const readOff = await checks(fakePool({ accounts: { [HNSKJ_ID]: accountRow(HNSKJ_ID, { read_enabled: 0 }) } }));
  assert.equal(readOff.checks.find((c) => c.code === 'SOURCE_HEALTHY').ok, false);

  // 备用卡台 A 生产实值 read_enabled=0（没有只读 API）：按能力位判，不算不健康。
  const backup = await checks(fakePool(), { targetAccountId: BACKUP_ID });
  assert.equal(backup.checks.find((c) => c.code === 'SOURCE_HEALTHY').ok, true);
});

test('check VERSION_MATCH rejects a stale or missing caller version', async () => {
  const stale = await checks(fakePool(), { expectedVersion: 7, currentVersion: 8 });
  assert.equal(stale.checks.find((c) => c.code === 'VERSION_MATCH').ok, false);
  assert.match(stale.checks.find((c) => c.code === 'VERSION_MATCH').detail, /看到的版本 7，当前 8/);
  const missing = await checks(fakePool(), { expectedVersion: undefined });
  assert.equal(missing.checks.find((c) => c.code === 'VERSION_MATCH').ok, false);
});

test('switching writes the new source with version+1, records the checks, and can take over safe waiting orders', async () => {
  const pool = fakePool({ orders: 3 });
  const service = createCardSourceSelectionService({ pool });
  const result = await service.switchSelection({
    productCode: 'chatgpt_plus', executorKind: 'BROWSER', providerAccountId: HNSKJ_ID, expectedVersion: 8,
    takeoverWaiting: true, actorId: 'lemon'
  });
  assert.equal(result.changed, true);
  assert.equal(result.previousProviderAccountId, BACKUP_ID);
  assert.equal(result.version, 9);
  assert.equal(result.actualTakeoverCount, 3);
  assert.equal(pool.tx.commit, 1);
  const update = pool.queries.find((q) => q.sql.startsWith('UPDATE card_source_selections'));
  assert.deepEqual(update.params, [HNSKJ_ID, 9, 'lemon', PLUS, 'BROWSER', 8]);
  const takeover = pool.queries.find((q) => q.sql.startsWith('UPDATE orders o'));
  assert.match(takeover.sql, /assigned_card_id IS NULL/);
  assert.match(takeover.sql, /recharge_attempts/);
  assert.match(takeover.sql, /fr\.executor_kind = \?/);
  const event = pool.queries.find((q) => q.sql.includes('INSERT INTO card_source_selection_events'));
  assert.equal(JSON.parse(event.params[6]).length, 4);
});

test('a rejected switch rolls back, changes nothing, and hands every failed check back', async () => {
  const pool = fakePool({ eligible: 0, routes: 2 });
  const service = createCardSourceSelectionService({ pool });
  await assert.rejects(
    service.switchSelection({ productCode: 'plus', executorKind: 'BROWSER', providerAccountId: HNSKJ_ID, expectedVersion: 1 }),
    (error) => {
      assert.equal(error.code, 'CARD_SOURCE_SWITCH_REJECTED');
      assert.equal(error.status, 409);
      assert.deepEqual(error.checks.filter((c) => !c.ok).map((c) => c.code), ['ROUTE_UNIQUE', 'TARGET_POOL_AVAILABLE', 'VERSION_MATCH']);
      return true;
    }
  );
  assert.equal(pool.tx.rollback, 1);
  assert.equal(pool.queries.some((q) => q.sql.startsWith('UPDATE card_source_selections')), false);
});

test('the locked API row refuses any switch before running the checks (API is fixed to hnskj, D-253)', async () => {
  const pool = fakePool();
  const service = createCardSourceSelectionService({ pool });
  await assert.rejects(
    service.switchSelection({ productCode: 'plus', executorKind: 'API', providerAccountId: BACKUP_ID, expectedVersion: 1 }),
    (error) => error.code === 'CARD_SOURCE_SELECTION_LOCKED' && error.status === 409
  );
  assert.equal(pool.queries.some((q) => q.sql.includes('FROM fulfillment_routes')), false, 'no checks ran');
  assert.equal(pool.tx.rollback, 1);
});

test('executor kind is validated before touching the database', async () => {
  const pool = fakePool();
  await assert.rejects(
    createCardSourceSelectionService({ pool }).switchSelection({ productCode: 'plus', executorKind: 'ROBOT', providerAccountId: HNSKJ_ID, expectedVersion: 1 }),
    (error) => error.code === 'INVALID_EXECUTOR_KIND'
  );
  assert.equal(pool.queries.length, 0);
});
