#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, stat, unlink } from 'node:fs/promises';
import process from 'node:process';

import { chromium } from 'playwright';

import { BitBrowserLocalApiClient } from '../src/bitbrowser-profile-runtime.js';
import { CookieSessionBootstrapAdapter } from '../src/session-bootstrap.js';
import { probeSessionIdentity } from '../src/session-identity-probe.js';
import {
  assertEvidenceIsSecretFree,
  sanitizeObservedRequest,
  sanitizeObservedResponse,
} from '../src/checkout-tax-evidence.js';
import {
  CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT,
  navigateToChatGPTPlusCheckout,
} from '../src/chatgpt-checkout-navigator.js';

const INPUT_KEYS = new Set(['profileId', 'sessionFile', 'card', 'billingAddress', 'checkout']);
const CARD_KEYS = new Set(['pan', 'expMonth', 'expYear', 'cvc']);
const ADDRESS_KEYS = new Set(['name', 'country', 'line1', 'city', 'state', 'postalCode']);
const CHECKOUT_KEYS = new Set(['creationMode', 'country', 'currency']);
const ACCOUNT_CHECK_PATH = '/backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=0';
const SUMMARY_SELECTOR = '[data-testid="checkout-summary-column"]';

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function assertExactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`${label}.${key} is not allowed`);
}

async function readSecretJson(path, { unlinkAfterRead = false } = {}) {
  const info = await stat(path);
  if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o077) !== 0) {
    throw new Error('secret input must be a caller-owned regular file with mode 0600');
  }
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw.split(/\r?\n/, 1)[0]);
  } finally {
    if (unlinkAfterRead) await unlink(path).catch(() => undefined);
  }
}

function validateInput(input) {
  assertExactKeys(input, INPUT_KEYS, 'input');
  assertExactKeys(input.card, CARD_KEYS, 'input.card');
  assertExactKeys(input.billingAddress, ADDRESS_KEYS, 'input.billingAddress');
  if (input.checkout !== undefined) assertExactKeys(input.checkout, CHECKOUT_KEYS, 'input.checkout');
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(String(input.profileId || ''))) throw new Error('profileId is invalid');
  if (!String(input.sessionFile || '').startsWith('/')) throw new Error('sessionFile must be absolute');
  if (!/^\d{12,19}$/.test(String(input.card.pan || '').replace(/\s/g, ''))) throw new Error('PAN format is invalid');
  if (!/^\d{3,4}$/.test(String(input.card.cvc || ''))) throw new Error('CVC format is invalid');
  if (!/^\d{1,2}$/.test(String(input.card.expMonth || '')) || !/^\d{4}$/.test(String(input.card.expYear || ''))) {
    throw new Error('expiry format is invalid');
  }
  const address = input.billingAddress;
  if (!address.name || !address.line1 || !address.city || !address.postalCode
    || !/^[A-Z]{2}$/.test(String(address.country || '').toUpperCase())
    || !/^[A-Z]{2}$/.test(String(address.state || '').toUpperCase())) {
    throw new Error('billingAddress is incomplete');
  }
  if (input.checkout !== undefined) {
    if (input.checkout.creationMode !== 'explicit-api'
      || !/^[A-Z]{2}$/.test(String(input.checkout.country || ''))
      || !/^[A-Z]{3}$/.test(String(input.checkout.currency || ''))) {
      throw new Error('checkout explicit region is invalid');
    }
  }
}

