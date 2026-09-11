import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { fillBillingAddress, fillTransientBillingEmail } from '../src/billing-address-fill.js';

test('fills the unique visible billing controls when Stripe retains hidden duplicates', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <form>
        <input name="name" hidden><select name="country" hidden><option value="US">US</option></select>
        <select name="administrativeArea" hidden><option value="DE">DE</option></select>
        <input name="addressLine1" hidden><input name="locality" hidden><input name="postalCode" hidden>
        <input name="name"><select name="country"><option value="PH">PH</option><option value="US">US</option></select>
        <select name="administrativeArea"><option value="DE">DE</option></select>
        <input name="addressLine1"><input name="locality"><input name="postalCode">
      </form>`);
    const result = await fillBillingAddress(page, {
      name: 'Test Holder', country: 'US', state: 'DE', line1: '1 Test St', city: 'Wilmington', postalCode: '19801',
    });
    assert.deepEqual(result, { fieldsFilled: 6, paymentClicked: false, submitCalls: 0 });
    assert.equal(await page.locator('select[name="country"]:visible').inputValue(), 'US');
    assert.equal(await page.locator('select[name="administrativeArea"]:visible').inputValue(), 'DE');
    assert.equal(await page.locator('input[name="postalCode"]:visible').inputValue(), '19801');
  } finally { await browser.close(); }
});

test('fills unique visible billing controls even when Stripe splits them across frames', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<iframe srcdoc='<input name="name"><select name="country"><option value="PH">PH</option><option value="US">US</option></select>'></iframe>
      <iframe srcdoc='<select name="administrativeArea"><option value="DE">DE</option></select><input name="addressLine1"><input name="locality"><input name="postalCode">'></iframe>`);
    await fillBillingAddress(page, {
      name: 'Test Holder', country: 'US', state: 'DE', line1: '1 Test St', city: 'Wilmington', postalCode: '19801',
    });
    assert.equal(await page.frames()[1].locator('select[name="country"]').inputValue(), 'US');
    assert.equal(await page.frames()[2].locator('input[name="postalCode"]').inputValue(), '19801');
  } finally { await browser.close(); }
});

test('a Checkout with no email control is filled without one instead of aborting', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    // The oaics_ Checkout observed 2026-09-11: card + address, no email anywhere.
    await page.setContent(`<form><input autocomplete="cc-number"><input name="name"></form>`);
    const result = await fillTransientBillingEmail(page, 'buyer@example.test', { timeoutMs: 1000 });
    assert.deepEqual(result, { fieldsFilled: 0, paymentClicked: false, submitCalls: 0, emailFieldPresent: false });
  } finally { await browser.close(); }
});

test('an email control is still filled, however the Checkout labels it', async () => {
  for (const markup of [
    '<input autocomplete="billing email">',
    '<input type="email" name="receipt">',
    '<input name="email">',
  ]) {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setContent(`<form>${markup}</form>`);
      const result = await fillTransientBillingEmail(page, 'Buyer@Example.test', { timeoutMs: 1000 });
      assert.equal(result.fieldsFilled, 1, markup);
      assert.equal(result.emailFieldPresent, true, markup);
      assert.equal(await page.locator('input').inputValue(), 'buyer@example.test', markup);
    } finally { await browser.close(); }
  }
});

test('two visible email controls stay an abort — the page is not understood', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<form><input autocomplete="billing email"><input type="email"></form>');
    await assert.rejects(
      () => fillTransientBillingEmail(page, 'buyer@example.test', { timeoutMs: 1000 }),
      /one visible input/,
    );
  } finally { await browser.close(); }
});

