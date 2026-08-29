import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { LiveChatGPTPaymentAdapter, LIVE_PAYMENT_CONFIRMATION } from '../src/live-chatgpt-payment-adapter.js';

const card = { pan: '4111111111111111', expMonth: 12, expYear: 2032, cvc: '123' };
const checkout = { recognized: true, submitControlSelector: '[data-pay]' };

test('LIVE adapter remains inert without exact confirmation', async () => {
  const adapter = new LiveChatGPTPaymentAdapter({ enabled: true, confirmation: 'wrong' });
  await assert.rejects(() => adapter.submit({ page: {}, checkout, cardMaterial: card, operationId: 'op-1' }), (e) => e.code === 'PAYMENT_EXECUTOR_DISABLED');
});

test('LIVE adapter fills secure fields and requires an explicit outcome observer', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<div><input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc"><button data-pay type="submit" onclick="event.preventDefault()">Pay</button></div>`);
    const adapter = new LiveChatGPTPaymentAdapter({ enabled: true, confirmation: LIVE_PAYMENT_CONFIRMATION });
    await assert.rejects(() => adapter.submit({ page, checkout, cardMaterial: card, operationId: 'op-2' }), (e) => e.code === 'PAYMENT_RESULT_UNKNOWN');
  } finally { await browser.close(); }
});

test('LIVE adapter validates operation id before touching checkout or clicking', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc"><button data-pay type="submit" onclick="window.clicked=true; event.preventDefault()">Pay</button>`);
    const adapter = new LiveChatGPTPaymentAdapter({ enabled: true, confirmation: LIVE_PAYMENT_CONFIRMATION, outcomeObserver: async () => ({ status: 'CONFIRMED' }) });
    await assert.rejects(() => adapter.submit({ page, checkout, cardMaterial: card }), (e) => e.code === 'INVALID_ARGUMENT');
    assert.equal(await page.locator('[data-pay]').evaluate((el) => window.clicked === true), false);
  } finally { await browser.close(); }
});

test('LIVE adapter converts 3DS/challenge observer failures to UNKNOWN and clears fields', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc"><button data-pay type="submit">Pay</button>`);
    await page.locator('[data-pay]').evaluate((el) => el.addEventListener('click', () => { window.clicked = (window.clicked || 0) + 1; }));
    const adapter = new LiveChatGPTPaymentAdapter({
      enabled: true, confirmation: LIVE_PAYMENT_CONFIRMATION,
      outcomeObserver: async () => { throw new Error('3DS challenge appeared'); },
    });
    await assert.rejects(() => adapter.submit({ page, checkout, cardMaterial: card, operationId: 'op-3' }), (e) => e.code === 'PAYMENT_RESULT_UNKNOWN');
    for (const selector of ['cc-number', 'cc-exp', 'cc-csc']) {
      assert.equal(await page.locator(`input[autocomplete="${selector}"]`).inputValue(), '');
    }
  } finally { await browser.close(); }
});
