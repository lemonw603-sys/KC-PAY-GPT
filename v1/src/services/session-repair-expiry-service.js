export function createSessionRepairExpiryService({ pool, cancelOrder, batchSize = 10 }) {
  if (!pool) throw new TypeError('pool is required');
  if (typeof cancelOrder !== 'function') throw new TypeError('cancelOrder is required');
  const limit = Math.max(1, Math.min(100, Math.trunc(Number(batchSize) || 10)));

  return async function closeExpiredSessionRepairOrders() {
    const [rows] = await pool.query(
      `SELECT public_no FROM orders
       WHERE status='WAITING_FOR_SESSION'
         AND session_repair_expires_at IS NOT NULL
         AND session_repair_expires_at <= CURRENT_TIMESTAMP(3)
         AND assigned_card_id IS NOT NULL
         AND recharge_order_no IS NULL AND recharge_card_key IS NULL
         AND EXISTS (SELECT 1 FROM tasks expiry_task
           WHERE expiry_task.order_id=orders.id
             AND expiry_task.task_type='SUBMIT_RECHARGE' AND expiry_task.status='DEAD')
         AND NOT EXISTS (SELECT 1 FROM recharge_attempts expiry_attempt
           WHERE expiry_attempt.order_id=orders.id
             AND expiry_attempt.funds_risk_state IN ('ACTIVE','UNKNOWN','SETTLED'))
         AND NOT EXISTS (SELECT 1 FROM provider_calls expiry_call
           WHERE expiry_call.order_id=orders.id
             AND expiry_call.operation='create_direct'
             AND expiry_call.outcome <> 'DEFINITE_FAILURE')
       ORDER BY session_repair_expires_at
       LIMIT ?`,
      [limit]
    );
    const result = { checked: rows.length, closed: 0, reviewRequired: 0 };
    for (const row of rows) {
      try {
        await cancelOrder(row.public_no, {
          confirmation: `取消订单 ${row.public_no}`,
          reason: 'Session replacement window expired without a replacement Session'
        });
        result.closed += 1;
      } catch (error) {
        // A concurrent replacement or any non-definitive funds state must win.
        // Leave the order and its card locked for manual review rather than
        // converting an expiry timer into a possible duplicate-payment path.
        if (['ORDER_CANCELLATION_NOT_ELIGIBLE', 'ORDER_CANCELLATION_REVIEW_REQUIRED',
          'ORDER_CANCELLATION_SUBMISSION_RISK', 'ORDER_CANCELLATION_ORDER_CHANGED'].includes(error?.code)) {
          result.reviewRequired += 1;
          continue;
        }
        throw error;
      }
    }
    return result;
  };
}
