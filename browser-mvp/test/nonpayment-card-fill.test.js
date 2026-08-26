import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

import { InMemoryCardMaterialLeaseProvider } from '../src/card-material-lease.js';
import { fillSecureCardFieldsNonPayment } from '../src/nonpayment-card-fill.js';

const CARD = Object.freeze({ pan: '4111111111111111', expMonth: 12, expYear: 2030, cvc: '123' });

async function makePage(browser) {
  const page = await browser.newPage();
  await page.setContent(`<form data-testid="checkout-form"><iframe srcdoc='\
    <input autocomplete="cc-number"><input autocomplete="cc-exp"><input autocomplete="cc-csc">\
  '></iframe></form>`);
  return page;
}

test('non-payment card fill uses a lease, clears fields, and never submits', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser);
    let loads = 0;
    const provider = new InMemoryCardMaterialLeaseProvider({
      source: { load: async () => { loads += 1; return CARD; } },
    });
    const lease = await provider.open('card:fixture-fill');
    const result = await fillSecureCardFieldsNonPayment(page, {
      cardMaterialLeaseProvider: provider,
      lease,
    });
    assert.deepEqual(result, {
      status: 'FILLED_AND_CLEARED',
      fieldsFilled: 3,
      fieldsCleared: 3,
      submitCalls: 0,
      paymentClicked: false,
    });
    assert.equal(loads, 1);
    assert.deepEqual(await page.frames()[1].locator('input').evaluateAll((inputs) => inputs.map((input) => input.value)), ['', '', '']);
    await provider.close(lease);
  } finally {
    await browser.close();
  }
});

test('lease loss stops the next field and still clears fields already written', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser);
    const provider = new InMemoryCardMaterialLeaseProvider({ source: { load: async () => CARD } });
    const lease = await provider.open('card:fixture-loss');
    let checks = 0;
    await assert.rejects(
      () => fillSecureCardFieldsNonPayment(page, {
        cardMaterialLeaseProvider: provider,
        lease,
        assertContinue: async () => {
          checks += 1;
          if (checks === 2) throw new Error('lease lost');
        },
      }),
      /lease lost/,
    );
    assert.deepEqual(await page.frames()[1].locator('input').evaluateAll((inputs) => inputs.map((input) => input.value)), ['', '', '']);
  } finally {
    await browser.close();
  }
});
