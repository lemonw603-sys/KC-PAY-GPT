import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BrowserRecoveryError,
  createBrowserRecoveryRepository
} from '../src/db/repositories/browser-recovery-repository.js';

function repository(pool = { getConnection: async () => { throw new Error('database should not be reached'); } }) {
  return createBrowserRecoveryRepository(pool, {
    artifactKeys: new Map([[1, Buffer.alloc(32, 1)]]),
    currentArtifactKeyVersion: 1,
    resourceHmacKey: Buffer.alloc(32, 2)
  });
}

test('recovery repository requires explicit independent 32-byte keys and an available version', () => {
  assert.throws(
    () => createBrowserRecoveryRepository({}, {
      artifactKeys: new Map([[1, Buffer.alloc(31)]]),
      currentArtifactKeyVersion: 1,
      resourceHmacKey: Buffer.alloc(32)
    }),
    (error) => error instanceof BrowserRecoveryError && error.code === 'INVALID_KEY'
  );
  assert.throws(
    () => createBrowserRecoveryRepository({}, {
      artifactKeys: new Map([[1, Buffer.alloc(32)]]),
      currentArtifactKeyVersion: 2,
      resourceHmacKey: Buffer.alloc(32)
    }),
    (error) => error.code === 'INVALID_KEY'
  );
});

test('unapproved, credential-bearing and incomplete Checkout authorities fail before MySQL access', async () => {
  for (const navigationUrl of [
    'https://pay.openai.com.evil.test/c/pay/cs_live_abc#fid',
    'https://user:pass@pay.openai.com/c/pay/cs_live_abc#fid',
    'https://pay.openai.com/c/pay/cs_live_abc',
    'https://chatgpt.com/checkout/not-a-checkout-id'
  ]) {
    await assert.rejects(
      repository().storeCheckoutArtifact({
        runId: 'run-1', ownerId: 'worker-1', leaseToken: 'lease-1', navigationUrl
      }),
      (error) => error.code === 'INVALID_CHECKOUT_ARTIFACT'
    );
  }
});

test('artifact destruction requires a deterministic allowlisted reason before MySQL access', async () => {
  await assert.rejects(
    repository().destroyCheckoutArtifact({
      runId: 'run-1', artifactId: 'artifact-1', ownerId: 'worker-1',
      leaseToken: 'lease-1', reasonCode: 'IT_LOOKS_OLD'
    }),
    (error) => error.code === 'INVALID_DESTROY_REASON'
  );
});
