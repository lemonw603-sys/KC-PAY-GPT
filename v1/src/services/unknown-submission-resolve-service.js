import { PublicApiError } from '../domain/public-api-error.js';
import { transitionCardConsumptionInTransaction } from './card-consumption-ledger-service.js';

/**
 * 第④步（面三③ 表二）：API 单付款不明的后台收口入口——以前只能手写 SQL（面三 §1.2）。
 *
 * 只对「API 路线、attempt SUBMIT_UNKNOWN / UNKNOWN、订单 SUBMIT_UNKNOWN 或 RECONCILIATION_REQUIRED」
 * 的单生效。两个结论：
 *   CHARGED     运营核实钱扣了、账号已开通：attempt SUCCESS/SETTLED、账本 CONSUMED、卡 DEPLETED、
 *               订单 RECHARGE_SUCCESS；取消续费未知 → cancellation_review_required=1（进待销清单 + 提醒）。
 *   NOT_CHARGED 运营核实没扣款：attempt CLEARED/CLEARED、账本 RELEASED、卡分配 RELEASED、
 *               订单 RECHARGE_FAILED（failure_code PAYMENT_NOT_CHARGED_VERIFIED），客户按失败单流程重提。
 * 两条都写 order_events（ADMIN + 核实说明），并关闭本单的 ORDER_PAYMENT_UNKNOWN_REVIEW 告警与
 * API_PAYMENT_UNKNOWN 对账案例。不重付、不换卡。
 */
export class UnknownSubmissionResolveError extends PublicApiError {}

