import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BrowserPaymentExecutor,
  BrowserPaymentExecutorError,
  MockCheckoutPaymentAdapter,
  MockPostPaymentVerifier,
  loadPaymentExecutorConfig,
} from '../src/payment-executor.js';

function harness({ outcome = 'CONFIRMED', plusActive = true, cancellationConfirmed = true, enabled = true } = {}) {
  const calls = [];
  const integration = {
    workerId: 'worker-1',
    async issueAuthoritativePaymentPermit() { calls.push('permit'); return { permitId: 'permit-1', permitNonce: 'nonce-1' }; },
  };
  const executionRepository = {
    async commitPaymentSubmissionIntent(input) { calls.push(['intent', input]); return { executeExternal: true }; },
    async markPaymentUnknown(input) { calls.push(['unknown', input]); },
    async markPaymentConfirmed(input) { calls.push(['confirmed', input]); },
    async recordPlusActivation(input) { calls.push(['plus-record', input]); },
    async recordCancellationConfirmed(input) { calls.push(['cancel-record', input]); },
  };
  const control = { async assertLeaseBeforeAction(action) { calls.push(`lease:${action}`); } };
  const verifier = new MockPostPaymentVerifier({ plusActive, cancellationConfirmed });
  const adapter = new MockCheckoutPaymentAdapter({ outcome });
  const executor = new BrowserPaymentExecutor({
    integration, executionRepository, paymentAdapter: adapter, postPaymentVerifier: verifier, enabled,
  });
  return { executor, control, executionRepository, adapter, verifier, calls };
}

test('payment executor is disabled by default and LIVE mode requires every independent gate', () => {
  assert.equal(loadPaymentExecutorConfig({}).enabled, false);
  assert.equal(loadPaymentExecutorConfig({ BROWSER_PAYMENT_EXECUTOR_ENABLED: 'true' }).mode, 'MOCK');
  assert.throws(() => loadPaymentExecutorConfig({ BROWSER_PAYMENT_EXECUTOR_MODE: 'LIVE' }), (error) => error.code === 'LIVE_PAYMENT_GATES_NOT_CONFIRMED');
  const live = loadPaymentExecutorConfig({
    BROWSER_PAYMENT_EXECUTOR_MODE: 'LIVE',
    BROWSER_PAYMENT_EXECUTOR_ENABLED: 'true',
    BROWSER_PAYMENT_WRITES_ENABLED: 'true',
    BROWSER_LIVE_PAYMENT_CONFIRMATION: 'I-CONFIRM-LIVE-BROWSER-PAYMENT-ADAPTER',
  });
  assert.equal(live.enabled, true);
  assert.equal(live.mode, 'LIVE');
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
    'lease:PAYMENT_PREFLIGHT', 'lease:PAYMENT_PERMIT', 'lease:PAYMENT_SUBMIT', 'lease:PAYMENT_RESULT',
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
  executor.paymentAdapter = {
    async preflight() { const error = new Error('selector drift'); error.code = 'CHECKOUT_DRIFT'; throw error; },
    async submit() { throw new Error('must not submit'); },
  };
  const result = await executor.execute({
    control, run: { runId: 'run-1', leaseToken: 'lease-1' }, checkout: { kind: 'MOCK_CHECKOUT' },
    cardMaterial: { ref: 'card-material' }, operationId: 'pay-drift',
  });
  assert.deepEqual(result, { status: 'PRE_SUBMIT_FAILED', reasonCode: 'CHECKOUT_DRIFT', paymentSubmitCalls: 0 });
  assert.equal(calls.filter((value) => Array.isArray(value) && value[0] === 'unknown').length, 0);
});

