import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  createOrderStatusService,
  mapCustomerOrderStatus
} from '../src/services/order-status-service.js';

test('maps internal states to the limited customer status vocabulary', () => {
  assert.equal(mapCustomerOrderStatus('CREATED'), 'QUEUED');
  assert.equal(mapCustomerOrderStatus('SUBMITTING'), 'PROCESSING');
  assert.equal(mapCustomerOrderStatus('SUBMIT_UNKNOWN'), 'REVIEWING');
  assert.equal(mapCustomerOrderStatus('RECONCILIATION_REQUIRED'), 'REVIEWING');
  assert.equal(mapCustomerOrderStatus('RECHARGE_SUCCESS'), 'SUCCESS');
  assert.equal(mapCustomerOrderStatus('RECHARGE_FAILED'), 'FAILED');
  assert.equal(mapCustomerOrderStatus('FUTURE_PROVIDER_STATE'), 'REVIEWING');
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
    status: 'PROCESSING',
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
