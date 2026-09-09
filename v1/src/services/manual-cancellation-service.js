// 「已在账号里取消续费」：付款已成功但自动取消续费未被确认（API 路线只轮询供应商，
// 供应商不一定真去取消；Browser 路线也可能确认失败）的订单，由运营亲自在 ChatGPT
// 账号里关闭自动续费后，在后台记录这一事实并收口。只写事实、不再触碰供应商或页面。
export class ManualCancellationError extends Error {
  constructor(message, code, status = 409) {
    super(message);
    this.name = 'ManualCancellationError';
    this.code = code;
    this.status = status;
  }
}

const ELIGIBLE_STATUSES = new Set(['CANCELLATION_REVIEW_REQUIRED', 'RECHARGE_SUCCESS']);

export function createManualCancellationService({ pool }) {
  if (!pool) throw new TypeError('pool is required');

  return async function confirmManualCancellation(publicNo, input = {}) {
    if (typeof publicNo !== 'string' || publicNo.length < 8 || publicNo.length > 64) {
      throw new ManualCancellationError('Order not found', 'ADMIN_ORDER_NOT_FOUND', 404);
    }
    if (input.confirmation !== `已取消续费 ${publicNo}`) {
      throw new ManualCancellationError('Confirmation mismatch', 'MANUAL_CANCELLATION_CONFIRMATION_REQUIRED', 400);
    }
    const note = String(input.note || '').trim().slice(0, 300);
    const actorId = String(input.actorId || 'admin').trim().slice(0, 128) || 'admin';

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT id, status, version, subscription_cancelled, cancellation_review_required
           FROM orders WHERE public_no = ? FOR UPDATE`,
        [publicNo]
      );
      if (rows.length !== 1) throw new ManualCancellationError('Order not found', 'ADMIN_ORDER_NOT_FOUND', 404);
      const order = rows[0];
      // 已经记录过：幂等返回，不重复写事件。
      if (order.subscription_cancelled === 1 && order.cancellation_review_required === 0 && order.status === 'RECHARGE_SUCCESS') {
        await connection.commit();
        return { publicNo, status: 'RECHARGE_SUCCESS', subscriptionCancelled: 1, replayed: true };
      }
      // 只有「付款已成功、取消续费待人工」的单可以这样收口；付款前/未知状态一律拒绝。
      const eligible = order.status === 'CANCELLATION_REVIEW_REQUIRED'
        || (order.status === 'RECHARGE_SUCCESS' && order.cancellation_review_required === 1);
      if (!eligible || !ELIGIBLE_STATUSES.has(order.status)) {
        throw new ManualCancellationError(`Order cannot record manual cancellation from ${order.status}`, 'MANUAL_CANCELLATION_NOT_ELIGIBLE', 409);
      }
      const [result] = await connection.query(
        `UPDATE orders SET status = 'RECHARGE_SUCCESS', subscription_cancelled = 1,
             cancellation_review_required = 0, cancellation_checked_at = CURRENT_TIMESTAMP(3),
             finished_at = COALESCE(finished_at, CURRENT_TIMESTAMP(3)),
             version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND version = ?`,
        [order.id, order.version]
      );
      if (result.affectedRows !== 1) {
        throw new ManualCancellationError('Order changed concurrently', 'MANUAL_CANCELLATION_ORDER_CHANGED', 409);
      }
      await connection.query(
        `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
         VALUES (?, ?, 'RECHARGE_SUCCESS', 'ADMIN', ?, ?, ?)`,
        [order.id, order.status, actorId,
          'operator confirmed auto-renewal was cancelled manually in the account',
          JSON.stringify({ manualCancellation: true, note: note || null })]
      );
      await connection.commit();
      return { publicNo, status: 'RECHARGE_SUCCESS', subscriptionCancelled: 1, replayed: false };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  };
}
