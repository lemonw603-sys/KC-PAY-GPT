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

  async submit({ page, checkout, cardMaterial, operationId, assertContinue = async () => undefined } = {}) {
    if (!this.enabled) throw new LiveChatGPTPaymentAdapterError('LIVE Browser payment adapter is disabled', 'PAYMENT_EXECUTOR_DISABLED');
    if (!page || typeof page.frames !== 'function') throw new TypeError('page is required');
    if (!checkout?.recognized || checkout.submitControlSelector == null) {
      throw new LiveChatGPTPaymentAdapterError('recognized Checkout contract is required', 'CHECKOUT_ADAPTER_MISMATCH');
    }
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
      for (const [name, field] of Object.entries(fields)) {
        await assertContinue();
        if ((await field.inputValue()).trim()) throw new LiveChatGPTPaymentAdapterError(`${name} secure field is not empty`, 'CHECKOUT_DRIFT');
        await field.fill(values[name]);
      }
      await assertContinue();
      const submit = await oneVisible(page, checkout.submitControlSelector, 'payment submit control');
      const shape = await submit.evaluate((element) => ({
        tag: element.tagName.toLowerCase(), type: element.getAttribute('type')?.toLowerCase() || null,
      }));
      if (shape.tag !== 'button' || shape.type !== 'submit') throw new ContractError('payment submit control shape drift');
      await submit.click();
      if (typeof this.outcomeObserver !== 'function') {
        throw new LiveChatGPTPaymentAdapterError('payment outcome observer is required after submit', 'PAYMENT_RESULT_UNKNOWN');
      }
      const outcome = await this.outcomeObserver({ page, operationId: required(operationId, 'operationId') });
      if (outcome?.status !== 'CONFIRMED') {
        throw new LiveChatGPTPaymentAdapterError('payment outcome was not confirmed', 'PAYMENT_RESULT_UNKNOWN');
      }
      return { status: 'CONFIRMED', providerCallRef: `browser:${required(operationId, 'operationId')}` };
    } catch (error) {
      if (error instanceof LiveChatGPTPaymentAdapterError) throw error;
      throw new LiveChatGPTPaymentAdapterError('LIVE Browser payment failed', 'PAYMENT_RESULT_UNKNOWN', error);
    }
  }
}
