import { createHash } from 'node:crypto';

import { ContractError } from './contracts.js';
import { assertBillingAddress, assertCardMaterial } from './card-material-lease.js';
import { SECURE_CARD_FIELD_SELECTORS } from './nonpayment-card-fill.js';

export const LIVE_PAYMENT_CONFIRMATION = 'I-CONFIRM-LIVE-BROWSER-PAYMENT-ADAPTER';

export class LiveChatGPTPaymentAdapterError extends Error {
  constructor(message, code, cause = undefined) {
    super(message, cause ? { cause } : undefined);
    this.name = 'LiveChatGPTPaymentAdapterError';
    this.code = code;
  }
}

function required(value, name) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new LiveChatGPTPaymentAdapterError(`${name} is required`, 'INVALID_ARGUMENT');
  return normalized;
}

async function oneVisible(page, selector, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const matches = [];
    for (const frame of page.frames()) {
      const locator = frame.locator(selector);
      for (let i = 0; i < await locator.count(); i += 1) {
        if (await locator.nth(i).isVisible()) matches.push(locator.nth(i));
      }
    }
    if (matches.length === 1) return matches[0];
    if (Date.now() >= deadline) throw new LiveChatGPTPaymentAdapterError(`${label} must resolve to one visible control`, 'CHECKOUT_DRIFT');
    await page.waitForTimeout(100);
  }
}

const BILLING_FIELD_SELECTORS = Object.freeze({
  name: 'input[autocomplete="billing name"]',
  country: 'select[autocomplete="billing country"]',
  line1: 'input[autocomplete="billing address-line1"]',
  city: 'input[autocomplete="billing address-level2"]',
  postalCode: 'input[autocomplete="billing postal-code"]',
  state: 'select[autocomplete="billing address-level1"]',
});

function checkoutFingerprint(checkout) {
  return JSON.stringify({
    recognized: checkout?.recognized === true,
    planDigest: String(checkout?.planDigest || ''),
    currency: String(checkout?.currency || '').toUpperCase(),
    amount: String(checkout?.amount || ''),
    estimatedTax: checkout?.estimatedTax == null ? null : String(checkout.estimatedTax),
    submitControlSelector: String(checkout?.submitControlSelector || ''),
  });
}

function assertCheckoutReadyAndStable(reviewed, current) {
  if (!reviewed?.recognized || !current?.recognized
    || checkoutFingerprint(reviewed) !== checkoutFingerprint(current)) {
    throw new LiveChatGPTPaymentAdapterError(
      'Checkout plan, currency, tax, total, or submit target changed before payment',
      'CHECKOUT_DRIFT',
    );
  }
  if (current.paymentFormPresent !== true
    || current.submitControlPresent !== true
    || current.submitControlEnabled !== true) {
    throw new LiveChatGPTPaymentAdapterError('Checkout payment controls are not ready', 'CHECKOUT_DRIFT');
  }
}

function assertCheckoutIdentity(reviewed, current) {
  if (!reviewed?.recognized || !current?.recognized
    || String(reviewed.planDigest || '') !== String(current.planDigest || '')
    || String(reviewed.currency || '').toUpperCase() !== String(current.currency || '').toUpperCase()
    || String(reviewed.submitControlSelector || '') !== String(current.submitControlSelector || '')) {
    throw new LiveChatGPTPaymentAdapterError(
      'Checkout plan, currency, or submit target changed while preparing payment',
      'CHECKOUT_DRIFT',
    );
  }
  if (current.paymentFormPresent !== true
    || current.submitControlPresent !== true
    || current.submitControlEnabled !== true) {
    throw new LiveChatGPTPaymentAdapterError('Checkout payment controls are not ready', 'CHECKOUT_DRIFT');
  }
}

function checkoutSnapshotHash(checkout) {
  return createHash('sha256').update(checkoutFingerprint(checkout)).digest('hex');
}

async function clearPreparedFields(prepared) {
  for (const field of Object.values(prepared?.fields || {})) {
    try { await field.fill(''); } catch {
      await field.evaluate((element) => {
        element.value = '';
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }).catch(() => undefined);
    }
  }
  for (const field of Object.values(prepared?.billingFields || {})) {
    try {
      if (typeof field.fill === 'function') await field.fill('');
    } catch { /* best-effort sensitive field cleanup */ }
  }
}

function cardValues(cardMaterial) {
  assertCardMaterial(cardMaterial);
  const month = Number(cardMaterial.expMonth);
  const year = Number(cardMaterial.expYear);
  const now = new Date();
  const currentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
  const expiryMonth = year * 12 + month;
  let billingAddress;
  try {
    billingAddress = assertBillingAddress(cardMaterial.billingAddress);
  } catch {
    throw new LiveChatGPTPaymentAdapterError('billing address format is invalid', 'BILLING_ADDRESS_INVALID');
  }
  const values = {
    cardNumber: String(cardMaterial.pan).replace(/\s+/g, ''),
    expiry: `${String(month).padStart(2, '0')} / ${String(year).slice(-2)}`,
    cvc: String(cardMaterial.cvc).trim(),
    billingAddress,
  };
  if (!/^\d{12,19}$/.test(values.cardNumber) || !/^\d{3,4}$/.test(values.cvc)
    || !Number.isInteger(month) || month < 1 || month > 12
    || !Number.isInteger(year) || expiryMonth < currentMonth) {
    throw new LiveChatGPTPaymentAdapterError('card material format is invalid', 'CARD_MATERIAL_INVALID');
  }
  return values;
}