test('insufficient balance proven before click is recoverable and does not mark payment UNKNOWN', async () => {
  const { executor, control, calls } = harness();
  executor.paymentAdapter = {
    async preflight() { const error = new Error('balance'); error.code = 'INSUFFICIENT_CARD_BALANCE'; throw error; },
    async submit() { throw new Error('must not submit'); },
  };
  const result = await executor.execute({
    control, run: { runId: 'run-1', leaseToken: 'lease-1' }, checkout: { kind: 'MOCK_CHECKOUT' },
    cardMaterial: { ref: 'card-material' }, operationId: 'pay-balance',
  });
  assert.deepEqual(result, { status: 'PRE_SUBMIT_FAILED', reasonCode: 'INSUFFICIENT_CARD_BALANCE', paymentSubmitCalls: 0 });
  assert.equal(calls.filter((value) => Array.isArray(value) && value[0] === 'unknown').length, 0);
});

test('a drift discovered after submit intent is consumed becomes UNKNOWN, never retryable', async () => {
  const { executor, control, calls } = harness();
  executor.paymentAdapter = {
    async preflight() { return { status: 'READY', submitCalls: 0 }; },
    async submit() { const error = new Error('late drift'); error.code = 'CHECKOUT_DRIFT'; throw error; },
  };
  const result = await executor.execute({
    control, run: { runId: 'run-1', leaseToken: 'lease-1' }, checkout: { kind: 'MOCK_CHECKOUT' },
    cardMaterial: { ref: 'card-material' }, operationId: 'pay-late-drift',
  });
  assert.deepEqual(result, { status: 'UNKNOWN', reasonCode: 'PAYMENT_RESULT_UNKNOWN', paymentSubmitCalls: 1 });
  assert.equal(calls.filter((value) => Array.isArray(value) && value[0] === 'unknown').length, 1);
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

test('payment preparation settles final total before permit and binds the same snapshot to submit intent', async () => {
  const calls = [];
  const prepared = { checkoutSnapshotHash: 'a'.repeat(64), opaque: true };
  const paymentAdapter = {
    async prepare() { calls.push('prepare'); return prepared; },
    async submitPrepared(input) {
      calls.push(['submit-prepared', input.prepared.checkoutSnapshotHash]);
      return { status: 'CONFIRMED', providerCallRef: 'browser:fixture' };
    },
    async cleanupPrepared(input) { calls.push(['cleanup', input.checkoutSnapshotHash]); },
    async submit() { throw new Error('unprepared submit must not be used'); },
  };
  const integration = {
    workerId: 'worker-1',
    async issueAuthoritativePaymentPermit(input) {
      calls.push(['permit', input.checkoutSnapshotHash]);
      return { permitNonce: 'nonce-1' };
    },
  };
  const repository = {
    async commitPaymentSubmissionIntent(input) {
      calls.push(['intent', input.checkoutSnapshotHash]);
      return { executeExternal: true };
    },
    async markPaymentConfirmed() { calls.push('confirmed'); },
    async recordPlusActivation() { calls.push('plus-record'); },
    async recordCancellationConfirmed() { calls.push('cancel-record'); },
  };
  const executor = new BrowserPaymentExecutor({
    integration,
    executionRepository: repository,
    paymentAdapter,
    postPaymentVerifier: new MockPostPaymentVerifier(),
    enabled: true,
  });
  const result = await executor.execute({
    control: { async assertLeaseBeforeAction(action) { calls.push(`lease:${action}`); } },
    run: { runId: 'run-1', leaseToken: 'lease-1' },
    page: { opaque: true }, checkout: { recognized: true }, cardMaterial: { opaque: true },
    operationId: 'pay-prepared',
  });
  assert.equal(result.status, 'COMPLETED');
  assert.ok(calls.indexOf('prepare') < calls.findIndex((entry) => Array.isArray(entry) && entry[0] === 'permit'));
  assert.deepEqual(calls.filter((entry) => Array.isArray(entry) && ['permit', 'intent'].includes(entry[0])), [
    ['permit', 'a'.repeat(64)],
    ['intent', 'a'.repeat(64)],
  ]);
  assert.deepEqual(calls.at(-1), ['cleanup', 'a'.repeat(64)]);
});
