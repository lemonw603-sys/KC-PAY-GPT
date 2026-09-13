import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  createOrderStatusService,
  mapCustomerOrderStatus
} from '../src/services/order-status-service.js';

test('maps internal states to the 6-step customer progress vocabulary', () => {
  // 正常成功链：QUEUED→PREPARING→PAYING→ACTIVATING→CONFIRMING→SUCCESS（「等卡」与「卡就绪」合并为 PREPARING）
  assert.equal(mapCustomerOrderStatus('CREATED'), 'QUEUED');
  assert.equal(mapCustomerOrderStatus('WAITING_FOR_CARD'), 'PREPARING');
  assert.equal(mapCustomerOrderStatus('CARD_PURCHASING'), 'PREPARING');
  assert.equal(mapCustomerOrderStatus('CARD_PROVISIONING'), 'PREPARING');
  assert.equal(mapCustomerOrderStatus('CARD_READY'), 'PREPARING');
  assert.equal(mapCustomerOrderStatus('SUBMITTING'), 'PAYING');
  assert.equal(mapCustomerOrderStatus('RECHARGE_PROCESSING'), 'ACTIVATING');
  assert.equal(mapCustomerOrderStatus('CANCELLATION_PENDING'), 'CONFIRMING');
  assert.equal(mapCustomerOrderStatus('RECHARGE_SUCCESS'), 'SUCCESS');
  // 异常分支单列，不混进正常进度条
  assert.equal(mapCustomerOrderStatus('WAITING_FOR_SESSION'), 'ACTION_REQUIRED');
  assert.equal(mapCustomerOrderStatus('CANCELLATION_REVIEW_REQUIRED'), 'REVIEWING');
  // 付款已提交、结果正在确认是**每一单必经的一步**（2026-09-13 两次全自动成功单各在此
  // 停 8~9 秒），不是故障。它此前和 RECONCILIATION_REQUIRED 一起映射成 REVIEWING，
  // 客户于是在钱已付掉、Plus 已开通的那几秒看到橙色「遇到点问题」，且前端轮询被降到
  // 30 秒，成功要等下一轮才显示。真正需要人工对账的情况有自己的状态。
  assert.equal(mapCustomerOrderStatus('SUBMIT_UNKNOWN'), 'VERIFYING');
  assert.equal(mapCustomerOrderStatus('RECONCILIATION_REQUIRED'), 'REVIEWING');
  assert.equal(mapCustomerOrderStatus('CARD_FAILED'), 'FAILED');
  assert.equal(mapCustomerOrderStatus('RECHARGE_FAILED'), 'FAILED');
  assert.equal(mapCustomerOrderStatus('FUTURE_PROVIDER_STATE'), 'REVIEWING');
});

