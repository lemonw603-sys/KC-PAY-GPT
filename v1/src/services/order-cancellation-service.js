import { transitionCardConsumptionInTransaction } from './card-consumption-ledger-service.js';

export class OrderCancellationError extends Error {
  constructor(message, code, status = 409) {
    super(message);
    this.name = 'OrderCancellationError';
    this.code = code;
    this.status = status;
  }
}

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
                ta.id AS assign_task_id, ta.status AS assign_task_status,
                ta.attempts AS assign_attempts,
                JSON_UNQUOTE(JSON_EXTRACT(t.payload_json, '$.rechargePermit.status')) AS permit_status
         FROM orders o
         LEFT JOIN cards c ON (c.id = o.assigned_card_id OR (o.assigned_card_id IS NULL AND c.order_id = o.id))
         LEFT JOIN tasks t ON t.order_id = o.id AND t.task_type = 'SUBMIT_RECHARGE'
         LEFT JOIN tasks ta ON ta.order_id = o.id AND ta.task_type = 'ASSIGN_CARD'
         WHERE BINARY o.public_no = ? LIMIT 1 FOR UPDATE`, [publicNo]
      );
      const order = rows[0];
      if (!order) throw new OrderCancellationError('Order not found', 'ADMIN_ORDER_NOT_FOUND', 404);
      if (order.status === 'CLOSED' && order.failure_code === 'CANCELLED_PRE_SUBMISSION') {
        await connection.commit();
        return { publicNo: order.public_no, status: 'CLOSED', cardReleased: Boolean(order.card_id),
          cardInventoryStatus: order.card_id ? 'HELD_FOR_REVIEW' : null, replayed: true };
      }
      if (order.status === 'WAITING_FOR_CARD') {
        if (order.card_id || !order.assign_task_id || order.assign_task_status !== 'PENDING'
          || Number(order.assign_attempts) !== 0 || order.recharge_order_no || order.recharge_card_key) {
          throw new OrderCancellationError('Waiting order state is not safely cancellable',
            'ORDER_CANCELLATION_REVIEW_REQUIRED');
        }
        const [calls] = await connection.query(
          `SELECT id FROM provider_calls WHERE order_id = ? AND operation = 'create_direct'
           LIMIT 1 FOR UPDATE`, [order.id]
        );
        if (calls.length) throw new OrderCancellationError('Recharge provider was already called',
          'ORDER_CANCELLATION_SUBMISSION_RISK');
        // Cancel supply work that has not reached any provider side effect.
        // A RUNNING/PENDING/UNKNOWN funding operation is deliberately left in
        // the funding ledger for reconciliation; it only prepares reusable
        // internal inventory and never authorizes a customer payment.
        await connection.query(
          `UPDATE card_funding_attempts
           SET status='FAILED', funds_risk_state='CLEARED', finished_at=CURRENT_TIMESTAMP(3),
             result_summary_json=JSON_OBJECT('code','ORDER_CANCELLED_BEFORE_FUNDING'),
             updated_at=CURRENT_TIMESTAMP(3)
           WHERE order_id=? AND status='PREPARED' AND funds_risk_state='NONE'`,
          [order.id]
        );
        await connection.query(
          `UPDATE card_stock_jobs
           SET status='CANCELLED', error_code='ORDER_CANCELLED_BEFORE_OPENING',
             error_message='关联订单已在开卡前取消。', finished_at=CURRENT_TIMESTAMP(3),
             updated_at=CURRENT_TIMESTAMP(3)
           WHERE status='PENDING' AND job_source='AUTOMATIC'
             AND JSON_UNQUOTE(JSON_EXTRACT(rules_snapshot_json, '$.demandOrderId'))=?`,
          [order.id]
        );
        await connection.query(
          `UPDATE tasks SET status = 'DEAD', leased_until = NULL, leased_by = NULL,
             last_error_code = 'CANCELLED_BY_ADMIN', last_error_message = ?,
             updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND status = 'PENDING' AND attempts = 0`,
          [reason, order.assign_task_id]
        );
        const [closed] = await connection.query(
          `UPDATE orders SET status = 'CLOSED', failure_code = 'CANCELLED_PRE_SUBMISSION',
             failure_reason = ?, version = version + 1, finished_at = CURRENT_TIMESTAMP(3),
             updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ? AND status = 'WAITING_FOR_CARD'`, [reason, order.id]
        );
        if (Number(closed.affectedRows) !== 1) throw new OrderCancellationError(
          'Order changed concurrently', 'ORDER_CANCELLATION_ORDER_CHANGED');
        await connection.query(
          `INSERT INTO order_events
           (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
           VALUES (?, 'WAITING_FOR_CARD', 'CLOSED', 'ADMIN', 'admin', ?, ?)`,
          [order.id, 'order cancelled before card assignment', JSON.stringify({ reason })]
        );
        await connection.query(
          `UPDATE operator_alerts
           SET status='RESOLVED', acknowledged_at=COALESCE(acknowledged_at, CURRENT_TIMESTAMP(3)),
             updated_at=CURRENT_TIMESTAMP(3)
           WHERE status='OPEN' AND alert_type='ORDER_WAITING_FOR_CARD'
             AND (order_id=? OR dedupe_key=?)`,
          [order.id, `order-waiting-card:${order.id}`]
        );
        await connection.commit();
        return { publicNo: order.public_no, status: 'CLOSED', cardReleased: false,
          cardInventoryStatus: null, replayed: false };
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
      await connection.query(
        `UPDATE tasks SET status = 'DEAD', leased_until = NULL, leased_by = NULL,
           last_error_code = 'CANCELLED_BY_ADMIN', last_error_message = ?,
           updated_at = CURRENT_TIMESTAMP(3)
         WHERE order_id = ? AND status = 'PENDING'`, [reason, order.id]
      );
      const [released] = await connection.query(
        `UPDATE cards SET inventory_status = CASE
             WHEN current_balance >= ? THEN 'AVAILABLE' ELSE 'DEPLETED' END,
           assigned_at = NULL, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`, [String(order.minimum_required_card_balance), order.card_id]
      );
      if (Number(released.affectedRows) !== 1) {
        throw new OrderCancellationError('Card assignment changed concurrently', 'ORDER_CANCELLATION_ORDER_CHANGED');
      }
      const [assignmentReleased] = await connection.query(
        `UPDATE card_assignment_history
         SET status = 'RELEASED', released_by = 'admin', release_reason = ?,
             released_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
         WHERE card_id = ? AND order_id = ? AND status = 'ACTIVE'`,
        [reason, order.card_id, order.id]
      );
      if (Number(assignmentReleased.affectedRows) !== 1) {
        throw new OrderCancellationError(
          'Card assignment history is inconsistent',
          'ORDER_CANCELLATION_ASSIGNMENT_HISTORY_INCONSISTENT'
        );
      }
      await transitionCardConsumptionInTransaction(connection, {
        orderId: order.id,
        targetStatus: 'RELEASED',
        reason: `Order cancelled before payment: ${reason}`,
        allowedCurrentStatuses: ['RESERVED'],
        requireActive: false,
        evidence: { source: 'admin_order_cancellation' }
      });
      const [closed] = await connection.query(
        `UPDATE orders SET status = 'CLOSED', assigned_card_id=NULL,
           failure_code = 'CANCELLED_PRE_SUBMISSION',
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
        [order.id, 'order cancelled before recharge; card capacity released', JSON.stringify({
          reason, cardId: order.card_id, cardTypeId: order.card_type_id
        })]
      );
      await connection.commit();
      const cardInventoryStatus = Number(order.current_balance) >= Number(order.minimum_required_card_balance)
        ? 'AVAILABLE' : 'DEPLETED';
      return { publicNo: order.public_no, status: 'CLOSED', cardReleased: true,
        cardInventoryStatus, replayed: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
}
