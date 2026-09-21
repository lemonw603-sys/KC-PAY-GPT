SELECT 'observed_at',UTC_TIMESTAMP(3);
SELECT 'order',JSON_OBJECT(
 'id',o.id,'publicNo',o.public_no,'status',o.status,'plan',o.plan_type,
 'created',o.created_at,'finished',o.finished_at,'failureCode',o.failure_code,
 'cancelled',o.subscription_cancelled,'cancellationReview',o.cancellation_review_required,
 'cdkStatus',c.status,'cdkPointsHere',c.order_id=o.id,
 'hadSuccess',EXISTS(SELECT 1 FROM order_events e WHERE e.order_id=o.id AND e.to_status='RECHARGE_SUCCESS'),
 'attempts',(SELECT COUNT(*) FROM recharge_attempts a WHERE a.order_id=o.id),
 'fundStates',(SELECT GROUP_CONCAT(DISTINCT CONCAT(a.status,':',a.funds_risk_state) ORDER BY a.created_at) FROM recharge_attempts a WHERE a.order_id=o.id),
 'activeFunds',(SELECT COUNT(*) FROM recharge_attempts a WHERE a.order_id=o.id AND a.funds_risk_state IN ('ACTIVE','UNKNOWN')),
 'consumed',(SELECT COUNT(*) FROM card_consumption_ledger l WHERE l.order_id=o.id AND l.status='CONSUMED'),
 'heldLedger',(SELECT COUNT(*) FROM card_consumption_ledger l WHERE l.order_id=o.id AND l.status IN ('RESERVED','RECONCILIATION')),
 'activeAssignments',(SELECT COUNT(*) FROM card_assignment_history h WHERE h.order_id=o.id AND h.status='ACTIVE'),
 'runStates',(SELECT GROUP_CONCAT(DISTINCT CONCAT(b.status,':',b.payment_state,':',b.verification_state,':',b.post_payment_state)) FROM browser_runs b JOIN recharge_attempts a ON a.id=b.recharge_attempt_id WHERE a.order_id=o.id),
 'submitOps',(SELECT COUNT(*) FROM browser_operations x JOIN browser_runs b ON b.id=x.browser_run_id JOIN recharge_attempts a ON a.id=b.recharge_attempt_id WHERE a.order_id=o.id AND x.operation_type='PAYMENT_SUBMIT'),
 'openCases',(SELECT COUNT(*) FROM reconciliation_cases r WHERE r.order_id=o.id AND r.status IN ('OPEN','ASSIGNED')),
 'openAlerts',(SELECT COUNT(*) FROM operator_alerts r WHERE r.order_id=o.id AND r.status='OPEN')
) FROM orders o LEFT JOIN cdks c ON c.id=o.cdk_id ORDER BY o.created_at;
SELECT 'case',JSON_OBJECT('id',r.id,'order',o.public_no,'type',r.case_type,'status',r.status,
 'attempt',r.recharge_attempt_id,'card',r.card_id,'detected',r.detected_at,'lastSeen',r.last_seen_at,
 'reasonCode',JSON_UNQUOTE(JSON_EXTRACT(r.evidence_json,'$.reasonCode')),
 'runId',JSON_UNQUOTE(JSON_EXTRACT(r.evidence_json,'$.browserRunId')))
FROM reconciliation_cases r LEFT JOIN orders o ON o.id=r.order_id WHERE r.status IN ('OPEN','ASSIGNED');
SELECT 'case_attempt',JSON_OBJECT('order',o.public_no,'id',a.id,'status',a.status,'funds',a.funds_risk_state,
 'intent',a.submit_intent_at,'submitted',a.submitted_at,'finished',a.finished_at,
 'resultKeys',JSON_KEYS(a.result_summary_json))
FROM recharge_attempts a JOIN orders o ON o.id=a.order_id
WHERE EXISTS(SELECT 1 FROM reconciliation_cases r WHERE r.order_id=o.id AND r.status IN ('OPEN','ASSIGNED'));
SELECT 'case_run',JSON_OBJECT('order',o.public_no,'id',b.id,'status',b.status,'payment',b.payment_state,
 'verification',b.verification_state,'postPayment',b.post_payment_state,'lastError',b.last_error_code,
 'lastCheckpoint',b.last_checkpoint_kind,'created',b.created_at,'finished',b.finished_at,
 'cancelledAt',b.cancellation_confirmed_at,'requestedBy',b.requested_by,'lane',b.selected_lane)
FROM browser_runs b JOIN recharge_attempts a ON a.id=b.recharge_attempt_id JOIN orders o ON o.id=a.order_id
WHERE EXISTS(SELECT 1 FROM reconciliation_cases r WHERE r.order_id=o.id AND r.status IN ('OPEN','ASSIGNED'));
SELECT 'case_operation',JSON_OBJECT('order',o.public_no,'run',b.id,'type',x.operation_type,'status',x.status,
 'code',x.result_code,'at',x.completed_at,'resultKeys',JSON_KEYS(x.public_result_json))
FROM browser_operations x JOIN browser_runs b ON b.id=x.browser_run_id JOIN recharge_attempts a ON a.id=b.recharge_attempt_id JOIN orders o ON o.id=a.order_id
WHERE EXISTS(SELECT 1 FROM reconciliation_cases r WHERE r.order_id=o.id AND r.status IN ('OPEN','ASSIGNED')) ORDER BY x.id;
SELECT 'alert_group',JSON_OBJECT('type',alert_type,'severity',severity,'status',status,'count',COUNT(*),
 'first',MIN(created_at),'last',MAX(updated_at)) FROM operator_alerts GROUP BY alert_type,severity,status;
SELECT 'alert',JSON_OBJECT('id',r.id,'type',r.alert_type,'order',o.public_no,'status',r.status,
 'severity',r.severity,'created',r.created_at,'updated',r.updated_at)
FROM operator_alerts r LEFT JOIN orders o ON o.id=r.order_id WHERE r.status='OPEN' ORDER BY r.alert_type,r.created_at;
