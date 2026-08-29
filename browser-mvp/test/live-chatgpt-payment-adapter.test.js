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
    await page.setContent(`<div><input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc"><button data-pay type="submit">Pay</button></div>`);
    const adapter = new LiveChatGPTPaymentAdapter({ enabled: true, confirmation: LIVE_PAYMENT_CONFIRMATION });
    await assert.rejects(() => adapter.submit({ page, checkout, cardMaterial: card, operationId: 'op-2' }), (e) => e.code === 'PAYMENT_RESULT_UNKNOWN');
  } finally { await browser.close(); }
});
