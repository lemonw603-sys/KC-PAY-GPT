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
