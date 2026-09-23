import assert from 'node:assert/strict';
import test from 'node:test';
import { orderBucket, primaryOrderAction } from '../src/services/order-list-bucket.js';

test('D-356: bucket follows needs_person first, then terminal status', () => {
  assert.equal(orderBucket({ status: 'RECHARGE_SUCCESS', needsPerson: true }), 'action', '成功但续费待确认 → 需要我处理');
  assert.equal(orderBucket({ status: 'RECHARGE_SUCCESS', needsPerson: false }), 'success');
  for (const status of ['RECHARGE_FAILED', 'CLOSED', 'CARD_FAILED']) assert.equal(orderBucket({ status, needsPerson: false }), 'failed');
  assert.equal(orderBucket({ status: 'RECHARGE_FAILED', needsPerson: true }), 'action', '已付款未交付');
  for (const status of ['CREATED', 'WAITING_FOR_CARD', 'CARD_READY', 'RECHARGE_PROCESSING', 'SUBMITTING', 'CANCELLATION_PENDING']) {
    assert.equal(orderBucket({ status, needsPerson: false }), 'processing', status);
  }
});

test('D-356: exactly one primary action per row, money first', () => {
  const act = (o) => primaryOrderAction(o)?.key ?? null;
  assert.equal(act({ status: 'SUBMIT_UNKNOWN', needsPerson: true }), 'verify');
  assert.equal(act({ status: 'RECONCILIATION_REQUIRED', needsPerson: true }), 'verify');
  assert.equal(act({ status: 'RECHARGE_PROCESSING', needsPerson: true, run: { status: 'HUMAN_REQUIRED', paymentState: 'PAYMENT_UNKNOWN' } }), 'verify', 'Browser 付款不明升级人工');
  assert.equal(act({ status: 'RECHARGE_PROCESSING', needsPerson: false, run: { status: 'RUNNING', paymentState: 'NOT_STARTED' } }), null, '正常处理中没有动作');
  assert.equal(act({ status: 'WAITING_FOR_SESSION' }), 'cancel');
  assert.equal(act({ status: 'CARD_READY' }), 'cancel');
  assert.equal(act({ status: 'RECHARGE_SUCCESS', cancellationReviewRequired: true, needsPerson: true }), 'renewal');
  assert.equal(act({ status: 'CANCELLATION_REVIEW_REQUIRED', needsPerson: true }), 'renewal');
  assert.equal(act({ status: 'RECHARGE_SUCCESS', cancellationReviewRequired: false }), null);
  assert.equal(act({ status: 'RECHARGE_FAILED', failedAfterPayment: false }), 'manual');
  assert.equal(act({ status: 'RECHARGE_FAILED', failedAfterPayment: true, needsPerson: true }), null, '已付款未交付不能标手工，要人看');
  assert.equal(act({ status: 'CLOSED' }), null);
});
