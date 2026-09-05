import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { assertSafeObject, ContractError } from '../src/contracts.js';
import { CHATGPT_PLUS_CHECKOUT_CONTRACT, observeCheckout } from '../src/checkout-observer.js';
import { probeSessionIdentity } from '../src/session-identity-probe.js';

test('session identity probe verifies the real session endpoint without returning raw session data', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/api/auth/session') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        user: { id: 'user-001', email: 'buyer@example.test' },
        account: { id: 'acct-001' },
        accessToken: 'fixture-access-token-must-not-leave-page',
      }));
      return;
    }
    if (request.url === '/backend-api/accounts/check/v4-fixture') {
      assert.equal(request.headers.authorization, 'Bearer fixture-access-token-must-not-leave-page');
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({
        accounts: { default: { entitlement: {
          has_active_subscription: false,
          subscription_plan: 'chatgptplusplan',
        } } },
      }));
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end('<title>ChatGPT fixture</title><main>logged in</main>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' });
    const result = await probeSessionIdentity(page, {
      email: 'buyer@example.test', accountId: 'acct-001', userId: 'user-001',
    }, { accountCheckPath: '/backend-api/accounts/check/v4-fixture' });
    assert.equal(result.verified, true);
    assert.equal(result.loggedIn, true);
    assert.equal(result.identityMatched, true);
    assert.equal(result.subscriptionStatus, 'FREE');
    assert.equal(result.alreadyPlus, false);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.observedEmailDigest.length, 64);
    assert.equal(JSON.stringify(result).includes('fixture-access-token'), false);
    await assert.rejects(() => probeSessionIdentity(page, { email: 'other@example.test' }), ContractError);
    await assert.rejects(
      () => probeSessionIdentity(page, { email: 'buyer@example.test', accountId: 'acct-other' }),
      /session identity mismatch/,
    );
  } finally {
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});

test('Session endpoint failures expose only bounded diagnostic metadata', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(401, { 'content-type': 'application/json', server: 'fixture-auth' });
    response.end(JSON.stringify({ error: 'unauthorized' }));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await assert.rejects(
      () => probeSessionIdentity(page, { email: 'buyer@example.test' }),
      (error) => error.code === 'SESSION_INVALID'
        && error.details?.stage === 'session-endpoint'
        && error.details?.httpStatus === 401
        && !JSON.stringify(error).includes('unauthorized'),
    );
  } finally { await browser.close(); server.close(); await once(server, 'close'); }
});

test('subscription probe classifies active Plus without returning account-check material', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.url === '/api/auth/session') {
      response.end(JSON.stringify({
        user: { email: 'plus@example.test' },
        accessToken: 'plus-access-token',
      }));
      return;
    }
    response.end(JSON.stringify({
      accounts: { default: { entitlement: { has_active_subscription: true, subscription_plan: 'chatgptplusplan' } } },
    }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'domcontentloaded' });
    const result = await probeSessionIdentity(page, { email: 'plus@example.test' }, {
      accountCheckPath: '/backend-api/accounts/check/v4-fixture',
    });
    assert.equal(result.subscriptionStatus, 'PLUS');
    assert.equal(result.alreadyPlus, true);
    assert.equal(JSON.stringify(result).includes('plus-access-token'), false);
  } finally {
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});

test('subscription schema drift is not misclassified as a customer Session replacement', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    if (request.url === '/api/auth/session') {
      response.end(JSON.stringify({
        user: { email: 'buyer@example.test' }, accessToken: 'fixture-access-token',
      }));
      return;
    }
    response.end(JSON.stringify({ accounts: { default: { entitlement: {} } } }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await assert.rejects(
      () => probeSessionIdentity(page, { email: 'buyer@example.test' }, {
        accountCheckPath: '/backend-api/accounts/check/v4-fixture',
      }),
      (error) => error.code === 'ACCOUNT_STATUS_UNKNOWN',
    );
  } finally {
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});

test('Cloudflare access blocking is not misclassified as an invalid customer Session', async () => {
  const server = createServer((request, response) => {
    response.writeHead(403, {
      'content-type': 'text/html; charset=UTF-8',
      server: 'cloudflare',
      'cf-ray': 'fixture-ray',
    });
    response.end('<!doctype html><title>Just a moment</title><main>challenge</main>');
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await assert.rejects(
      () => probeSessionIdentity(page, { email: 'buyer@example.test' }),
      (error) => error.code === 'CHATGPT_ACCESS_BLOCKED',
    );
  } finally {
    await browser.close();
    server.close();
    await once(server, 'close');
  }
});

test('checkout observer extracts plan, currency and amount without submitting payment', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const url = 'data:text/html,<title>Checkout</title><main data-checkout-plan>Plus</main><span data-checkout-currency>PHP</span><span data-checkout-amount>999</span><form data-payment-form></form>';
    await page.goto(url);
    const result = await observeCheckout(page, {
      urlPrefix: 'data:text/html,',
    });
    assert.equal(result.currency, 'PHP');
    assert.equal(result.amount, '999');
    assert.equal(result.paymentFormPresent, true);
    assert.equal(result.submitCalls, 0);
  } finally {
    await browser.close();
  }
});

test('checkout observer matches the live ChatGPT Plus checkout shape without touching card fields', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <div data-testid="checkout-page-content">
        <form data-testid="checkout-form"><iframe srcdoc='
          <input name="number" autocomplete="cc-number">
          <input name="expiry" autocomplete="cc-exp">
          <input name="cvc" autocomplete="cc-csc">
        '></iframe></form>
        <section data-testid="checkout-summary-column">
          <h2>Plus 套餐</h2>
          <div><span>预估税费</span><span>US$0.00</span></div>
          <div><span>今日应付金额</span><span>US$20.00</span></div>
          <button type="submit" aria-label="订阅">订阅</button>
        </section>
      </div>
    `);
    const result = await observeCheckout(page, {
      ...CHATGPT_PLUS_CHECKOUT_CONTRACT,
      urlPrefix: 'about:blank',
    });
    assert.equal(result.currency, 'USD');
    assert.equal(result.amount, '20.00');
    assert.equal(result.estimatedTax, '0.00');
    assert.equal(result.paymentFormPresent, true);
    assert.equal(result.submitControlPresent, true);
    assert.equal(result.submitControlEnabled, true);
    assert.deepEqual(result.cardFieldsPresent, { number: true, expiry: true, securityCode: true });
    assert.doesNotThrow(() => assertSafeObject(result, 'checkout observation'));
    assert.equal(result.submitCalls, 0);
  } finally {
    await browser.close();
  }
});

test('live Checkout contract fails closed when Stripe secure fields never become ready', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <form data-testid="checkout-form"></form>
      <section data-testid="checkout-summary-column">
        <h2>Plus plan</h2>
        <div><span>Estimated tax</span><span>US$0.00</span></div>
        <div><span>Total due today</span><span>US$20.00</span></div>
        <button type="submit">Subscribe</button>
      </section>
    `);
    await assert.rejects(
      () => observeCheckout(page, {
        ...CHATGPT_PLUS_CHECKOUT_CONTRACT,
        urlPrefix: 'about:blank',
        secureFieldTimeoutMs: 50,
      }),
      /secure card fields did not become ready/,
    );
  } finally {
    await browser.close();
  }
});