async function createExplicitCheckout(page, checkout, accessToken, timeoutMs = 45_000) {
  if (typeof accessToken !== 'string' || accessToken.length < 32) throw new Error('session access token is unavailable');
  const response = await page.evaluate(async ({ token, country, currency }) => {
    const result = await fetch('/backend-api/payments/checkout', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        entry_point: 'all_plans_pricing_modal',
        plan_name: 'chatgptplusplan',
        billing_details: { country, currency },
        checkout_ui_mode: 'custom',
      }),
    });
    let body = null;
    try { body = await result.json(); } catch { /* response shape checked below */ }
    return {
      ok: result.ok,
      status: result.status,
      checkoutSessionId: typeof body?.checkout_session_id === 'string' ? body.checkout_session_id : null,
      detail: typeof body?.detail === 'string' ? body.detail
        : typeof body?.message === 'string' ? body.message
          : typeof body?.error?.message === 'string' ? body.error.message : null,
    };
  }, { token: accessToken, country: checkout.country, currency: checkout.currency });
  if (!response.ok || response.status !== 200) {
    const safeDetail = String(response.detail || 'no public detail')
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '<email-redacted>')
      .replace(/\b(?:oaics_|cs_(?:live|test)_)[A-Za-z0-9_-]+\b/g, '<checkout-redacted>')
      .replace(/[A-Za-z0-9_.-]{80,}/g, '<opaque-redacted>')
      .slice(0, 240);
    throw new Error(`explicit checkout creation failed with HTTP ${response.status}: ${safeDetail}`);
  }
  if (!/^(?:oaics_|cs_(?:live|test)_)[A-Za-z0-9_-]{8,256}$/.test(String(response.checkoutSessionId || ''))) {
    throw new Error('explicit checkout creation returned an unsupported response');
  }
  const checkoutUrl = `https://chatgpt.com/checkout/openai_llc/${response.checkoutSessionId}`;
  await page.goto(checkoutUrl, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
  const marker = page.locator(CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT.checkoutReadySelector);
  await marker.waitFor({ state: 'visible', timeout: timeoutMs });
  return {
    checkoutCreated: true,
    actions: ['explicit-checkout-created'],
    checkoutUrlDigest: digest(page.url()),
    submitCalls: 0,
  };
}

async function clearCustomerState(context) {
  // Keep one anchor alive. Some BitBrowser builds tear down the CDP target
  // when the last page closes, which would turn cleanup itself into a failure.
  const anchor = await context.newPage();
  for (const page of context.pages()) {
    if (page !== anchor) await page.close({ runBeforeUnload: false }).catch(() => undefined);
  }
  await context.clearCookies();
  const session = await context.newCDPSession(anchor);
  try {
    for (const origin of ['https://chatgpt.com', 'https://openai.com', 'https://auth.openai.com']) {
      await session.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' });
    }
  } finally {
    await session.detach().catch(() => undefined);
    // Leave the anchor alive until the caller closes the physical Profile.
  }
}

async function visibleFields(page, selectors) {
  const matches = [];
  for (const frame of page.frames()) {
    for (const selector of selectors) {
      const locator = frame.locator(selector);
      for (let i = 0; i < await locator.count(); i += 1) {
        const field = locator.nth(i);
        if (await field.isVisible().catch(() => false)) matches.push(field);
      }
    }
  }
  return matches;
}

async function uniqueCardField(page, selectors, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matches = await visibleFields(page, selectors);
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) throw new Error(`${label} resolved to multiple visible fields`);
    await page.waitForTimeout(250);
  }
  throw new Error(`${label} did not become ready`);
}

async function fillCardFields(page, card) {
  const fields = {
    number: await uniqueCardField(page, ['input[autocomplete="cc-number"]'], 'card number'),
    expiry: await uniqueCardField(page, ['input[autocomplete="cc-exp"]'], 'expiry'),
    cvc: await uniqueCardField(page, ['input[autocomplete="cc-csc"]'], 'security code'),
  };
  const values = {
    number: String(card.pan).replace(/\s/g, ''),
    expiry: `${String(card.expMonth).padStart(2, '0')} / ${String(card.expYear).slice(-2)}`,
    cvc: String(card.cvc),
  };
  for (const [key, field] of Object.entries(fields)) {
    if ((await field.inputValue()).trim()) throw new Error(`${key} field was not empty`);
    await field.fill(values[key]);
  }
  return fields;
}

async function firstVisible(page, selectors, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const matches = await visibleFields(page, selectors);
    if (matches.length) return matches[0];
    await page.waitForTimeout(250);
  }
  return null;
}

