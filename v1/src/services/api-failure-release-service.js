import { PublicApiError } from '../domain/public-api-error.js';
import { successfulPurchaseSql } from '../domain/card-purchase-evidence.js';
import { returnCdkForOrderInTransaction } from '../db/repositories/cdk-return-repository.js';
import { transitionCardConsumptionInTransaction } from './card-consumption-ledger-service.js';

/**
 * 「放卡退卡密」：API 单直充平台确认失败后，卡锁在对账、卡密绑死，运营核实卡台没这笔扣款后一键放开
 * （2026-09-27 整体排查欠账 23，Lemon「做」）。
 *
 * 为什么要人：自动放卡只在卡流水同步到这张卡时才发生（card-transaction-repository），而 highvcc 同步
 * 只给卡台上有流水的卡写流水——对方没碰到卡就失败（如要人工安全验证）时，这张卡永远放不回。
 *
 * 能点的条件（列表摆不摆按钮、进不进「需要我处理」、服务拒不拒，全用下面同一组表达式，D-191）：
 *   API 路线 + 订单 RECHARGE_FAILED + 账本有 RECONCILIATION（卡还锁着）
 *   + 付款尝试是「对方确认失败」FAILED / CLEARED，且没有 ACTIVE / UNKNOWN / SETTLED 的
 *   + 系统在这张卡上没看到这单占用之后的成功扣款（看到了就不许放，先查清）。
 * 点下去：账本 RELEASED、卡的占用解除、卡密退回（客户页显示可重新兑换）、关「充值失败」告警、记订单事件。
 * 不改订单状态（仍 RECHARGE_FAILED），不碰卡的库存状态（与自动放卡一致）。
 */
export const API_FAILURE_RELEASE_REASON = 'operator verified the failed API order did not charge the card';

export function apiFailureReleaseConfirmation(publicNo) {
  return `确认没扣款 ${publicNo}`;
}

export function apiFailureReleaseInputsSql(alias = 'o') {
  if (!/^[a-z_][a-z0-9_]*$/i.test(String(alias))) throw new TypeError('invalid SQL alias');
  return {
    executor_kind: `(SELECT afr_fr.executor_kind FROM fulfillment_routes afr_fr WHERE afr_fr.id = ${alias}.fulfillment_route_id)`,
    reconciliation_ledgers: `(SELECT COUNT(*) FROM card_consumption_ledger afr_l WHERE afr_l.order_id = ${alias}.id AND afr_l.status = 'RECONCILIATION')`,
    cleared_failed_attempts: `(SELECT COUNT(*) FROM recharge_attempts afr_ra WHERE afr_ra.order_id = ${alias}.id AND afr_ra.status = 'FAILED' AND afr_ra.funds_risk_state = 'CLEARED')`,
    open_fund_attempts: `(SELECT COUNT(*) FROM recharge_attempts afr_ra2 WHERE afr_ra2.order_id = ${alias}.id AND afr_ra2.funds_risk_state IN ('ACTIVE','UNKNOWN','SETTLED'))`,
    charged_since_reservation: `(SELECT COUNT(*) FROM card_consumption_ledger afr_l2
        INNER JOIN card_transactions afr_t ON afr_t.card_id = afr_l2.card_id
        WHERE afr_l2.order_id = ${alias}.id AND afr_l2.status = 'RECONCILIATION'
          AND ${successfulPurchaseSql('afr_t')} AND afr_t.first_seen_at >= afr_l2.reserved_at)`
  };
}

/** 卡还锁着的 API 失败单（不论能不能放）——这类单要人看，进「需要我处理」。 */
export function apiFailureLockedSql(alias = 'o') {
  const e = apiFailureReleaseInputsSql(alias);
  return `(${alias}.status = 'RECHARGE_FAILED' AND ${e.executor_kind} = 'API' AND ${e.reconciliation_ledgers} > 0)`;
}

/** 能点「放卡退卡密」的（与 apiFailureReleaseEligibility 逐条对应）。 */
export function apiFailureReleasableSql(alias = 'o') {
  const e = apiFailureReleaseInputsSql(alias);
  return `(${apiFailureLockedSql(alias)} AND ${e.open_fund_attempts} = 0 AND ${e.cleared_failed_attempts} > 0
    AND ${e.charged_since_reservation} = 0)`;
}

export function apiFailureReleaseEligibility({
  orderStatus, executorKind, reconciliationLedgers, clearedFailedAttempts, openFundAttempts, chargedSinceReservation
} = {}) {
  const no = (code, reason) => ({ eligible: false, code, reason, status: 409 });
  if (String(executorKind || '').toUpperCase() !== 'API') {
    return no('API_FAILURE_RELEASE_WRONG_EXECUTOR', 'Only API-route failures release here');
  }
  if (orderStatus !== 'RECHARGE_FAILED') return no('API_FAILURE_RELEASE_NOT_FAILED', `Order is ${orderStatus}`);
  if (!(Number(reconciliationLedgers) > 0)) return no('API_FAILURE_RELEASE_NOTHING_LOCKED', 'The card is not locked by this order');
  if (Number(openFundAttempts) > 0 || !(Number(clearedFailedAttempts) > 0)) {
    return no('API_FAILURE_RELEASE_FUNDS_NOT_CLEARED', 'The payment attempt is not a provider-confirmed failure');
  }
  if (Number(chargedSinceReservation) > 0) {
    return no('API_FAILURE_RELEASE_CHARGE_OBSERVED', 'A successful purchase was observed on this card after the reservation');
  }
  return { eligible: true, code: null, reason: null, status: null };
}

