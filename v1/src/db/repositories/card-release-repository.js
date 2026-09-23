// Releases the card held by an order that ended before any payment action.
// Used by the Browser pre-payment abort (RECHARGE_FAILED target) and by the
// one-off repair script for orders that failed before this release existed.
// Mirrors the operator cancellation path, except that manually imported cards
// keep their MANUAL_IMPORT sync tier (they have no API to re-sync against).

import { transitionCardConsumptionInTransaction } from '../../services/card-consumption-ledger-service.js';

function required(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
  return value.trim();
}

export async function releaseCardForFailedOrderInTransaction(connection, {
  orderId, releasedBy, reason, now = new Date()
}) {
  const order = required(orderId, 'orderId');
  const actor = required(releasedBy, 'releasedBy').slice(0, 128);
  const text = required(reason, 'reason').slice(0, 255);
  const [[setting]] = await connection.query(
    `SELECT setting_value FROM app_settings
     WHERE setting_key = 'default_minimum_required_card_balance' LIMIT 1 FOR SHARE`
  );
  const [[orderRow]] = await connection.query(
    'SELECT minimum_required_card_balance FROM orders WHERE id = ? LIMIT 1 FOR UPDATE', [order]
  );
  const minimumBalance = Number(setting?.setting_value ?? orderRow?.minimum_required_card_balance ?? 0);
  const [assignments] = await connection.query(
    `UPDATE card_assignment_history
     SET status = 'RELEASED', released_by = ?, release_reason = ?, released_at = ?, updated_at = ?
     WHERE order_id = ? AND status = 'ACTIVE'`,
    [actor, text, now, now, order]
  );
  // Only cards with no other live assignment go back to the pool; balance decides
  // AVAILABLE vs DEPLETED exactly like the cancellation path.
  const [cards] = await connection.query(
    `UPDATE cards c
     INNER JOIN orders o ON (c.id = o.assigned_card_id OR (o.assigned_card_id IS NULL AND c.order_id = o.id))
     SET c.next_sync_at = CASE WHEN c.sync_tier = 'MANUAL_IMPORT' THEN c.next_sync_at
                               WHEN c.current_balance >= ? THEN ? ELSE c.next_sync_at END,
         c.sync_tier = CASE WHEN c.sync_tier = 'MANUAL_IMPORT' THEN c.sync_tier
                            WHEN c.current_balance >= ? THEN 'AVAILABLE' ELSE c.sync_tier END,
         c.inventory_status = CASE WHEN c.current_balance >= ? THEN 'AVAILABLE' ELSE 'DEPLETED' END,
         c.assigned_at = NULL,
         c.order_id = CASE WHEN c.order_id = o.id THEN NULL ELSE c.order_id END,
         c.updated_at = ?
     WHERE o.id = ? AND c.inventory_status = 'ASSIGNED'
       AND NOT EXISTS (SELECT 1 FROM card_assignment_history other
                       WHERE other.card_id = c.id AND other.status = 'ACTIVE')`,
    [minimumBalance, now, minimumBalance, minimumBalance, now, order]
  );
  return {
    releasedAssignments: Number(assignments.affectedRows || 0),
    resetCards: Number(cards.affectedRows || 0),
    minimumBalance
  };
}


/**
 * D-355（2026-09-23，Lemon 定）：订单被打回「等 Session」时把卡放回池子，不让一张卡陪客户等
 * 72 小时。重贴路径本来就会处理「没有卡」：session-replacement-repository 在 assigned_card_id
 * 为空时回 WAITING_FOR_CARD 并重排 ASSIGN_CARD，一秒钟重新分卡。
 *
 * 只在**没有任何付款痕迹**时放：资金栅栏 ACTIVE/UNKNOWN/SETTLED、点过付款的 run、ZZSHU
 * 非明确失败的下单调用，任一存在就原样保留（这类单本就不该在等 Session，留给人看）。
 * 放的时候一起做：账本 RESERVED→RELEASED（已释放的跳过）、分配 RELEASED、卡回
 * AVAILABLE/DEPLETED、订单 assigned_card_id 清空。
 */
export async function releaseCardForSessionReplacementInTransaction(connection, {
  orderId, releasedBy, reason, now = new Date()
}) {
  const order = required(orderId, 'orderId');
  const actor = required(releasedBy, 'releasedBy').slice(0, 128);
  const text = required(reason, 'reason').slice(0, 255);
  const [[evidence]] = await connection.query(
    `SELECT
       (SELECT COUNT(*) FROM recharge_attempts ra WHERE ra.order_id = o.id
          AND ra.funds_risk_state IN ('ACTIVE','UNKNOWN','SETTLED')) AS live_or_paid_attempts,
       (SELECT COUNT(*) FROM browser_runs br INNER JOIN recharge_attempts bra ON bra.id = br.recharge_attempt_id
          WHERE bra.order_id = o.id
          AND br.payment_state IN ('PAYMENT_SUBMITTING','PAYMENT_UNKNOWN','PAYMENT_CONFIRMED')) AS payment_runs,
       (SELECT COUNT(*) FROM provider_calls pc WHERE pc.order_id = o.id AND pc.provider = 'zzshu'
          AND pc.operation = 'create_direct' AND pc.outcome <> 'DEFINITE_FAILURE') AS provider_calls
     FROM orders o WHERE o.id = ? LIMIT 1`, [order]
  );
  if (!evidence) throw new Error(`Order not found: ${order}`);
  for (const key of ['live_or_paid_attempts', 'payment_runs', 'provider_calls']) {
    if (Number(evidence[key]) > 0) return { released: false, blockedBy: key, count: Number(evidence[key]) };
  }
  const ledger = await transitionCardConsumptionInTransaction(connection, {
    orderId: order, targetStatus: 'RELEASED', reason: text, now,
    allowedCurrentStatuses: ['RESERVED'], requireActive: false,
    evidence: { source: 'session_replacement_release', releasedBy: actor }
  });
  const released = await releaseCardForFailedOrderInTransaction(connection, { orderId: order, releasedBy: actor, reason: text, now });
  await connection.query('UPDATE orders SET assigned_card_id = NULL, updated_at = ? WHERE id = ?', [now, order]);
  return { released: true, ledgerReleased: !ledger.missing, ...released };
}