async function setSelectOrCombobox(page, selectors, values, optionPattern) {
  const field = await firstVisible(page, selectors);
  if (!field) return false;
  const tag = await field.evaluate((node) => node.tagName.toLowerCase());
  if (tag === 'select') {
    for (const value of values) {
      if (await field.selectOption({ value }).then(() => true).catch(() => false)) return true;
      if (await field.selectOption({ label: value }).then(() => true).catch(() => false)) return true;
    }
    return false;
  }
  await field.click();
  const option = page.getByRole('option', { name: optionPattern }).first();
  if (await option.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await option.click();
    return true;
  }
  return false;
}

async function fillText(page, selectors, value) {
  const field = await firstVisible(page, selectors, 12_000);
  if (!field) return false;
  await field.fill(String(value));
  await field.press('Tab').catch(() => undefined);
  return true;
}

async function fillBillingAddress(page, address) {
  const country = String(address.country).toUpperCase();
  const state = String(address.state).toUpperCase();
  const countrySet = await setSelectOrCombobox(page, [
    '#billingAddress-countryInput',
    'select[autocomplete="billing country"]',
    '[role="combobox"][aria-label*="country" i]',
  ], [country, 'United States'], /United States|美国/i);
  if (!countrySet) throw new Error('billing country field was not ready');

  const result = {
    name: await fillText(page, ['#billingAddress-nameInput', 'input[autocomplete="billing name"]'], address.name),
    line1: await fillText(page, [
      '#billingAddress-addressLine1Input', 'input[autocomplete="billing address-line1"]',
      'input[autocomplete="address-line1"]',
    ], address.line1),
    city: await fillText(page, ['#billingAddress-localityInput', 'input[autocomplete="billing address-level2"]'], address.city),
    postalCode: await fillText(page, ['#billingAddress-postalCodeInput', 'input[autocomplete="billing postal-code"]'], address.postalCode),
  };
  const stateSet = await setSelectOrCombobox(page, [
    '#billingAddress-administrativeAreaInput',
    'select[autocomplete="billing address-level1"]',
    '[role="combobox"][aria-label*="state" i]',
  ], [state, 'Delaware'], /^(Delaware|DE)$/i);
  if (!Object.values(result).every(Boolean) || !stateSet) throw new Error('billing address fields were incomplete');
  await page.keyboard.press('Escape').catch(() => undefined);
  await page.locator(SUMMARY_SELECTOR).click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  return { countrySet, stateSet, fieldsFilled: 4 };
}

async function readBillingRegion(page) {
  const readValue = async (selectors) => {
    const field = await firstVisible(page, selectors, 2_000);
    if (!field) return null;
    const tag = await field.evaluate((node) => node.tagName.toLowerCase());
    if (tag === 'select') {
      return field.locator('option:checked').evaluate((option) => ({ value: option.value, label: option.textContent?.trim() || null }));
    }
    return { value: await field.inputValue().catch(() => null), label: await field.getAttribute('aria-label').catch(() => null) };
  };
  const country = await readValue([
    '#billingAddress-countryInput', 'select[autocomplete="billing country"]',
    '[role="combobox"][aria-label*="country" i]',
  ]);
  const state = await readValue([
    '#billingAddress-administrativeAreaInput', 'select[autocomplete="billing address-level1"]',
    '[role="combobox"][aria-label*="state" i]',
  ]);
  const normalize = (field, allowed) => {
    const candidates = [field?.value, field?.label].filter(Boolean).map((value) => String(value).trim());
    return candidates.find((value) => allowed.includes(value.toUpperCase()))?.toUpperCase() || null;
  };
  return { country: normalize(country, ['US']), state: normalize(state, ['DE']) };
}

