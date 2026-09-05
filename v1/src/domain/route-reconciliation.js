import { reconcileOrderEvidence } from './order-reconciliation.js';

/**
 * Build the evidence contract without assuming a particular card provider.
 * API routes may include an external recharge result; Browser routes rely on
 * Browser/Plus evidence; manual-card routes rely on the local ledger and a
 * later snapshot. Missing real-time transaction API is therefore pending, not
 * automatically an error.
 */
export function reconcileByRoute({ executorKind, cardSourceKind = 'API', ...evidence } = {}) {
  const executor = String(executorKind || '').toUpperCase();
  const source = String(cardSourceKind || '').toUpperCase();
  if (!['API', 'BROWSER'].includes(executor)) {
    return { status: 'REVIEW_REQUIRED', code: 'EXECUTOR_KIND_UNKNOWN', issue: true };
  }
  const result = reconcileOrderEvidence(evidence);
  if (result.issue && result.code === 'RECHARGE_ORDER_ID_MISSING'
    && executor === 'BROWSER') {
    return { status: 'EVIDENCE_PENDING', code: 'BROWSER_EXTERNAL_ORDER_NOT_APPLICABLE', issue: false };
  }
  if (executor === 'BROWSER' && source === 'MANUAL_IMPORT'
    && result.code === 'CARD_TRANSACTIONS_NOT_SYNCED') {
    return { status: 'EVIDENCE_PENDING', code: 'MANUAL_CARD_SNAPSHOT_PENDING', issue: false };
  }
  return result;
}
