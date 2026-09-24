import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';

import { ChatGptPostPaymentVerifier } from '../src/chatgpt-post-payment-verifier.js';
import { BrowserPaymentExecutor, MockCheckoutPaymentAdapter } from '../src/payment-executor.js';

const identity = { email: 'fixture@example.test', accountId: 'acct-fixture', userId: 'user-fixture' };

async function fixture({ willRenew = true, plan = 'chatgptplusplan' } = {}) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.route('https://chatgpt.com/', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<title>ChatGPT</title>',
  }));
  await page.route('**/api/auth/session', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      user: { email: identity.email, id: identity.userId }, account: { id: identity.accountId }, accessToken: 'fixture-token',
    }),
  }));
  let renew = willRenew;
  await page.route('**/backend-api/accounts/check/**', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ accounts: { default: {
      account: { account_id: identity.accountId },
      entitlement: { has_active_subscription: true, subscription_plan: plan },
      last_active_subscription: { will_renew: renew, purchase_origin_platform: 'stripe' },
    } } }),
  }));
  let cancelCalls = 0;
  await page.route('**/backend-api/subscriptions/cancel', async (route) => {
    cancelCalls += 1; renew = false; await route.fulfill({ status: 204, body: '' });
  });
  await page.goto('https://chatgpt.com/');
  const transactionReader = {
    async read() { return [{ id: 'txn-1', status: 'success' }]; },
    async reconcile({ transactions }) { return { matched: transactions.length === 1 }; },
  };
  return { browser, page, transactionReader, cancelCalls: () => cancelCalls };
}

test('real post-payment verifier proves Plus, cancels renewal, and confirms the changed state', async () => {
  const h = await fixture();
  try {
    const verifier = new ChatGptPostPaymentVerifier({
      page: h.page, expectedIdentity: identity, transactionReader: h.transactionReader,
      timeoutMs: 2_000, pollIntervalMs: 100,
    });
    assert.equal((await verifier.confirmPlus()).confirmed, true);
    assert.equal((await verifier.confirmCancellation()).confirmed, true);
    assert.equal(h.cancelCalls(), 1);
    assert.equal((await verifier.reconcile({ transactions: await verifier.readCardTransactions() })).matched, true);
  } finally { await h.browser.close(); }
});

test('real post-payment verifier does not call cancel when renewal is already off', async () => {
  const h = await fixture({ willRenew: false });
  try {
    const verifier = new ChatGptPostPaymentVerifier({
      page: h.page, expectedIdentity: identity, transactionReader: h.transactionReader,
      timeoutMs: 2_000, pollIntervalMs: 100,
    });
    const result = await verifier.confirmCancellation();
    assert.equal(result.confirmed, true);
    assert.equal(result.evidence.alreadyCancelled, true);
    assert.equal(h.cancelCalls(), 0);
  } finally { await h.browser.close(); }
});

test('verifier runs the session ladder once when the session endpoint stops answering, then confirms Plus', async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  let sessionHealthy = false;
  const recoveries = [];
  try {
    await page.route('https://chatgpt.com/', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>ChatGPT</title>' }));
    await page.route('**/api/auth/session', (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(sessionHealthy
        ? { user: { email: identity.email, id: identity.userId }, account: { id: identity.accountId }, accessToken: 'fixture-token' }
        : { error: 'RefreshAccessTokenError' }),
    }));
    await page.route('**/backend-api/accounts/check/**', (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ accounts: { default: {
        account: { account_id: identity.accountId },
        entitlement: { has_active_subscription: true, subscription_plan: 'chatgptplusplan' },
        last_active_subscription: { will_renew: true, purchase_origin_platform: 'stripe' },
      } } }),
    }));
    await page.goto('https://chatgpt.com/');
    const verifier = new ChatGptPostPaymentVerifier({
      page, expectedIdentity: identity,
      transactionReader: { async read() { return []; }, async reconcile() { return { matched: true }; } },
      timeoutMs: 3_000, pollIntervalMs: 100,
      sessionRecovery: async (_page, { reason }) => { recoveries.push(reason); sessionHealthy = true; return { recovered: true, recoveryStep: 'clear-login-cookies', steps: [{ step: 'probe', ok: false, status: 200, errorCode: 'RefreshAccessTokenError' }] }; },
    });
    assert.equal((await verifier.confirmPlus()).confirmed, true);
    assert.deepEqual(recoveries, ['session-invalid-before-verification']);
    assert.deepEqual(verifier.recoveryReport(), { recovered: true, recoveryStep: 'clear-login-cookies', errorCode: null,
      steps: [{ step: 'probe', ok: false, status: 200, errorCode: 'RefreshAccessTokenError', onLoginPage: false }] });
    assert.throws(() => new ChatGptPostPaymentVerifier({ page, expectedIdentity: identity, transactionReader: { read() {}, reconcile() {} }, upgradePlan: 'team' }), /upgradePlan/);
  } finally { await browser.close(); }
});

