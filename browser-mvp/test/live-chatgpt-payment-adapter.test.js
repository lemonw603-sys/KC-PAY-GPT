import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { LiveChatGPTPaymentAdapter, LIVE_PAYMENT_CONFIRMATION } from '../src/live-chatgpt-payment-adapter.js';

const card = {
  pan: '4111111111111111', expMonth: 12, expYear: 2032, cvc: '123',
  billingAddress: {
    name: 'Test Customer', country: 'US', line1: '1 Test Street', city: 'Wilmington',
    state: 'DE', postalCode: '19801',
  },
};
const billingFields = `<input autocomplete="billing name"><select autocomplete="billing country"><option value="US">United States</option></select><input autocomplete="billing address-line1"><input autocomplete="billing address-level2"><input autocomplete="billing postal-code"><select autocomplete="billing address-level1"><option value="DE">Delaware</option></select>`;
const checkout = {
  recognized: true,
  planDigest: 'plus-plan',
  currency: 'PHP',
  amount: '1100.00',
  estimatedTax: '117.86',
  paymentFormPresent: true,
  submitControlPresent: true,
  submitControlEnabled: true,
  submitControlSelector: '[data-pay]',
};

const safeLiveOptions = {
  enabled: true,
  confirmation: LIVE_PAYMENT_CONFIRMATION,
  checkoutObserver: async () => ({ ...checkout }),
  budgetGuard: async () => ({ approved: true }),
};

test('LIVE adapter remains inert without exact confirmation', async () => {
  const adapter = new LiveChatGPTPaymentAdapter({ enabled: true, confirmation: 'wrong' });
  await assert.rejects(() => adapter.submit({ page: {}, checkout, cardMaterial: card, operationId: 'op-1' }), (e) => e.code === 'PAYMENT_EXECUTOR_DISABLED');
});

test('LIVE adapter fills secure fields and requires an explicit outcome observer', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div><input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">${billingFields}<button data-pay type="submit" onclick="event.preventDefault()">Pay</button></div>`);
    const adapter = new LiveChatGPTPaymentAdapter(safeLiveOptions);
    await assert.rejects(() => adapter.submit({ page, checkout, cardMaterial: card, operationId: 'op-2' }), (e) => e.code === 'PAYMENT_RESULT_UNKNOWN');
  } finally { await browser.close(); }
});

test('LIVE adapter validates operation id before touching checkout or clicking', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">${billingFields}<button data-pay type="submit" onclick="window.clicked=true; event.preventDefault()">Pay</button>`);
    const adapter = new LiveChatGPTPaymentAdapter({ ...safeLiveOptions, outcomeObserver: async () => ({ status: 'CONFIRMED' }) });
    await assert.rejects(() => adapter.submit({ page, checkout, cardMaterial: card }), (e) => e.code === 'INVALID_ARGUMENT');
    assert.equal(await page.locator('[data-pay]').evaluate((el) => window.clicked === true), false);
  } finally { await browser.close(); }
});

test('LIVE adapter converts 3DS/challenge observer failures to UNKNOWN and clears fields', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">${billingFields}<button data-pay type="submit">Pay</button>`);
    await page.locator('[data-pay]').evaluate((el) => el.addEventListener('click', () => { window.clicked = (window.clicked || 0) + 1; }));
    const adapter = new LiveChatGPTPaymentAdapter({
      ...safeLiveOptions,
      outcomeObserver: async () => { throw new Error('3DS challenge appeared'); },
    });
    await assert.rejects(() => adapter.submit({ page, checkout, cardMaterial: card, operationId: 'op-3' }), (e) => e.code === 'PAYMENT_RESULT_UNKNOWN');
    for (const selector of ['cc-number', 'cc-exp', 'cc-csc']) {
      assert.equal(await page.locator(`input[autocomplete="${selector}"]`).inputValue(), '');
    }
  } finally { await browser.close(); }
});

