const NEVER_REFUND_TYPES = new Set([
  'CARD_RECHARGE'
]);

const REFUND_CANDIDATE_TYPES = new Set([
  'REFUND',
  'CARD_REFUND',
  'PURCHASE_REFUND',
  'REVERSAL'
]);

export function classifyCardTransaction(transaction) {
  const type = String(transaction?.type ?? transaction?.transaction_type ?? '')
    .trim()
    .toUpperCase();
  if (NEVER_REFUND_TYPES.has(type)) return 'NOT_REFUND';
  if (REFUND_CANDIDATE_TYPES.has(type)) return 'REFUND_CANDIDATE';
  return 'UNKNOWN';
}
