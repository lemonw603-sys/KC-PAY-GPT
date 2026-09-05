const ACTIVE_RECHARGE_STATUSES = new Set(['SUBMITTING', 'RECHARGE_PROCESSING']);
const FAILED_RECHARGE_STATUSES = new Set(['RECHARGE_FAILED']);

export function reconcileOrderEvidence({
  orderStatus,
  rechargeOrderNo = null,
  createAttempted = false,
  createAttemptStalled = false,
  hasRechargeSuccessEvent = false,
  actualPaymentAmount = null,
  actualPaymentCurrency = null,
  transactionEvidenceSynced = false,
  successfulPurchaseExists = false,
  paymentMatched = false,
  paymentSettled = false
}) {
  const status = String(orderStatus || '');
  const effectiveSuccess = status === 'RECHARGE_SUCCESS' || hasRechargeSuccessEvent;
  const hasPaymentResult = actualPaymentAmount != null && Boolean(actualPaymentCurrency);

  if (createAttemptStalled) {
    return { status: 'REVIEW_REQUIRED', code: 'RECHARGE_CREATE_STALLED', issue: true };
  }

  if (status === 'RECONCILIATION_REQUIRED' || status === 'SUBMIT_UNKNOWN') {
    return { status: 'REVIEW_REQUIRED', code: status, issue: true };
  }
  // A provider-confirmed failure may legitimately have no external order ID.
  // Check the terminal failure evidence before the generic missing-ID branch.
  if (FAILED_RECHARGE_STATUSES.has(status)
    || (status === 'CLOSED' && (createAttempted || rechargeOrderNo || successfulPurchaseExists))) {
    if (successfulPurchaseExists) {
      return { status: 'REVIEW_REQUIRED', code: 'FAILED_ORDER_HAS_SUCCESSFUL_CHARGE', issue: true };
    }
    return { status: 'CONSISTENT_FAILURE', code: 'NO_SUCCESSFUL_CARD_CHARGE', issue: false };
  }
  if (!createAttempted && !rechargeOrderNo) {
    if (successfulPurchaseExists) {
      return { status: 'REVIEW_REQUIRED', code: 'CARD_CHARGED_WITHOUT_RECHARGE', issue: true };
    }
    return { status: 'NOT_SUBMITTED', code: 'RECHARGE_NOT_SUBMITTED', issue: false };
  }
  if (!rechargeOrderNo) {
    if (status === 'SUBMITTING') {
      return { status: 'IN_PROGRESS', code: 'SUBMISSION_IN_PROGRESS', issue: false };
    }
    return { status: 'REVIEW_REQUIRED', code: 'RECHARGE_ORDER_ID_MISSING', issue: true };
  }
  if (ACTIVE_RECHARGE_STATUSES.has(status)) {
    return { status: 'IN_PROGRESS', code: 'RECHARGE_IN_PROGRESS', issue: false };
  }
  if (effectiveSuccess) {
    if (!hasPaymentResult) {
      return { status: 'REVIEW_REQUIRED', code: 'PROVIDER_PAYMENT_EVIDENCE_MISSING', issue: true };
    }
    if (!transactionEvidenceSynced) {
      return { status: 'EVIDENCE_PENDING', code: 'CARD_TRANSACTIONS_NOT_SYNCED', issue: false };
    }
    if (!paymentMatched) {
      return {
        status: 'REVIEW_REQUIRED',
        code: successfulPurchaseExists ? 'PAYMENT_AMOUNT_MISMATCH' : 'CARD_PAYMENT_NOT_FOUND',
        issue: true
      };
    }
    return paymentSettled
      ? { status: 'MATCHED', code: 'THREE_WAY_MATCHED', issue: false }
      : { status: 'EVIDENCE_PENDING', code: 'CARD_PAYMENT_UNSETTLED', issue: false };
  }
  return { status: 'IN_PROGRESS', code: 'ORDER_NOT_TERMINAL', issue: false };
}