test('LIVE adapter allows address settlement but never clicks when the settled total changes again', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form><input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">${billingFields}<button data-pay type="submit" onclick="window.clicked=true; event.preventDefault()">Pay</button></form>`);
    let observations = 0;
    const adapter = new LiveChatGPTPaymentAdapter({
      ...safeLiveOptions,
      checkoutObserver: async () => {
        observations += 1;
        if (observations === 1) return { ...checkout };
        if (observations === 2) return { ...checkout, amount: '1200.00' };
        return { ...checkout, amount: '1300.00' };
      },
      outcomeObserver: async () => ({ status: 'CONFIRMED' }),
    });
    await assert.rejects(
      () => adapter.submit({ page, checkout, cardMaterial: card, operationId: 'op-drift' }),
      (error) => error.code === 'CHECKOUT_DRIFT',
    );
    assert.equal(await page.evaluate(() => window.clicked === true), false);
    for (const selector of ['cc-number', 'cc-exp', 'cc-csc']) {
      assert.equal(await page.locator(`input[autocomplete="${selector}"]`).inputValue(), '');
    }
  } finally { await browser.close(); }
});

test('LIVE adapter requires an explicit positive budget decision before touching card fields', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form><input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">${billingFields}<button data-pay type="submit">Pay</button></form>`);
    const adapter = new LiveChatGPTPaymentAdapter({
      ...safeLiveOptions,
      budgetGuard: async () => ({ approved: false }),
      outcomeObserver: async () => ({ status: 'CONFIRMED' }),
    });
    await assert.rejects(
      () => adapter.submit({ page, checkout, cardMaterial: card, operationId: 'op-budget' }),
      (error) => error.code === 'INSUFFICIENT_CARD_BALANCE',
    );
    assert.equal(await page.locator('input[autocomplete="cc-number"]').inputValue(), '');
  } finally { await browser.close(); }
});

test('LIVE preflight checks budget without writing card fields or clicking', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form><input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">${billingFields}<button data-pay type="submit">Pay</button></form>`);
    const adapter = new LiveChatGPTPaymentAdapter(safeLiveOptions);
    assert.deepEqual(
      await adapter.preflight({ page, checkout, cardMaterial: card, operationId: 'op-preflight' }),
      { status: 'READY', submitCalls: 0 },
    );
    assert.equal(await page.locator('input[autocomplete="cc-number"]').inputValue(), '');
  } finally { await browser.close(); }
});

test('LIVE preparation allows address-time tax settlement and returns a stable pre-click snapshot', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form><input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">${billingFields}<button data-pay type="submit" onclick="window.clicked=true; event.preventDefault()">Pay</button></form>`);
    let observations = 0;
    const adapter = new LiveChatGPTPaymentAdapter({
      ...safeLiveOptions,
      checkoutObserver: async () => {
        observations += 1;
        return observations === 1 ? { ...checkout } : { ...checkout, amount: '982.14', estimatedTax: '0.00' };
      },
      outcomeObserver: async () => ({ status: 'CONFIRMED' }),
    });
    const prepared = await adapter.prepare({ page, checkout, cardMaterial: card, operationId: 'op-prepare' });
    assert.equal(prepared.finalCheckout.amount, '982.14');
    assert.match(prepared.checkoutSnapshotHash, /^[a-f0-9]{64}$/);
    assert.equal(await page.evaluate(() => window.clicked === true), false);
    // Freeze the observer at the final snapshot for the last pre-click check.
    adapter.checkoutObserver = async () => ({ ...prepared.finalCheckout });
    assert.deepEqual(await adapter.submitPrepared({ prepared }), {
      status: 'CONFIRMED', providerCallRef: 'browser:op-prepare',
    });
    await adapter.cleanupPrepared(prepared);
    assert.equal(await page.locator('input[autocomplete="cc-number"]').inputValue(), '');
  } finally { await browser.close(); }
});