function installSafeNetworkObserver(page, evidence) {
  const pending = new Set();
  page.on('request', (request) => {
    const safe = sanitizeObservedRequest(request.url(), request.method(), request.postData());
    if (safe) evidence.push(safe);
  });
  page.on('response', (response) => {
    const task = (async () => {
      const url = response.url();
      const responseShape = sanitizeObservedResponse(url, response.status());
      const bodyText = ['checkout-create-response', 'checkout-snapshot-response', 'pricing-config-response'].includes(responseShape?.kind)
        ? await response.text().catch(() => null)
        : null;
      const safe = sanitizeObservedResponse(url, response.status(), bodyText);
      if (safe) evidence.push(safe);
    })();
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  return async () => Promise.allSettled([...pending]);
}

const MONEY = '(?:[0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{2})|[0-9]+(?:\\.[0-9]{2}))';

function moneyAfter(text, labels) {
  for (const label of labels) {
    const match = new RegExp(`${label}[\\s\\S]{0,100}?(US\\$|USD|PHP|\\$|₱)\\s*(${MONEY})`, 'i').exec(text);
    if (match) return { currency: ['₱', 'PHP'].includes(match[1].toUpperCase()) ? 'PHP' : 'USD', amount: match[2].replaceAll(',', '') };
  }
  return null;
}

async function readTotals(page) {
  const summary = page.locator(SUMMARY_SELECTOR);
  if (await summary.count() !== 1) throw new Error('checkout summary is unavailable');
  const text = await summary.innerText();
  const base = moneyAfter(text, ['Monthly subscription', '月度订阅', '按月订阅']);
  const tax = moneyAfter(text, ['VAT(?: \\(12%\\))?', 'Estimated tax', '预估税费']);
  const total = moneyAfter(text, ['Due today', 'Total due today', '今日应付金额', '今日应付']);
  if (!base || !total) throw new Error('checkout totals were incomplete');
  return { base, tax, total };
}

async function waitForStableTotals(page, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let prior = null;
  let stable = 0;
  while (Date.now() < deadline) {
    const current = await readTotals(page).catch(() => null);
    const serialized = current ? JSON.stringify(current) : null;
    if (serialized && serialized === prior) stable += 1;
    else stable = 0;
    if (stable >= 3) return current;
    prior = serialized;
    await page.waitForTimeout(750);
  }
  throw new Error('checkout totals did not stabilize');
}

async function installSubmitTripwire(page) {
  await page.exposeFunction('__codexSubmitTripwire', () => { throw new Error('payment submit was attempted'); });
  await page.addInitScript(() => {
    window.addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.__codexSubmitTripwire();
    }, true);
  });
  await page.evaluate(() => {
    window.addEventListener('submit', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.__codexSubmitTripwire();
    }, true);
  });
}