export function createUnknownSubmissionResolveService({ pool, clock = () => new Date() }) {
  if (!pool) throw new TypeError('pool is required');

  return async function resolveUnknownSubmission(publicNo, input = {}) {
    if (typeof publicNo !== 'string' || publicNo.length < 8 || publicNo.length > 64) {
      throw new PublicApiError('Order not found', { code: 'ADMIN_ORDER_NOT_FOUND', status: 404 });
    }
    const outcome = String(input.outcome || '').trim().toUpperCase();
    if (!['CHARGED', 'NOT_CHARGED'].includes(outcome)) {
      throw new PublicApiError('outcome must be CHARGED or NOT_CHARGED', { code: 'INVALID_UNKNOWN_RESOLUTION', status: 400 });
    }
    if (input.confirmation !== `已核实 ${publicNo} ${outcome}`) {
      throw new PublicApiError('Confirmation mismatch', { code: 'UNKNOWN_RESOLUTION_CONFIRMATION_REQUIRED', status: 400 });
    }
    const note = String(input.note || '').trim().slice(0, 300);
    const actorId = String(input.actorId || 'admin').trim().slice(0, 128) || 'admin';
    const now = clock();

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT o.id, o.status, o.version, o.assigned_card_id,
                fr.executor_kind,
                rat.id AS attempt_id, rat.status AS attempt_status, rat.funds_risk_state,
                rat.authorization_item_id
           FROM orders o
           LEFT JOIN fulfillment_routes fr ON fr.id = o.fulfillment_route_id
           LEFT JOIN recharge_attempts rat ON rat.order_id = o.id
             AND rat.status = 'SUBMIT_UNKNOWN' AND rat.funds_risk_state = 'UNKNOWN'
          WHERE o.public_no = ? ORDER BY rat.created_at DESC LIMIT 1 FOR UPDATE`,
        [publicNo]
      );
      if (rows.length !== 1) throw new PublicApiError('Order not found', { code: 'ADMIN_ORDER_NOT_FOUND', status: 404 });
      const order = rows[0];
      if (String(order.executor_kind || '').toUpperCase() !== 'API') {
        throw new PublicApiError('Only API-route orders resolve here; Browser runs use RESOLVE_UNKNOWN_PAYMENT', {
          code: 'UNKNOWN_RESOLUTION_WRONG_EXECUTOR', status: 409 });
      }
      if (!['SUBMIT_UNKNOWN', 'RECONCILIATION_REQUIRED'].includes(order.status) || !order.attempt_id) {
        throw new PublicApiError(`Order cannot resolve an unknown submission from ${order.status}`, {
          code: 'UNKNOWN_RESOLUTION_NOT_ELIGIBLE', status: 409 });
      }
      const targetOrderStatus = outcome === 'CHARGED' ? 'RECHARGE_SUCCESS' : 'RECHARGE_FAILED';
      if (outcome === 'CHARGED') {
        await connection.query(
          `UPDATE recharge_attempts SET status = 'SUCCESS', funds_risk_state = 'SETTLED',
             finished_at = COALESCE(finished_at, ?), last_reconciled_at = ?, updated_at = ?
           WHERE id = ? AND status = 'SUBMIT_UNKNOWN' AND funds_risk_state = 'UNKNOWN'`,
          [now, now, now, order.attempt_id]
        );
        await transitionCardConsumptionInTransaction(connection, {
          orderId: order.id, rechargeAttemptId: order.attempt_id, targetStatus: 'CONSUMED',
          allowedCurrentStatuses: ['RESERVED', 'RECONCILIATION'], requireActive: false, now,
          evidence: { source: 'admin_resolve_unknown_submission', outcome, actorId, note: note || null }
        });
        await connection.query(
          `UPDATE card_assignment_history SET status = 'RELEASED', released_by = ?,
             release_reason = 'operator verified the payment was charged; capacity ledger retains consumption',
             released_at = COALESCE(released_at, ?)
           WHERE order_id = ? AND status = 'ACTIVE'`, [`admin:${actorId}`, now, order.id]
        );
        if (order.assigned_card_id) {
          await connection.query(
            `UPDATE cards SET inventory_status = 'DEPLETED', current_balance = NULL,
               last_transaction_synced_at = NULL, updated_at = ? WHERE id = ?`,
            [now, order.assigned_card_id]
          );
        }
        const [orderUpdate] = await connection.query(
          `UPDATE orders SET status = 'RECHARGE_SUCCESS', subscription_cancelled = 0,
             cancellation_review_required = 1, cancellation_checked_at = ?,
             failure_code = NULL, failure_reason = NULL, customer_action_code = NULL,
             finished_at = COALESCE(finished_at, ?), version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
          [now, now, now, order.id, order.version]
        );
        if (orderUpdate.affectedRows !== 1) throw new PublicApiError('Order changed concurrently', { code: 'ORDER_CONFLICT', status: 409 });
        await connection.query(
          `INSERT INTO operator_alerts
           (id, alert_type, dedupe_key, order_id, severity, title, message, status)
           VALUES (UUID(), 'ORDER_CANCELLATION_UNCONFIRMED', ?, ?, 'warning', ?, ?, 'OPEN')
           ON DUPLICATE KEY UPDATE severity = VALUES(severity), title = VALUES(title),
             order_id = VALUES(order_id), message = VALUES(message),
             status = IF(status = 'RESOLVED', 'OPEN', status),
             acknowledged_at = IF(status = 'RESOLVED', NULL, acknowledged_at)`,
          [`order-cancellation-unconfirmed:${order.id}`, order.id,
            '取消续费未确认，订单已交付，卡进待销清单',
            `订单 ${publicNo}｜人工核实已扣款收口，取消续费状态未知。这张卡已进待销清单，到存活期请在卡台删掉，删完在后台点「已销卡」。`]
        );
      } else {
        await connection.query(
          `UPDATE recharge_attempts SET status = 'CLEARED', funds_risk_state = 'CLEARED',
             finished_at = COALESCE(finished_at, ?), last_reconciled_at = ?, updated_at = ?
           WHERE id = ? AND status = 'SUBMIT_UNKNOWN' AND funds_risk_state = 'UNKNOWN'`,
          [now, now, now, order.attempt_id]
        );
        await transitionCardConsumptionInTransaction(connection, {
          orderId: order.id, rechargeAttemptId: order.attempt_id, targetStatus: 'RELEASED',
          allowedCurrentStatuses: ['RESERVED', 'RECONCILIATION'], requireActive: false, now,
          reason: 'operator verified no charge after an unknown submission',
          evidence: { source: 'admin_resolve_unknown_submission', outcome, actorId, note: note || null }
        });
        await connection.query(
          `UPDATE card_assignment_history SET status = 'RELEASED', released_by = ?,
             release_reason = 'operator verified no charge after an unknown submission',
             released_at = COALESCE(released_at, ?)
           WHERE order_id = ? AND status = 'ACTIVE'`, [`admin:${actorId}`, now, order.id]
        );
        if (order.authorization_item_id) {
          await connection.query(
            `UPDATE recharge_authorization_items SET status = 'RELEASED'
             WHERE id = ? AND consumed_attempt_id = ? AND status = 'CONSUMED'`,
            [order.authorization_item_id, order.attempt_id]
          );
        }
        const [orderUpdate] = await connection.query(
          `UPDATE orders SET status = 'RECHARGE_FAILED', failure_code = 'PAYMENT_NOT_CHARGED_VERIFIED',
             failure_reason = ?, customer_action_code = NULL,
             finished_at = COALESCE(finished_at, ?), version = version + 1, updated_at = ?
           WHERE id = ? AND version = ?`,
          ['Operator verified the unknown submission did not charge the card', now, now, order.id, order.version]
        );
        if (orderUpdate.affectedRows !== 1) throw new PublicApiError('Order changed concurrently', { code: 'ORDER_CONFLICT', status: 409 });
      }
      await connection.query(
        `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
         VALUES (?, ?, ?, 'ADMIN', ?, ?, ?)`,
        [order.id, order.status, targetOrderStatus, actorId,
          outcome === 'CHARGED'
            ? 'Operator verified the unknown API submission was charged and the account was upgraded'
            : 'Operator verified the unknown API submission did not charge the card',
          JSON.stringify({ resolveUnknownSubmission: true, outcome, attemptId: order.attempt_id, note: note || null })]
      );
      await connection.query(
        `UPDATE operator_alerts SET status = 'RESOLVED', acknowledged_at = COALESCE(acknowledged_at, ?)
         WHERE dedupe_key = ? AND status = 'OPEN'`,
        [now, `order-payment-unknown-review:${order.id}`]
      );
      await connection.query(
        `UPDATE reconciliation_cases SET status = 'RESOLVED', resolved_at = COALESCE(resolved_at, ?),
           resolution_note = ?, updated_at = ?
         WHERE dedupe_key = ? AND status = 'OPEN'`,
        [now, `${actorId}: ${outcome}${note ? ` — ${note}` : ''}`.slice(0, 500), now, `api-payment-unknown:${order.id}`]
      );
      await connection.commit();
      return { publicNo, outcome, status: targetOrderStatus, attemptId: order.attempt_id,
        cancellationReviewRequired: outcome === 'CHARGED' };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  };
}