test('verifier opens the Pro upgrade dialog on a subscribed account and stops before Pay now', async () => {
  const html = `<title>ChatGPT</title>
    <button data-testid="accounts-profile-button" onclick="document.getElementById('menu').hidden=false">me</button>
    <div id="menu" hidden><div role="menuitem" onclick="document.getElementById('picker').hidden=false">Upgrade plan</div></div>
    <section role="dialog" id="picker" hidden>
      <button type="button" disabled>Your current plan</button>
      <button type="button" aria-pressed="true" onclick="document.body.dataset.tier='5x'">5x</button>
      <button type="button" aria-pressed="false" onclick="document.body.dataset.tier='20x'">20x</button>
      <button type="button" onclick="document.getElementById('confirm').hidden=false">Upgrade to Pro</button>
    </section>
    <section role="dialog" id="confirm" hidden>
      <h2>Confirm plan changes</h2><p>ChatGPT Pro subscription</p><p>₱8,919.64</p><p>Adjustment</p><p>-₱973.87</p>
      <p>Total due today</p><p>₱7,945.77</p><p>Payment method</p><p>VISA *5501</p>
      <button type="button">Cancel</button><button type="button" onclick="document.body.dataset.paid='yes'">Pay now</button>
    </section>`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    await page.route('https://chatgpt.com/', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html }));
    await page.route('**/api/auth/session', (route) => route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ user: { email: identity.email, id: identity.userId }, account: { id: identity.accountId }, accessToken: 'fixture-token' }) }));
    await page.goto('https://chatgpt.com/');
    const verifier = new ChatGptPostPaymentVerifier({
      page, expectedIdentity: identity, transactionReader: { async read() { return []; }, async reconcile() { return { matched: true }; } },
      timeoutMs: 3_000, pollIntervalMs: 100, upgradePlan: 'pro_20x', navigationTimeoutMs: 5_000,
    });
    const opened = await verifier.openUpgradeDialog();
    assert.equal(opened.ok, true);
    assert.equal(opened.plan, 'pro_20x');
    assert.deepEqual([opened.planChange.totalDueToday, opened.planChange.paymentMethod, opened.planChange.payButtonPresent], ['₱7,945.77', { brand: 'VISA', last4: '5501' }, true]);
    assert.ok(opened.actions.includes('tier-selected:20x'));
    assert.equal(await page.evaluate(() => document.body.dataset.paid), undefined);
  } finally { await browser.close(); }
});


test('one trusted snapshot confirms Plus with only two GETs; cancellation still reads back independently', async () => {
  const h = await fixture(); const requests=[];
  h.page.on('request', r => requests.push([r.method(),new URL(r.url()).pathname]));
  try {
    const v=new ChatGptPostPaymentVerifier({page:h.page,expectedIdentity:identity,transactionReader:h.transactionReader});
    assert.equal((await v.confirmPlus()).confirmed,true);
    assert.equal(requests.length,2);
    assert.equal((await v.confirmCancellation()).confirmed,true);
    assert.equal(requests.length,8);
    assert.equal(h.cancelCalls(),1);
    assert.equal(requests.at(-1)[1],'/backend-api/accounts/check/v4-2023-04-27');
  } finally {await h.browser.close()}
});


test('polling never turns another account becoming Plus into this order success',async()=>{
 const h=await fixture();let reads=0;
 try {
  await h.page.route('**/backend-api/accounts/check/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({accounts:{default:{
    account:{account_id:++reads===1?identity.accountId:'other-account'},
    entitlement:{has_active_subscription:reads>1,subscription_plan:'chatgptplusplan'},
    last_active_subscription:{will_renew:true,purchase_origin_platform:'stripe'},
  }}})}));
  const v=new ChatGptPostPaymentVerifier({page:h.page,expectedIdentity:identity,transactionReader:h.transactionReader,pollIntervalMs:100});
  await assert.rejects(()=>v.confirmPlus(),/account changed/);
  assert.equal(h.cancelCalls(),0);
 }finally{await h.browser.close()}
});

