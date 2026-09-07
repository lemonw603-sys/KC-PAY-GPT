import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOrderStage, STAGE_META } from '../src/services/order-stage.js';

const now = Date.parse('2026-09-07T12:00:00.000Z');

test('every stage in CORE_SPEC §1 has a label and tone', () => {
  for (const stage of ['RECEIVED', 'SESSION_INVALID', 'QUEUED', 'LOGIN', 'CHECKOUT', 'PAYING', 'VERIFYING',
    'UPGRADING', 'DONE', 'CLOSED_NO_PAYMENT', 'PAYMENT_UNKNOWN', 'FAILED_AFTER_PAYMENT']) {
    assert.equal(STAGE_META[stage].length, 2, stage);
  }
});

test('terminal order statuses map to DONE / CLOSED_NO_PAYMENT / FAILED_AFTER_PAYMENT', () => {
  assert.equal(deriveOrderStage({ status: 'RECHARGE_SUCCESS', now }).stage, 'DONE');
  assert.equal(deriveOrderStage({ status: 'RECHARGE_SUCCESS', now }).action, '');
  assert.equal(deriveOrderStage({ status: 'CLOSED', now }).stage, 'CLOSED_NO_PAYMENT');
  assert.equal(deriveOrderStage({ status: 'RECHARGE_FAILED', now }).stage, 'CLOSED_NO_PAYMENT');
  const paid = deriveOrderStage({ status: 'RECHARGE_FAILED', attempt: { fundsRiskState: 'SETTLED' }, now });
  assert.equal(paid.stage, 'FAILED_AFTER_PAYMENT');
  assert.match(paid.action, /已扣款/);
  const paidRun = deriveOrderStage({ status: 'RECHARGE_FAILED', run: { status: 'FAILED_SAFE', paymentState: 'PAYMENT_CONFIRMED' }, now });
  assert.equal(paidRun.stage, 'FAILED_AFTER_PAYMENT');
});

test('unknown payment evidence always wins and forbids repay', () => {
  for (const input of [
    { status: 'SUBMIT_UNKNOWN' },
    { status: 'RECONCILIATION_REQUIRED' },
    { status: 'CARD_READY', attempt: { fundsRiskState: 'UNKNOWN' } },
    { status: 'RECHARGE_PROCESSING', run: { status: 'RECONCILE_ONLY', paymentState: 'PAYMENT_UNKNOWN' } }
  ]) {
    const result = deriveOrderStage({ ...input, now });
    assert.equal(result.stage, 'PAYMENT_UNKNOWN', JSON.stringify(input));
    assert.match(result.action, /禁止重付/);
  }
});

test('session bounce explains what the customer must do', () => {
  assert.match(deriveOrderStage({ status: 'WAITING_FOR_SESSION', customerActionCode: 'ACCOUNT_ALREADY_PLUS', now }).action, /已是 Plus/);
  assert.match(deriveOrderStage({ status: 'WAITING_FOR_SESSION', customerActionCode: 'SESSION_INVALID', now }).action, /Session 无效/);
  assert.equal(deriveOrderStage({ status: 'WAITING_FOR_SESSION', now }).stage, 'SESSION_INVALID');
});

test('pre-payment statuses map to RECEIVED / QUEUED with card guidance', () => {
  assert.equal(deriveOrderStage({ status: 'CREATED', now }).stage, 'RECEIVED');
  assert.match(deriveOrderStage({ status: 'WAITING_FOR_CARD', now }).action, /没有合格卡/);
  assert.equal(deriveOrderStage({ status: 'CARD_PROVISIONING', now }).stage, 'QUEUED');
  assert.match(deriveOrderStage({ status: 'CARD_FAILED', now }).action, /开卡失败/);
  assert.equal(deriveOrderStage({ status: 'CARD_READY', now }).stage, 'QUEUED');
  assert.equal(deriveOrderStage({ status: 'CARD_READY', now }).action, '');
});

