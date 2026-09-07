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
    minimumRequiredCardBalance: '15.5',
    minimumRequiredCardBalanceByPlan: {}
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
        frozen_card_provider_account_id: 'manual-source-a',
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
  const insert = calls.find(({ sql }) => sql.includes('INSERT INTO orders'));
  assert.match(insert.sql, /frozen_card_provider_account_id/);
  assert.equal(insert.values.includes('manual-source-a'), true);
});

function intakeInput(overrides = {}) {
  return {
    orderId: 'order-new', publicNo: 'PJV1-NEWNEWNEWNEWNEWNEWNEW',
    cdkLookup: { current: { version: 2, hash: 'current' }, legacy: { version: 1, hash: 'legacy' } },
    customerEmail: 'customer@example.com', chatgptAccountId: 'account-1',
    sessionCiphertext: 'encrypted-session', cardPurchaseIdempotencyKey: 'purchase-key', ...overrides,
  };
}

function boundCdkConnection({ boundOrder }) {
  const calls = [];
  const connection = {
    calls, committed: 0,
    async beginTransaction() {}, async commit() { connection.committed += 1; }, async rollback() {}, release() {},
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM app_settings')) return [[
        { setting_key: 'accept_new_orders', setting_value: 'true' }, { setting_key: 'default_card_type_id', setting_value: '1' },
        { setting_key: 'default_open_card_amount', setting_value: '16' }, { setting_key: 'default_minimum_required_card_balance', setting_value: '16' },
      ]];
      if (sql.includes('FROM cdks') && sql.includes('code_hash')) return [[{ id: 'cdk-1', status: 'REDEEMED', plan_type: 'plus', batch_no: 'batch-1' }]];
      if (sql.includes('FROM orders WHERE id = (SELECT order_id FROM cdks')) return [[boundOrder]];
      if (/cdk-return payment evidence/.test(sql)) return [[{ payment_evidence: 0 }]];
      if (/FROM cdks WHERE order_id/.test(sql)) return [[{ id: 'cdk-1', batch_no: 'batch-1' }]];
      if (/UPDATE cdks SET status = 'AVAILABLE'/.test(sql)) return [{ affectedRows: 1 }];
      if (/INSERT INTO cdk_delivery_events/.test(sql)) return [{ affectedRows: 1 }];
      if (sql.includes('FROM products')) return [[{ product_id: 'product-1', fulfillment_route_id: 'route-browser', executor_kind: 'BROWSER', frozen_card_provider_account_id: 'manual-source-a' }]];
      if (sql.includes("UPDATE cdks SET status = 'REDEEMED'")) return [{ affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    },
  };
  return connection;
}

test('the same customer submitting a bound code again gets the existing open order back', async () => {
  const connection = boundCdkConnection({ boundOrder: { id: 'order-old', public_no: 'PJV1-OLDOLDOLDOLDOLDOLDOLD', status: 'WAITING_FOR_SESSION', customer_email: 'Customer@Example.com', chatgpt_account_id: 'account-1' } });
  const result = await createOrderFromCdk({ getConnection: async () => connection }, intakeInput());
  assert.deepEqual(result, { orderId: 'order-old', publicNo: 'PJV1-OLDOLDOLDOLDOLDOLDOLD', status: 'WAITING_FOR_SESSION', reused: true });
  assert.equal(connection.calls.some(({ sql }) => sql.includes('INSERT INTO orders')), false);
  assert.equal(connection.committed, 1);
});

test('a bound code whose order already ended without payment is handed back and accepted as a fresh order', async () => {
  const connection = boundCdkConnection({ boundOrder: { id: 'order-dead', public_no: 'PJV1-DEADDEADDEADDEADDEAD', status: 'RECHARGE_FAILED', customer_email: 'other@example.com', chatgpt_account_id: 'account-9' } });
  const result = await createOrderFromCdk({ getConnection: async () => connection }, intakeInput());
  assert.deepEqual(result, { orderId: 'order-new', publicNo: 'PJV1-NEWNEWNEWNEWNEWNEWNEW', status: 'CREATED' });
  assert.equal(connection.calls.some(({ sql }) => /UPDATE cdks SET status = 'AVAILABLE'/.test(sql)), true);
  assert.equal(connection.calls.some(({ sql }) => sql.includes('INSERT INTO orders')), true);
});

test('a bound code used by a different account on a live order is still rejected', async () => {
  const connection = boundCdkConnection({ boundOrder: { id: 'order-old', public_no: 'PJV1-OLD', status: 'CARD_READY', customer_email: 'someone-else@example.com', chatgpt_account_id: 'account-2' } });
  await assert.rejects(() => createOrderFromCdk({ getConnection: async () => connection }, intakeInput()), (error) => error.code === 'CDK_UNAVAILABLE');
});

test('intake applies a per-product minimum card balance for Pro CDKs and falls back to the Plus default', async () => {
  const { minimumRequiredCardBalanceForPlan } = await import('../src/db/repositories/order-intake-repository.js');
  const parsed = parseOrderIntakeSettings(settings({
    accept_new_orders: 'true', default_card_type_id: '1', default_open_card_amount: '16',
    default_minimum_required_card_balance: '16', 'minimum_required_card_balance:pro_20x': '145.5',
    'minimum_required_card_balance:pro_5x': 'not-a-number'
  }));
  assert.deepEqual(parsed.minimumRequiredCardBalanceByPlan, { pro_20x: '145.5' });
  assert.equal(minimumRequiredCardBalanceForPlan(parsed, 'pro_20x'), '145.5');
  assert.equal(minimumRequiredCardBalanceForPlan(parsed, 'pro_5x'), '16');
  assert.equal(minimumRequiredCardBalanceForPlan(parsed, 'plus'), '16');
  assert.equal(minimumRequiredCardBalanceForPlan(parsed, undefined), '16');
});

