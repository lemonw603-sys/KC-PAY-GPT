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
  const service = createOrderStatusService({
    pool: {},
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
    cdkHash: crypto.createHash('sha256').update('PJ-ABCDEFGH').digest('hex')
  });
  assert.equal(JSON.stringify(calls).includes('PJ-ABCDEFGH'), false);
  assert.equal(byCdk.publicNo, byPublicNo.publicNo);
});

test('rejects ambiguous query bodies and hides missing lookup details', async () => {
  const service = createOrderStatusService({
    pool: {},
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