function eligibilityFromRow(row) {
  return apiFailureReleaseEligibility({
    orderStatus: row.status,
    executorKind: row.executor_kind,
    reconciliationLedgers: row.reconciliation_ledgers,
    clearedFailedAttempts: row.cleared_failed_attempts,
    openFundAttempts: row.open_fund_attempts,
    chargedSinceReservation: row.charged_since_reservation
  });
}

function inputsSelect(alias) {
  return Object.entries(apiFailureReleaseInputsSql(alias)).map(([key, sql]) => `${sql} AS ${key}`).join(',\n       ');
}

/** 只读：订单抽屉用它决定摆不摆按钮（与服务同一份判断）。 */
export async function readApiFailureReleaseState(queryable, orderId) {
  const [rows] = await queryable.query(
    `SELECT o.status, ${inputsSelect('o')} FROM orders o WHERE o.id = ? LIMIT 1`, [orderId]
  );
  if (!rows[0]) return { eligible: false, code: 'ADMIN_ORDER_NOT_FOUND', locked: false };
  const verdict = eligibilityFromRow(rows[0]);
  const locked = rows[0].status === 'RECHARGE_FAILED'
    && String(rows[0].executor_kind || '').toUpperCase() === 'API' && Number(rows[0].reconciliation_ledgers) > 0;
  return { eligible: verdict.eligible, code: verdict.code, locked };
}

export function createApiFailureReleaseService({ pool, clock = () => new Date() }) {
  if (!pool?.getConnection) throw new TypeError('pool is required');

  return async function releaseApiFailure(publicNo, input = {}) {
    if (typeof publicNo !== 'string' || publicNo.length < 8 || publicNo.length > 64) {
      throw new PublicApiError('Order not found', { code: 'ADMIN_ORDER_NOT_FOUND', status: 404 });
    }
    if (input.confirmation !== apiFailureReleaseConfirmation(publicNo)) {
      throw new PublicApiError('Confirmation mismatch', { code: 'API_FAILURE_RELEASE_CONFIRMATION_REQUIRED', status: 400 });
    }
    const note = String(input.note || '').trim().slice(0, 300);
    const actorId = String(input.actorId || 'admin').trim().slice(0, 128) || 'admin';
    const now = clock();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [locked] = await connection.query(
        'SELECT id, status, version FROM orders WHERE BINARY public_no = ? LIMIT 1 FOR UPDATE', [publicNo]
      );
      if (locked.length !== 1) throw new PublicApiError('Order not found', { code: 'ADMIN_ORDER_NOT_FOUND', status: 404 });
      const order = locked[0];
      const [ledgers] = await connection.query(
        `SELECT l.id, l.card_id, c.last4 FROM card_consumption_ledger l LEFT JOIN cards c ON c.id = l.card_id
          WHERE l.order_id = ? AND l.status = 'RECONCILIATION' FOR UPDATE`, [order.id]
      );
      const [[state]] = await connection.query(
        `SELECT o.status, ${inputsSelect('o')} FROM orders o WHERE o.id = ?`, [order.id]
      );
      const verdict = eligibilityFromRow(state);
      if (!verdict.eligible) throw new PublicApiError(verdict.reason, { code: verdict.code, status: verdict.status });

      for (const ledger of ledgers) {
        await transitionCardConsumptionInTransaction(connection, {
          id: ledger.id, targetStatus: 'RELEASED', allowedCurrentStatuses: ['RECONCILIATION'], now,
          reason: API_FAILURE_RELEASE_REASON,
          evidence: { source: 'admin_api_failure_release', actorId, note: note || null }
        });
      }
      await connection.query(
        `UPDATE card_assignment_history SET status = 'RELEASED', released_by = ?, release_reason = ?,
           released_at = COALESCE(released_at, ?)
         WHERE order_id = ? AND status = 'ACTIVE'`,
        [`admin:${actorId}`.slice(0, 128), API_FAILURE_RELEASE_REASON, now, order.id]
      );
      const cdk = await returnCdkForOrderInTransaction(connection, {
        orderId: order.id, reason: API_FAILURE_RELEASE_REASON, actorType: 'ADMIN', actorId,
        metadata: { source: 'admin_api_failure_release' }
      });
      const [orderUpdate] = await connection.query(
        'UPDATE orders SET version = version + 1, updated_at = ? WHERE id = ? AND version = ?',
        [now, order.id, order.version]
      );
      if (orderUpdate.affectedRows !== 1) throw new PublicApiError('Order changed concurrently', { code: 'ORDER_CONFLICT', status: 409 });
      await connection.query(
        `INSERT INTO order_events (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
         VALUES (?, ?, ?, 'ADMIN', ?, ?, ?)`,
        [order.id, order.status, order.status, actorId,
          'Operator verified the failed API order did not charge the card; card released and CDK returned',
          JSON.stringify({ apiFailureRelease: true, ledgers: ledgers.length, cdkReturned: cdk.returned,
            cdkReturnCode: cdk.reasonCode, note: note || null })]
      );
      await connection.query(
        `UPDATE operator_alerts SET status = 'RESOLVED', acknowledged_at = COALESCE(acknowledged_at, ?)
         WHERE dedupe_key = ? AND status = 'OPEN'`, [now, `api-order-failed:${order.id}`]
      );
      await connection.commit();
      return { publicNo, released: ledgers.length, cdkReturned: cdk.returned,
        cardLast4: ledgers[0]?.last4 || null };
    } catch (error) {
      await connection.rollback().catch(() => {});
      throw error;
    } finally {
      connection.release();
    }
  };
}
