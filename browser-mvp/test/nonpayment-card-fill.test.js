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

test('non-payment card fill keeps fields only for the bounded billing callback and then clears them', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser);
    const provider = new InMemoryCardMaterialLeaseProvider({ source: { load: async () => CARD } });
    const lease = await provider.open('card:fixture-billing');
    let populatedDuringCallback = false;
    const result = await fillSecureCardFieldsNonPayment(page, {
      cardMaterialLeaseProvider: provider,
      lease,
      whileFilled: async () => {
        populatedDuringCallback = (await page.frames()[1].locator('input').evaluateAll((inputs) => inputs.every((input) => input.value.length > 0)));
      },
    });
    assert.equal(populatedDuringCallback, true);
    assert.equal(result.fieldsCleared, 3);
    assert.deepEqual(await page.frames()[1].locator('input').evaluateAll((inputs) => inputs.map((input) => input.value)), ['', '', '']);
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

test('card-material lease expiry stops before the next secure field', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser);
    let now = 10_000;
    const provider = new InMemoryCardMaterialLeaseProvider({
      clock: () => now,
      source: { load: async () => CARD },
    });
    const lease = await provider.open('card:fixture-expiry', { ttlMs: 1_000 });
    let checks = 0;
    await assert.rejects(
      () => fillSecureCardFieldsNonPayment(page, {
        cardMaterialLeaseProvider: provider,
        lease,
        assertContinue: async () => {
          checks += 1;
          if (checks === 1) now += 1_001;
        },
      }),
      /card material lease is expired/,
    );
    assert.deepEqual(await page.frames()[1].locator('input').evaluateAll((inputs) => inputs.map((input) => input.value)), ['', '', '']);
  } finally {
    await browser.close();
  }
});

// D-203：填完卡之后那一步失败（账单填写 / requote 观察），现场必须原样留着——
// 运营要能直接接手点订阅，排查也要看得到失败那一刻的真实状态。
// 2026-09-13 实例：清空把「填了又被清」伪装成「从没填进去」，害排查判错根因。
test('whileFilled failure holds the filled scene for the operator', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await makePage(browser);
    const provider = new InMemoryCardMaterialLeaseProvider({ source: { load: async () => CARD } });
    const lease = await provider.open('card:fixture-hold');
    await assert.rejects(
      () => fillSecureCardFieldsNonPayment(page, {
        cardMaterialLeaseProvider: provider,
        lease,
        whileFilled: async () => {
          throw new Error('Target page, context or browser has been closed');
        },
      }),
      /Target page, context or browser has been closed/,
    );
    const values = await page.frames()[1].locator('input').evaluateAll((inputs) => inputs.map((input) => input.value));
    assert.equal(values.every((value) => value.length > 0), true, 'card fields must stay filled for operator takeover');
  } finally {
    await browser.close();
  }
});
