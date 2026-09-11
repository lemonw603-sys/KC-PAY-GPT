import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { LiveChatGPTPaymentAdapter, LIVE_PAYMENT_CONFIRMATION } from '../src/live-chatgpt-payment-adapter.js';

const card = {
  pan: '4111111111111111', expMonth: 12, expYear: 2032, cvc: '123',
  billingAddress: { name: 'Fixture Name', country: 'US', state: 'DE', line1: '100 Test St', city: 'Wilmington', postalCode: '19801' },
};
const checkout = { recognized: true, submitControlSelector: '[data-pay]' };
const checkoutContract = {
  urlPrefix: 'about:blank', planSelector: '#summary h2', summarySelector: '#summary',
  amountLabels: ['Total due today'], estimatedTaxLabels: ['Tax'], subtotalLabels: ['Subtotal'],
  paymentFormSelector: 'form', submitControlSelector: '[data-pay]',
  requiredCurrency: 'PHP', requireZeroTax: true, requireQuoteConsistency: true,
};
function html({ tax = '0.00' } = {}) {
  return `<form><input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">
    <input name="name"><select name="country"><option value="US">US</option></select>
    <select name="administrativeArea"><option value="DE">DE</option></select>
    <input name="addressLine1"><input name="locality"><input name="postalCode">
    <input autocomplete="billing email"><div id="summary"><h2>Plus</h2>
    <div><span>Subtotal</span><span>₱982.14</span></div><div><span>Tax</span><span>₱${tax}</span></div>
    <div><span>Total due today</span><span>₱${tax === '0.00' ? '982.14' : '1,100.00'}</span></div>
    <button data-pay type="submit" onclick="window.clicked=(window.clicked||0)+1; event.preventDefault()">Pay</button>
    </div></form>`;
}

test('LIVE adapter remains inert without exact confirmation', async () => {
  const adapter = new LiveChatGPTPaymentAdapter({ enabled: true, confirmation: 'wrong' });
  await assert.rejects(() => adapter.submit({ page: {}, checkout, cardMaterial: card, operationId: 'op-1' }), (e) => e.code === 'PAYMENT_EXECUTOR_DISABLED');
});

test('LIVE adapter fills secure fields and requires an explicit outcome observer', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html());
    const adapter = new LiveChatGPTPaymentAdapter({ enabled: true, confirmation: LIVE_PAYMENT_CONFIRMATION });
    await assert.rejects(() => adapter.submit({ page, checkout, checkoutContract, cardMaterial: card, billingEmail: 'fixture@example.test', operationId: 'op-2', authorizeSubmit: async () => ({ executeExternal: true }) }), (e) => e.code === 'PAYMENT_RESULT_UNKNOWN');
  } finally { await browser.close(); }
});

test('LIVE adapter validates operation id before touching checkout or clicking', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html());
    const adapter = new LiveChatGPTPaymentAdapter({ enabled: true, confirmation: LIVE_PAYMENT_CONFIRMATION, outcomeObserver: async () => ({ status: 'CONFIRMED' }) });
    await assert.rejects(() => adapter.submit({ page, checkout, checkoutContract, cardMaterial: card, billingEmail: 'fixture@example.test' }), (e) => e.code === 'INVALID_ARGUMENT');
    assert.equal(await page.locator('[data-pay]').evaluate((el) => window.clicked === true), false);
  } finally { await browser.close(); }
});

test('LIVE adapter converts 3DS/challenge observer failures to UNKNOWN and clears fields', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html());
    const adapter = new LiveChatGPTPaymentAdapter({
      enabled: true, confirmation: LIVE_PAYMENT_CONFIRMATION,
      outcomeObserver: async () => { throw new Error('3DS challenge appeared'); },
    });
    await assert.rejects(() => adapter.submit({ page, checkout, checkoutContract, cardMaterial: card, billingEmail: 'fixture@example.test', operationId: 'op-3', authorizeSubmit: async () => ({ executeExternal: true }) }), (e) => e.code === 'PAYMENT_RESULT_UNKNOWN');
    for (const selector of ['cc-number', 'cc-exp', 'cc-csc']) {
      assert.equal(await page.locator(`input[autocomplete="${selector}"]`).inputValue(), '');
    }
  } finally { await browser.close(); }
});

test('LIVE adapter never submits a non-zero-tax quote', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html({ tax: '117.86' }));
    const adapter = new LiveChatGPTPaymentAdapter({
      enabled: true, confirmation: LIVE_PAYMENT_CONFIRMATION,
      outcomeObserver: async () => ({ status: 'CONFIRMED' }),
    });
    await assert.rejects(() => adapter.submit({
      page, checkout, checkoutContract, cardMaterial: card,
      billingEmail: 'fixture@example.test', operationId: 'op-tax', authorizeSubmit: async () => ({ executeExternal: true }), repriceTimeoutMs: 1_000,
    }), (error) => error.code === 'CHECKOUT_DRIFT'
      && error.message === 'LIVE Browser payment failed at wait-for-zero-tax-requote');
    assert.equal(await page.evaluate(() => window.clicked || 0), 0);
    // On a pre-submit drift the secure card number must NOT stay in the field:
    // leftover PAN would keep card data resident in a reusable page and poison
    // any retry that reuses the same checkout (it would trip the "secure field
    // is not empty" guard). Billing address / email are non-PAN and are kept.
    assert.equal(await page.locator('input[autocomplete="cc-number"]').inputValue(), '');
    assert.equal(await page.locator('input[name="locality"]').inputValue(), card.billingAddress.city);
    assert.equal(await page.locator('input[autocomplete="billing email"]').inputValue(), 'fixture@example.test');
  } finally { await browser.close(); }
});

