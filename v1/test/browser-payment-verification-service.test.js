import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserPaymentVerificationService } from '../src/services/browser-payment-verification-service.js';

function harness({ row = {}, observation = { outcome: 'UNKNOWN' } } = {}) {
  const calls = [];
  const repository = {
    async listPaymentVerificationsDue(input) { calls.push(['list', input]); return [{ runId: 'run-1', verificationCheckCount: 1, ...row }]; },
    async recordPaymentVerificationObservation(input) { calls.push(['observe', input]); },
    async markPaymentConfirmed(input) { calls.push(['confirmed', input]); },
    async recordPlusActivation(input) { calls.push(['plus', input]); },
    async recordCancellationConfirmed(input) { calls.push(['cancellation', input]); },
    async recordManual20xHandoff(input) { calls.push(['20x-handoff', input]); },
    async recordManual20xReviewRequired(input) { calls.push(['20x-review', input]); },
    async markPaymentDeclinedAfterVerification(input) { calls.push(['declined', input]); },
    async escalatePaymentVerification(input) { calls.push(['escalated', input]); },
  };
  return { repository, calls, verifier: { async verify() { return observation; } } };
}

test('verification coordinator keeps short unknown results read-only and schedules next check', async () => {
  const h = harness({ observation: { outcome: 'UNKNOWN', nextCheckAt: new Date('2026-09-06T00:00:05Z') } });
  const result = await createBrowserPaymentVerificationService({
    repository: h.repository, verifier: h.verifier,
    clock: () => new Date('2026-09-06T00:00:00Z'),
  }).runOnce();
  assert.equal(result.status, 'PROCESSED');
  assert.equal(h.calls[1][0], 'observe');
  assert.equal(h.calls[1][1].outcome, 'UNKNOWN');
});

test('an UNKNOWN check without its own nextCheckAt is rescheduled one interval later, never immediately', async () => {
  const h = harness({ observation: { outcome: 'UNKNOWN' } });
  await createBrowserPaymentVerificationService({
    repository: h.repository, verifier: h.verifier,
    clock: () => new Date('2026-09-06T00:00:00Z'), verificationIntervalMs: 7_000,
  }).runOnce();
  assert.equal(h.calls[1][0], 'observe');
  assert.equal(h.calls[1][1].outcome, 'UNKNOWN');
  assert.equal(h.calls[1][1].nextCheckAt.toISOString(), '2026-09-06T00:00:07.000Z');
  assert.throws(() => createBrowserPaymentVerificationService({
    repository: h.repository, verifier: h.verifier, verificationIntervalMs: 0,
  }), /verificationIntervalMs/);
});

test('verification coordinator confirms or declines without a second submit', async () => {
  for (const outcome of ['CONFIRMED', 'DECLINED']) {
    const h = harness({ row: { paymentState: 'PAYMENT_UNKNOWN' }, observation: { outcome } });
    await createBrowserPaymentVerificationService({ repository: h.repository, verifier: h.verifier }).runOnce();
    assert.equal(h.calls[1][0], outcome === 'CONFIRMED' ? 'confirmed' : 'declined');
  }
});

test('confirmed recovery completes Plus and cancellation without remarking an already confirmed payment', async () => {
  const h = harness({
    row: { paymentState: 'PAYMENT_CONFIRMED' },
    observation: { outcome: 'CONFIRMED', postPaymentComplete: true,
      evidence: { plus: { observed: true }, cancellation: { observed: true }, transactionHash: 'a'.repeat(64) } },
  });
  await createBrowserPaymentVerificationService({ repository: h.repository, verifier: h.verifier }).runOnce();
  assert.deepEqual(h.calls.map(([name]) => name), ['list', 'plus', 'cancellation']);
});

