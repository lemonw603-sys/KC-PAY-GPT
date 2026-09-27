// 「标为已手工充值」（D-356 ⑤）：运营在系统之外（比特浏览器 / 上号器手动付）把客户充好了，
// 而系统一分钱没付。客户已得到服务，所以 CDK 留在（或重新绑回）这单、订单收成
// RECHARGE_SUCCESS，取消续费留给运营确认；分配的卡放回（默认卡没用）或记消费（cardUsed）。
//
// 这份逻辑原先只在 scripts/close-manually-fulfilled-order.mjs 里（生产用过 7 次），现在提成服务，
// 脚本与后台按钮共用同一份守卫与写入，不许出现第二份。
//
// 守卫（任一存在即拒，这种单是对账不是收口）：资金栅栏 ACTIVE/UNKNOWN/SETTLED 的 attempt、
// 账本 CONSUMED/RECONCILIATION、点过付款的 run、PAYMENT_SUBMIT 操作、活动 run、外部订单号/卡键。
// RECHARGE_FAILED（付款前终态，D-131）：中止时已放卡、放账本、退码；这里把码重新绑回本单，
// 码不再空闲（被别的单拿走或已作废）则拒；这类单不接受 cardUsed（账本已 RELEASED，不能改成 CONSUMED）。
import { randomUUID } from 'node:crypto';
import { releaseCardForFailedOrderInTransaction } from '../db/repositories/card-release-repository.js';
import { transitionCardConsumptionInTransaction } from './card-consumption-ledger-service.js';

export class ManualFulfillmentError extends Error {
  constructor(message, code, status = 409, detail = null) {
    super(message);
    this.name = 'ManualFulfillmentError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

export const MANUAL_FULFILLMENT_CLOSABLE = Object.freeze(['CREATED', 'CARD_READY', 'WAITING_FOR_SESSION', 'RECHARGE_FAILED']);
export const MANUAL_FULFILLMENT_CONFIRMATION = '我已在系统外手工充值成功';

/**
 * 守卫的每一项：列名 → 相关子查询（外层订单别名 alias）。服务在事务里逐项读出来报「卡在哪一项」；
 * 后台列表 / 抽屉用 manualFulfillmentBlockedSql 把同一组拼成一个布尔决定摆不摆按钮——
 * 2026-09-27 整体排查：API 失败单一律带直充单号，按钮照摆、点了必拒（D-191：判断不许抄规则）。
 */
export function manualFulfillmentBlockerExpressions(alias = 'o') {
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(alias))) throw new TypeError('invalid SQL alias');
  return {
    live_or_paid_attempts: `(SELECT COUNT(*) FROM recharge_attempts mf_ra WHERE mf_ra.order_id = ${alias}.id AND mf_ra.funds_risk_state IN ('ACTIVE','UNKNOWN','SETTLED'))`,
    consumed_ledger: `(SELECT COUNT(*) FROM card_consumption_ledger mf_l WHERE mf_l.order_id = ${alias}.id AND mf_l.status IN ('CONSUMED','RECONCILIATION'))`,
    runs_past_arming: `(SELECT COUNT(*) FROM browser_runs mf_br INNER JOIN recharge_attempts mf_bra ON mf_bra.id = mf_br.recharge_attempt_id
              WHERE mf_bra.order_id = ${alias}.id AND mf_br.payment_state NOT IN ('NOT_STARTED','PAYMENT_ARMED'))`,
    payment_submits: `(SELECT COUNT(*) FROM browser_operations mf_bo INNER JOIN browser_runs mf_br2 ON mf_br2.id = mf_bo.browser_run_id
              INNER JOIN recharge_attempts mf_bra2 ON mf_bra2.id = mf_br2.recharge_attempt_id
              WHERE mf_bra2.order_id = ${alias}.id AND mf_bo.operation_type = 'PAYMENT_SUBMIT')`,
    open_runs: `(SELECT COUNT(*) FROM browser_runs mf_br3 INNER JOIN recharge_attempts mf_bra3 ON mf_bra3.id = mf_br3.recharge_attempt_id
              WHERE mf_bra3.order_id = ${alias}.id AND mf_br3.active_account_key_hmac IS NOT NULL)`,
    recharge_order_no: `${alias}.recharge_order_no`,
    recharge_card_key: `${alias}.recharge_card_key`
  };
}