/**
 * Minimal LIVE adapter. It is inert unless both enabled=true and the exact
 * confirmation string are supplied by a separately controlled caller.
 * The adapter never decides success from a click; the caller must provide an
 * outcome observer, otherwise the result is deliberately UNKNOWN.
 */
export class LiveChatGPTPaymentAdapter {
  constructor({
    enabled = false,
    confirmation = '',
    checkoutObserver = null,
    budgetGuard = null,
    outcomeObserver = null,
    fieldTimeoutMs = 60_000,
  } = {}) {
    this.enabled = enabled === true && confirmation === LIVE_PAYMENT_CONFIRMATION;
    this.checkoutObserver = checkoutObserver;
    this.budgetGuard = budgetGuard;
    this.outcomeObserver = outcomeObserver;
    if (!Number.isInteger(fieldTimeoutMs) || fieldTimeoutMs < 1_000 || fieldTimeoutMs > 120_000) {
      throw new TypeError('fieldTimeoutMs must be between 1000 and 120000');
    }
    this.fieldTimeoutMs = fieldTimeoutMs;
  }

  /**
   * Performs every check that can be proven without touching payment fields or
   * consuming a payment submit intent. BrowserPaymentExecutor calls this
   * before it asks the shared repository for a one-shot permit.
   */
  async preflight({ page, checkout, cardMaterial, operationId } = {}) {
    if (!this.enabled) throw new LiveChatGPTPaymentAdapterError('LIVE Browser payment adapter is disabled', 'PAYMENT_EXECUTOR_DISABLED');
    if (!page || typeof page.frames !== 'function') throw new TypeError('page is required');
    const op = required(operationId, 'operationId');
    if (!checkout?.recognized || typeof checkout.submitControlSelector !== 'string' || !checkout.submitControlSelector.trim()) {
      throw new LiveChatGPTPaymentAdapterError('recognized Checkout contract is required', 'CHECKOUT_ADAPTER_MISMATCH');
    }
    if (typeof this.checkoutObserver !== 'function') {
      throw new LiveChatGPTPaymentAdapterError('Checkout re-observer is required before payment', 'CHECKOUT_DRIFT');
    }
    if (typeof this.budgetGuard !== 'function') {
      throw new LiveChatGPTPaymentAdapterError('card budget guard is required before payment', 'INSUFFICIENT_CARD_BALANCE');
    }
    cardValues(cardMaterial);
    const observed = await this.checkoutObserver({ page, operationId: op });
    assertCheckoutReadyAndStable(checkout, observed);
    const budget = await this.budgetGuard({ checkout: observed, operationId: op });
    if (budget?.approved !== true) {
      throw new LiveChatGPTPaymentAdapterError('card balance does not cover the current Checkout total', 'INSUFFICIENT_CARD_BALANCE');
    }
    return { status: 'READY', submitCalls: 0 };
  }

