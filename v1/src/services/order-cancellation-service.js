export class OrderCancellationError extends Error {
  constructor(message, code, status = 409) {
    super(message);
    this.name = 'OrderCancellationError';
    this.code = code;
    this.status = status;
  }
}

const ACTIVE_CARD_STATUSES = new Set(['active', 'available', 'usable', 'ready']);

export function createOrderCancellationService({ pool }) {
  if (!pool) throw new TypeError('pool is required');

  return async function cancelOrder(publicNo, input = {}) {
    if (typeof publicNo !== 'string' || publicNo.length < 8 || publicNo.length > 64) {
      throw new OrderCancellationError('Order not found', 'ADMIN_ORDER_NOT_FOUND', 404);
    }
    if (input.confirmation !== `取消订单 ${publicNo}`) {
      throw new OrderCancellationError('Cancellation confirmation mismatch', 'ORDER_CANCELLATION_CONFIRMATION_REQUIRED', 400);
    }
    const reason = String(input.reason || 'customer abandoned before recharge submission').trim();
    if (!reason || reason.length > 500) {
      throw new OrderCancellationError('Invalid cancellation reason', 'INVALID_ORDER_CANCELLATION_REASON', 400);
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT o.id, o.public_no, o.status, o.failure_code, o.recharge_order_no,
                o.recharge_card_key, o.minimum_required_card_balance,
                c.id AS card_id, c.card_type_id, c.status AS card_status,
                c.current_balance, c.card_credentials_ciphertext,
                c.last_synced_at, t.id AS submit_task_id, t.status AS submit_task_status,
                t.attempts AS submit_attempts,
                JSON_UNQUOTE(JSON_EXTRACT(t.payload_json, '$.rechargePermit.status')) AS permit_status
         FROM orders o
         LEFT JOIN cards c ON c.order_id = o.id
         LEFT JOIN tasks t ON t.order_id = o.id AND t.task_type = 'SUBMIT_RECHARGE'
         WHERE BINARY o.public_no = ? LIMIT 1 FOR UPDATE`, [publicNo]
      );
      const order = rows[0];
      if (!order) throw new OrderCancellationError('Order not found', 'ADMIN_ORDER_NOT_FOUND', 404);
      if (order.status === 'CLOSED' && order.failure_code === 'CANCELLED_PRE_SUBMISSION') {
        await connection.commit();
        return { publicNo: order.public_no, status: 'CLOSED', cardReleased: true, replayed: true };
      }
      if (order.status !== 'CARD_READY') {
        throw new OrderCancellationError('Order is not awaiting recharge', 'ORDER_CANCELLATION_NOT_ELIGIBLE');
      }
      if (!order.card_id || !order.submit_task_id) {
        throw new OrderCancellationError('Order state is incomplete', 'ORDER_CANCELLATION_REVIEW_REQUIRED');
      }
      if (order.submit_task_status !== 'PENDING' || Number(order.submit_attempts) !== 0
        || order.permit_status === 'CONSUMED' || order.recharge_order_no || order.recharge_card_key) {
        throw new OrderCancellationError('Recharge may have started', 'ORDER_CANCELLATION_SUBMISSION_RISK');
      }
      const [calls] = await connection.query(
        `SELECT id FROM provider_calls
         WHERE order_id = ? AND provider = 'zzshu' AND operation = 'create_direct'
         LIMIT 1 FOR UPDATE`, [order.id]
      );
      if (calls.length) {
        throw new OrderCancellationError('Recharge provider was already called', 'ORDER_CANCELLATION_SUBMISSION_RISK');
      }
      const cardActive = ACTIVE_CARD_STATUSES.has(String(order.card_status || '').toLowerCase());
      const cardFunded = Number(order.current_balance) >= Number(order.minimum_required_card_balance);
      const cardFresh = order.last_synced_at
        && Date.now() - new Date(order.last_synced_at).getTime() <= 15 * 60_000;
      if (!cardActive || !cardFunded || !order.card_credentials_ciphertext || !cardFresh) {
        throw new OrderCancellationError('Card cannot be safely returned to stock', 'ORDER_CANCELLATION_CARD_NOT_REUSABLE');
      }

      await connection.query(
        `UPDATE tasks SET status = 'DEAD', leased_until = NULL, leased_by = NULL,
           last_error_code = 'CANCELLED_BY_ADMIN', last_error_message = ?,
           updated_at = CURRENT_TIMESTAMP(3)
         WHERE order_id = ? AND status = 'PENDING'`, [reason, order.id]
      );
      const [released] = await connection.query(
        `UPDATE cards SET order_id = NULL, inventory_status = 'AVAILABLE', assigned_at = NULL,
           updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND order_id = ?`, [order.card_id, order.id]
      );
      if (Number(released.affectedRows) !== 1) {
        throw new OrderCancellationError('Card assignment changed concurrently', 'ORDER_CANCELLATION_ORDER_CHANGED');
      }
      const [closed] = await connection.query(
        `UPDATE orders SET status = 'CLOSED', failure_code = 'CANCELLED_PRE_SUBMISSION',
           failure_reason = ?, version = version + 1, finished_at = CURRENT_TIMESTAMP(3),
           updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'CARD_READY'`, [reason, order.id]
      );
      if (Number(closed.affectedRows) !== 1) {
        throw new OrderCancellationError('Order changed concurrently', 'ORDER_CANCELLATION_ORDER_CHANGED');
      }
      await connection.query(
        `INSERT INTO order_events
         (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
         VALUES (?, 'CARD_READY', 'CLOSED', 'ADMIN', 'admin', ?, ?)`,
        [order.id, 'order cancelled before recharge; card returned to inventory', JSON.stringify({
          reason, cardId: order.card_id, cardTypeId: order.card_type_id
        })]
      );
      await connection.commit();
      return { publicNo: order.public_no, status: 'CLOSED', cardReleased: true, replayed: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
}
