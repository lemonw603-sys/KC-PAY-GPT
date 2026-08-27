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

test('payment executor is disabled by default and rejects live adapter mode', () => {
  assert.equal(loadPaymentExecutorConfig({}).enabled, false);
  assert.equal(loadPaymentExecutorConfig({ BROWSER_PAYMENT_EXECUTOR_ENABLED: 'true' }).mode, 'MOCK');
  assert.throws(() => loadPaymentExecutorConfig({ BROWSER_PAYMENT_EXECUTOR_MODE: 'LIVE' }), (error) => error.code === 'LIVE_PAYMENT_ADAPTER_UNAVAILABLE');
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
    'lease:PAYMENT_PERMIT', 'lease:PAYMENT_SUBMIT', 'lease:PAYMENT_RESULT',
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
  assert.equal(result.status, 'UNKNOWN');
  assert.equal(adapter.calls.length, 0);
});
