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

function normalizeAmount(value) {
  const compact = value.replace(/\s+/g, '');
  if (compact.includes('.') && compact.includes(',')) return compact.replaceAll(',', '');
  return compact;
}

function parseMoney(value) {
  const prefix = /(US\$|USD|PHP|\$|₱)\s*([0-9]+(?:[.,][0-9]{1,2})?)/i.exec(value || '');
  const suffix = /([0-9]+(?:[.,][0-9]{1,2})?)\s*(USD|PHP)/i.exec(value || '');
  const match = prefix || suffix;
  if (!match) return null;
  const token = prefix ? match[1].toUpperCase() : match[2].toUpperCase();
  const amount = normalizeAmount(prefix ? match[2] : match[1]);
  const currency = token === 'US$' ? 'USD' : token;
  return { currency, amount };
}

async function readMoneyRow(page, { summarySelector, labels }) {
  if (!summarySelector || !Array.isArray(labels) || labels.length === 0) return null;
  const summary = page.locator(summarySelector);
  if (await summary.count() !== 1) return null;
  const rows = [];
  for (const label of labels) {
    const matches = summary.getByText(label, { exact: true });
    const count = await matches.count();
    for (let index = 0; index < count; index += 1) {
      rows.push((await matches.nth(index).locator('..').textContent())?.trim() || '');
    }
  }
  if (rows.length !== 1) return null;
  return parseMoney(rows[0]);
}

async function inspectCardFields(page, timeoutMs) {
  const selectors = {
    cardNumber: 'input[autocomplete="cc-number"]',
    expiry: 'input[autocomplete="cc-exp"]',
    cvc: 'input[autocomplete="cc-csc"]',
  };
  const present = { cardNumber: false, expiry: false, cvc: false };
  const deadline = Date.now() + timeoutMs;
  do {
    for (const frame of page.frames()) {
      for (const [name, selector] of Object.entries(selectors)) {
        if (!present[name] && await frame.locator(selector).count() > 0) present[name] = true;
      }
    }
    if (Object.values(present).every(Boolean) || Date.now() >= deadline) break;
    await page.waitForTimeout(100);
  } while (true);
  return present;
}

export const CHATGPT_PLUS_CHECKOUT_CONTRACT = Object.freeze({
  urlPrefix: 'https://chatgpt.com/checkout/',
  planSelector: '[data-testid="checkout-summary-column"] h2',
  currencySelector: null,
  amountSelector: null,
  summarySelector: '[data-testid="checkout-summary-column"]',
  amountLabels: Object.freeze(['今日应付金额', 'Total due today', 'Amount due today']),
  estimatedTaxLabels: Object.freeze(['预估税费', 'Estimated tax']),
  paymentFormSelector: 'form[data-testid="checkout-form"]',
  submitControlSelector: '[data-testid="checkout-summary-column"] button[type="submit"]',
  inspectSecureCardFields: true,
  requireSecureCardFields: true,
  secureFieldTimeoutMs: 10_000,
});

/** Read-only Checkout summary. It never clicks or submits payment controls. */
export async function observeCheckout(page, {
  urlPrefix,
  planSelector = '[data-checkout-plan]',
  currencySelector = '[data-checkout-currency]',
  amountSelector = '[data-checkout-amount]',
  paymentFormSelector = 'form[data-payment-form]',
  summarySelector = null,
  amountLabels = [],
  estimatedTaxLabels = [],
  submitControlSelector = null,
  inspectSecureCardFields = false,
  requireSecureCardFields = false,
  secureFieldTimeoutMs = 0,
} = {}) {
  if (!page || typeof page.url !== 'function') throw new TypeError('page is required');
  if (typeof urlPrefix !== 'string' || !urlPrefix) throw new ContractError('checkout urlPrefix is required');
  if (inspectSecureCardFields && (!Number.isInteger(secureFieldTimeoutMs) || secureFieldTimeoutMs < 0 || secureFieldTimeoutMs > 30_000)) {
    throw new ContractError('secureFieldTimeoutMs must be between 0 and 30000');
  }
  if (!page.url().startsWith(urlPrefix)) throw new ContractError('checkout page URL drift');
  let [plan, currency, amount] = await Promise.all([
    readText(page, planSelector),
    readText(page, currencySelector),
    readText(page, amountSelector),
  ]);
  const [amountRow, taxRow] = await Promise.all([
    readMoneyRow(page, { summarySelector, labels: amountLabels }),
    readMoneyRow(page, { summarySelector, labels: estimatedTaxLabels }),
  ]);
  if ((!currency || !amount) && amountRow) {
    currency = amountRow.currency;
    amount = amountRow.amount;
  }
  const paymentFormPresent = paymentFormSelector ? (await page.locator(paymentFormSelector).count()) === 1 : false;
  const submitControl = submitControlSelector ? page.locator(submitControlSelector) : null;
  const submitControlPresent = submitControl ? (await submitControl.count()) === 1 : false;
  const submitControlEnabled = submitControlPresent ? await submitControl.isEnabled() : false;
  const cardFieldsPresent = inspectSecureCardFields ? await inspectCardFields(page, secureFieldTimeoutMs) : null;
  if (!plan || !currency || !amount) throw new ContractError('checkout summary is incomplete');
  if (requireSecureCardFields && (!cardFieldsPresent || Object.values(cardFieldsPresent).some((present) => !present))) {
    throw new ContractError('secure card fields did not become ready');
  }
  return {
    planDigest: digest(plan),
    currency,
    amount,
    estimatedTax: taxRow?.amount || null,
    paymentFormPresent,
    submitControlPresent,
    submitControlEnabled,
    cardFieldsPresent,
    submitCalls: 0,
  };
}