test('exposes only allowlisted customer actions and bounded Session replacement metadata', async () => {
  const service = createOrderStatusService({
    pool: {},
    repository: {
      findCustomerOrder: async () => ({
        public_no: 'PJV1-ABCDEFGHIJKLMNOPQRST',
        effective_status: 'WAITING_FOR_SESSION',
        customer_action_code: 'ACCOUNT_ALREADY_PLUS',
        session_replacement_count: 1,
        session_repair_expires_at: new Date('2026-08-24T10:00:00.000Z'),
        updated_at: new Date('2026-08-21T10:00:00.000Z')
      })
    }
  });
  const result = await service({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST' });
  assert.deepEqual(result.actionRequired, {
    code: 'ACCOUNT_ALREADY_PLUS',
    message: '当前账号已是 Plus，请更换一个免费账号的 Session。'
  });
  // Replacement is unlimited and never expires (baseline 2026-09-07): the
  // customer page only needs to know the order is waiting for a Session.
  assert.deepEqual(result.sessionReplacement, {
    used: 1,
    remaining: null,
    expiresAt: null
  });

  const hidden = createOrderStatusService({
    pool: {},
    repository: {
      findCustomerOrder: async () => ({
        public_no: 'PJV1-ABCDEFGHIJKLMNOPQRST',
        effective_status: 'WAITING_FOR_SESSION',
        customer_action_code: 'CARD_INVENTORY_EMPTY',
        session_replacement_count: 0,
        updated_at: new Date('2026-08-21T10:00:00.000Z')
      })
    }
  });
  const hiddenResult = await hidden({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST' });
  assert.equal(Object.hasOwn(hiddenResult, 'actionRequired'), false);
});

test('looks up by public number or hashed CDK without passing CDK plaintext', async () => {
  const calls = [];
  const cdkHashKey = crypto.randomBytes(32);
  const service = createOrderStatusService({
    pool: {},
    cdkHashKey,
    repository: {
      findCustomerOrder: async (_pool, lookup) => {
        calls.push(lookup);
        return {
          public_no: 'PJV1-ABCDEFGHIJKLMNOPQRST',
          effective_status: 'RECHARGE_PROCESSING',
          updated_at: new Date('2026-08-17T10:00:00.000Z')
        };
      }
    }
  });
  const byPublicNo = await service({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST' });
  const byCdk = await service({ cdk: '  PJ-ABCDEFGH  ' });
  assert.deepEqual(byPublicNo, {
    publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST',
    status: 'ACTIVATING',
    updatedAt: '2026-08-17T10:00:00.000Z'
  });
  assert.deepEqual(calls[0], { publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST' });
  assert.deepEqual(calls[1], {
    cdkLookup: {
      current: {
        version: 'hmac-sha256-v1',
        hash: crypto.createHmac('sha256', cdkHashKey).update('PJ-ABCDEFGH').digest('hex')
      },
      legacy: {
        version: 'sha256-v1',
        hash: crypto.createHash('sha256').update('PJ-ABCDEFGH').digest('hex')
      }
    }
  });
  assert.equal(JSON.stringify(calls).includes('PJ-ABCDEFGH'), false);
  assert.equal(byCdk.publicNo, byPublicNo.publicNo);
});

test('closed compensated orders are resolved from the compensation record before public mapping', async () => {
  const queries = [];
  const pool = {
    async query(sql, values) {
      queries.push({ sql, values });
      return [[{ public_no: 'PJV1-ABCDEFGHIJKLMNOPQRST', status: 'CLOSED',
        effective_status: 'CARD_FAILED', updated_at: new Date('2026-08-20T00:00:00Z') }], []];
    }
  };
  const result = await createOrderStatusService({ pool })({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST' });
  assert.equal(result.status, 'FAILED');
  assert.match(queries[0].sql, /order_compensations/);
});

test('rejects ambiguous query bodies and hides missing lookup details', async () => {
  const service = createOrderStatusService({
    pool: {},
    cdkHashKey: crypto.randomBytes(32),
    repository: { findCustomerOrder: async () => null }
  });
  await assert.rejects(service({}), (error) => error.code === 'INVALID_ORDER_QUERY');
  await assert.rejects(
    service({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST', cdk: 'PJ-ABCDEFGH' }),
    (error) => error.code === 'INVALID_ORDER_QUERY'
  );
  await assert.rejects(
    service({ cdk: 'PJ-NOTFOUND' }),
    (error) => error.code === 'ORDER_NOT_FOUND' && error.status === 404
  );
});

test('customer status names the product for Pro orders and stays Plus-shaped for legacy rows', async () => {
  const service = createOrderStatusService({
    pool: {}, cdkHashKey: Buffer.alloc(32, 7),
    repository: {
      findCustomerOrder: async (_pool, lookup) => (lookup.publicNo === 'PJV1-PRO00000000000000000'
        ? { public_no: lookup.publicNo, status: 'RECHARGE_PROCESSING', effective_status: 'RECHARGE_PROCESSING',
          updated_at: '2026-09-08T10:00:00.000Z', plan_type: 'pro_20x', product_name: 'ChatGPT Pro 20X' }
        : { public_no: lookup.publicNo, status: 'RECHARGE_PROCESSING', effective_status: 'RECHARGE_PROCESSING',
          updated_at: '2026-09-08T10:00:00.000Z', plan_type: 'plus', product_name: null })
    }
  });
  const pro = await service({ publicNo: 'PJV1-PRO00000000000000000' });
  assert.deepEqual(pro.product, { planType: 'pro_20x', label: 'ChatGPT Pro 20X' });
  const plus = await service({ publicNo: 'PJV1-PLUS0000000000000000' });
  assert.deepEqual(plus.product, { planType: 'plus', label: 'ChatGPT Plus' });
});


test('the customer status carries the nine-stage reading, built from execution evidence', async () => {
  const service = createOrderStatusService({
    pool: {},
    repository: {
      findCustomerOrder: async () => ({
        public_no: 'PJV1-ABCDEFGHIJKLMNOPQRST',
        internal_order_id: 'order-1',
        effective_status: 'RECHARGE_PROCESSING',
        updated_at: new Date('2026-09-11T11:13:40.000Z'),
        events: [
          { to_status: 'CREATED', created_at: new Date('2026-09-11T11:10:03.646Z') },
          { to_status: 'RECHARGE_PROCESSING', created_at: new Date('2026-09-11T11:10:04.256Z') }
        ]
      }),
      findStageEvidence: async (_pool, orderId) => {
        assert.equal(orderId, 'order-1');
        return [
          { kind: 'event', token: 'session-bootstrap', at: '2026-09-11T11:12:46.022Z' },
          { kind: 'event', token: 'checkout-navigation', at: '2026-09-11T11:13:36.882Z' }
        ];
      }
    }
  });
  const order = await service({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST' });
  // 区间与典型耗时在 2026-09-13（D-193）按真实耗时占比重分过，见 domain/customer-stage.js
  // 上方那段来历。typicalMs 必须随 stage 一起下发——前端按它在段内匀速推进，不存副本。
  assert.deepEqual(order.stage, {
    index: 5,
    code: 'CHECKOUT_LOADING',
    label: '正在获取支付信息',
    total: 9,
    typicalMs: 82_500,
    floor: 20,
    ceiling: 62,
    since: '2026-09-11T11:13:36.882Z'
  });
  // The six-step vocabulary stays exactly as it was: the stage is additional.
  assert.equal(order.status, 'ACTIVATING');
});

test('evidence that will not load costs the stage, never the order status', async () => {
  const service = createOrderStatusService({
    pool: {},
    repository: {
      findCustomerOrder: async () => ({
        public_no: 'PJV1-ABCDEFGHIJKLMNOPQRST',
        internal_order_id: 'order-1',
        effective_status: 'RECHARGE_SUCCESS',
        customer_email: 'customer@example.com',
        updated_at: new Date('2026-09-11T11:15:15.961Z'),
        events: []
      }),
      findStageEvidence: async () => { throw new Error('browser_run_events unavailable'); }
    }
  });
  const order = await service({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST' });
  assert.equal(order.status, 'SUCCESS');
  assert.equal(order.customerEmail, 'customer@example.com');
  assert.equal('stage' in order, false);
});

test('a failed order says whether the customer can just redeem the code again', async () => {
  const asked = [];
  const make = (blocked) => createOrderStatusService({
    pool: {},
    repository: {
      findCustomerOrder: async () => ({
        public_no: 'PJV1-ABCDEFGHIJKLMNOPQRST',
        internal_order_id: 'order-1',
        effective_status: 'RECHARGE_FAILED',
        updated_at: new Date('2026-09-12T09:26:31.000Z')
      }),
      cdkReturnWouldBeBlocked: async (_pool, orderId) => { asked.push(orderId); return blocked; }
    }
  });

  // 付款前就停了：卡密退得回来，客户自己再兑一次就行。
  const open = await make(false)({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST' });
  assert.equal(open.status, 'FAILED');
  assert.equal(open.canRetry, true);

  // 点过付款、结果不明：卡密留在原单上等人工核对，不能许诺重来。
  const held = await make(true)({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST' });
  assert.equal(held.canRetry, false);

  assert.deepEqual(asked, ['order-1', 'order-1'], '问的是订单自己的 id，不是查询码');
});

test('retry eligibility fails closed when it cannot be determined', async () => {
  const service = createOrderStatusService({
    pool: {},
    repository: {
      findCustomerOrder: async () => ({
        public_no: 'PJV1-ABCDEFGHIJKLMNOPQRST',
        internal_order_id: 'order-1',
        effective_status: 'RECHARGE_FAILED',
        updated_at: new Date('2026-09-12T09:26:31.000Z')
      }),
      cdkReturnWouldBeBlocked: async () => { throw new Error('db is down'); }
    }
  });
  const result = await service({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST' });
  // 查不出来就说不能重来：宁可让客户找客服，也不能许诺一个兑不掉的重来。
  assert.equal(result.status, 'FAILED');
  assert.equal(result.canRetry, false);
});

test('orders that have not failed carry no retry field at all', async () => {
  let asked = 0;
  const service = createOrderStatusService({
    pool: {},
    repository: {
      findCustomerOrder: async () => ({
        public_no: 'PJV1-ABCDEFGHIJKLMNOPQRST',
        internal_order_id: 'order-1',
        effective_status: 'RECHARGE_SUCCESS',
        customer_email: 'buyer@example.test',
        updated_at: new Date('2026-09-12T09:26:31.000Z')
      }),
      cdkReturnWouldBeBlocked: async () => { asked += 1; return false; }
    }
  });
  const result = await service({ publicNo: 'PJV1-ABCDEFGHIJKLMNOPQRST' });
  assert.equal(result.status, 'SUCCESS');
  assert.equal('canRetry' in result, false);
  assert.equal(asked, 0, '成功单不去问卡密退回，白跑一次查询');
});
