import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderRouteAdminService } from '../src/services/provider-route-admin-service.js';

const HNSKJ_ID = '00000000-0000-4000-8000-000000000101';
const BACKUP_ID = '00000000-0000-4000-8000-000000000103';
const PLUS = '00000000-0000-4000-8000-000000000201';

function accountRow(id) {
  const backup = id === BACKUP_ID;
  return {
    id, provider_code: backup ? 'manual_excel' : 'hnskj', account_code: backup ? 'backup-a' : 'legacy-primary',
    display_name: backup ? '备用卡台 A' : 'HNSKJ', environment: 'PRODUCTION', purpose: 'CARD',
    source_adapter: backup ? 'backup_card_export_v1' : 'hnskj_api_v1', open_adapter: backup ? 'highvcc_api_v1' : 'hnskj_api_v1',
    default_card_segment: null, wallet_floor: null, wallet_alert_threshold: null, supply_fault_state: 'OK',
    supply_fault_reason: null, supply_fault_at: null, supports_api_recharge: backup ? 0 : 1, supports_browser_recharge: 1,
    supports_api_sync: backup ? 0 : 1, supports_auto_open: 1, supports_auto_funding: 0, operational_enabled: 1,
    read_enabled: backup ? 0 : 1, write_enabled: 0, circuit_state: 'CLOSED', retry_after_until: null, last_full_snapshot_at: null
  };
}

/**
 * 生产 2026-09-17 现场：301 API accepts=1、302 BROWSER accepts=0；选择表 plus API→101 / BROWSER→103。
 * eligible 按目标卡台给数；routesFor 控制「目标路线唯一」。
 */
function defaultMethodPool({
  currentMethod = 'API', browserGate = true, browserHeartbeat = new Date().toISOString(),
  eligible = { [HNSKJ_ID]: 1, [BACKUP_ID]: 1 }, routesPerKind = { API: 1, BROWSER: 1 }
} = {}) {
  const queries = [];
  const transaction = { commits: 0, rollbacks: 0 };
  async function query(sql, params = []) {
    const text = String(sql);
    queries.push({ sql: text.replace(/\s+/g, ' ').trim(), params });
    if (/FROM products WHERE product_code = 'chatgpt_plus'/.test(text)) return [[{ id: PLUS, legacy_plan_type: 'plus' }]];
    if (/SELECT fr\.id, fr\.executor_kind, fr\.accepts_new_orders/.test(text)) return [[
      { id: 'route-301', executor_kind: 'API', accepts_new_orders: currentMethod === 'API' ? 1 : 0 },
      { id: 'route-302', executor_kind: 'BROWSER', accepts_new_orders: currentMethod === 'BROWSER' ? 1 : 0 }
    ]];
    if (/SELECT provider_account_id, version FROM card_source_selections/.test(text)) {
      return [[{ provider_account_id: params[1] === 'API' ? HNSKJ_ID : BACKUP_ID, version: params[1] === 'API' ? 1 : 8 }]];
    }
    if (/SELECT id FROM fulfillment_routes/.test(text)) return [Array.from({ length: routesPerKind[params[1]] ?? 1 }, (_, i) => ({ id: `r${i}` }))];
    if (/FROM provider_accounts pa/.test(text)) return [[accountRow(params[0])]];
    if (/SELECT COUNT\(\*\) AS count FROM cards/.test(text)) return [[{ count: eligible[params[0]] ?? 0 }]];
    if (/browser_dispatch_enabled/.test(text)) {
      return [[
        { setting_key: 'browser_dispatch_enabled', setting_value: browserGate ? 'true' : 'false' },
        { setting_key: 'browser_worker_heartbeat_at', setting_value: browserHeartbeat }
      ]];
    }
    if (/FROM executor_profiles/.test(text)) return [[{ id: 'profile-browser' }]];
    if (/FROM fulfillment_routes fr/.test(text) && /card_source_selections css/.test(text)) return [[]];
    return [{ affectedRows: 1 }];
  }
  return {
    queries, transaction, query,
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() { transaction.commits += 1; },
        async rollback() { transaction.rollbacks += 1; },
        release() {}, query
      };
    }
  };
}

const confirm = (method) => `切换默认充值方式为 ${method}`;

test('default recharge method atomically selects Browser for future orders only, after the four checks pass', async () => {
  const pool = defaultMethodPool();
  const result = await createProviderRouteAdminService({ pool }).setDefaultRechargeMethod({
    method: 'BROWSER', actorId: 'operator-1', confirmation: confirm('BROWSER'), expectedCurrentMethod: 'API'
  });
  assert.equal(result.method, 'BROWSER');
  assert.equal(result.routeId, 'route-302');
  assert.equal(result.previousRouteId, 'route-301');
  assert.equal(result.changed, true);
  assert.deepEqual(result.checks.map((c) => c.code), ['ROUTE_UNIQUE', 'SOURCE_HEALTHY', 'TARGET_POOL_AVAILABLE', 'VERSION_MATCH']);
  assert.equal(result.checks.every((c) => c.ok), true);
  assert.equal(pool.transaction.commits, 1);
  assert.equal(pool.queries.some(({ sql }) => /SET accepts_new_orders = 0 WHERE product_id/.test(sql)), true);
  assert.equal(pool.queries.some(({ sql }) => /provider_route_switch_events/.test(sql)), true);
  // 切路线不动卡台：没有任何对选择表或旧卡台列的写（D-219 那个「连带切」本来就是手点两次）。
  assert.equal(pool.queries.some(({ sql }) => /UPDATE card_source_selections|browser_card_source_selections|card_provider_account_id =/.test(sql)), false);
});

