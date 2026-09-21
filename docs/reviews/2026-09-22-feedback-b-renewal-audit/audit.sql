SELECT 'observed_at', UTC_TIMESTAMP(3);

SELECT 'renewal_summary', JSON_OBJECT(
  'pendingRenewalReview', COUNT(*),
  'success', SUM(o.status = 'RECHARGE_SUCCESS'),
  'subscriptionCancelledNull', SUM(o.subscription_cancelled IS NULL),
  'cancellationCheckedNull', SUM(o.cancellation_checked_at IS NULL),
  'missingConsumed', SUM(NOT EXISTS (
    SELECT 1 FROM card_consumption_ledger l
    WHERE l.order_id = o.id AND l.status = 'CONSUMED'
  ))
)
FROM orders o
WHERE o.cancellation_review_required = 1;

SELECT 'renewal_order', JSON_OBJECT(
  'publicNo', o.public_no,
  'email', CASE
    WHEN o.customer_email IS NULL OR o.customer_email NOT LIKE '%@%' THEN NULL
    ELSE CONCAT(LEFT(SUBSTRING_INDEX(o.customer_email, '@', 1), 2), '***@', SUBSTRING_INDEX(o.customer_email, '@', -1))
  END,
  'status', o.status,
  'subscriptionCancelled', o.subscription_cancelled,
  'cancellationReviewRequired', o.cancellation_review_required,
  'cancellationCheckedAt', o.cancellation_checked_at,
  'finishedAt', o.finished_at,
  'attemptCount', (SELECT COUNT(*) FROM recharge_attempts a WHERE a.order_id = o.id),
  'runCount', (SELECT COUNT(*) FROM browser_runs b JOIN recharge_attempts a ON a.id = b.recharge_attempt_id WHERE a.order_id = o.id),
  'paymentSubmitOps', (SELECT COUNT(*) FROM browser_operations x JOIN browser_runs b ON b.id = x.browser_run_id JOIN recharge_attempts a ON a.id = b.recharge_attempt_id WHERE a.order_id = o.id AND x.operation_type = 'PAYMENT_SUBMIT'),
  'cancellationConfirmedRuns', (SELECT COUNT(*) FROM browser_runs b JOIN recharge_attempts a ON a.id = b.recharge_attempt_id WHERE a.order_id = o.id AND b.post_payment_state = 'CANCELLATION_CONFIRMED'),
  'manualCloseEvents', (SELECT COUNT(*) FROM order_events e WHERE e.order_id = o.id AND e.actor_id = 'close-manually-fulfilled' AND JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.closeManuallyFulfilled')) = 'true'),
  'manualCancellationEvents', (SELECT COUNT(*) FROM order_events e WHERE e.order_id = o.id AND JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.manualCancellation')) = 'true'),
  'unconfirmedCancellationAlerts', (SELECT COUNT(*) FROM operator_alerts r WHERE r.order_id = o.id AND r.alert_type = 'ORDER_CANCELLATION_UNCONFIRMED'),
  'ledger', (SELECT GROUP_CONCAT(CONCAT(l.status, ':', COALESCE(l.amount, 'NULL'), ':', COALESCE(c.last4, 'NULL')) ORDER BY l.created_at SEPARATOR ',') FROM card_consumption_ledger l LEFT JOIN cards c ON c.id = l.card_id WHERE l.order_id = o.id),
  'linkedTransactions', (SELECT GROUP_CONCAT(CONCAT(t.transaction_type, ':', t.status, ':', t.amount, ':', t.currency) ORDER BY t.id SEPARATOR ',') FROM card_consumption_ledger l JOIN card_transactions t ON t.card_id = l.card_id AND t.provider_transaction_id = l.provider_transaction_id WHERE l.order_id = o.id)
)
FROM orders o
WHERE o.cancellation_review_required = 1
ORDER BY o.created_at, o.public_no;

SELECT 'renewal_run', JSON_OBJECT(
  'publicNo', o.public_no,
  'attemptStatus', a.status,
  'fundsRisk', a.funds_risk_state,
  'runStatus', b.status,
  'paymentState', b.payment_state,
  'verificationState', b.verification_state,
  'postPaymentState', b.post_payment_state,
  'lastErrorCode', b.last_error_code,
  'lastCheckpoint', b.last_checkpoint_kind,
  'paymentSubmitOps', (SELECT COUNT(*) FROM browser_operations x WHERE x.browser_run_id = b.id AND x.operation_type = 'PAYMENT_SUBMIT'),
  'createdAt', b.created_at,
  'finishedAt', b.finished_at
)
FROM orders o
JOIN recharge_attempts a ON a.order_id = o.id
JOIN browser_runs b ON b.recharge_attempt_id = a.id
WHERE o.cancellation_review_required = 1
ORDER BY o.created_at, a.created_at, b.created_at;

SELECT 'renewal_close_event', JSON_OBJECT(
  'publicNo', o.public_no,
  'eventId', e.id,
  'fromStatus', e.from_status,
  'toStatus', e.to_status,
  'actorId', e.actor_id,
  'cardUsed', JSON_EXTRACT(e.metadata_json, '$.cardUsed'),
  'cardLast4', JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.cardLast4')),
  'ledgerStatus', JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.ledger.status')),
  'at', e.created_at
)
FROM orders o
JOIN order_events e ON e.order_id = o.id
WHERE o.cancellation_review_required = 1
  AND e.actor_id = 'close-manually-fulfilled'
  AND JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json, '$.closeManuallyFulfilled')) = 'true'
ORDER BY o.created_at, e.created_at;
