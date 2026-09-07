import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BrowserPaymentExecutor,
  BrowserPaymentExecutorError,
  MockCheckoutPaymentAdapter,
  MockPostPaymentVerifier,
  loadPaymentExecutorConfig,
} from '../src/payment-executor.js';

function harness({ outcome = 'CONFIRMED', plusActive = true, cancellationConfirmed = true,
  reconciliationMatched = true, enabled = true, postPlusAction = 'CANCEL_RENEWAL' } = {}) {
  const calls = [];
  const integration = {
    workerId: 'worker-1',
    async issueAuthoritativePaymentPermit() { calls.push('permit'); return { permitId: 'permit-1', permitNonce: 'nonce-1' }; },
  };
  const executionRepository = {
    async commitPaymentSubmissionIntent(input) { calls.push(['intent', input]); return { executeExternal: true }; },
    async markPaymentUnknown(input) { calls.push(['unknown', input]); },
    async markPaymentConfirmed(input) { calls.push(['confirmed', input]); },
    async schedulePostPaymentVerification(input) { calls.push(['schedule-verification', input]); },
    async recordPlusActivation(input) { calls.push(['plus-record', input]); },
    async recordManual20xHandoff(input) { calls.push(['manual-20x-handoff', input]); },
    async recordManual20xReviewRequired(input) { calls.push(['manual-20x-review', input]); },
    async recordCancellationConfirmed(input) { calls.push(['cancel-record', input]); },
  };
  const control = { async assertLeaseBeforeAction(action) { calls.push(`lease:${action}`); } };
  const verifier = new MockPostPaymentVerifier({ plusActive, cancellationConfirmed });
  if (!reconciliationMatched) verifier.reconcile = async () => {
    verifier.calls.push('reconcile');
    return { matched: false };
  };
  const adapter = new MockCheckoutPaymentAdapter({ outcome });
  const executor = new BrowserPaymentExecutor({
    integration, executionRepository, paymentAdapter: adapter, postPaymentVerifier: verifier,
    enabled, postPlusAction,
  });
  return { executor, control, executionRepository, adapter, verifier, calls };
}

test('payment executor is disabled by default and rejects live adapter mode', () => {
  assert.equal(loadPaymentExecutorConfig({}).enabled, false);
  assert.equal(loadPaymentExecutorConfig({ BROWSER_PAYMENT_EXECUTOR_ENABLED: 'true' }).mode, 'MOCK');
  assert.throws(() => loadPaymentExecutorConfig({ BROWSER_PAYMENT_EXECUTOR_MODE: 'LIVE' }), (error) => error.code === 'LIVE_PAYMENT_ADAPTER_UNAVAILABLE');
  assert.deepEqual(loadPaymentExecutorConfig({
    BROWSER_PAYMENT_EXECUTOR_MODE: 'LIVE', BROWSER_PAYMENT_EXECUTOR_ENABLED: 'true',
  }, { liveAdapterAvailable: true }), { enabled: true, mode: 'LIVE' });
  const { executor, control } = harness({ enabled: false });
  return assert.rejects(() => executor.execute({ control, run: { runId: 'run-1', leaseToken: 'lease-1' }, checkout: { kind: 'MOCK_CHECKOUT' }, cardMaterial: { ref: 'card-material' }, operationId: 'pay-1' }), (error) => error.code === 'PAYMENT_EXECUTOR_DISABLED');
});

test('mock payment lane obtains authoritative permit, submits once, and verifies post-payment lifecycle', async () => {
  const { executor, control, calls, adapter, verifier } = harness();
  const result = await executor.execute({
    control, run: { runId: 'run-1', leaseToken: 'lease-1' }, checkout: { kind: 'MOCK_CHECKOUT' },
    cardMaterial: { ref: 'card-material' }, operationId: 'pay-1',
  });
  assert.equal(result.status, 'COMPLETED');
  assert.equal(result.paymentSubmitCalls, 1);
  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(verifier.calls, ['plus', 'cancellation', 'card-transactions', 'reconcile']);
  assert.deepEqual(calls.filter((value) => typeof value === 'string' && value.startsWith('lease:')), [
    'lease:PAYMENT_PERMIT', 'lease:PAYMENT_SUBMIT', 'lease:PAYMENT_SUBMIT_INTENT', 'lease:PAYMENT_RESULT',
  ]);
});

