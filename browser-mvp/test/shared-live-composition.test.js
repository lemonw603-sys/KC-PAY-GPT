import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryEvidenceSink } from '../src/evidence-sink.js';
import { createBitBrowserControlManifest } from '../src/fixtures.js';
import { awaitOperatorTakeover, checkoutPlanForAction, createSharedLivePaymentWorker, runPreSubmitRehearsal } from '../src/shared-live-composition.js';

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
  // D-212 续：演练失败也带上诊断（沿 cause 链拼的文字），落 pre-submit-failure-diagnostic 证据。
  assert.deepEqual(drift, { status: 'PRE_SUBMIT_FAILED', reasonCode: 'CHECKOUT_DRIFT', paymentSubmitCalls: 0, diagnostic: 'drift' });
  const clicked = await runPreSubmitRehearsal({ adapter: { async submit() { return { status: 'CONFIRMED' }; } }, control, operationId: 'op-3' });
  assert.deepEqual(clicked, { status: 'PRE_SUBMIT_FAILED', reasonCode: 'REHEARSAL_RESULT_INVALID', paymentSubmitCalls: 0, diagnostic: 'rehearsal adapter returned an unexpected status' });
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

// D-210：付款前失败但现场留在屏幕上时，不能当场判失败——客户页一进终态就停止轮询，
// 并显示「没有完成，卡密可以直接重新兑换」；运营正要接手的那几分钟里，客户照那句话
// 做就是两张卡付两次钱。
test('D-210: takeover watch stops as soon as the account turns paid', async () => {
  let calls = 0;
  const notified = [];
  const result = await awaitOperatorTakeover({
    verifier: { confirmPlus: async () => ({ confirmed: ++calls >= 3 }) },
    control: { assertLeaseBeforeAction: async () => undefined },
    notify: async (info) => { notified.push(info); },
    windowMs: 60_000, pollIntervalMs: 10,
    sleep: async () => undefined,
  });
  assert.equal(result.takenOver, true);
  assert.equal(result.reason, 'PLUS_OBSERVED');
  assert.equal(calls, 3);
  assert.equal(notified.length, 1, '进入等待时必须通知运营一次，否则他不知道有单在等');
});

test('D-210: the window expires instead of waiting forever', async () => {
  let now = 0;
  const result = await awaitOperatorTakeover({
    verifier: { confirmPlus: async () => ({ confirmed: false }) },
    windowMs: 1_000, pollIntervalMs: 100,
    clock: () => now,
    sleep: async (ms) => { now += ms; },
  });
  assert.equal(result.takenOver, false);
  assert.equal(result.reason, 'WINDOW_EXPIRED');
});

// 租约丢了说明这一单可能已被别的 worker 接管，必须立刻退出，不能继续占着。
test('D-210: a lost lease ends the watch immediately', async () => {
  const result = await awaitOperatorTakeover({
    verifier: { confirmPlus: async () => ({ confirmed: true }) },
    control: { assertLeaseBeforeAction: async () => { throw new Error('lease lost'); } },
    windowMs: 60_000, pollIntervalMs: 10, sleep: async () => undefined,
  });
  assert.equal(result.takenOver, false);
  assert.equal(result.reason, 'LEASE_LOST');
});

// D-213：这条 lane 是串行的，等待期间后面的客户全在排队。而那时候本来也留不住现场
// （下一单 startFresh 会关掉这个 checkout 页），所以"有人排队还硬等"是纯亏。
test('D-213: the wait yields the lane as soon as someone is queued', async () => {
  let probes = 0;
  const result = await awaitOperatorTakeover({
    verifier: { confirmPlus: async () => ({ confirmed: false }) },
    queueDepth: async () => { probes += 1; return probes >= 2 ? 1 : 0; },
    windowMs: 60_000, pollIntervalMs: 10, sleep: async () => undefined,
  });
  assert.equal(result.takenOver, false);
  assert.equal(result.reason, 'QUEUE_WAITING');
  assert.equal(result.waiting, 1);
  assert.equal(probes, 2, '每轮都要问一次队列，不能只在开头问');
});

// 队列空就该等满窗口——这正是"保留现场"存在的意义。
test('D-213: an empty queue still gets the full window', async () => {
  let now = 0;
  const result = await awaitOperatorTakeover({
    verifier: { confirmPlus: async () => ({ confirmed: false }) },
    queueDepth: async () => 0,
    windowMs: 1_000, pollIntervalMs: 100,
    clock: () => now, sleep: async (ms) => { now += ms; },
  });
  assert.equal(result.reason, 'WINDOW_EXPIRED');
});

// 队列查询自己挂了不能连累这一单：查不到就当没人排队，继续等。
test('D-213: a failing queue probe does not abort the wait', async () => {
  let now = 0;
  const result = await awaitOperatorTakeover({
    verifier: { confirmPlus: async () => ({ confirmed: false }) },
    queueDepth: async () => { throw new Error('db down'); },
    windowMs: 1_000, pollIntervalMs: 100,
    clock: () => now, sleep: async (ms) => { now += ms; },
  });
  assert.equal(result.reason, 'WINDOW_EXPIRED');
});

test('block 6: Checkout buys the order plan when one payment completes the order; legacy two-stage callers still buy Plus first', () => {
  assert.equal(checkoutPlanForAction('pro_5x', 'CANCEL_RENEWAL'), 'pro_5x');
  assert.equal(checkoutPlanForAction('plus', 'CANCEL_RENEWAL'), 'plus');
  assert.equal(checkoutPlanForAction(undefined, 'CANCEL_RENEWAL'), 'plus');
  assert.equal(checkoutPlanForAction('pro_5x', 'UPGRADE_DIALOG_STOP'), 'plus');
  assert.equal(checkoutPlanForAction('pro_20x', 'MANUAL_20X_HANDOFF'), 'plus');
});
