import assert from 'node:assert/strict';
import test from 'node:test';
import { reconcileOrderEvidence } from '../src/domain/order-reconciliation.js';

test('keeps untouched and cancelled pre-submission orders out of reconciliation alerts', () => {
  assert.deepEqual(reconcileOrderEvidence({ orderStatus: 'CREATED' }), {
    status: 'NOT_SUBMITTED', code: 'RECHARGE_NOT_SUBMITTED', issue: false
  });
  assert.deepEqual(reconcileOrderEvidence({ orderStatus: 'CLOSED' }), {
    status: 'NOT_SUBMITTED', code: 'RECHARGE_NOT_SUBMITTED', issue: false
  });
});

test('marks a settled three-way payment match as reconciled', () => {
  assert.deepEqual(reconcileOrderEvidence({
    orderStatus: 'RECHARGE_SUCCESS', rechargeOrderNo: 'R-1', createAttempted: true,
    actualPaymentAmount: '982.14', actualPaymentCurrency: 'PHP',
    transactionEvidenceSynced: true, successfulPurchaseExists: true,
    paymentMatched: true, paymentSettled: true
  }), { status: 'MATCHED', code: 'THREE_WAY_MATCHED', issue: false });
});

test('distinguishes delayed evidence from a real payment mismatch', () => {
  assert.equal(reconcileOrderEvidence({
    orderStatus: 'RECHARGE_SUCCESS', rechargeOrderNo: 'R-1', createAttempted: true,
    actualPaymentAmount: '982.14', actualPaymentCurrency: 'PHP'
  }).status, 'EVIDENCE_PENDING');
  assert.deepEqual(reconcileOrderEvidence({
    orderStatus: 'RECHARGE_SUCCESS', rechargeOrderNo: 'R-1', createAttempted: true,
    actualPaymentAmount: '982.14', actualPaymentCurrency: 'PHP',
    transactionEvidenceSynced: true, successfulPurchaseExists: true
  }), { status: 'REVIEW_REQUIRED', code: 'PAYMENT_AMOUNT_MISMATCH', issue: true });
});

test('flags successful card charges on failed or never-submitted orders', () => {
  assert.equal(reconcileOrderEvidence({
    orderStatus: 'RECHARGE_FAILED', rechargeOrderNo: 'R-1', createAttempted: true,
    transactionEvidenceSynced: true, successfulPurchaseExists: true
  }).code, 'FAILED_ORDER_HAS_SUCCESSFUL_CHARGE');
  assert.equal(reconcileOrderEvidence({
    orderStatus: 'CARD_READY', successfulPurchaseExists: true
  }).code, 'CARD_CHARGED_WITHOUT_RECHARGE');
});

test('flags a persisted recharge call intent that never reached a final outcome', () => {
  assert.deepEqual(reconcileOrderEvidence({
    orderStatus: 'SUBMITTING', createAttempted: true, createAttemptStalled: true
  }), { status: 'REVIEW_REQUIRED', code: 'RECHARGE_CREATE_STALLED', issue: true });
});
