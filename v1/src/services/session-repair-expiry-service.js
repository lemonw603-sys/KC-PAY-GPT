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
