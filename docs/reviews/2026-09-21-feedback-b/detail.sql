SELECT 'manual_resolution',JSON_OBJECT('order',o.public_no,'run',b.id,'at',x.completed_at,
 'resultCode',x.result_code,'verifiedOutcome',JSON_UNQUOTE(JSON_EXTRACT(x.public_result_json,'$.verifiedOutcome')),
 'actor',JSON_UNQUOTE(JSON_EXTRACT(x.public_result_json,'$.actorId')),
 'hasNote',CHAR_LENGTH(JSON_UNQUOTE(JSON_EXTRACT(x.public_result_json,'$.evidenceNote')))>0)
FROM browser_operations x JOIN browser_runs b ON b.id=x.browser_run_id
JOIN recharge_attempts a ON a.id=b.recharge_attempt_id JOIN orders o ON o.id=a.order_id
WHERE x.operation_type='MANUAL_VERIFICATION_RESOLVED'
AND (EXISTS(SELECT 1 FROM reconciliation_cases r WHERE r.order_id=o.id AND r.status IN ('OPEN','ASSIGNED'))
 OR EXISTS(SELECT 1 FROM operator_alerts r WHERE r.order_id=o.id AND r.alert_type='BROWSER_PAYMENT_UNKNOWN' AND r.status='OPEN'));
SELECT 'held_ledger',JSON_OBJECT('order',o.public_no,'card',c.last4,'ledgerStatus',l.status,'amount',l.amount,
 'reserved',l.reserved_at,'consumed',l.consumed_at,'released',l.released_at,'evidenceKeys',JSON_KEYS(l.evidence_json),
 'inventory',c.inventory_status,'attemptId',l.recharge_attempt_id)
FROM card_consumption_ledger l JOIN orders o ON o.id=l.order_id JOIN cards c ON c.id=l.card_id
WHERE l.status IN ('RESERVED','RECONCILIATION');
SELECT 'order_event',JSON_OBJECT('order',o.public_no,'from',e.from_status,'to',e.to_status,
 'actorType',e.actor_type,'actorId',e.actor_id,'at',e.created_at,'metadataKeys',JSON_KEYS(e.metadata_json))
FROM order_events e JOIN orders o ON o.id=e.order_id
WHERE o.failure_code='CANCELLED_PRE_SUBMISSION' OR o.cancellation_review_required=1
ORDER BY o.created_at,e.created_at;
SELECT 'run_provenance',JSON_OBJECT('order',o.public_no,'run',b.id,'requestedBy',b.requested_by,
 'lane',b.selected_lane,'lastError',b.last_error_code,'lastCheckpoint',b.last_checkpoint_kind,'created',b.created_at)
FROM browser_runs b JOIN recharge_attempts a ON a.id=b.recharge_attempt_id JOIN orders o ON o.id=a.order_id
WHERE o.failure_code='CANCELLED_PRE_SUBMISSION';
SELECT 'cdk_legacy',JSON_OBJECT('orderStatus',s.order_status,'cdkStatus',s.cdk_status,'pointsHere',s.points_here,'count',s.n)
FROM (SELECT o.status AS order_status,c.status AS cdk_status,c.order_id=o.id AS points_here,COUNT(*) AS n
FROM orders o JOIN cdks c ON c.id=o.cdk_id GROUP BY order_status,cdk_status,points_here) s;
SELECT 'integrity',JSON_OBJECT(
 'ordersMissingCdk',(SELECT COUNT(*) FROM orders o LEFT JOIN cdks c ON c.id=o.cdk_id WHERE c.id IS NULL),
 'attemptMissingOrder',(SELECT COUNT(*) FROM recharge_attempts a LEFT JOIN orders o ON o.id=a.order_id WHERE o.id IS NULL),
 'ledgerMissingOrder',(SELECT COUNT(*) FROM card_consumption_ledger l LEFT JOIN orders o ON o.id=l.order_id WHERE o.id IS NULL),
 'duplicatePublicNo',(SELECT COUNT(*) FROM (SELECT public_no FROM orders GROUP BY public_no HAVING COUNT(*)>1) d));
SELECT 'rehearsal_marker',JSON_OBJECT('order',o.public_no,'event',e.id,'at',e.created_at,
 'marker',JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json,'$.closeRehearsalOrder')))
FROM orders o JOIN order_events e ON e.order_id=o.id
WHERE JSON_UNQUOTE(JSON_EXTRACT(e.metadata_json,'$.closeRehearsalOrder'))='true';
SELECT 'window',JSON_OBJECT('name',w.label,'orders',COUNT(o.id),
 'success',COALESCE(SUM(o.status='RECHARGE_SUCCESS'),0),
 'failed',COALESCE(SUM(o.status='RECHARGE_FAILED'),0),'closed',COALESCE(SUM(o.status='CLOSED'),0))
FROM (SELECT 'today_CST8' AS label,'2026-09-20 16:00:00' AS start_at UNION ALL SELECT 'seven_calendar_days_CST8','2026-09-14 16:00:00') w
LEFT JOIN orders o ON o.created_at>=w.start_at AND o.created_at<'2026-09-21 16:00:00' GROUP BY w.label;
