import assert from 'node:assert/strict';
import test from 'node:test';
import { createProviderRouteAdminService } from '../src/services/provider-route-admin-service.js';

function poolFor() {
  const queries = [];
  return {
    queries,
    async getConnection() {
      return {
        async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
        async query(sql, params) {
          queries.push({ sql, params });
          if (/SELECT fr\.id, fr\.route_code/.test(sql)) {
            return [[{ id: 'route-2', route_code: 'HNSKJ_BROWSER', route_version: 2,
              read_enabled: 1, circuit_state: 'CLOSED', retry_after_until: null }]];
          }
          if (/SELECT id FROM fulfillment_routes/.test(sql)) return [[{ id: 'route-1' }]];
          return [{ affectedRows: 1 }];
        }
      };
    }
  };
}

test('provider route switch requires health and exact confirmation, then records an audit event', async () => {
  const pool = poolFor();
  const service = createProviderRouteAdminService({ pool });
  const result = await service.switchRoute({
    routeId: 'route-2', actorId: 'operator-1',
    operatorNote: '当前主卡台只读正常，切换到备用路线',
    confirmation: '切换卡台 HNSKJ_BROWSER:2'
  });
  assert.equal(result.routeId, 'route-2');
  assert.equal(result.previousRouteId, 'route-1');
  assert.equal(pool.queries.some(({ sql }) => /provider_route_switch_events/.test(sql)), true);
});

test('provider route switch rejects weak operator notes before database access', async () => {
  const pool = poolFor();
  const service = createProviderRouteAdminService({ pool });
  await assert.rejects(
    service.switchRoute({ routeId: 'route-2', operatorNote: 'short', confirmation: 'wrong' }),
    (error) => error.code === 'ROUTE_SWITCH_NOTE_REQUIRED'
  );
  assert.equal(pool.queries.length, 0);
});

function defaultMethodPool({ browserGate = true, browserHeartbeat = new Date().toISOString() } = {}) {
  const queries = [];
  const transaction = { commits: 0, rollbacks: 0 };
  return {
    queries, transaction,
    async getConnection() {
      return {
        async beginTransaction() {},
        async commit() { transaction.commits += 1; },
        async rollback() { transaction.rollbacks += 1; },
        release() {},
        async query(sql, params) {
          queries.push({ sql, params });
          if (/SELECT fr\.id, fr\.executor_kind/.test(sql)) return [[
            { id: 'route-api', executor_kind: 'API', accepts_new_orders: 1 },
            { id: 'route-browser', executor_kind: 'BROWSER', accepts_new_orders: 0 }
          ]];
          if (/browser_dispatch_enabled/.test(sql)) {
            return [[
              { setting_key: 'browser_dispatch_enabled', setting_value: browserGate ? 'true' : 'false' },
              { setting_key: 'browser_worker_heartbeat_at', setting_value: browserHeartbeat }
            ]];
          }
          if (/FROM executor_profiles/.test(sql)) return [[{ id: 'profile-browser' }]];
          return [{ affectedRows: 1 }];
        }
      };
    }
  };
}

test('default recharge method atomically selects Browser for future orders only', async () => {
  const pool = defaultMethodPool();
  const result = await createProviderRouteAdminService({ pool }).setDefaultRechargeMethod({
    method: 'BROWSER', actorId: 'operator-1',
    confirmation: '切换默认充值方式为 BROWSER'
  });
  assert.equal(result.method, 'BROWSER');
  assert.equal(result.routeId, 'route-browser');
  assert.equal(result.previousRouteId, 'route-api');
  assert.equal(result.changed, true);
  assert.equal(pool.transaction.commits, 1);
  assert.equal(pool.queries.some(({ sql }) => /SET fr\.accepts_new_orders = 0/.test(sql)), true);
  assert.equal(pool.queries.some(({ sql }) => /provider_route_switch_events/.test(sql)), true);
});

test('default recharge method refuses Browser while its independent dispatch gate is closed', async () => {
  const pool = defaultMethodPool({ browserGate: false });
  await assert.rejects(
    createProviderRouteAdminService({ pool }).setDefaultRechargeMethod({
      method: 'BROWSER', confirmation: '切换默认充值方式为 BROWSER'
    }),
    (error) => error.code === 'BROWSER_RECHARGE_NOT_READY'
  );
  assert.equal(pool.transaction.commits, 0);
  assert.equal(pool.transaction.rollbacks, 1);
  assert.equal(pool.queries.some(({ sql }) => /SET fr\.accepts_new_orders = 0/.test(sql)), false);
});

test('default recharge method refuses Browser when its dedicated Worker heartbeat is stale', async () => {
  const pool = defaultMethodPool({ browserHeartbeat: '2020-01-01T00:00:00.000Z' });
  await assert.rejects(
    createProviderRouteAdminService({ pool }).setDefaultRechargeMethod({
      method: 'BROWSER', confirmation: '切换默认充值方式为 BROWSER'
    }),
    (error) => error.code === 'BROWSER_RECHARGE_NOT_READY'
  );
  assert.equal(pool.queries.some(({ sql }) => /SET fr\.accepts_new_orders = 0/.test(sql)), false);
});
