import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright';

import { ChatGptPostPaymentVerifier } from '../src/chatgpt-post-payment-verifier.js';

const identity = { email: 'fixture@example.test', accountId: 'acct-fixture', userId: 'user-fixture' };

async function fixture({ willRenew = true } = {}) {
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
      entitlement: { has_active_subscription: true, subscription_plan: 'chatgptplusplan' },
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