// 块 6（D-369/D-370）：5x 结账 plan_name=chatgptprolite；付款后账号上的套餐字符串还没真实观察过（等第一张 5x 客户单）。
test('block 6: a pro_5x order is confirmed only by a Pro plan, then cancels renewal like Plus', async () => {
  const h = await fixture({ plan: 'chatgptprolite' });
  try {
    const verifier = new ChatGptPostPaymentVerifier({
      page: h.page, expectedIdentity: identity, transactionReader: h.transactionReader,
      timeoutMs: 2_000, pollIntervalMs: 100, targetPlan: 'pro_5x',
    });
    const confirmed = await verifier.confirmPlus();
    assert.equal(confirmed.confirmed, true);
    assert.equal(confirmed.evidence.kind, 'PLUS_ACTIVE', 'downstream consumers key on this kind');
    assert.equal(confirmed.evidence.targetPlan, 'pro_5x');
    assert.equal((await verifier.confirmCancellation()).confirmed, true);
    assert.equal(h.cancelCalls(), 1);
  } finally { await h.browser.close(); }
});

test('block 6: plan mismatch is never a confirmation — Plus on a 5x order, Pro on a Plus order, and no cancel is sent', async () => {
  for (const [plan, targetPlan] of [['chatgptplusplan', 'pro_5x'], ['chatgptprolite', 'plus'], ['', 'pro_5x']]) {
    const h = await fixture({ plan });
    try {
      const verifier = new ChatGptPostPaymentVerifier({
        page: h.page, expectedIdentity: identity, transactionReader: h.transactionReader,
        timeoutMs: 1_000, pollIntervalMs: 100, targetPlan,
      });
      assert.equal((await verifier.confirmPlus()).confirmed, false, `${plan || '(empty)'} must not confirm ${targetPlan}`);
      assert.equal((await verifier.confirmCancellation()).confirmed, false);
      assert.equal(h.cancelCalls(), 0);
    } finally { await h.browser.close(); }
  }
  assert.throws(() => new ChatGptPostPaymentVerifier({ page: {}, expectedIdentity: identity, transactionReader: { read() {}, reconcile() {} }, targetPlan: 'team' }), /targetPlan/);
});

test('block 6: a 5x order whose account does not show Pro goes to post-payment review and is never paid again', async () => {
  const h = await fixture({ plan: 'chatgptplusplan' });
  try {
    const calls = [];
    const executionRepository = new Proxy({}, { get: (_t, name) => async (input) => {
      calls.push(String(name));
      return name === 'commitPaymentSubmissionIntent' ? { executeExternal: true } : input;
    } });
    const adapter = new MockCheckoutPaymentAdapter({ outcome: 'CONFIRMED' });
    const executor = new BrowserPaymentExecutor({
      integration: { workerId: 'worker-1', async issueAuthoritativePaymentPermit() { return { permitId: 'permit-1', permitNonce: 'nonce-1' }; } },
      executionRepository, paymentAdapter: adapter, enabled: true, postPlusAction: 'CANCEL_RENEWAL',
      postPaymentVerifier: new ChatGptPostPaymentVerifier({
        page: h.page, expectedIdentity: identity, transactionReader: h.transactionReader,
        timeoutMs: 1_000, pollIntervalMs: 100, targetPlan: 'pro_5x',
      }),
    });
    const result = await executor.execute({
      control: { async assertLeaseBeforeAction() {} }, run: { runId: 'run-5x', leaseToken: 'lease-5x' },
      checkout: { kind: 'MOCK_CHECKOUT' }, cardMaterial: { ref: 'card-material' }, operationId: 'pay-5x',
    });
    assert.equal(result.status, 'POST_PAYMENT_UNKNOWN');
    assert.equal(result.reasonCode, 'PLUS_ACTIVATION_UNCONFIRMED');
    assert.equal(adapter.calls.length, 1, 'exactly one payment submit');
    assert.equal(h.cancelCalls(), 0);
    assert.ok(calls.includes('schedulePostPaymentVerification'));
    assert.ok(!calls.includes('markPaymentUnknown') && !calls.includes('recordCancellationConfirmed'));
  } finally { await h.browser.close(); }
});
