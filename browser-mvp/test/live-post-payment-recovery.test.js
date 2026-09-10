import assert from 'node:assert/strict';
import test from 'node:test';

import { LivePostPaymentRecoveryVerifier } from '../src/live-post-payment-recovery.js';

function harness({ plus = true, cancelled = true, matched = true,
  postPlusAction = 'CANCEL_RENEWAL' } = {}) {
  const calls = [];
  const page = {
    closed: false,
    async goto(url) { calls.push(['goto', url]); },
    async close() { this.closed = true; calls.push('page-close'); },
    isClosed() { return this.closed; },
  };
  const runtime = { context: { async newPage() { calls.push('new-page'); return page; } } };
  const verifier = new LivePostPaymentRecoveryVerifier({
    runtimeAdapter: {
      async open() { calls.push('open'); return runtime; },
      async close() { calls.push('close'); },
      async detach() { calls.push('detach'); },
    },
    manifest: { allowWrites: false },
    sessionProvider: {
      async open(ref) { calls.push(['session-open', ref]); return { leaseId: 'lease' }; },
      async bootstrap() { calls.push('bootstrap'); },
      async close() { calls.push('session-close'); },
    },
    resolveSessionIdentity: async () => ({ emailDigest: 'a'.repeat(64) }),
    transactionReaderFactory: async () => ({ async read() { return []; }, async reconcile() { return { matched }; } }),
    verifierFactory: () => ({
      async confirmPlus() { calls.push('plus'); return { confirmed: plus, evidence: { plus } }; },
      async confirmCancellation() { calls.push('cancellation'); return { confirmed: cancelled, evidence: { cancelled } }; },
      async readCardTransactions() { calls.push('transactions'); return [{ id: 'tx-1' }]; },
      async reconcile() { calls.push('reconcile'); return { matched, transactionHash: 'a'.repeat(64) }; },
    }),
    navigationTimeoutMs: 1_000, verificationWindowMs: 1_000, verificationIntervalMs: 100,
    postPlusAction,
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

test('manual 20X recovery verifies Plus and card evidence, never cancels, and detaches Profile', async () => {
  const h = harness({ postPlusAction: 'MANUAL_20X_HANDOFF' });
  const result = await h.verifier.verify({ runId: 'run-20x', executorProfileId: 'profile-20x' });
  assert.equal(result.outcome, 'CONFIRMED');
  assert.equal(result.manual20xState, 'HANDOFF');
  assert.equal(h.calls.includes('cancellation'), false);
  assert.equal(h.calls.at(-1), 'detach');
  assert.equal(h.calls.includes('close'), false);
});

test('manual 20X recovery preserves Profile and requests review when card evidence is unmatched', async () => {
  const h = harness({ postPlusAction: 'MANUAL_20X_HANDOFF', matched: false });
  const result = await h.verifier.verify({ runId: 'run-20x-review', executorProfileId: 'profile-20x' });
  assert.equal(result.outcome, 'CONFIRMED');
  assert.equal(result.manual20xState, 'REVIEW_REQUIRED');
  assert.equal(result.reasonCode, 'MANUAL_20X_RECONCILIATION_REQUIRED');
  assert.equal(h.calls.includes('cancellation'), false);
  assert.equal(h.calls.at(-1), 'detach');
});

test('a plan-aware action stops Pro orders on the upgrade dialog and keeps Plus orders on renewal cancellation', async () => {
  const factoryInputs = [];
  const build = (row) => {
    const h = harness({ postPlusAction: (plan) => (plan === 'plus' ? 'CANCEL_RENEWAL' : 'UPGRADE_DIALOG_STOP') });
    const factory = h.verifier.verifierFactory;
    h.verifier.verifierFactory = (input) => {
      factoryInputs.push({ upgradePlan: input.upgradePlan, hasRecovery: typeof input.sessionRecovery === 'function' });
      const verifier = factory(input);
      verifier.openUpgradeDialog = async () => { h.calls.push('upgrade-dialog'); return { ok: true, plan: 'pro_20x', actions: ['upgrade-requested'],
        planChange: { totalDueToday: '₱7,945.77', paymentMethod: { brand: 'VISA', last4: '5501' } }, recovery: null }; };
      return verifier;
    };
    return h;
  };
  const pro = build();
  const proResult = await pro.verifier.verify({ runId: 'run-pro', executorProfileId: 'profile', plan: 'pro_20x' });
  assert.equal(proResult.manual20xState, 'HANDOFF');
  assert.deepEqual([proResult.publicResult.upgradeDialog.totalDueToday, proResult.publicResult.upgradeDialog.stoppedBefore, proResult.publicResult.upgradeReason], ['₱7,945.77', 'PAY_NOW', null]);
  assert.equal(pro.calls.includes('cancellation'), false);
  assert.equal(pro.calls.at(-1), 'detach');
  const plus = build();
  const plusResult = await plus.verifier.verify({ runId: 'run-plus', executorProfileId: 'profile', plan: 'plus' });
  assert.equal(plusResult.postPaymentComplete, true);
  assert.equal(plus.calls.includes('cancellation'), true);
  assert.equal(plus.calls.includes('upgrade-dialog'), false);
  assert.deepEqual(factoryInputs, [{ upgradePlan: 'pro_20x', hasRecovery: true }, { upgradePlan: null, hasRecovery: true }]);
});

// F-24: every check used to leave one more chatgpt.com tab in the resident window,
// and the executor refuses a window with more than one matching page. A finished
// check closes its own page before detaching; a 20X hand-off keeps the page for
// the person. F-18: the verification lane no longer re-injects the order's
// pre-payment token (only one Session lease is ever opened per check).
test('a verification check closes the page it opened unless it hands the Profile to a person, and never re-injects the order Session', async () => {
  const plus = harness({ postPlusAction: 'CANCEL_RENEWAL' });
  await plus.verifier.verify({ runId: 'run-close', executorProfileId: 'profile' });
  assert.equal(plus.calls.filter((item) => item === 'new-page').length, 1);
  assert.equal(plus.calls.includes('page-close'), true);
  assert.ok(plus.calls.indexOf('page-close') < plus.calls.indexOf('close'), 'page closes while CDP is still attached');
  assert.equal(plus.calls.filter((item) => Array.isArray(item) && item[0] === 'session-open').length, 1);

  const unknown = harness({ plus: false });
  const result = await unknown.verifier.verify({ runId: 'run-unknown', executorProfileId: 'profile' });
  assert.equal(result.outcome, 'UNKNOWN');
  assert.equal(unknown.calls.includes('page-close'), true);

  const handoff = harness({ postPlusAction: 'MANUAL_20X_HANDOFF' });
  await handoff.verifier.verify({ runId: 'run-handoff', executorProfileId: 'profile' });
  assert.equal(handoff.calls.includes('page-close'), false);
  assert.equal(handoff.calls.at(-1), 'detach');

  const failed = harness();
  failed.verifier.resolveSessionIdentity = async () => { throw new Error('fixture read failed'); };
  await assert.rejects(() => failed.verifier.verify({ runId: 'run-fail', executorProfileId: 'profile' }));
  assert.equal(failed.calls.includes('page-close'), true);
});