test('unknown or declined submission is locked for reconciliation and never retried', async () => {
  for (const outcome of ['UNKNOWN', 'DECLINED']) {
    const { executor, control, calls, adapter } = harness({ outcome });
    const result = await executor.execute({
      control, run: { runId: 'run-1', leaseToken: 'lease-1' }, checkout: { kind: 'MOCK_CHECKOUT' },
      cardMaterial: { ref: 'card-material' }, operationId: 'pay-1',
    });
    assert.equal(result.status, 'UNKNOWN');
    assert.equal(adapter.calls.length, outcome === 'UNKNOWN' ? 1 : 1);
    assert.equal(calls.filter((value) => Array.isArray(value) && value[0] === 'unknown').length, 1);
  }
});

test('post-payment mismatch never attempts another payment', async () => {
  const { executor, control, calls, adapter } = harness({ plusActive: false });
  const result = await executor.execute({
    control, run: { runId: 'run-1', leaseToken: 'lease-1' }, checkout: { kind: 'MOCK_CHECKOUT' },
    cardMaterial: { ref: 'card-material' }, operationId: 'pay-1',
  });
  assert.equal(result.status, 'POST_PAYMENT_UNKNOWN');
  assert.equal(adapter.calls.length, 1);
  assert.equal(calls.filter((value) => Array.isArray(value) && value[0] === 'unknown').length, 0);
});

test('manual 20X mode confirms Plus and card transaction, never cancels renewal', async () => {
  const { executor, control, calls, adapter, verifier } = harness({
    postPlusAction: 'MANUAL_20X_HANDOFF',
  });
  const result = await executor.execute({
    control, run: { runId: 'run-20x', leaseToken: 'lease-20x' },
    checkout: { kind: 'MOCK_CHECKOUT' }, cardMaterial: { ref: 'card-material' },
    operationId: 'pay-20x',
  });
  assert.deepEqual(result, {
    status: 'MANUAL_20X_HANDOFF', paymentSubmitCalls: 1,
    cardTransactionCount: 1, preserveProfile: true,
  });
  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(verifier.calls, ['plus', 'card-transactions', 'reconcile']);
  assert.equal(calls.filter((value) => Array.isArray(value)
    && value[0] === 'manual-20x-handoff').length, 1);
  assert.equal(calls.filter((value) => Array.isArray(value)
    && value[0] === 'cancel-record').length, 0);
});

test('manual 20X mode does not claim handoff success when card reconciliation mismatches', async () => {
  const { executor, control, calls, adapter, verifier } = harness({
    postPlusAction: 'MANUAL_20X_HANDOFF', reconciliationMatched: false,
  });
  const result = await executor.execute({
    control, run: { runId: 'run-20x-review', leaseToken: 'lease-20x-review' },
    checkout: { kind: 'MOCK_CHECKOUT' }, cardMaterial: { ref: 'card-material' },
    operationId: 'pay-20x-review',
  });
  assert.equal(result.status, 'MANUAL_20X_REVIEW_REQUIRED');
  assert.equal(result.preserveProfile, true);
  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(verifier.calls, ['plus', 'card-transactions', 'reconcile']);
  assert.equal(calls.filter((value) => Array.isArray(value)
    && value[0] === 'manual-20x-handoff').length, 0);
  assert.equal(calls.filter((value) => Array.isArray(value)
    && value[0] === 'manual-20x-review').length, 1);
});

test('mock adapter rejects non-mock checkout before any external action', async () => {
  const { executor, control, adapter } = harness();
  const result = await executor.execute({
    control, run: { runId: 'run-1', leaseToken: 'lease-1' }, checkout: { kind: 'LIVE_CHECKOUT' },
    cardMaterial: { ref: 'card-material' }, operationId: 'pay-1',
  });
  assert.equal(result.status, 'PRE_SUBMIT_FAILED');
  assert.equal(result.reasonCode, 'CHECKOUT_ADAPTER_MISMATCH');
  assert.equal(adapter.calls.length, 0);
});

test('proven pre-submit drift is recoverable and does not mark payment UNKNOWN', async () => {
  const { executor, control, calls } = harness();
  executor.paymentAdapter = { async submit() { const error = new Error('selector drift'); error.code = 'CHECKOUT_DRIFT'; throw error; } };
  const result = await executor.execute({
    control, run: { runId: 'run-1', leaseToken: 'lease-1' }, checkout: { kind: 'MOCK_CHECKOUT' },
    cardMaterial: { ref: 'card-material' }, operationId: 'pay-drift',
  });
  assert.deepEqual(result, { status: 'PRE_SUBMIT_FAILED', reasonCode: 'CHECKOUT_DRIFT', paymentSubmitCalls: 0 });
  assert.equal(calls.filter((value) => Array.isArray(value) && value[0] === 'unknown').length, 0);
  assert.equal(calls.filter((value) => Array.isArray(value) && value[0] === 'intent').length, 0);
});

