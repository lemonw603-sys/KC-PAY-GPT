import assert from 'node:assert/strict';
import test from 'node:test';
import { EXECUTOR_HEARTBEAT_MAX_AGE_MS, assertExecutorHeartbeat, createOrderFromCdk, parseOrderIntakeSettings } from '../src/db/repositories/order-intake-repository.js';

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

test('D-158: Browser order intake creates only the card assignment task, no separate preflight', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM app_settings') && sql.includes('setting_key IN (?, ?)')) return [[{ setting_key: 'browser_worker_heartbeat_at', setting_value: new Date().toISOString() }, { setting_key: 'worker_heartbeat_at', setting_value: new Date().toISOString() }]];
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
  assert.equal(taskCalls.length, 1, 'a second login for a separate preflight is no longer scheduled');
  assert.match(taskCalls[0].sql, /'ASSIGN_CARD'/);
  assert.equal(calls.some(({ sql }) => sql.includes('BROWSER_PREFLIGHT')), false);
  const insert = calls.find(({ sql }) => sql.includes('INSERT INTO orders'));
  assert.match(insert.sql, /frozen_card_provider_account_id/);
  assert.equal(insert.values.includes('manual-source-a'), true);
  // D-246 面一 C1：冻结卡台只从「产品 × 执行器 → 卡台」选择表取；不再读路线表旧列、不再写死卡台名字。
  const routeQuery = calls.find(({ sql }) => sql.includes('INSERT INTO orders') === false && sql.includes('FROM products p INNER JOIN fulfillment_routes fr'));
  assert.match(routeQuery.sql, /INNER JOIN card_source_selections css\s+ON css\.product_id = p\.id AND css\.executor_kind = fr\.executor_kind/);
  assert.doesNotMatch(routeQuery.sql, /browser_card_source_selections|fr\.card_provider_account_id|'hnskj'|manual_excel/);
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
      if (sql.includes('FROM app_settings') && sql.includes('setting_key IN (?, ?)')) return [[{ setting_key: 'browser_worker_heartbeat_at', setting_value: new Date().toISOString() }, { setting_key: 'worker_heartbeat_at', setting_value: new Date().toISOString() }]];
      if (sql.includes('FROM app_settings')) return [[
        { setting_key: 'accept_new_orders', setting_value: 'true' }, { setting_key: 'default_card_type_id', setting_value: '1' },
        { setting_key: 'default_open_card_amount', setting_value: '16' }, { setting_key: 'default_minimum_required_card_balance', setting_value: '16' },
      ]];
      if (sql.includes('FROM cdks') && sql.includes('code_hash')) return [[{ id: 'cdk-1', status: 'REDEEMED', plan_type: 'plus', batch_no: 'batch-1' }]];
      if (sql.includes('FROM orders WHERE id = (SELECT order_id FROM cdks')) return [[boundOrder]];
      if (sql.includes('FROM tasks') && sql.includes('lease_active')) return [[]];
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
  const connection = boundCdkConnection({ boundOrder: { id: 'order-old', public_no: 'PJV1-OLDOLDOLDOLDOLDOLDOLD', status: 'CARD_READY', customer_email: 'Customer@Example.com', chatgpt_account_id: 'account-1' } });
  const result = await createOrderFromCdk({ getConnection: async () => connection }, intakeInput());
  assert.deepEqual(result, { orderId: 'order-old', publicNo: 'PJV1-OLDOLDOLDOLDOLDOLDOLD', status: 'CARD_READY', reused: true });
  assert.equal(connection.calls.some(({ sql }) => sql.includes('INSERT INTO orders')), false);
  assert.equal(connection.calls.some(({ sql }) => sql.includes('INSERT INTO order_session_replacements')), false);
  assert.equal(connection.committed, 1);
});

