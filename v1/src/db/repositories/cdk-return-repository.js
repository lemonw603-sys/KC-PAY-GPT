import { randomUUID } from 'node:crypto';

/**
 * Read-only: the payment evidence that decides whether a CDK may go back.
 * Runs on any connection or pool — it writes nothing and takes no locks, so the
 * customer-facing verify path can ask the same question the intake transaction
 * will ask later under FOR UPDATE. One source for the rule, two callers.
 */
export async function readCdkReturnEvidence(connection, orderId) {
  const order = String(orderId || '').trim();
  if (!order) throw new TypeError('orderId is required');
  const [[row]] = await connection.query(
    `SELECT /* cdk-return payment evidence */
        (SELECT COUNT(*) FROM recharge_attempts
          WHERE order_id = ? AND (funds_risk_state IN ('UNKNOWN','SETTLED') OR status = 'SUCCESS'))
      + (SELECT COUNT(*) FROM card_consumption_ledger
          WHERE order_id = ? AND status IN ('CONSUMED','RECONCILIATION')) AS funds_evidence,
        (SELECT COUNT(*) FROM browser_operations bo
          INNER JOIN browser_runs br ON br.id = bo.browser_run_id
          INNER JOIN recharge_attempts rat ON rat.id = br.recharge_attempt_id
          WHERE rat.order_id = ? AND bo.operation_type = 'PAYMENT_SUBMIT') AS submit_evidence`,
    [order, order, order],
  );
  return {
    fundsEvidence: Number(row?.funds_evidence || 0),
    submitEvidence: Number(row?.submit_evidence || 0),
  };
}

/** Read-only verdict over that evidence. Funds evidence blocks unconditionally. */
export function cdkReturnBlockedBy(evidence, { paymentSubmitAdjudicated = false } = {}) {
  if (Number(evidence?.fundsEvidence || 0) > 0) return true;
  if (!paymentSubmitAdjudicated && Number(evidence?.submitEvidence || 0) > 0) return true;
  return false;
}

/**
 * A CDK is a paid entitlement. It is bound to an order at intake (REDEEMED)
 * and only consumed by delivery. When an order ends without any payment
 * action, the CDK goes back to AVAILABLE so the customer can submit again.
 * Any payment evidence at all (settled/unknown funds, consumed ledger, a
 * PAYMENT_SUBMIT operation) keeps the CDK bound: those orders are for humans.
 *
 * Must run inside the caller's transaction on the same connection.
 */
export async function returnCdkForOrderInTransaction(connection, {
  orderId, reason, actorType = 'SYSTEM', actorId = 'system', metadata = {},
  // F-48 (2026-09-11): a submit click alone blocks the return, which is right
  // while nobody knows whether money moved. It stops being right once a person
  // has looked at the account and the card and recorded "not charged"
  // (RESOLVE_UNKNOWN_PAYMENT / NOT_CHARGED): the customer then holds a spent CDK
  // for a service they never got. That verdict — and only that — clears the
  // click; the funds-ledger evidence below still blocks unconditionally.
  paymentSubmitAdjudicated = false,
} = {}) {
  const order = String(orderId || '').trim();
  if (!order) throw new TypeError('orderId is required');
  const evidence = await readCdkReturnEvidence(connection, order);
  if (cdkReturnBlockedBy(evidence, { paymentSubmitAdjudicated })) {
    return { returned: false, reasonCode: 'PAYMENT_EVIDENCE', cdkId: null };
  }
  const [bound] = await connection.query(
    `SELECT id, batch_no FROM cdks WHERE order_id = ? AND status = 'REDEEMED' LIMIT 1 FOR UPDATE`,
    [order],
  );
  if (!bound.length) return { returned: false, reasonCode: 'CDK_NOT_BOUND', cdkId: null };
  const cdk = bound[0];
  const [update] = await connection.query(
    `UPDATE cdks SET status = 'AVAILABLE', order_id = NULL, redeemed_at = NULL
     WHERE id = ? AND order_id = ? AND status = 'REDEEMED'`,
    [cdk.id, order],
  );
  if (Number(update.affectedRows) !== 1) return { returned: false, reasonCode: 'CDK_NOT_BOUND', cdkId: null };
  await connection.query(
    `INSERT INTO cdk_delivery_events
       (id, cdk_id, batch_no, event_type, channel, actor_id, metadata_json)
     VALUES (?, ?, ?, 'RETURNED', 'order', ?, ?)`,
    [randomUUID(), cdk.id, cdk.batch_no || null, String(actorId).slice(0, 128),
      JSON.stringify({ orderId: order, reason: String(reason || '').slice(0, 300), actorType, ...metadata })],
  );
  return { returned: true, reasonCode: null, cdkId: cdk.id };
}

/** Statuses in which an order can no longer deliver: only these may hand the CDK back. */
export const CDK_RETURN_ORDER_STATUSES = Object.freeze(['RECHARGE_FAILED', 'CLOSED']);