test('a CARD_READY order that waited too long for automation says which switches to check', () => {
  const readyAt = new Date(now - 45 * 60_000).toISOString();
  const result = deriveOrderStage({ status: 'CARD_READY', requiresRechargeConfirmation: true, confirmationReadyAt: readyAt, now });
  assert.equal(result.stage, 'QUEUED');
  assert.match(result.action, /45 分钟/);
  assert.match(result.action, /浏览器付款开关/);
  const fresh = deriveOrderStage({ status: 'CARD_READY', requiresRechargeConfirmation: true, confirmationReadyAt: new Date(now - 60_000).toISOString(), now });
  assert.equal(fresh.action, '');
});

test('an active Browser run projects LOGIN / CHECKOUT / PAYING and surfaces human takeover', () => {
  const base = { status: 'CARD_READY', now };
  assert.equal(deriveOrderStage({ ...base, run: { status: 'RUNNING', paymentState: 'NOT_STARTED', lastCheckpointKind: 'session-bootstrap', controlState: 'AUTOMATION' } }).stage, 'LOGIN');
  assert.equal(deriveOrderStage({ ...base, run: { status: 'RUNNING', paymentState: 'NOT_STARTED', lastCheckpointKind: 'checkout-navigation', controlState: 'AUTOMATION' } }).stage, 'CHECKOUT');
  assert.equal(deriveOrderStage({ ...base, run: { status: 'RUNNING', paymentState: 'PAYMENT_ARMED', lastCheckpointKind: 'checkout-navigation', controlState: 'AUTOMATION' } }).stage, 'PAYING');
  const frozen = deriveOrderStage({ ...base, run: { status: 'HUMAN_REQUIRED', paymentState: 'NOT_STARTED', lastCheckpointKind: 'checkout-navigation', controlState: 'FROZEN' } });
  assert.equal(frozen.stage, 'CHECKOUT');
  assert.match(frozen.action, /人工接管中/);
  const failedSafe = deriveOrderStage({ ...base, run: { status: 'FAILED_SAFE', paymentState: 'NOT_STARTED', lastErrorCode: 'PAGE_DRIFT' } });
  assert.equal(failedSafe.stage, 'QUEUED');
  assert.match(failedSafe.action, /PAGE_DRIFT/);
});

test('post-payment statuses map to VERIFYING / UPGRADING', () => {
  assert.equal(deriveOrderStage({ status: 'CANCELLATION_PENDING', now }).stage, 'VERIFYING');
  assert.match(deriveOrderStage({ status: 'CANCELLATION_REVIEW_REQUIRED', now }).action, /取消续费失败/);
  assert.equal(deriveOrderStage({ status: 'RECHARGE_PROCESSING', run: { status: 'RUNNING', paymentState: 'PAYMENT_CONFIRMED', postPaymentState: 'PLUS_PENDING' }, now }).stage, 'VERIFYING');
  const upgrading = deriveOrderStage({ status: 'RECHARGE_PROCESSING', planType: '20x',
    run: { status: 'HUMAN_REQUIRED', paymentState: 'PAYMENT_CONFIRMED', postPaymentState: 'PLUS_CONFIRMED' }, now });
  assert.equal(upgrading.stage, 'UPGRADING');
  assert.match(upgrading.action, /20X/);
  assert.equal(deriveOrderStage({ status: 'RECHARGE_PROCESSING', now }).stage, 'PAYING');
  assert.equal(deriveOrderStage({ status: 'SUBMITTING', now }).stage, 'PAYING');
});

test('reconciliation issues append to the action without hiding the stage', () => {
  const result = deriveOrderStage({ status: 'RECHARGE_SUCCESS', reconciliationIssue: true, now });
  assert.equal(result.stage, 'DONE');
  assert.match(result.action, /资金证据不一致/);
  assert.equal(deriveOrderStage({ status: 'CLOSED', reconciliationIssue: true, now }).action, '');
});
