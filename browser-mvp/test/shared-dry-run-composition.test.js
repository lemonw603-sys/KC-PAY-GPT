import test from 'node:test';
import assert from 'node:assert/strict';

import { createSyntheticManifest } from '../src/fixtures.js';
import {
  createSharedNonPaymentDryRun,
  SHARED_NONPAYMENT_DRY_RUN_CONFIRMATION,
} from '../src/shared-dry-run-composition.js';

const pageContract = {
  urlPrefix: 'data:text/html,fixture',
  title: 'fixture',
  requiredSelector: 'main',
  markerText: 'fixture',
};

function inputs(pool) {
  return {
    pool,
    workerId: 'dry-run-worker',
    executorProfileId: 'dry-run-profile',
    runtimeAdapter: { open: async () => ({}), close: async () => {} },
    manifest: createSyntheticManifest(),
    observation: { pageContract },
    resolveAccountKey: async ({ orderId }) => `account:${orderId}`,
    runtimeHmacKey: Buffer.alloc(32, 1),
    artifactKey: Buffer.alloc(32, 2),
    resourceHmacKey: Buffer.alloc(32, 3),
  };
}

test('shared dry-run requires an exact invocation confirmation before database access', async () => {
  let queries = 0;
  const pool = {
    query: async () => { queries += 1; return [[{ setting_value: 'false' }], []]; },
    getConnection: async () => { throw new Error('must not claim'); },
  };
  const dryRun = createSharedNonPaymentDryRun(inputs(pool));
  await assert.rejects(() => dryRun.runOnce(), (error) => error.code === 'CONFIRMATION_REQUIRED');
  await assert.rejects(() => dryRun.runOnce({ confirmation: 'continue' }), (error) => error.code === 'CONFIRMATION_REQUIRED');
  assert.equal(queries, 0);
  assert.equal(SHARED_NONPAYMENT_DRY_RUN_CONFIRMATION, 'RUN SHARED BROWSER NONPAYMENT DRY RUN');
});

test('shared dry-run refuses to claim work unless Browser payment writes are false', async () => {
  let connections = 0;
  const pool = {
    query: async () => [[{ setting_value: 'true' }], []],
    getConnection: async () => { connections += 1; throw new Error('must not claim'); },
  };
  const dryRun = createSharedNonPaymentDryRun(inputs(pool));
  await assert.rejects(
    () => dryRun.runOnce({ confirmation: SHARED_NONPAYMENT_DRY_RUN_CONFIRMATION }),
    (error) => error.code === 'PAYMENT_WRITES_NOT_DISABLED',
  );
  assert.equal(connections, 0);
});

test('shared dry-run requires independent 32-byte runtime and recovery keys', () => {
  const pool = { query: async () => [[], []], getConnection: async () => ({}) };
  for (const key of ['runtimeHmacKey', 'artifactKey', 'resourceHmacKey']) {
    assert.throws(
      () => createSharedNonPaymentDryRun({ ...inputs(pool), [key]: Buffer.alloc(31) }),
      (error) => error.code === 'INVALID_KEY',
    );
  }
  assert.throws(
    () => createSharedNonPaymentDryRun({ ...inputs(pool), manifest: { ...createSyntheticManifest(), allowWrites: true } }),
    (error) => error.code === 'WRITE_CAPABLE_MANIFEST_REJECTED',
  );
  assert.throws(
    () => createSharedNonPaymentDryRun({ ...inputs(pool), resolveAccountKey: null }),
    /cross-order account isolation/,
  );
});