test('switching to API used to check nothing; now it refuses when the hnskj pool is empty and says so', async () => {
  const pool = defaultMethodPool({ currentMethod: 'BROWSER', eligible: { [HNSKJ_ID]: 0, [BACKUP_ID]: 1 } });
  await assert.rejects(
    createProviderRouteAdminService({ pool }).setDefaultRechargeMethod({
      method: 'API', confirmation: confirm('API'), expectedCurrentMethod: 'BROWSER'
    }),
    (error) => {
      assert.equal(error.code, 'DEFAULT_RECHARGE_METHOD_REJECTED');
      const failed = error.checks.filter((c) => !c.ok);
      assert.deepEqual(failed.map((c) => c.code), ['TARGET_POOL_AVAILABLE']);
      assert.match(failed[0].detail, /可分配 0 张/);
      return true;
    }
  );
  assert.equal(pool.transaction.commits, 0);
  assert.equal(pool.transaction.rollbacks, 1);
  assert.equal(pool.queries.some(({ sql }) => /SET accepts_new_orders = 0/.test(sql)), false);
});

test('a caller that saw a different current method is refused (version check) and nothing moves', async () => {
  const pool = defaultMethodPool();
  await assert.rejects(
    createProviderRouteAdminService({ pool }).setDefaultRechargeMethod({
      method: 'BROWSER', confirmation: confirm('BROWSER'), expectedCurrentMethod: 'BROWSER'
    }),
    (error) => error.code === 'DEFAULT_RECHARGE_METHOD_REJECTED'
      && error.checks.find((c) => c.code === 'VERSION_MATCH').ok === false
      && /看到的当前方式 BROWSER，实际 API/.test(error.checks.find((c) => c.code === 'VERSION_MATCH').detail)
  );
  assert.equal(pool.queries.some(({ sql }) => /SET accepts_new_orders = 0/.test(sql)), false);
});

test('two live routes for the target executor fail ROUTE_UNIQUE', async () => {
  const pool = defaultMethodPool({ routesPerKind: { API: 1, BROWSER: 2 } });
  await assert.rejects(
    createProviderRouteAdminService({ pool }).setDefaultRechargeMethod({
      method: 'BROWSER', confirmation: confirm('BROWSER'), expectedCurrentMethod: 'API'
    }),
    (error) => error.checks?.find((c) => c.code === 'ROUTE_UNIQUE')?.ok === false
  );
});

test('default recharge method still refuses Browser while its independent dispatch gate is closed', async () => {
  const pool = defaultMethodPool({ browserGate: false });
  await assert.rejects(
    createProviderRouteAdminService({ pool }).setDefaultRechargeMethod({
      method: 'BROWSER', confirmation: confirm('BROWSER'), expectedCurrentMethod: 'API'
    }),
    (error) => error.code === 'BROWSER_RECHARGE_NOT_READY'
  );
  assert.equal(pool.transaction.commits, 0);
  assert.equal(pool.transaction.rollbacks, 1);
  assert.equal(pool.queries.some(({ sql }) => /SET accepts_new_orders = 0/.test(sql)), false);
});

test('default recharge method refuses Browser when its dedicated Worker heartbeat is stale', async () => {
  const pool = defaultMethodPool({ browserHeartbeat: '2020-01-01T00:00:00.000Z' });
  await assert.rejects(
    createProviderRouteAdminService({ pool }).setDefaultRechargeMethod({
      method: 'BROWSER', confirmation: confirm('BROWSER'), expectedCurrentMethod: 'API'
    }),
    (error) => error.code === 'BROWSER_RECHARGE_NOT_READY'
  );
  assert.equal(pool.queries.some(({ sql }) => /SET accepts_new_orders = 0/.test(sql)), false);
});

test('confirmation phrase is checked before any database access', async () => {
  const pool = defaultMethodPool();
  await assert.rejects(
    createProviderRouteAdminService({ pool }).setDefaultRechargeMethod({ method: 'API', confirmation: 'nope', expectedCurrentMethod: 'BROWSER' }),
    (error) => error.code === 'DEFAULT_RECHARGE_METHOD_CONFIRMATION_REQUIRED'
  );
  assert.equal(pool.queries.length, 0);
});

test('route listing shows the card source from the selection table, not the retired route column', async () => {
  const pool = defaultMethodPool();
  await createProviderRouteAdminService({ pool }).list();
  assert.match(pool.queries[0].sql, /card_source_selections css ON css\.product_id = p\.id AND css\.executor_kind = fr\.executor_kind/);
  assert.doesNotMatch(pool.queries[0].sql, /fr\.card_provider_account_id/);
});