  /**
   * Populate card and billing fields without clicking Submit. The returned
   * opaque handle remains process-local and binds the later permit to the
   * address-adjusted tax/total snapshot.
   */
  async prepare({ page, checkout, cardMaterial, operationId, assertContinue = async () => undefined } = {}) {
    if (!this.enabled) throw new LiveChatGPTPaymentAdapterError('LIVE Browser payment adapter is disabled', 'PAYMENT_EXECUTOR_DISABLED');
    if (!page || typeof page.frames !== 'function') throw new TypeError('page is required');
    const op = required(operationId, 'operationId');
    if (!checkout?.recognized || typeof checkout.submitControlSelector !== 'string' || !checkout.submitControlSelector.trim()) {
      throw new LiveChatGPTPaymentAdapterError('recognized Checkout contract is required', 'CHECKOUT_ADAPTER_MISMATCH');
    }
    if (typeof this.checkoutObserver !== 'function') {
      throw new LiveChatGPTPaymentAdapterError('Checkout re-observer is required before payment', 'CHECKOUT_DRIFT');
    }
    if (typeof this.budgetGuard !== 'function') {
      throw new LiveChatGPTPaymentAdapterError('card budget guard is required before payment', 'INSUFFICIENT_CARD_BALANCE');
    }
    const values = cardValues(cardMaterial);
    const fields = {};
    const billingFields = {};
    const prepared = { page, operationId: op, fields, billingFields, finalCheckout: null, checkoutSnapshotHash: null };
    try {
      const beforeFill = await this.checkoutObserver({ page, operationId: op });
      assertCheckoutReadyAndStable(checkout, beforeFill);
      for (const [name, selector] of Object.entries(SECURE_CARD_FIELD_SELECTORS)) {
        fields[name] = await oneVisible(page, selector, name, this.fieldTimeoutMs);
      }
      for (const [name, field] of Object.entries(fields)) {
        await assertContinue();
        if ((await field.inputValue()).trim()) {
          throw new LiveChatGPTPaymentAdapterError(`${name} secure field is not empty`, 'CHECKOUT_DRIFT');
        }
        await field.fill(values[name]);
      }
      for (const [name, selector] of Object.entries(BILLING_FIELD_SELECTORS)) {
        billingFields[name] = await oneVisible(page, selector, `billing ${name}`, this.fieldTimeoutMs);
      }
      const billing = values.billingAddress;
      await assertContinue();
      await billingFields.country.selectOption(billing.country);
      await billingFields.name.fill(billing.name);
      await billingFields.line1.fill(billing.line1);
      await billingFields.city.fill(billing.city);
      await billingFields.postalCode.fill(billing.postalCode);
      if (billing.country === 'US') await billingFields.state.selectOption(billing.state);
      await billingFields.postalCode.press('Tab');
      await assertContinue();
      const finalCheckout = await this.checkoutObserver({ page, operationId: op });
      // Tax and total are allowed to settle only during this pre-permit phase.
      assertCheckoutIdentity(checkout, finalCheckout);
      const budget = await this.budgetGuard({ checkout: finalCheckout, operationId: op });
      if (budget?.approved !== true) {
        throw new LiveChatGPTPaymentAdapterError('card balance does not cover the final Checkout total', 'INSUFFICIENT_CARD_BALANCE');
      }
      prepared.finalCheckout = finalCheckout;
      prepared.checkoutSnapshotHash = checkoutSnapshotHash(finalCheckout);
      return prepared;
    } catch (error) {
      await clearPreparedFields(prepared);
      if (error instanceof LiveChatGPTPaymentAdapterError || error instanceof ContractError) throw error;
      throw new LiveChatGPTPaymentAdapterError('LIVE Browser payment preparation failed', 'CHECKOUT_DRIFT', error);
    }
  }

  async submitPrepared({ prepared, assertContinue = async () => undefined } = {}) {
    if (!this.enabled) throw new LiveChatGPTPaymentAdapterError('LIVE Browser payment adapter is disabled', 'PAYMENT_EXECUTOR_DISABLED');
    if (!prepared?.page || !prepared?.finalCheckout || !prepared?.checkoutSnapshotHash) {
      throw new LiveChatGPTPaymentAdapterError('prepared Checkout handle is required', 'CHECKOUT_DRIFT');
    }
    const { page, operationId: op, finalCheckout } = prepared;
    await assertContinue();
    const current = await this.checkoutObserver({ page, operationId: op });
    assertCheckoutReadyAndStable(finalCheckout, current);
    if (checkoutSnapshotHash(current) !== prepared.checkoutSnapshotHash) {
      throw new LiveChatGPTPaymentAdapterError('prepared Checkout snapshot changed before payment', 'CHECKOUT_DRIFT');
    }
    const budget = await this.budgetGuard({ checkout: current, operationId: op });
    if (budget?.approved !== true) {
      throw new LiveChatGPTPaymentAdapterError('card balance does not cover the final Checkout total', 'INSUFFICIENT_CARD_BALANCE');
    }
    const submit = await oneVisible(page, current.submitControlSelector, 'payment submit control', this.fieldTimeoutMs);
    const shape = await submit.evaluate((element) => ({
      tag: element.tagName.toLowerCase(), type: element.getAttribute('type')?.toLowerCase() || null,
    }));
    if (shape.tag !== 'button' || shape.type !== 'submit') throw new ContractError('payment submit control shape drift');
    await assertContinue();
    await submit.click();
    if (typeof this.outcomeObserver !== 'function') {
      throw new LiveChatGPTPaymentAdapterError('payment outcome observer is required after submit', 'PAYMENT_RESULT_UNKNOWN');
    }
    const outcome = await this.outcomeObserver({ page, operationId: op });
    if (outcome?.status !== 'CONFIRMED') {
      throw new LiveChatGPTPaymentAdapterError('payment outcome was not confirmed', 'PAYMENT_RESULT_UNKNOWN');
    }
    return { status: 'CONFIRMED', providerCallRef: `browser:${op}` };
  }

  async cleanupPrepared(prepared) {
    await clearPreparedFields(prepared);
  }

  async submit({ page, checkout, cardMaterial, operationId, assertContinue = async () => undefined } = {}) {
    let prepared = null;
    let submitted = false;
    try {
      prepared = await this.prepare({ page, checkout, cardMaterial, operationId, assertContinue });
      submitted = true;
      return await this.submitPrepared({ prepared, assertContinue });
    } catch (error) {
      if (error instanceof LiveChatGPTPaymentAdapterError) throw error;
      throw new LiveChatGPTPaymentAdapterError(
        'LIVE Browser payment failed', submitted ? 'PAYMENT_RESULT_UNKNOWN' : 'CHECKOUT_DRIFT', error,
      );
    } finally {
      if (prepared) await this.cleanupPrepared(prepared).catch(() => undefined);
    }
  }
}

export { BILLING_FIELD_SELECTORS };