test('20X recovery confirms Plus and hands off without cancelling renewal', async () => {
  const h = harness({
    row: { paymentState: 'PAYMENT_CONFIRMED' },
    observation: { outcome: 'CONFIRMED', postPaymentComplete: true,
      manual20xState: 'HANDOFF', evidence: { plus: { observed: true }, transactionHash: 'a'.repeat(64) } },
  });
  await createBrowserPaymentVerificationService({
    repository: h.repository, verifier: h.verifier, postPlusAction: 'MANUAL_20X_HANDOFF',
  }).runOnce();
  assert.deepEqual(h.calls.map(([name]) => name), ['list', 'plus', '20x-handoff']);
  assert.equal(h.calls.some(([name]) => name === 'cancellation'), false);
});

test('20X recovery routes unmatched card evidence to review without cancelling renewal', async () => {
  const h = harness({
    row: { paymentState: 'PAYMENT_CONFIRMED' },
    observation: { outcome: 'CONFIRMED', postPaymentComplete: true,
      manual20xState: 'REVIEW_REQUIRED', evidence: { plus: { observed: true }, transactionCandidateCount: 0 } },
  });
  await createBrowserPaymentVerificationService({
    repository: h.repository, verifier: h.verifier, postPlusAction: 'MANUAL_20X_HANDOFF',
  }).runOnce();
  assert.deepEqual(h.calls.map(([name]) => name), ['list', 'plus', '20x-review']);
  assert.equal(h.calls.some(([name]) => name === 'cancellation'), false);
});

test('verification deadline or conflict escalates exactly one case', async () => {
  const h = harness({ row: { verificationDeadlineAt: new Date('2026-09-05T23:00:00Z') },
    observation: { outcome: 'UNKNOWN' } });
  await createBrowserPaymentVerificationService({ repository: h.repository,
    verifier: h.verifier, clock: () => new Date('2026-09-06T00:00:00Z') }).runOnce();
  assert.equal(h.calls[1][0], 'escalated');
});

test('verification coordinator constrains recovery to the explicitly approved order', async () => {
  const h = harness();
  await createBrowserPaymentVerificationService({
    repository: h.repository, verifier: h.verifier, approvedOrderId: 'order-approved',
  }).runOnce();
  assert.equal(h.calls[0][1].orderId, 'order-approved');
});

test('a plan-aware post-Plus action hands Pro rows off with the upgrade dialog facts and keeps Plus rows on renewal cancellation', async () => {
  const byPlan = (row) => (row.plan === 'plus' ? 'CANCEL_RENEWAL' : 'UPGRADE_DIALOG_STOP');
  const pro = harness({
    row: { paymentState: 'PAYMENT_CONFIRMED', plan: 'pro_20x' },
    observation: { outcome: 'CONFIRMED', postPaymentComplete: true, manual20xState: 'HANDOFF',
      publicResult: { upgradeDialog: { totalDueToday: '₱7,945.77', stoppedBefore: 'PAY_NOW' }, upgradeReason: null },
      evidence: { plus: { observed: true }, transactionHash: 'a'.repeat(64), upgradeDialog: { totalDueToday: '₱7,945.77' } } },
  });
  await createBrowserPaymentVerificationService({ repository: pro.repository, verifier: pro.verifier, postPlusAction: byPlan }).runOnce();
  assert.deepEqual(pro.calls.map(([name]) => name), ['list', 'plus', '20x-handoff']);
  assert.deepEqual(pro.calls[2][1].publicResult, { upgradeDialog: { totalDueToday: '₱7,945.77', stoppedBefore: 'PAY_NOW' }, upgradeReason: null });
  const plus = harness({
    row: { paymentState: 'PAYMENT_CONFIRMED', plan: 'plus' },
    observation: { outcome: 'CONFIRMED', postPaymentComplete: true,
      evidence: { plus: { observed: true }, cancellation: { observed: true }, transactionHash: 'a'.repeat(64) } },
  });
  await createBrowserPaymentVerificationService({ repository: plus.repository, verifier: plus.verifier, postPlusAction: byPlan }).runOnce();
  assert.deepEqual(plus.calls.map(([name]) => name), ['list', 'plus', 'cancellation']);
  assert.throws(() => createBrowserPaymentVerificationService({ repository: plus.repository, verifier: plus.verifier, postPlusAction: 'UPGRADE_PAY' }), /postPlusAction must be/);
});

