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
  const currentYear = new Date().getUTCFullYear();
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < currentYear) {
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
 * Fills Stripe-like secure fields and clears only fields written by this call.
 * This is a non-payment simulation primitive: it has no click or submit
 * operation and returns only counts/status, never card material.
 *
 * Clearing happens on the clean path and on a *partial* fill failure. It does
 * NOT happen once every field is written and the failure comes from the
 * whileFilled callback (billing address, requote observation): that page is a
 * complete failure scene — card, billing and price all on screen — and it is
 * left intact so an operator can take over and so the run can be diagnosed
 * (D-203, requested by the operator 2026-09-13). Wiping it was actively
 * misleading: it made "filled, then wiped" read as "never filled".
 * Safety boundary: the next order runs with startFresh=true
 * (shared-runtime-integration.js) which closes this checkout page before
 * anything else, so the PAN never reaches the following customer's session.
 */
export async function fillSecureCardFieldsNonPayment(page, {
  cardMaterialLeaseProvider,
  lease,
  material = undefined,
  whileFilled = null,
  assertContinue = async () => undefined,
  timeoutMs = 5_000,
} = {}) {
  if (!page || typeof page.frames !== 'function') throw new TypeError('page is required');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new TypeError('timeoutMs must be between 1 and 30000');
  if (whileFilled != null && typeof whileFilled !== 'function') throw new TypeError('whileFilled must be a function');
  if (material === undefined && (!cardMaterialLeaseProvider || typeof cardMaterialLeaseProvider.withMaterial !== 'function' || typeof cardMaterialLeaseProvider.assertActive !== 'function' || !lease)) {
    throw new TypeError('card material lease provider and lease are required');
  }

  const fill = async (cardMaterial) => {
    const inputValues = values(cardMaterial);
    const fields = {};
    const written = [];
    let allFieldsWritten = false;
    let finishedCleanly = false;
    for (const [name, selector] of Object.entries(FIELD_SELECTORS)) {
      fields[name] = await uniqueVisibleField(page, selector, name);
    }
    for (const [name, field] of Object.entries(fields)) {
      if ((await field.inputValue()).trim() !== '') throw new ContractError(`${name} secure field is not empty`);
    }
    try {
      for (const [name, field] of Object.entries(fields)) {
        if (material === undefined) cardMaterialLeaseProvider.assertActive(lease);
        await assertContinue();
        await field.fill(inputValues[name], { timeout: timeoutMs });
        written.push(field);
      }
      if (material === undefined) cardMaterialLeaseProvider.assertActive(lease);
      await assertContinue();
      allFieldsWritten = true;
      if (whileFilled) await whileFilled(cardMaterial);
      finishedCleanly = true;
      return { status: 'FILLED_AND_CLEARED', fieldsFilled: written.length, fieldsCleared: 0, submitCalls: 0, paymentClicked: false };
    } finally {
      // Hold the scene only when the card went in whole and the *later* step failed.
      // A partial fill (lease lost/expired mid-field) is a half-written form that
      // helps nobody, so it still gets wiped.
      const holdForOperator = allFieldsWritten && !finishedCleanly;
      let fieldsCleared = 0;
      for (const field of holdForOperator ? [] : written) {
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
