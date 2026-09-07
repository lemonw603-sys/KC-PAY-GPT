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
  assert.equal(mapCustomerOrderStatus('SUBMIT_UNKNOWN'), 'REVIEWING');
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

