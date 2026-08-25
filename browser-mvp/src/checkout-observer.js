import { createHash } from 'node:crypto';

import { ContractError } from './contracts.js';

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

async function readText(page, selector) {
  if (!selector) return '';
  const locator = page.locator(selector);
  if (await locator.count() !== 1) return '';
  return (await locator.textContent())?.trim() || '';
}

/** Read-only Checkout summary. It never clicks or submits payment controls. */
export async function observeCheckout(page, {
  urlPrefix,
  planSelector = '[data-checkout-plan]',
  currencySelector = '[data-checkout-currency]',
  amountSelector = '[data-checkout-amount]',
  paymentFormSelector = 'form[data-payment-form]',
} = {}) {
  if (!page || typeof page.url !== 'function') throw new TypeError('page is required');
  if (typeof urlPrefix !== 'string' || !urlPrefix) throw new ContractError('checkout urlPrefix is required');
  if (!page.url().startsWith(urlPrefix)) throw new ContractError('checkout page URL drift');
  const [plan, currency, amount] = await Promise.all([
    readText(page, planSelector),
    readText(page, currencySelector),
    readText(page, amountSelector),
  ]);
  const paymentFormPresent = paymentFormSelector ? (await page.locator(paymentFormSelector).count()) === 1 : false;
  if (!plan || !currency || !amount) throw new ContractError('checkout summary is incomplete');
  return {
    planDigest: digest(plan),
    currency,
    amount,
    paymentFormPresent,
    submitCalls: 0,
  };
}
