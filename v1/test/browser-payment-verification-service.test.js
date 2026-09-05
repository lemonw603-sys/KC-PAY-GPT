import test from 'node:test';
import assert from 'node:assert/strict';
import { createBrowserPaymentVerificationService } from '../src/services/browser-payment-verification-service.js';

function harness({ row = {}, observation = { outcome: 'UNKNOWN' } } = {}) {
  const calls = [];
  const repository = {
    async listPaymentVerificationsDue() { return [{ runId: 'run-1', verificationCheckCount: 1, ...row }]; },
    async recordPaymentVerificationObservation(input) { calls.push(['observe', input]); },
    async markPaymentConfirmed(input) { calls.push(['confirmed', input]); },
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
  assert.equal(h.calls[0][0], 'observe');
  assert.equal(h.calls[0][1].outcome, 'UNKNOWN');
});

test('verification coordinator confirms or declines without a second submit', async () => {
  for (const outcome of ['CONFIRMED', 'DECLINED']) {
    const h = harness({ observation: { outcome } });
    await createBrowserPaymentVerificationService({ repository: h.repository, verifier: h.verifier }).runOnce();
    assert.equal(h.calls[0][0], outcome === 'CONFIRMED' ? 'confirmed' : 'declined');
  }
});

test('verification deadline or conflict escalates exactly one case', async () => {
  const h = harness({ row: { verificationDeadlineAt: new Date('2026-09-05T23:00:00Z') },
    observation: { outcome: 'UNKNOWN' } });
  await createBrowserPaymentVerificationService({ repository: h.repository,
    verifier: h.verifier, clock: () => new Date('2026-09-06T00:00:00Z') }).runOnce();
  assert.equal(h.calls[0][0], 'escalated');
});
