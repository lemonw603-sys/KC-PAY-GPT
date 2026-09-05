import { ContractError } from './contracts.js';

const SELECTORS = Object.freeze({
  name: 'input[name="name"]',
  country: 'select[name="country"]',
  state: 'select[name="administrativeArea"]',
  line1: 'input[name="addressLine1"]',
  city: 'input[name="locality"]',
  postalCode: 'input[name="postalCode"]',
});

async function visible(frame, selector) {
  const l = frame.locator(selector);
  return (await l.count()) === 1 && await l.isVisible();
}

/** Fills only billing-address fields; never touches card fields or submit controls. */
export async function fillBillingAddress(page, address, { timeoutMs = 5000 } = {}) {
  if (!page || typeof page.frames !== 'function') throw new TypeError('page is required');
  if (!address || String(address.country).toUpperCase() !== 'US' || !/^[A-Z]{2}$/.test(String(address.state || '').toUpperCase())) {
    throw new ContractError('billing address must be a US state address');
  }
  for (const key of ['name', 'line1', 'city', 'postalCode']) if (!String(address[key] || '').trim()) throw new ContractError(`billing address ${key} is missing`);
  let target = null;
  for (const candidate of page.frames()) {
    if (await visible(candidate, SELECTORS.country) && await visible(candidate, SELECTORS.state)) { target = candidate; break; }
  }
  if (!target || !(await visible(target, SELECTORS.name))) throw new ContractError('billing address form not found');
  await target.locator(SELECTORS.name).fill(String(address.name).trim(), { timeout: timeoutMs });
  await target.locator(SELECTORS.country).selectOption(String(address.country).toUpperCase(), { timeout: timeoutMs });
  await target.locator(SELECTORS.state).selectOption(String(address.state).toUpperCase(), { timeout: timeoutMs });
  await target.locator(SELECTORS.line1).fill(String(address.line1).trim(), { timeout: timeoutMs });
  await target.locator(SELECTORS.city).fill(String(address.city).trim(), { timeout: timeoutMs });
  await target.locator(SELECTORS.postalCode).fill(String(address.postalCode).trim(), { timeout: timeoutMs });
  await target.locator(SELECTORS.postalCode).blur();
  return { fieldsFilled: 6, paymentClicked: false, submitCalls: 0 };
}

export { SELECTORS as BILLING_ADDRESS_SELECTORS };

/** Fills the transient Session email in the payment form; never persists it. */
export async function fillTransientBillingEmail(page, email, { timeoutMs = 5000 } = {}) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new ContractError('billing email is invalid');
  const matches = [];
  for (const frame of page.frames()) {
    const locator = frame.locator('input[autocomplete="billing email"]');
    for (let i = 0; i < await locator.count(); i += 1) if (await locator.nth(i).isVisible()) matches.push(locator.nth(i));
  }
  if (matches.length !== 1) throw new ContractError('billing email field must resolve to one visible input');
  await matches[0].fill(value, { timeout: timeoutMs });
  await matches[0].blur();
  return { fieldsFilled: 1, paymentClicked: false, submitCalls: 0 };
}