test('LIVE adapter exposes only the strict quote to the final authoritative recheck', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html());
    let checked = null;
    const adapter = new LiveChatGPTPaymentAdapter({
      enabled: true, confirmation: LIVE_PAYMENT_CONFIRMATION,
      outcomeObserver: async () => ({ status: 'CONFIRMED' }),
    });
    const result = await adapter.submit({
      page, checkout, checkoutContract, cardMaterial: card,
      billingEmail: 'fixture@example.test', operationId: 'op-zero-tax', authorizeSubmit: async () => ({ executeExternal: true }),
      beforeSubmit: async ({ checkout: quote }) => { checked = quote; },
    });
    assert.equal(checked.currency, 'PHP');
    assert.equal(checked.estimatedTax, '0.00');
    assert.equal(result.quote.amount, '982.14');
    assert.equal(await page.evaluate(() => window.clicked || 0), 1);
  } finally { await browser.close(); }
});

test('D-154: an unanswered human verification keeps the filled form for the person and clicks nothing', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html());
    let gateCalls = 0;
    const adapter = new LiveChatGPTPaymentAdapter({
      enabled: true,
      confirmation: LIVE_PAYMENT_CONFIRMATION,
      challengeGate: async () => { gateCalls += 1; return { challenged: true, cleared: false, reason: 'HUMAN_VERIFICATION_TIMEOUT' }; },
      outcomeObserver: async () => { throw new Error('outcome observer must not run while verification is pending'); },
    });
    await assert.rejects(
      () => adapter.submit({
        page, checkout, checkoutContract, cardMaterial: card, billingEmail: 'fixture@example.test',
        operationId: 'op-hv-1', authorizeSubmit: async () => ({ executeExternal: true }), beforeSubmit: async () => undefined,
      }),
      (e) => e.code === 'PAYMENT_RESULT_UNKNOWN' && /human verification/i.test(e.message),
    );
    assert.equal(gateCalls, 1);
    assert.equal(await page.evaluate(() => window.clicked || 0), 1, 'exactly one submit click');
    assert.equal(await page.locator('input[autocomplete="cc-number"]').inputValue(), card.pan, 'card form is preserved for the operator');
  } finally { await browser.close(); }
});

test('D-154: a verification cleared by a person lets the run continue and still clears the card fields', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html());
    const adapter = new LiveChatGPTPaymentAdapter({
      enabled: true,
      confirmation: LIVE_PAYMENT_CONFIRMATION,
      challengeGate: async () => ({ challenged: true, cleared: true, waitedMs: 4_000 }),
      outcomeObserver: async ({ challenge }) => {
        assert.equal(challenge.cleared, true);
        return { status: 'CONFIRMED' };
      },
    });
    const result = await adapter.submit({
      page, checkout, checkoutContract, cardMaterial: card, billingEmail: 'fixture@example.test',
      operationId: 'op-hv-2', authorizeSubmit: async () => ({ executeExternal: true }), beforeSubmit: async () => undefined,
    });
    assert.equal(result.status, 'CONFIRMED');
    assert.equal(await page.evaluate(() => window.clicked || 0), 1, 'still exactly one submit click');
    assert.equal(await page.locator('input[autocomplete="cc-number"]').inputValue(), '');
  } finally { await browser.close(); }
});

test('F-47: a Checkout that states the card was declined is reported as DECLINED, not bare unknown', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html());
    const adapter = new LiveChatGPTPaymentAdapter({
      enabled: true,
      confirmation: LIVE_PAYMENT_CONFIRMATION,
      outcomeObserver: async () => ({ status: 'DECLINED', reasonCode: 'CARD_DECLINED', observedText: 'Tinanggihan ang iyong kard.' }),
    });
    const result = await adapter.submit({
      page, checkout, checkoutContract, cardMaterial: card, billingEmail: 'fixture@example.test',
      operationId: 'op-decline', authorizeSubmit: async () => ({ executeExternal: true }), beforeSubmit: async () => undefined,
    });
    assert.equal(result.status, 'DECLINED');
    assert.equal(result.reasonCode, 'CARD_DECLINED');
    assert.equal(result.observedText, 'Tinanggihan ang iyong kard.');
    assert.equal(await page.evaluate(() => window.clicked || 0), 1, 'a decline must not produce a second click');
    assert.equal(await page.locator('input[autocomplete="cc-number"]').inputValue(), '', 'card fields are cleared after a decline');
  } finally { await browser.close(); }
});

