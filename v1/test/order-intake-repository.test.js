import assert from 'node:assert/strict';
import test from 'node:test';
import { createOrderFromCdk, parseOrderIntakeSettings } from '../src/db/repositories/order-intake-repository.js';

function settings(values) {
  return Object.entries(values).map(([setting_key, setting_value]) => ({ setting_key, setting_value }));
}

test('order intake snapshots independent open-card and minimum-balance settings', () => {
  const parsed = parseOrderIntakeSettings(settings({
    accept_new_orders: 'true',
    default_card_type_id: '1',
    default_open_card_amount: '16',
    default_minimum_required_card_balance: '15.5'
  }));
  assert.deepEqual(parsed, {
    cardTypeId: '1',
    openCardAmount: '16',
    minimumRequiredCardBalance: '15.5'
  });
});

test('order intake fails closed when minimum balance is missing or exceeds funding', () => {
  const base = {
    accept_new_orders: 'true',
    default_card_type_id: '1',
    default_open_card_amount: '16'
  };
  assert.throws(
    () => parseOrderIntakeSettings(settings(base)),
    (error) => error.code === 'ORDERING_NOT_CONFIGURED'
  );
  assert.throws(
    () => parseOrderIntakeSettings(settings({
      ...base,
      default_minimum_required_card_balance: '17'
    })),
    (error) => error.code === 'ORDERING_NOT_CONFIGURED'
  );
});

test('Browser order intake atomically creates card assignment and preflight tasks', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM app_settings')) return [[
        { setting_key: 'accept_new_orders', setting_value: 'true' },
        { setting_key: 'default_card_type_id', setting_value: '1' },
        { setting_key: 'default_open_card_amount', setting_value: '16' },
        { setting_key: 'default_minimum_required_card_balance', setting_value: '16' },
      ]];
      if (sql.includes('FROM cdks')) return [[{
        id: 'cdk-1', status: 'AVAILABLE', plan_type: 'plus', batch_no: 'batch-1',
      }]];
      if (sql.includes('FROM products')) return [[{
        product_id: 'product-1', fulfillment_route_id: 'route-browser', executor_kind: 'BROWSER',
      }]];
      if (sql.includes("UPDATE cdks SET status = 'REDEEMED'")) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    },
  };
  await createOrderFromCdk({ getConnection: async () => connection }, {
    orderId: 'order-1', publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST',
    cdkLookup: {
      current: { version: 2, hash: 'current' }, legacy: { version: 1, hash: 'legacy' },
    },
    customerEmail: 'customer@example.com', chatgptAccountId: 'account-1',
    sessionCiphertext: 'encrypted-session', cardPurchaseIdempotencyKey: 'purchase-key',
  });
  const taskCalls = calls.filter(({ sql }) => sql.includes('INSERT INTO tasks'));
  assert.equal(taskCalls.length, 2);
  assert.match(taskCalls[0].sql, /'ASSIGN_CARD'/);
  assert.match(taskCalls[1].sql, /'BROWSER_PREFLIGHT'/);
});
