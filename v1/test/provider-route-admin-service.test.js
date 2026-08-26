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
