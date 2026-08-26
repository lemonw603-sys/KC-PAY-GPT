import { ContractError } from './contracts.js';
import { assertCardMaterial } from './card-material-lease.js';

const FIELD_SELECTORS = Object.freeze({
  cardNumber: 'input[autocomplete="cc-number"]',
  expiry: 'input[autocomplete="cc-exp"]',
  cvc: 'input[autocomplete="cc-csc"]',
});

async function uniqueVisibleField(page, selector, name) {
  const matches = [];
  for (const frame of page.frames()) {
    const locator = frame.locator(selector);
    for (let index = 0; index < await locator.count(); index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible()) matches.push(candidate);
    }
  }
  if (matches.length !== 1) throw new ContractError(`${name} secure field must resolve to one visible input`);
  return matches[0];
}

function formatExpiry(material) {
  const month = Number(material.expMonth);
  const year = Number(material.expYear);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 2000) {
    throw new ContractError('card expiry is invalid');
  }
  return `${String(month).padStart(2, '0')} / ${String(year).slice(-2)}`;
}

function values(material) {
  assertCardMaterial(material);
  const pan = String(material.pan).replace(/\s+/g, '');
  const cvc = String(material.cvc).trim();
  if (!/^\d{12,19}$/.test(pan) || !/^\d{3,4}$/.test(cvc)) throw new ContractError('card material format is invalid');
  return { cardNumber: pan, expiry: formatExpiry(material), cvc };
}

/**
 * Fills Stripe-like secure fields and immediately clears only fields written by
 * this call. This is a non-payment simulation primitive: it has no click or
 * submit operation and returns only counts/status, never card material.
 */
export async function fillSecureCardFieldsNonPayment(page, {
  cardMaterialLeaseProvider,
  lease,
  material = undefined,
  assertContinue = async () => undefined,
  timeoutMs = 5_000,
} = {}) {
  if (!page || typeof page.frames !== 'function') throw new TypeError('page is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new TypeError('timeoutMs must be between 1 and 30000');
  if (material === undefined && (!cardMaterialLeaseProvider || typeof cardMaterialLeaseProvider.withMaterial !== 'function' || !lease)) {
    throw new TypeError('card material lease provider and lease are required');
  }

  const fill = async (cardMaterial) => {
    const inputValues = values(cardMaterial);
    const fields = {};
    const written = [];
    for (const [name, selector] of Object.entries(FIELD_SELECTORS)) {
      fields[name] = await uniqueVisibleField(page, selector, name);
    }
    for (const [name, field] of Object.entries(fields)) {
      if ((await field.inputValue()).trim() !== '') throw new ContractError(`${name} secure field is not empty`);
    }
    try {
      for (const [name, field] of Object.entries(fields)) {
        await assertContinue();
        await field.fill(inputValues[name], { timeout: timeoutMs });
        written.push(field);
      }
      await assertContinue();
      return { status: 'FILLED_AND_CLEARED', fieldsFilled: written.length, fieldsCleared: 0, submitCalls: 0, paymentClicked: false };
    } finally {
      let fieldsCleared = 0;
      for (const field of written) {
        try {
          await field.fill('', { timeout: timeoutMs });
          fieldsCleared += 1;
        } catch {
          // Cleanup is best effort; the caller still receives a fail-closed error
          // if the lease/assertContinue or field fill failed above.
        }
      }
      // Return values cannot be changed from a finally block, so attach cleanup
      // count to the local result through the closure below.
      cleanupCount = fieldsCleared;
    }
  };

  let cleanupCount = 0;
  const result = material === undefined
    ? await cardMaterialLeaseProvider.withMaterial(lease, fill)
    : await fill(material);
  return { ...result, fieldsCleared: cleanupCount };
}

export const SECURE_CARD_FIELD_SELECTORS = FIELD_SELECTORS;
