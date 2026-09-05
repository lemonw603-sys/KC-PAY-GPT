import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileByRoute } from '../src/domain/route-reconciliation.js';

test('Browser reconciliation does not require an API external order number', () => {
  const result = reconcileByRoute({ executorKind: 'BROWSER', cardSourceKind: 'HNSKJ',
    orderStatus: 'RECHARGE_SUCCESS', createAttempted: false });
  assert.equal(result.issue, false);
});

test('manual Browser card waits for a later snapshot instead of inventing a mismatch', () => {
  const result = reconcileByRoute({ executorKind: 'BROWSER', cardSourceKind: 'MANUAL_IMPORT',
    orderStatus: 'RECHARGE_SUCCESS', rechargeOrderNo: 'browser-ref',
    actualPaymentAmount: '16', actualPaymentCurrency: 'USD',
    transactionEvidenceSynced: false });
  assert.deepEqual(result, { status: 'EVIDENCE_PENDING', code: 'MANUAL_CARD_SNAPSHOT_PENDING', issue: false });
});

test('unknown executor is a real configuration issue', () => {
  assert.equal(reconcileByRoute({ executorKind: 'OTHER', orderStatus: 'CREATED' }).code,
    'EXECUTOR_KIND_UNKNOWN');
});
