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

async function oneVisible(page, selector, label, timeoutMs = 45_000) {
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
  constructor({ enabled = false, confirmation = '', outcomeObserver = null, challengeGate = null } = {}) {
    this.enabled = enabled === true && confirmation === LIVE_PAYMENT_CONFIRMATION;
    this.outcomeObserver = outcomeObserver;
    // D-154: optional human-verification gate. It only observes and waits; it
    // never satisfies the challenge and never issues a second submit click.
    this.challengeGate = challengeGate;
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
    let holdForReconcile = false;
    // D-154: set only when a human-verification challenge raised by our single
    // submit click is still unanswered when we let go. The filled form is then
    // left for the PERSON who has to satisfy that challenge; clearing it would
    // strand them with an empty card form and no way to finish the purchase.
    let holdForHumanVerification = false;
    let stage = 'validate-card-material';
    try {
      assertCardMaterial(cardMaterial);
      stage = 'resolve-secure-card-controls';
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
        stage = 'fill-secure-card-controls';
        for (const [name, field] of Object.entries(fields)) {
          await assertContinue();
          if ((await field.inputValue()).trim()) throw new LiveChatGPTPaymentAdapterError(`${name} secure field is not empty`, 'CHECKOUT_DRIFT');
          await field.fill(values[name]);
        }
        if (!cardMaterial.billingAddress) {
          throw new LiveChatGPTPaymentAdapterError('billing address is required', 'CARD_MATERIAL_INVALID');
        }
        stage = 'fill-billing-address';
        await assertContinue();
        await fillBillingAddress(page, cardMaterial.billingAddress, { timeoutMs: repriceTimeoutMs });
        stage = 'fill-billing-email';
        await assertContinue();
        // Not every Checkout implementation asks for a receipt email (see
        // fillTransientBillingEmail). A page that does ask still must resolve to
        // exactly one field, so this cannot silently skip a real requirement.
        await fillTransientBillingEmail(page, billingEmail, { timeoutMs: repriceTimeoutMs });
        stage = 'wait-for-zero-tax-requote';
        const strictCheckout = await observeStrictQuoteAfterReprice(
          page, checkoutContract, repriceTimeoutMs, assertContinue,
        );
        if (strictCheckout.submitControlSelector !== checkout.submitControlSelector) {
          throw new LiveChatGPTPaymentAdapterError('payment submit selector changed after requote', 'CHECKOUT_DRIFT');
        }
        stage = 'final-pre-submit-check';
        await assertContinue();
        await beforeSubmit({ checkout: strictCheckout });
        await assertContinue();
        const submit = await oneVisible(page, strictCheckout.submitControlSelector, 'payment submit control');
        const shape = await submit.evaluate((element) => ({
          tag: element.tagName.toLowerCase(), type: element.getAttribute('type')?.toLowerCase() || null,
        }));
        if (shape.tag !== 'button' || shape.type !== 'submit') throw new ContractError('payment submit control shape drift');
        const intent = await authorizeSubmit();
        if (!intent?.executeExternal) {
          // Intentional in-attempt hold: no external submit happens, so keep the
          // filled form for the reconcile/requote path (do not clear below).
          holdForReconcile = true;
          return {
            status: 'RECONCILE_ONLY',
            quote: { currency: strictCheckout.currency, amount: strictCheckout.amount, estimatedTax: strictCheckout.estimatedTax },
          };
        }
        stage = 'submit-payment';
        await submit.click();
        submitted = true;
        if (typeof this.outcomeObserver !== 'function') {
          throw new LiveChatGPTPaymentAdapterError('payment outcome observer is required after submit', 'PAYMENT_RESULT_UNKNOWN');
        }
        let challenge = null;
        if (typeof this.challengeGate === 'function') {
          stage = 'human-verification-gate';
          challenge = await this.challengeGate({ page, operationId: op, assertContinue });
          if (challenge?.challenged && !challenge.cleared) {
            holdForHumanVerification = true;
            // The click already happened, so this stays an UNKNOWN result: the
            // page may still settle after we let go. The reason is recorded so
            // the run says "a person had to verify" instead of nothing at all.
            throw new LiveChatGPTPaymentAdapterError(
              `payment is waiting on human verification (${challenge.reason || 'HUMAN_VERIFICATION_REQUIRED'})`,
              'PAYMENT_RESULT_UNKNOWN',
            );
          }
        }
        stage = 'observe-payment-outcome';
        const outcome = await this.outcomeObserver({ page, operationId: op, challenge });
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
        // Clear the secure card fields on every exit EXCEPT the intentional
        // reconcile hold (holdForReconcile), which deliberately keeps the filled
        // form for an in-attempt requote. This covers both the post-submit
        // boundary (submitted) and — critically — a pre-submit failure (drift/
        // timeout/lease loss): leaving the PAN in the field would keep card data
        // resident in a reusable page and poison any retry that reuses the same
        // checkout, which then fails the "secure field is not empty" guard
        // forever. Cleanup is best effort; after submit the page may have moved.
        // The one exception is holdForHumanVerification (D-154): the challenge is
        // still on screen and only a person can clear it, so the form stays. The
        // next order navigates to its own checkout, so nothing is reused.
        if ((submitted || !holdForReconcile) && !holdForHumanVerification) {
          for (const field of Object.values(fields)) {
            try { await field.fill(''); } catch {
              await field.evaluate((element) => { element.value = ''; element.dispatchEvent(new Event('input', { bubbles: true })); }).catch(() => undefined);
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof LiveChatGPTPaymentAdapterError) throw error;
      throw new LiveChatGPTPaymentAdapterError(
        `LIVE Browser payment failed at ${stage}`,
        submitted ? 'PAYMENT_RESULT_UNKNOWN' : 'CHECKOUT_DRIFT', error,
      );
    }
  }
}
