import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { once } from 'node:events';

import { ContractError } from '../src/contracts.js';
import { CHATGPT_PLUS_CHECKOUT_CONTRACT, observeCheckout } from '../src/checkout-observer.js';
import { probeSessionIdentity } from '../src/session-identity-probe.js';

test('session identity probe verifies the real session endpoint without returning raw session data', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/api/auth/session') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ user: { id: 'user-001', email: 'buyer@example.test' }, account: { id: 'acct-001' } }));
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
    const result = await probeSessionIdentity(page, { email: 'buyer@example.test' });
    assert.equal(result.verified, true);
    assert.equal(result.httpStatus, 200);
    assert.equal(result.observedEmailDigest.length, 64);
    await assert.rejects(() => probeSessionIdentity(page, { email: 'other@example.test' }), ContractError);
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
    assert.deepEqual(result.cardFieldsPresent, { cardNumber: true, expiry: true, cvc: true });
    assert.equal(result.submitCalls, 0);
  } finally {
    await browser.close();
  }
});
