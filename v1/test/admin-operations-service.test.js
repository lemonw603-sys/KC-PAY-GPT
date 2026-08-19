import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdminOperationsService } from '../src/services/admin-operations-service.js';

function poolFixture(settings = [
  { setting_key: 'accept_new_orders', setting_value: 'false' },
  { setting_key: 'dispatch_new_recharges', setting_value: 'false' }
]) {
  const queries = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, values = []) {
      queries.push({ sql, values });
      if (/SELECT setting_key/.test(sql)) return [settings, []];
      return [{ affectedRows: 1 }, []];
    }
  };
  return { queries, pool: { async getConnection() { return connection; } } };
}

test('starting intake also enables safe processing of existing orders', async () => {
  const fixture = poolFixture();
  const service = createAdminOperationsService({ pool: fixture.pool });
  const result = await service.setOrderAcceptance({ enabled: true, confirmation: '开始接单' });
  assert.deepEqual(result, { acceptNewOrders: true, dispatchExistingOrders: true });
  assert.equal(fixture.queries.some(({ sql }) => /dispatch_new_recharges/.test(sql) && /UPDATE/.test(sql)), true);
});

test('stopping intake leaves existing-order processing unchanged', async () => {
  const fixture = poolFixture([
    { setting_key: 'accept_new_orders', setting_value: 'true' },
    { setting_key: 'dispatch_new_recharges', setting_value: 'true' }
  ]);
  const service = createAdminOperationsService({ pool: fixture.pool });
  const result = await service.setOrderAcceptance({ enabled: false, confirmation: '停止接单' });
  assert.deepEqual(result, { acceptNewOrders: false, dispatchExistingOrders: true });
  assert.equal(fixture.queries.filter(({ sql }) => /^\s*UPDATE/.test(sql)).length, 1);
});

test('order acceptance requires an exact confirmation', async () => {
  const fixture = poolFixture();
  const service = createAdminOperationsService({ pool: fixture.pool });
  await assert.rejects(
    service.setOrderAcceptance({ enabled: true, confirmation: '停止接单' }),
    (error) => error.code === 'ORDER_ACCEPTANCE_CONFIRMATION_REQUIRED'
  );
  assert.equal(fixture.queries.length, 0);
});
