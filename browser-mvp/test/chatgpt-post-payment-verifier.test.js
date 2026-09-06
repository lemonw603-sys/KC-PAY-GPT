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
