import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryEvidenceSink } from '../src/evidence-sink.js';
import { createBitBrowserControlManifest } from '../src/fixtures.js';
import { createSharedLivePaymentWorker, runPreSubmitRehearsal } from '../src/shared-live-composition.js';

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

test('LIVE composition accepts a rehearsal but never together with a manual 20X handoff', () => {
  const values = input();
  assert.equal(createSharedLivePaymentWorker({ ...values, stopBeforeSubmit: true }).stopBeforeSubmit, true);
  assert.equal(createSharedLivePaymentWorker(values).stopBeforeSubmit, false);
  assert.throws(() => createSharedLivePaymentWorker({ ...values, stopBeforeSubmit: true, postPlusAction: 'MANUAL_20X_HANDOFF' }), /rehearsal cannot carry/);
  assert.equal(values.queryCount(), 0);
});

test('pre-submit rehearsal drives the adapter without authorization and reports the strict quote', async () => {
  const seen = [];
  const control = { assertLeaseBeforeAction: async (action) => { seen.push(action); } };
  const adapter = {
    async submit({ authorizeSubmit, beforeSubmit, assertContinue, operationId }) {
      await assertContinue();
      await beforeSubmit({ checkout: { currency: 'PHP', amount: '982.14' } });
      const intent = await authorizeSubmit();
      assert.equal(intent.executeExternal, false, 'a rehearsal never authorizes the click');
      seen.push(`op:${operationId}`);
      return { status: 'RECONCILE_ONLY', quote: { currency: 'PHP', amount: '982.14', estimatedTax: '0.00' } };
    },
  };
  const result = await runPreSubmitRehearsal({ adapter, control, page: {}, checkout: {}, checkoutContract: {}, cardMaterial: {}, billingEmail: 'x@example.test', operationId: 'browser-live-rehearsal:run-1' });
  assert.deepEqual(result, {
    status: 'PRE_SUBMIT_STOPPED', reasonCode: 'STOP_BEFORE_SUBMIT', paymentSubmitCalls: 0,
    quote: { currency: 'PHP', amount: '982.14', estimatedTax: '0.00' }, preserveProfile: true,
  });
  assert.deepEqual(seen, ['PAYMENT_PAGE_ACTION', 'FINAL_PRE_SUBMIT_RECHECK', 'op:browser-live-rehearsal:run-1']);

  // Pre-click failures stay safe pre-submit failures; an adapter that claims it
  // clicked is a contract violation and must not be softened.
  const drift = await runPreSubmitRehearsal({ adapter: { async submit() { throw Object.assign(new Error('drift'), { code: 'CHECKOUT_DRIFT' }); } }, control, operationId: 'op-2' });
  assert.deepEqual(drift, { status: 'PRE_SUBMIT_FAILED', reasonCode: 'CHECKOUT_DRIFT', paymentSubmitCalls: 0 });
  const clicked = await runPreSubmitRehearsal({ adapter: { async submit() { return { status: 'CONFIRMED' }; } }, control, operationId: 'op-3' });
  assert.deepEqual(clicked, { status: 'PRE_SUBMIT_FAILED', reasonCode: 'REHEARSAL_RESULT_INVALID', paymentSubmitCalls: 0 });
  await assert.rejects(() => runPreSubmitRehearsal({ adapter: { async submit() { throw Object.assign(new Error('unknown'), { code: 'PAYMENT_RESULT_UNKNOWN' }); } }, control, operationId: 'op-4' }), (e) => e.code === 'PAYMENT_RESULT_UNKNOWN');
});

test('LIVE composition accepts a plan-aware post-Plus action, even on a rehearsal, and the upgrade-dialog stop', () => {
  const values = input();
  const byPlan = (plan) => (plan === 'plus' ? 'CANCEL_RENEWAL' : 'UPGRADE_DIALOG_STOP');
  assert.equal(createSharedLivePaymentWorker({ ...values, stopBeforeSubmit: true, postPlusAction: byPlan }).stopBeforeSubmit, true);
  assert.equal(createSharedLivePaymentWorker({ ...values, postPlusAction: 'UPGRADE_DIALOG_STOP' }).stopBeforeSubmit, false);
  assert.throws(() => createSharedLivePaymentWorker({ ...values, postPlusAction: 'UPGRADE_PAY' }), /postPlusAction must be/);
  assert.equal(values.queryCount(), 0);
});