// F-34: a customer sent back for a new Session who does the natural thing, resubmitting the
// same code with a new Session, used to get the old order back untouched (new Session dropped).
test('a sent-back order receiving the same code again gets its Session replaced and resumes', async () => {
  const connection = boundCdkConnection({ boundOrder: {
    id: 'order-old', public_no: 'PJV1-OLDOLDOLDOLDOLDOLDOLD', status: 'WAITING_FOR_SESSION', version: 3,
    customer_email: 'customer@example.com', chatgpt_account_id: 'account-1',
    customer_action_code: 'SESSION_INVALID', session_replacement_count: 0, assigned_card_id: 'card-1',
  } });
  const result = await createOrderFromCdk({ getConnection: async () => connection }, intakeInput({ sessionCiphertext: 'encrypted-session-2' }));
  assert.deepEqual(result, { orderId: 'order-old', publicNo: 'PJV1-OLDOLDOLDOLDOLDOLDOLD', status: 'CARD_READY', reused: true, sessionReplaced: true });
  assert.equal(connection.calls.some(({ sql }) => sql.includes('INSERT INTO orders')), false);
  assert.ok(connection.calls.some(({ sql }) => sql.includes('INSERT INTO order_session_replacements')));
  const update = connection.calls.find(({ sql }) => /UPDATE orders SET status = \?, session_ciphertext = \?/.test(sql));
  assert.deepEqual(update.values.slice(0, 4), ['CARD_READY', 'encrypted-session-2', 'customer@example.com', 'account-1']);
  assert.ok(connection.calls.some(({ sql }) => /UPDATE tasks SET status = 'PENDING'/.test(sql) && sql.includes("'BROWSER_PREFLIGHT'")));
  assert.equal(connection.committed, 1);
});

