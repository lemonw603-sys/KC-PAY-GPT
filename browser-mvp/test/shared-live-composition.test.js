import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryEvidenceSink } from '../src/evidence-sink.js';
import { createBitBrowserControlManifest } from '../src/fixtures.js';
import { createSharedLivePaymentWorker } from '../src/shared-live-composition.js';

const key = (byte) => Buffer.alloc(32, byte);
function input(overrides = {}) {
  let queries = 0;
  return {
    pool: { async query() { queries += 1; return [[], []]; }, async getConnection() { throw new Error('not used'); } },
    workerId: 'worker-live', executorProfileId: 'profile-live', approvedOrderId: 'order-live',
    runtimeAdapter: { async open() {}, async close() {} },
    manifest: createBitBrowserControlManifest(),
    observation: {
      pageContract: { urlPrefix: 'https://chatgpt.com/', title: 'ChatGPT', requiredSelector: 'body', markerText: '' },
      checkoutContract: { requiredCurrency: 'PHP', requireZeroTax: true, requireQuoteConsistency: true },
    },
    sessionProvider: { async open() {}, async bootstrap() {}, async close() {} },
    cardMaterialLeaseProvider: { async open() {}, async withMaterial() {}, async close() {} },
    resolveAccountKey: async () => 'account-live',
    resolveSessionIdentity: async () => ({ emailDigest: 'a'.repeat(64) }),
    resolveSessionRef: async () => 'browser-run:run-live',
    resolveCardMaterialRef: async () => 'browser-run:run-live',
    transactionReaderFactory: async () => ({ async read() { return []; }, async reconcile() { return { matched: false }; } }),
    runtimeHmacKey: key(1), artifactKey: key(2), resourceHmacKey: key(3),
    evidenceSink: new MemoryEvidenceSink(),
    queryCount: () => queries,
    ...overrides,
  };
}

test('LIVE composition is inert at construction and remains bound to one order', () => {
  const values = input();
  const worker = createSharedLivePaymentWorker(values);
  assert.equal(worker.approvedOrderId, 'order-live');
  assert.equal(values.queryCount(), 0);
});

test('LIVE composition rejects a Checkout contract that does not enforce final zero tax', () => {
  const values = input();
  assert.throws(() => createSharedLivePaymentWorker({
    ...values,
    observation: { ...values.observation, checkoutContract: {
      requiredCurrency: 'PHP', requireZeroTax: false, requireQuoteConsistency: true,
    } },
  }), /zero tax/);
});
