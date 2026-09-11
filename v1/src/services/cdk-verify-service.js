import { CDK_RETURN_ORDER_STATUSES } from '../db/repositories/cdk-return-repository.js';
import { cdkReturnWouldBeBlocked, findCdkForVerification } from '../db/repositories/cdk-verify-repository.js';
import { productLabel } from '../domain/product-labels.js';
import { PublicApiError } from '../domain/public-api-error.js';
import { createCdkLookup } from '../security/cdk-code.js';

/**
 * The four answers a customer can get before typing a Session.
 *
 * VALID           the code can start an order now — go to the Session step.
 * NEEDS_SESSION   the code already has an order, and that order is waiting for
 *                 a replacement Session. Same step, different wording: what the
 *                 customer submits next repairs the existing order (F-34/F-35),
 *                 it does not open a second one.
 * BOUND_TO_ORDER  the code is spent on an order that is still running, already
 *                 delivered, or held for a person. Send the customer to that
 *                 order's progress, not to a new submission.
 * INVALID         no such code, revoked, or a state we refuse to guess about.
 */
export const CDK_VERIFY_STATES = Object.freeze({
  VALID: 'VALID',
  NEEDS_SESSION: 'NEEDS_SESSION',
  BOUND_TO_ORDER: 'BOUND_TO_ORDER',
  INVALID: 'INVALID'
});

function readCdkInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new PublicApiError('Verification request must be a JSON object', {
      code: 'INVALID_CDK_REQUEST',
      status: 400
    });
  }
  if (typeof input.cdk !== 'string') {
    throw new PublicApiError('Verification request must carry a cdk string', {
      code: 'INVALID_CDK_REQUEST',
      status: 400
    });
  }
  // A mistyped code is an answer, not a protocol error: the page says the code
  // is invalid rather than showing the customer a failed request.
  const cdk = input.cdk.trim();
  return cdk.length < 8 || cdk.length > 256 ? null : cdk;
}

function invalid() {
  return { state: CDK_VERIFY_STATES.INVALID };
}

export function createCdkVerifyService({
  pool,
  cdkHashKey,
  repository = { findCdkForVerification, cdkReturnWouldBeBlocked }
}) {
  return async function verifyCustomerCdk(input) {
    const cdk = readCdkInput(input);
    if (!cdk) return invalid();

    const found = await repository.findCdkForVerification(pool, createCdkLookup(cdk, cdkHashKey));
    if (!found) return invalid();
    // REVOKED, and anything a future migration adds, fall through to invalid:
    // only a state this code was written to understand may say "go ahead".
    if (found.status !== 'AVAILABLE' && found.status !== 'REDEEMED') return invalid();

    const product = {
      planType: String(found.planType || 'plus'),
      label: found.productName || productLabel(found.planType)
    };

    if (found.status === 'AVAILABLE') {
      return { state: CDK_VERIFY_STATES.VALID, product };
    }

    // REDEEMED without an order row is a broken pairing, not an entitlement.
    // Say invalid and let the operator alerting on order intake be the one to
    // surface it; never invite a Session into an order that isn't there.
    if (!found.order) return invalid();

    if (found.order.status === 'WAITING_FOR_SESSION') {
      return {
        state: CDK_VERIFY_STATES.NEEDS_SESSION,
        product,
        order: { publicNo: found.order.publicNo }
      };
    }

    // An order that ended without delivering hands the code back at intake —
    // but only when no payment evidence blocks the return. Ask the shared rule
    // rather than assuming, so this screen and intake always agree.
    if (CDK_RETURN_ORDER_STATUSES.includes(found.order.status)) {
      const blocked = await repository.cdkReturnWouldBeBlocked(pool, found.order.internalOrderId);
      if (!blocked) return { state: CDK_VERIFY_STATES.VALID, product };
    }

    return {
      state: CDK_VERIFY_STATES.BOUND_TO_ORDER,
      product,
      order: { publicNo: found.order.publicNo }
    };
  };
}