test('post-payment verifier errors become structured reconciliation state', async () => {
  const { executor, control, adapter } = harness();
  const original = executor.postPaymentVerifier.confirmCancellation;
  executor.postPaymentVerifier.confirmCancellation = async () => { throw new Error('temporary verifier outage'); };
  const result = await executor.execute({
    control, run: { runId: 'run-1', leaseToken: 'lease-1' }, checkout: { kind: 'MOCK_CHECKOUT' },
    cardMaterial: { ref: 'card-material' }, operationId: 'pay-1',
  });
  executor.postPaymentVerifier.confirmCancellation = original;
  assert.deepEqual(result, {
    status: 'POST_PAYMENT_UNKNOWN',
    reasonCode: 'POST_PAYMENT_RECONCILIATION_REQUIRED',
    paymentSubmitCalls: 1,
  });
  assert.equal(adapter.calls.length, 1);
});

test('payment executor forwards the Browser page only to the payment adapter boundary', async () => {
  const { executor, control } = harness();
  let observedPage = null;
  executor.paymentAdapter = {
    async submit(input) { observedPage = input.page; return { status: 'DECLINED', providerCallRef: 'mock-page-forward' }; },
  };
  const page = { opaque: true };
  const result = await executor.execute({
    control, page, run: { runId: 'run-1', leaseToken: 'lease-1' }, checkout: { kind: 'MOCK_CHECKOUT' },
    cardMaterial: { ref: 'card-material' }, operationId: 'pay-page',
  });
  assert.equal(observedPage, page);
  assert.equal(result.status, 'UNKNOWN');
});

test('upgrade-dialog stop mode confirms Plus, opens the Pro upgrade dialog, records its facts and hands off before Pay now', async () => {
  const { executor, control, calls, adapter, verifier } = harness({ postPlusAction: 'UPGRADE_DIALOG_STOP' });
  const result = await executor.execute({
    control, run: { runId: 'run-upgrade', leaseToken: 'lease-upgrade' },
    checkout: { kind: 'MOCK_CHECKOUT' }, cardMaterial: { ref: 'card-material' },
    operationId: 'pay-upgrade',
  });
  assert.equal(result.status, 'MANUAL_20X_HANDOFF');
  assert.equal(result.paymentSubmitCalls, 1);
  assert.equal(result.preserveProfile, true);
  assert.equal(result.upgradeReason, null);
  assert.deepEqual([result.upgradeDialog.totalDueToday, result.upgradeDialog.paymentMethod, result.upgradeDialog.stoppedBefore],
    ['₱7,945.77', { brand: 'VISA', last4: '4242' }, 'PAY_NOW']);
  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(verifier.calls, ['plus', 'card-transactions', 'reconcile', 'upgrade-dialog']);
  const handoff = calls.find((value) => Array.isArray(value) && value[0] === 'manual-20x-handoff');
  assert.equal(handoff[1].publicResult.upgradeDialog.totalDueToday, '₱7,945.77');
  assert.equal(calls.filter((value) => Array.isArray(value) && value[0] === 'cancel-record').length, 0);
});

test('upgrade-dialog stop mode still hands off when the dialog cannot be opened, without any second payment', async () => {
  const { executor, control, calls, verifier } = harness({ postPlusAction: 'UPGRADE_DIALOG_STOP' });
  verifier.upgradeDialogOutcome = 'unavailable';
  const result = await executor.execute({
    control, run: { runId: 'run-upgrade-fail', leaseToken: 'lease-upgrade-fail' },
    checkout: { kind: 'MOCK_CHECKOUT' }, cardMaterial: { ref: 'card-material' },
    operationId: 'pay-upgrade-fail',
  });
  assert.equal(result.status, 'MANUAL_20X_HANDOFF');
  assert.equal(result.upgradeReason, 'SESSION_INVALID_AFTER_PAYMENT');
  assert.equal(result.paymentSubmitCalls, 1);
  const handoff = calls.find((value) => Array.isArray(value) && value[0] === 'manual-20x-handoff');
  assert.equal(handoff[1].publicResult.upgradeReason, 'SESSION_INVALID_AFTER_PAYMENT');
  assert.throws(() => harness({ postPlusAction: 'UPGRADE_PAY' }), /postPlusAction must be/);
});