async function clearFields(fields) {
  let cleared = 0;
  for (const field of fields) {
    if (await field.fill('').then(() => true).catch(() => false)) cleared += 1;
  }
  return cleared;
}

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath || !inputPath.startsWith('/')) throw new Error('usage: observe-bitbrowser-checkout-tax-nonpayment.js /absolute/0600-input.json');
  const input = await readSecretJson(inputPath, { unlinkAfterRead: true });
  validateInput(input);
  const session = await readSecretJson(input.sessionFile, { unlinkAfterRead: true });
  const expectedIdentity = {
    email: session?.user?.email,
    userId: session?.user?.id,
    accountId: session?.account?.id,
  };
  const sessionProvider = new CookieSessionBootstrapAdapter({ source: { load: async () => session } });
  // A cold fingerprint profile can take longer than the Local API client's
  // default request timeout even though the API itself is healthy.
  const api = new BitBrowserLocalApiClient({ timeoutMs: 60_000 });
  let browser = null;
  let context = null;
  let page = null;
  let profileOpened = false;
  let sessionLease = null;
  const fieldsToClear = [];
  const result = { status: 'FAILED_SAFE', submitCalls: 0 };
  const networkEvidence = [];
  let flushNetworkEvidence = async () => undefined;
  try {
    await api.health();
    const { cdpEndpoint } = await api.openProfile(input.profileId);
    profileOpened = true;
    browser = await chromium.connectOverCDP(cdpEndpoint);
    const contexts = browser.contexts();
    if (contexts.length !== 1) throw new Error('BitBrowser must expose exactly one BrowserContext');
    context = contexts[0];
    await clearCustomerState(context);
    sessionLease = await sessionProvider.open('tax-observe-session', { ttlMs: 180_000 });
    await sessionProvider.bootstrap(sessionLease, context);
    await sessionProvider.close(sessionLease);
    sessionLease = null;
    page = await context.newPage();
    await installSubmitTripwire(page);
    flushNetworkEvidence = installSafeNetworkObserver(page, networkEvidence);
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const identity = await probeSessionIdentity(page, expectedIdentity, { accountCheckPath: ACCOUNT_CHECK_PATH });
    if (identity.alreadyPlus) throw new Error('test account is already subscribed');
    const navigation = input.checkout?.creationMode === 'explicit-api'
      ? await createExplicitCheckout(page, input.checkout, session.accessToken, 45_000)
      : await navigateToChatGPTPlusCheckout(page, CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT, { timeoutMs: 45_000 });
    const totalsBeforePaymentData = await waitForStableTotals(page);
    const cardFields = await fillCardFields(page, input.card);
    fieldsToClear.push(...Object.values(cardFields));
    const totalsAfterCard = await waitForStableTotals(page);
    const billing = await fillBillingAddress(page, input.billingAddress);
    const totals = await waitForStableTotals(page);
    const billingRegion = await readBillingRegion(page);
    await flushNetworkEvidence();
    const submit = page.locator(`${SUMMARY_SELECTOR} button[type="submit"]`);
    result.status = 'OBSERVED_BEFORE_SUBMIT';
    result.identityMatched = identity.identityMatched === true;
    result.subscriptionStatus = identity.subscriptionStatus;
    result.checkoutCreationMode = input.checkout?.creationMode || 'ui';
    result.checkoutUrlDigest = navigation.checkoutUrlDigest || digest(page.url());
    const planText = (await page.locator(`${SUMMARY_SELECTOR} h2`).first().textContent().catch(() => ''))?.trim() || '';
    if (!/ChatGPT Plus/i.test(planText)) throw new Error('checkout plan was not confirmed as ChatGPT Plus');
    result.planDigest = digest(planText);
    result.currency = totals.total.currency;
    result.baseAmount = totals.base.amount;
    result.estimatedTax = totals.tax?.amount ?? null;
    result.totalAmount = totals.total.amount;
    result.totalsTimeline = {
      beforePaymentData: totalsBeforePaymentData,
      afterCard: totalsAfterCard,
      afterBillingAddress: totals,
    };
    result.finalBillingRegion = billingRegion;
    result.networkEvidence = networkEvidence;
    result.billingFieldsFilled = billing.fieldsFilled + 2;
    result.cardFieldsFilled = 3;
    result.submitControlPresent = await submit.count() === 1;
    result.submitControlEnabled = await submit.count() === 1 ? await submit.isEnabled() : false;
    assertEvidenceIsSecretFree(result, [
      session.accessToken, session.sessionToken,
      input.card.pan, input.card.cvc, input.billingAddress.name, input.billingAddress.line1,
      input.billingAddress.city, input.billingAddress.postalCode,
    ]);
  } finally {
    result.fieldsCleared = await clearFields(fieldsToClear);
    if (page) {
      const billingFields = await visibleFields(page, [
        '#billingAddress-nameInput', '#billingAddress-addressLine1Input', '#billingAddress-localityInput',
        '#billingAddress-postalCodeInput', '#billingAddress-administrativeAreaInput',
      ]).catch(() => []);
      result.fieldsCleared += await clearFields(billingFields);
    }
    if (sessionLease) await sessionProvider.close(sessionLease).catch(() => undefined);
    if (context) await clearCustomerState(context).catch(() => undefined);
    if (profileOpened) await api.closeProfile(input.profileId).catch(() => undefined);
    if (browser) await browser.close().catch(() => undefined);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stdout.write(`${JSON.stringify({ status: 'FAILED_SAFE', errorCode: error?.code || error?.name || 'ERROR', message: String(error?.message || error), submitCalls: 0 })}\n`);
  process.exitCode = 1;
});
