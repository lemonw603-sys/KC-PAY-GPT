import { ContractError } from './contracts.js';
import { assertCardMaterial } from './card-material-lease.js';
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

async function oneVisible(page, selector, label) {
  const deadline = Date.now() + 10_000;
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

function cardValues(cardMaterial) {
  assertCardMaterial(cardMaterial);
  const month = Number(cardMaterial.expMonth);
  const year = Number(cardMaterial.expYear);
  const now = new Date();
  const currentMonth = now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
  const expiryMonth = year * 12 + month;
  const values = {
    cardNumber: String(cardMaterial.pan).replace(/\s+/g, ''),
    expiry: `${String(month).padStart(2, '0')} / ${String(year).slice(-2)}`,
    cvc: String(cardMaterial.cvc).trim(),
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
  } = {}) {
    this.enabled = enabled === true && confirmation === LIVE_PAYMENT_CONFIRMATION;
    this.checkoutObserver = checkoutObserver;
    this.budgetGuard = budgetGuard;
    this.outcomeObserver = outcomeObserver;
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

  async submit({ page, checkout, cardMaterial, operationId, assertContinue = async () => undefined } = {}) {
    if (!this.enabled) throw new LiveChatGPTPaymentAdapterError('LIVE Browser payment adapter is disabled', 'PAYMENT_EXECUTOR_DISABLED');
    if (!page || typeof page.frames !== 'function') throw new TypeError('page is required');
    const op = required(operationId, 'operationId');
    if (!checkout?.recognized || typeof checkout.submitControlSelector !== 'string' || !checkout.submitControlSelector.trim()) {
      throw new LiveChatGPTPaymentAdapterError('recognized Checkout contract is required', 'CHECKOUT_ADAPTER_MISMATCH');
    }
    let submitted = false;
    try {
      // Repeat preflight after the authoritative submit intent. Any failure
      // from this point is deliberately treated as UNKNOWN by the executor,
      // because the one-shot intent has already been consumed.
      await this.preflight({ page, checkout, cardMaterial, operationId: op });
      const values = cardValues(cardMaterial);
      const fields = {};
      for (const [name, selector] of Object.entries(SECURE_CARD_FIELD_SELECTORS)) {
        fields[name] = await oneVisible(page, selector, name);
      }
      try {
        for (const [name, field] of Object.entries(fields)) {
          await assertContinue();
          if ((await field.inputValue()).trim()) throw new LiveChatGPTPaymentAdapterError(`${name} secure field is not empty`, 'CHECKOUT_DRIFT');
          await field.fill(values[name]);
        }
        await assertContinue();
        // Card country/BIN can change tax or the amount due. Re-read after the
        // secure fields are populated and before the one permitted click.
        const beforeSubmit = await this.checkoutObserver({ page, operationId: op });
        assertCheckoutReadyAndStable(checkout, beforeSubmit);
        const finalBudget = await this.budgetGuard({ checkout: beforeSubmit, operationId: op });
        if (finalBudget?.approved !== true) {
          throw new LiveChatGPTPaymentAdapterError('card balance does not cover the final Checkout total', 'INSUFFICIENT_CARD_BALANCE');
        }
        const submit = await oneVisible(page, checkout.submitControlSelector, 'payment submit control');
        const shape = await submit.evaluate((element) => ({
          tag: element.tagName.toLowerCase(), type: element.getAttribute('type')?.toLowerCase() || null,
        }));
        if (shape.tag !== 'button' || shape.type !== 'submit') throw new ContractError('payment submit control shape drift');
        await assertContinue();
        await submit.click();
        submitted = true;
        if (typeof this.outcomeObserver !== 'function') {
          throw new LiveChatGPTPaymentAdapterError('payment outcome observer is required after submit', 'PAYMENT_RESULT_UNKNOWN');
        }
        const outcome = await this.outcomeObserver({ page, operationId: op });
        if (outcome?.status !== 'CONFIRMED') {
          throw new LiveChatGPTPaymentAdapterError('payment outcome was not confirmed', 'PAYMENT_RESULT_UNKNOWN');
        }
        return { status: 'CONFIRMED', providerCallRef: `browser:${op}` };
      } finally {
        // Never leave card values in the page after success, failure, or an
        // unknown outcome. Cleanup is best effort because the page may have
        // navigated after the submit click.
        for (const field of Object.values(fields)) {
          try { await field.fill(''); } catch {
            await field.evaluate((element) => { element.value = ''; element.dispatchEvent(new Event('input', { bubbles: true })); }).catch(() => undefined);
          }
        }
      }
    } catch (error) {
      if (error instanceof LiveChatGPTPaymentAdapterError) throw error;
      throw new LiveChatGPTPaymentAdapterError(
        'LIVE Browser payment failed', submitted ? 'PAYMENT_RESULT_UNKNOWN' : 'CHECKOUT_DRIFT', error,
      );
    }
  }
}