// F-35: "please switch to a free account" must be possible with the same code.
test('a different free account resubmitting the same code on a sent-back order replaces the Session instead of a 409', async () => {
  const connection = boundCdkConnection({ boundOrder: {
    id: 'order-old', public_no: 'PJV1-OLDOLDOLDOLDOLDOLDOLD', status: 'WAITING_FOR_SESSION', version: 5,
    customer_email: 'plus-account@example.com', chatgpt_account_id: 'account-plus',
    customer_action_code: 'ACCOUNT_ALREADY_PLUS', session_replacement_count: 1, assigned_card_id: null,
  } });
  const result = await createOrderFromCdk({ getConnection: async () => connection }, intakeInput({ customerEmail: 'free@example.com', chatgptAccountId: 'account-free' }));
  assert.equal(result.status, 'WAITING_FOR_CARD');
  assert.equal(result.sessionReplaced, true);
  const event = connection.calls.find(({ sql }) => sql.includes('INSERT INTO order_events') && sql.includes("'WAITING_FOR_SESSION', ?"));
  assert.match(event.values.at(-1), /"accountChanged":true/);
  assert.match(event.values.at(-1), /"replacementNo":2/);
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


/* ===== D-286 有效期必须拦在建单这一步（2026-09-20 补）=====
   验码只是给页面看的；真正的闸门是这里。只改验码等于留一条绕过去的路
   （直接打下单接口）。此前两处都没读 expires_at，后台说「已过期」的码照样能兑。 */

function cdkConnectionWithExpiry(expiresAt) {
  return {
    async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
    async query(sql) {
      if (sql.includes('FROM app_settings') && sql.includes('setting_key IN (?, ?)')) return [[{ setting_key: 'browser_worker_heartbeat_at', setting_value: new Date().toISOString() }, { setting_key: 'worker_heartbeat_at', setting_value: new Date().toISOString() }]];
      if (sql.includes('FROM app_settings')) return [[
        { setting_key: 'accept_new_orders', setting_value: 'true' },
        { setting_key: 'default_card_type_id', setting_value: '1' },
        { setting_key: 'default_open_card_amount', setting_value: '16' },
        { setting_key: 'default_minimum_required_card_balance', setting_value: '16' }
      ]];
      if (sql.includes('FROM cdks')) return [[
        { id: 'cdk-1', status: 'AVAILABLE', plan_type: 'plus', batch_no: 'batch-1', expires_at: expiresAt }
      ]];
      return [[]];
    }
  };
}

test('D-286: 过期的码在建单这一步被拒，错误码与「码不对」分开', async () => {
  const connection = cdkConnectionWithExpiry(new Date(Date.now() - 60_000).toISOString());
  await assert.rejects(
    () => createOrderFromCdk({ getConnection: async () => connection }, intakeInput()),
    (error) => error.code === 'CDK_EXPIRED');
});

test('D-286: expires_at 为 NULL 的码不受影响 —— 生产现存的码全是 NULL', async () => {
  // 这一条写错就是全站事故：所有客户都建不了单。它必须走过过期检查继续往下。
  const connection = cdkConnectionWithExpiry(null);
  await assert.rejects(
    () => createOrderFromCdk({ getConnection: async () => connection }, intakeInput()),
    (error) => error.code !== 'CDK_EXPIRED',
    '无有效期的码绝不能被当成过期');
});

test('D-286: 有效期未到的码不受影响', async () => {
  const connection = cdkConnectionWithExpiry(new Date(Date.now() + 86_400_000).toISOString());
  await assert.rejects(
    () => createOrderFromCdk({ getConnection: async () => connection }, intakeInput()),
    (error) => error.code !== 'CDK_EXPIRED');
});


test('D-352 块3②: intake refuses when the route executor heartbeat is stale, missing or in the future; a disabled check passes', () => {
  const now = Date.parse('2026-09-23T08:00:00.000Z');
  const fresh = new Date(now - 30_000).toISOString();
  const stale = new Date(now - EXECUTOR_HEARTBEAT_MAX_AGE_MS - 1).toISOString();
  assert.deepEqual(assertExecutorHeartbeat({ executorKind: 'BROWSER', heartbeatAt: fresh, now }), { skipped: false, ageMs: 30_000 });
  for (const heartbeatAt of [stale, null, '', 'not-a-date', new Date(now + 10 * 60_000).toISOString()]) {
    assert.throws(() => assertExecutorHeartbeat({ executorKind: 'BROWSER', heartbeatAt, now }),
      (error) => error.code === 'EXECUTOR_UNAVAILABLE' && error.status === 503, `heartbeat=${heartbeatAt}`);
  }
  assert.throws(() => assertExecutorHeartbeat({ executorKind: 'ZZSHU', heartbeatAt: fresh, now }), (error) => error.code === 'ORDER_ROUTE_UNAVAILABLE');
  assert.deepEqual(assertExecutorHeartbeat({ executorKind: 'BROWSER', heartbeatAt: stale, checkEnabled: 'false', now }), { skipped: true });
  assert.throws(() => assertExecutorHeartbeat({ executorKind: 'API', heartbeatAt: stale, checkEnabled: 'true', now }), (error) => error.code === 'EXECUTOR_UNAVAILABLE');
});

test('D-352 块3②: a stale Browser heartbeat rejects the order before anything is inserted and the CDK stays untouched', async () => {
  const calls = [];
  const connection = {
    async beginTransaction() {}, async commit() { calls.push({ sql: 'COMMIT' }); }, async rollback() { calls.push({ sql: 'ROLLBACK' }); }, release() {},
    async query(sql, values) {
      calls.push({ sql, values });
      if (sql.includes('FROM app_settings') && sql.includes('setting_key IN (?, ?)')) return [[
        { setting_key: 'browser_worker_heartbeat_at', setting_value: '2026-09-23T00:00:00.000Z' }
      ]];
      if (sql.includes('FROM app_settings')) return [[
        { setting_key: 'accept_new_orders', setting_value: 'true' },
        { setting_key: 'default_card_type_id', setting_value: '1' },
        { setting_key: 'default_open_card_amount', setting_value: '16' },
        { setting_key: 'default_minimum_required_card_balance', setting_value: '16' },
      ]];
      if (sql.includes('FROM cdks')) return [[{ id: 'cdk-1', status: 'AVAILABLE', plan_type: 'plus', batch_no: 'batch-1' }]];
      if (sql.includes('FROM products')) return [[{
        product_id: 'product-1', fulfillment_route_id: 'route-browser', executor_kind: 'BROWSER',
        frozen_card_provider_account_id: 'manual-source-a',
      }]];
      throw new Error(`unexpected query in rejected intake: ${sql.slice(0, 60)}`);
    }
  };
  const pool = { async getConnection() { return connection; } };
  await assert.rejects(
    createOrderFromCdk(pool, {
      orderId: 'order-1', publicNo: 'PJV1-test', customerEmail: 'a@b.c', chatgptAccountId: 'acct-1',
      sessionCiphertext: 'cipher', cardPurchaseIdempotencyKey: 'purchase-order-1',
      cdkLookup: { current: { version: 2, hash: 'h2' }, legacy: { version: 1, hash: 'h1' } },
      now: () => Date.parse('2026-09-23T08:00:00.000Z')
    }),
    (error) => error.code === 'EXECUTOR_UNAVAILABLE' && error.status === 503
  );
  assert.ok(!calls.some((call) => /INSERT INTO orders/.test(call.sql)), '没有建单');
  assert.ok(!calls.some((call) => /UPDATE cdks/.test(call.sql)), 'CDK 没被占用');
  assert.ok(calls.some((call) => call.sql === 'ROLLBACK'), '事务回滚');
});

// ---- D-386：验卡预检与下单用同一套判断（只读、不加锁） ----
import { checkOrderAvailability as checkAvailabilityForTest } from '../src/db/repositories/order-intake-repository.js';

function availabilityQueryable({ settings = {}, routes = [{ executor_kind: 'BROWSER', product_id: 'p', fulfillment_route_id: 'r', frozen_card_provider_account_id: 'a' }], heartbeat = {} } = {}) {
  const base = { accept_new_orders: 'true', default_card_type_id: '23', default_open_card_amount: '16', default_minimum_required_card_balance: '16.00' };
  const merged = { ...base, ...settings };
  const sqls = [];
  return {
    sqls,
    async query(sql, params) {
      sqls.push(sql);
      if (/FROM products p/.test(sql)) return [routes];
      if (/FROM app_settings/.test(sql) && params.length === 2) {
        return [params.filter((key) => key in heartbeat).map((key) => ({ setting_key: key, setting_value: heartbeat[key] }))];
      }
      if (/FROM app_settings/.test(sql)) {
        return [Object.entries(merged).filter(([, v]) => v != null).map(([setting_key, setting_value]) => ({ setting_key, setting_value }))];
      }
      throw new Error(`unexpected sql ${sql}`);
    },
  };
}

test('availability pre-check answers like intake would: paused, route closed, executor down, ok — and never locks', async () => {
  const now = Date.parse('2026-09-26T00:00:00Z');
  const fresh = { browser_worker_heartbeat_at: new Date(now - 5_000).toISOString() };
  const stale = { browser_worker_heartbeat_at: new Date(now - 600_000).toISOString() };
  const cases = [
    [{ settings: { accept_new_orders: 'false' }, heartbeat: fresh }, { ok: false, code: 'ORDERING_PAUSED' }],
    [{ routes: [], heartbeat: fresh }, { ok: false, code: 'ORDER_ROUTE_UNAVAILABLE' }],
    [{ heartbeat: stale }, { ok: false, code: 'EXECUTOR_UNAVAILABLE' }],
    [{ heartbeat: { ...stale, intake_executor_heartbeat_check: 'false' } }, { ok: true }],
    [{ heartbeat: fresh }, { ok: true }],
  ];
  for (const [setup, expected] of cases) {
    const queryable = availabilityQueryable(setup);
    assert.deepEqual(await checkAvailabilityForTest(queryable, { planType: 'plus', now }), expected, JSON.stringify(setup));
    assert.ok(queryable.sqls.every((sql) => !/FOR (SHARE|UPDATE)/.test(sql)), 'pre-check must not lock');
  }
});