/** 布尔版：状态不在可收口之列，或任一守卫命中 → 后台必拒（与 closeManuallyFulfilled 的判断一致）。 */
export function manualFulfillmentBlockedSql(alias = 'o') {
  const e = manualFulfillmentBlockerExpressions(alias);
  const counts = ['live_or_paid_attempts', 'consumed_ledger', 'runs_past_arming', 'payment_submits', 'open_runs']
    .map((key) => `${e[key]} > 0`);
  const texts = ['recharge_order_no', 'recharge_card_key'].map((key) => `COALESCE(${e[key]}, '') <> ''`);
  return `(${alias}.status NOT IN (${MANUAL_FULFILLMENT_CLOSABLE.map((s) => `'${s}'`).join(', ')}) OR ${[...counts, ...texts].join(' OR ')})`;
}

export function createManualFulfillmentService({ pool } = {}) {
  if (!pool?.getConnection) throw new TypeError('pool is required');

  /**
   * @param publicNo 订单号
   * @param options.cardUsed 分配的卡是否被手工用掉（默认 false = 放回）
   * @param options.reason 记录用的原因
   * @param options.actorId 谁做的（审计）
   * @param options.dryRun 只算不写（脚本 --dry-run）
   */
  async function closeManuallyFulfilled(publicNo, { cardUsed = false, reason = '', actorId = 'admin', dryRun = false } = {}) {
    const reference = String(publicNo || '').trim();
    if (!reference) throw new ManualFulfillmentError('order reference is required', 'MANUAL_FULFILLMENT_INVALID', 400);
    const text = (String(reason || '').trim() || 'fulfilled manually outside the system by operator; system made no payment').slice(0, 300);
    const actor = String(actorId || 'admin').slice(0, 64);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[order]] = await connection.query(
        'SELECT id, status, version, assigned_card_id, cdk_id FROM orders WHERE BINARY public_no = ? LIMIT 1 FOR UPDATE', [reference]);
      if (!order) throw new ManualFulfillmentError('order not found', 'ORDER_NOT_FOUND', 404);
      if (!MANUAL_FULFILLMENT_CLOSABLE.includes(order.status)) {
        throw new ManualFulfillmentError(`order is ${order.status}`, 'MANUAL_FULFILLMENT_NOT_ELIGIBLE', 409, { status: order.status });
      }
      const failedBeforePayment = order.status === 'RECHARGE_FAILED';
      if (failedBeforePayment && cardUsed) {
        throw new ManualFulfillmentError('RECHARGE_FAILED orders already released their card and ledger', 'MANUAL_FULFILLMENT_CARD_USED_NOT_ALLOWED', 409);
      }
      const [[evidence]] = await connection.query(
        `SELECT ${Object.entries(manualFulfillmentBlockerExpressions('o')).map(([key, sql]) => `${sql} AS ${key}`).join(',\n           ')}
         FROM orders o WHERE o.id = ?`, [order.id]);
      const blockers = Object.entries(evidence).filter(([, value]) => (typeof value === 'number' ? value > 0 : Boolean(value)));
      if (blockers.length) {
        throw new ManualFulfillmentError('system payment evidence present', 'MANUAL_FULFILLMENT_PAYMENT_EVIDENCE', 409, Object.fromEntries(blockers));
      }

      let cdkOutcome = 'kept REDEEMED';
      if (failedBeforePayment) {
        const [[cdk]] = await connection.query('SELECT id, status, order_id, batch_no FROM cdks WHERE id = ? LIMIT 1 FOR UPDATE', [order.cdk_id]);
        if (!cdk) throw new ManualFulfillmentError('order has no CDK to rebind', 'MANUAL_FULFILLMENT_CDK_MISSING', 409);
        if (cdk.status === 'REDEEMED' && cdk.order_id === order.id) {
          cdkOutcome = 'already bound to this order';
        } else {
          if (cdk.status !== 'AVAILABLE' || cdk.order_id) {
            throw new ManualFulfillmentError('CDK is no longer free', 'MANUAL_FULFILLMENT_CDK_TAKEN', 409, { status: cdk.status, boundElsewhere: Boolean(cdk.order_id) });
          }
          const [rebound] = await connection.query(
            `UPDATE cdks SET status = 'REDEEMED', order_id = ?, redeemed_at = CURRENT_TIMESTAMP(3)
             WHERE id = ? AND status = 'AVAILABLE' AND order_id IS NULL`, [order.id, cdk.id]);
          if (Number(rebound.affectedRows) !== 1) throw new ManualFulfillmentError('CDK changed concurrently', 'MANUAL_FULFILLMENT_CONFLICT', 409);
          await connection.query(
            `INSERT INTO cdk_delivery_events (id, cdk_id, batch_no, event_type, channel, actor_id, metadata_json)
             VALUES (?, ?, ?, 'REBOUND', 'order', ?, ?)`,
            [randomUUID(), cdk.id, cdk.batch_no || null, actor,
              JSON.stringify({ orderId: order.id, publicNo: reference, reason: text, previousOrderStatus: order.status })]);
          cdkOutcome = 'rebound REDEEMED';
        }
      }

      const [[card]] = await connection.query('SELECT id, last4, sync_tier FROM cards WHERE id = ? LIMIT 1 FOR UPDATE', [order.assigned_card_id]);
      const ledger = await transitionCardConsumptionInTransaction(connection, {
        orderId: order.id, targetStatus: cardUsed ? 'CONSUMED' : 'RELEASED',
        reason: `Order fulfilled manually outside the system; assigned card ${cardUsed ? 'WAS used by hand' : 'was NOT used'}: ${text}`,
        allowedCurrentStatuses: ['RESERVED'], requireActive: false,
        evidence: { source: 'close_manually_fulfilled_order', cardUsed, actorId: actor },
      });
      const release = await releaseCardForFailedOrderInTransaction(connection, { orderId: order.id, releasedBy: `admin:${actor}:manual-fulfilled`, reason: text });
      if (cardUsed && card) {
        await connection.query(
          `UPDATE cards SET inventory_status = 'DEPLETED', current_balance = NULL, last_transaction_synced_at = NULL, updated_at = CURRENT_TIMESTAMP(3)
           WHERE id = ?`, [card.id]);
      }
      const [tasks] = await connection.query(
        `UPDATE tasks SET status = 'DEAD', leased_by = NULL, leased_until = NULL,
           last_error_code = 'FULFILLED_MANUALLY_OUTSIDE', last_error_message = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE order_id = ? AND status IN ('PENDING','RUNNING')`, [text.slice(0, 255), order.id]);
      const [dispatch] = await connection.query(
        `UPDATE browser_dispatch_jobs SET status = 'CANCELLED', last_error_code = 'FULFILLED_MANUALLY_OUTSIDE',
           completed_at = CURRENT_TIMESTAMP(3), lease_owner = NULL, lease_token_hash = NULL, lease_until = NULL, updated_at = CURRENT_TIMESTAMP(3)
         WHERE order_id = ? AND status IN ('QUEUED','CLAIMED')`, [order.id]);
      const [closed] = await connection.query(
        `UPDATE orders SET status = 'RECHARGE_SUCCESS', cancellation_review_required = 1,
           assigned_card_id = CASE WHEN ? THEN assigned_card_id ELSE NULL END,
           failure_code = NULL, failure_reason = NULL, customer_action_code = NULL,
           version = version + 1, finished_at = CURRENT_TIMESTAMP(3), updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND version = ?`, [cardUsed ? 1 : 0, order.id, order.version]);
      if (Number(closed.affectedRows) !== 1) throw new ManualFulfillmentError('order changed concurrently', 'MANUAL_FULFILLMENT_CONFLICT', 409);
      const summary = {
        publicNo: reference, previousStatus: order.status, cardUsed, cardLast4: card?.last4 || null,
        ledger, release, deadTasks: Number(tasks.affectedRows || 0), cancelledDispatch: Number(dispatch.affectedRows || 0), cdk: cdkOutcome,
        next: 'operator confirms 取消续费 via 「已在账号里取消续费」'
      };
      await connection.query(
        `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
         VALUES (?, ?, 'RECHARGE_SUCCESS', 'ADMIN', ?, ?, ?)`,
        [order.id, order.status, actor, text, JSON.stringify({ closeManuallyFulfilled: true, ...summary, evidence })]);
      if (dryRun) { await connection.rollback(); return { ...summary, dryRun: true }; }
      await connection.commit();
      return { ...summary, dryRun: false };
    } catch (error) {
      await connection.rollback().catch(() => undefined);
      throw error;
    } finally {
      connection.release();
    }
  }

  return { closeManuallyFulfilled };
}
