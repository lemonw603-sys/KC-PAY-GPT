import { ContractError } from './contracts.js';

const SELECTORS = Object.freeze({
  name: 'input[name="name"]',
  country: 'select[name="country"]',
  state: 'select[name="administrativeArea"]',
  line1: 'input[name="addressLine1"]',
  city: 'input[name="locality"]',
  postalCode: 'input[name="postalCode"]',
});

async function uniqueVisible(page, selector) {
  const matches = [];
  for (const frame of page.frames()) {
    const locator = frame.locator(selector);
    for (let index = 0; index < await locator.count(); index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible()) matches.push(candidate);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

async function waitUniqueVisible(page, selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    const found = await uniqueVisible(page, selector);
    if (found) return found;
    if (Date.now() >= deadline) return null;
    await page.waitForTimeout(100);
  } while (true);
}

/** Fills only billing-address fields; never touches card fields or submit controls. */
export async function fillBillingAddress(page, address, { timeoutMs = 5000 } = {}) {
  if (!page || typeof page.frames !== 'function') throw new TypeError('page is required');
  if (!address || String(address.country).toUpperCase() !== 'US' || !/^[A-Z]{2}$/.test(String(address.state || '').toUpperCase())) {
    throw new ContractError('billing address must be a US state address');
  }
  for (const key of ['name', 'line1', 'city', 'postalCode']) if (!String(address[key] || '').trim()) throw new ContractError(`billing address ${key} is missing`);
  // Stripe mounts the address iframe after the secure card iframe. Wait for
  // its first controls instead of taking a one-shot snapshot during hydrate.
  const name = await waitUniqueVisible(page, SELECTORS.name, timeoutMs);
  const country = await waitUniqueVisible(page, SELECTORS.country, timeoutMs);
  if (!name || !country) throw new ContractError('billing address form not found or ambiguous');
  await name.fill(String(address.name).trim(), { timeout: timeoutMs });
  await country.selectOption(String(address.country).toUpperCase(), { timeout: timeoutMs });
  const state = await waitUniqueVisible(page, SELECTORS.state, timeoutMs);
  const line1 = await waitUniqueVisible(page, SELECTORS.line1, timeoutMs);
  const city = await waitUniqueVisible(page, SELECTORS.city, timeoutMs);
  const postalCode = await waitUniqueVisible(page, SELECTORS.postalCode, timeoutMs);
  if (!state || !line1 || !city || !postalCode) throw new ContractError('billing address fields are incomplete or ambiguous');
  await state.selectOption(String(address.state).toUpperCase(), { timeout: timeoutMs });
  await line1.fill(String(address.line1).trim(), { timeout: timeoutMs });
  await city.fill(String(address.city).trim(), { timeout: timeoutMs });
  await postalCode.fill(String(address.postalCode).trim(), { timeout: timeoutMs });
  await postalCode.blur();
  return { fieldsFilled: 6, paymentClicked: false, submitCalls: 0 };
}

export { SELECTORS as BILLING_ADDRESS_SELECTORS };

/** Fills the transient Session email in the payment form; never persists it. */
/**
 * ChatGPT serves more than one Checkout implementation. The Stripe-hosted one
 * (`/checkout/.../cs_live_…`) asks for a receipt email; the newer OpenAI one
 * (`/checkout/.../oaics_…`, observed 2026-09-11) has no email control at all and
 * bills the account's own address. So "no email field" is a legitimate page, not
 * drift — but an email field we failed to recognise is NOT: the broadened match
 * below means a page that does ask for one can never be silently skipped.
 */
const BILLING_EMAIL_SELECTOR = [
  'input[autocomplete="billing email"]',
  'input[autocomplete="email"]',
  'input[type="email"]',
  'input[name="email"]',
].join(', ');

export async function fillTransientBillingEmail(page, email, { timeoutMs = 5000, required = false } = {}) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new ContractError('billing email is invalid');
  const matches = [];
  for (const frame of page.frames()) {
    const locator = frame.locator(BILLING_EMAIL_SELECTOR);
    for (let i = 0; i < await locator.count(); i += 1) if (await locator.nth(i).isVisible()) matches.push(locator.nth(i));
  }
  if (matches.length === 0 && !required) return { fieldsFilled: 0, paymentClicked: false, submitCalls: 0, emailFieldPresent: false };
  if (matches.length !== 1) throw new ContractError('billing email field must resolve to one visible input');
  await matches[0].fill(value, { timeout: timeoutMs });
  await matches[0].blur();
  return { fieldsFilled: 1, paymentClicked: false, submitCalls: 0, emailFieldPresent: true };
}
