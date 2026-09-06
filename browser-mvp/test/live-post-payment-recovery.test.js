import assert from 'node:assert/strict';
import test from 'node:test';

import { LivePostPaymentRecoveryVerifier } from '../src/live-post-payment-recovery.js';

function harness({ plus = true, cancelled = true, matched = true } = {}) {
  const calls = [];
  const page = { async goto(url) { calls.push(['goto', url]); } };
  const runtime = { context: { async newPage() { return page; } } };
  const verifier = new LivePostPaymentRecoveryVerifier({
    runtimeAdapter: {
      async open() { calls.push('open'); return runtime; },
      async close() { calls.push('close'); },
    },
    manifest: { allowWrites: false },
    sessionProvider: {
      async open(ref) { calls.push(['session-open', ref]); return { leaseId: 'lease' }; },
      async bootstrap() { calls.push('bootstrap'); },
      async close() { calls.push('session-close'); },
    },
    resolveSessionIdentity: async () => ({ emailDigest: 'a'.repeat(64) }),
    transactionReaderFactory: async () => ({ async read() { return []; }, async reconcile() { return { matched }; } }),
    navigationTimeoutMs: 1_000, verificationWindowMs: 1_000, verificationIntervalMs: 100,
  });
  verifier.createPostPaymentVerifier = null;
  return { verifier, calls, plus, cancelled };
}

test('post-payment recovery never owns a submit adapter and always closes Session/runtime on failure', async () => {
  const h = harness();
  h.verifier.resolveSessionIdentity = async () => { throw new Error('fixture read failed'); };
  await assert.rejects(() => h.verifier.verify({ runId: 'run-1', executorProfileId: 'profile-1' }));
  assert.equal(h.calls.includes('session-close'), true);
  assert.equal(h.calls.at(-1), 'close');
  assert.equal(h.calls.some((item) => String(item).includes('submit')), false);
});
