import { ContractError } from './contracts.js';
import { assertCardMaterial } from './card-material-lease.js';
import { SECURE_CARD_FIELD_SELECTORS } from './nonpayment-card-fill.js';
import { fillBillingAddress, fillTransientBillingEmail } from './billing-address-fill.js';
import { observeCheckout } from './checkout-observer.js';

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

async function observeStrictQuoteAfterReprice(page, checkoutContract, timeoutMs, assertContinue) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    await assertContinue();
    try { return await observeCheckout(page, checkoutContract); } catch (error) {
      lastError = error;
      const pending = /tax is not zero|summary is incomplete|quote is incomplete|quote total does not match subtotal/i
        .test(String(error?.message || ''));
      if (!pending || Date.now() >= deadline) throw error;
      await page.waitForTimeout(250);
    }
  } while (true);
  throw lastError;
}

/**
 * Minimal LIVE adapter. It is inert unless both enabled=true and the exact
 * confirmation string are supplied by a separately controlled caller.
 * The adapter never decides success from a click; the caller must provide an
 * outcome observer, otherwise the result is deliberately UNKNOWN.
 */
export class LiveChatGPTPaymentAdapter {
  constructor({ enabled = false, confirmation = '', outcomeObserver = null } = {}) {
    this.enabled = enabled === true && confirmation === LIVE_PAYMENT_CONFIRMATION;
    this.outcomeObserver = outcomeObserver;
  }

  async submit({
    page, checkout, checkoutContract, cardMaterial, billingEmail, operationId,
    assertContinue = async () => undefined,
    beforeSubmit = async () => undefined,
    authorizeSubmit = null,
    repriceTimeoutMs = 30_000,
  } = {}) {
    if (!this.enabled) throw new LiveChatGPTPaymentAdapterError('LIVE Browser payment adapter is disabled', 'PAYMENT_EXECUTOR_DISABLED');
    if (!page || typeof page.frames !== 'function') throw new TypeError('page is required');
    const op = required(operationId, 'operationId');
    if (!checkout?.recognized || typeof checkout.submitControlSelector !== 'string' || !checkout.submitControlSelector.trim()) {
      throw new LiveChatGPTPaymentAdapterError('recognized Checkout contract is required', 'CHECKOUT_ADAPTER_MISMATCH');
    }
    if (!checkoutContract || checkoutContract.requiredCurrency !== 'PHP'
      || checkoutContract.requireZeroTax !== true
      || checkoutContract.requireQuoteConsistency !== true) {
      throw new LiveChatGPTPaymentAdapterError('strict PHP zero-tax Checkout contract is required', 'CHECKOUT_ADAPTER_MISMATCH');
    }
    if (typeof assertContinue !== 'function' || typeof beforeSubmit !== 'function') {
      throw new TypeError('assertContinue and beforeSubmit are required');
    }
    if (typeof authorizeSubmit !== 'function') throw new TypeError('authorizeSubmit is required');
    if (!Number.isInteger(repriceTimeoutMs) || repriceTimeoutMs < 1_000 || repriceTimeoutMs > 60_000) {
      throw new TypeError('repriceTimeoutMs must be between 1000 and 60000');
    }
    let submitted = false;
    try {
      assertCardMaterial(cardMaterial);
      const fields = {};
      for (const [name, selector] of Object.entries(SECURE_CARD_FIELD_SELECTORS)) {
        fields[name] = await oneVisible(page, selector, name);
      }
      const values = {
        cardNumber: String(cardMaterial.pan).replace(/\s+/g, ''),
        expiry: `${String(cardMaterial.expMonth).padStart(2, '0')} / ${String(cardMaterial.expYear).slice(-2)}`,
        cvc: String(cardMaterial.cvc),
      };
      if (!/^\d{12,19}$/.test(values.cardNumber) || !/^\d{3,4}$/.test(values.cvc)) {
        throw new LiveChatGPTPaymentAdapterError('card material format is invalid', 'CARD_MATERIAL_INVALID');
      }
      try {
        for (const [name, field] of Object.entries(fields)) {
          await assertContinue();
          if ((await field.inputValue()).trim()) throw new LiveChatGPTPaymentAdapterError(`${name} secure field is not empty`, 'CHECKOUT_DRIFT');
          await field.fill(values[name]);
        }
        if (!cardMaterial.billingAddress) {
          throw new LiveChatGPTPaymentAdapterError('billing address is required', 'CARD_MATERIAL_INVALID');
        }
        await assertContinue();
        await fillBillingAddress(page, cardMaterial.billingAddress, { timeoutMs: repriceTimeoutMs });
        await assertContinue();
        await fillTransientBillingEmail(page, billingEmail, { timeoutMs: repriceTimeoutMs, required: true });
        const strictCheckout = await observeStrictQuoteAfterReprice(
          page, checkoutContract, repriceTimeoutMs, assertContinue,
        );
        if (strictCheckout.submitControlSelector !== checkout.submitControlSelector) {
          throw new LiveChatGPTPaymentAdapterError('payment submit selector changed after requote', 'CHECKOUT_DRIFT');
        }
        await assertContinue();
        await beforeSubmit({ checkout: strictCheckout });
        await assertContinue();
        const submit = await oneVisible(page, strictCheckout.submitControlSelector, 'payment submit control');
        const shape = await submit.evaluate((element) => ({
          tag: element.tagName.toLowerCase(), type: element.getAttribute('type')?.toLowerCase() || null,
        }));
        if (shape.tag !== 'button' || shape.type !== 'submit') throw new ContractError('payment submit control shape drift');
        const intent = await authorizeSubmit();
        if (!intent?.executeExternal) return { status: 'RECONCILE_ONLY' };
        await submit.click();
        submitted = true;
        if (typeof this.outcomeObserver !== 'function') {
          throw new LiveChatGPTPaymentAdapterError('payment outcome observer is required after submit', 'PAYMENT_RESULT_UNKNOWN');
        }
        const outcome = await this.outcomeObserver({ page, operationId: op });
        if (outcome?.status !== 'CONFIRMED') {
          throw new LiveChatGPTPaymentAdapterError('payment outcome was not confirmed', 'PAYMENT_RESULT_UNKNOWN');
        }
        return {
          status: 'CONFIRMED', providerCallRef: `browser:${op}`,
          quote: {
            currency: strictCheckout.currency,
            amount: strictCheckout.amount,
            estimatedTax: strictCheckout.estimatedTax,
          },
        };
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
