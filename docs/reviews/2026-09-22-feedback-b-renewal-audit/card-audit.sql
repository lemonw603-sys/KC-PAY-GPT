SELECT 'observed_at', UTC_TIMESTAMP(3);

SELECT 'card', JSON_OBJECT(
  'id', c.id,
  'last4', c.last4,
  'inventory', c.inventory_status,
  'status', c.status,
  'balance', c.current_balance,
  'provider', pa.account_code,
  'source', pa.source_adapter,
  'sourcePresent', c.source_present,
  'syncTier', c.sync_tier,
  'activeAssignments', (SELECT COUNT(*) FROM card_assignment_history h WHERE h.card_id = c.id AND h.status = 'ACTIVE'),
  'openRefundCases', (SELECT COUNT(*) FROM refund_cases r WHERE r.card_id = c.id AND r.status NOT IN ('CLOSED','WITHDRAWN')),
  'pendingOrders', (SELECT COUNT(*) FROM orders o WHERE o.assigned_card_id = c.id AND o.status NOT IN ('RECHARGE_SUCCESS','RECHARGE_FAILED','CLOSED'))
)
FROM cards c
JOIN provider_accounts pa ON pa.id = c.provider_account_id
WHERE c.last4 IN ('7402','3159','5371','1657')
ORDER BY c.last4;

SELECT 'ledger', JSON_OBJECT(
  'last4', c.last4,
  'status', l.status,
  'count', COUNT(*),
  'amount', SUM(l.amount)
)
FROM card_consumption_ledger l
JOIN cards c ON c.id = l.card_id
WHERE c.last4 IN ('7402','3159','5371','1657')
GROUP BY c.last4, l.status
ORDER BY c.last4, l.status;
