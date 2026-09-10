import crypto from 'node:crypto';

/**
 * Replaces the customer Session on an order that is waiting for one
 * (WAITING_FOR_SESSION) and resumes it. Shared by the public replacement
 * endpoint and by order intake: a customer who was sent back and submits the
 * same CDK again (same account or a different free account) is replacing the
 * Session, not opening a second order (audit F-34 / F-35, baseline D-120).
 *
 * Must run inside the caller's transaction on the same connection; the caller
 * has already locked the order row FOR UPDATE and validated the Session.
 * Query order is part of the contract (tests replay it): funds check,
 * replacement row, order update, task reset, order event.
 */
export class SessionReplacementError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'SessionReplacementError';
    this.code = code;
  }
}

export async function replaceCustomerSessionInTransaction(connection, {
  order, sessionCiphertext, customerEmail, chatgptAccountId,
  actorType = 'customer', reason = 'customer replaced Session on the original order',
} = {}) {
  if (!order?.id) throw new TypeError('order row is required');
  if (order.status !== 'WAITING_FOR_SESSION') {
    throw new SessionReplacementError('Order is not waiting for a new Session', 'SESSION_REPLACEMENT_NOT_ALLOWED');
  }
  if (!sessionCiphertext) throw new TypeError('sessionCiphertext is required');
  // A customer may re-submit a Session as many times as it takes and whenever
  // they get to it: the order waits, the CDK stays bound.
  const [riskRows] = await connection.query(
    `SELECT COUNT(*) AS count FROM recharge_attempts
     WHERE order_id = ? AND funds_risk_state IN ('ACTIVE','UNKNOWN','SETTLED')`,
    [order.id]
  );
  if (Number(riskRows?.[0]?.count || 0) !== 0) {
    throw new SessionReplacementError('Order funds state requires manual review', 'FUNDS_STATE_UNSAFE');
  }
  const replacementNo = Number(order.session_replacement_count || 0) + 1;
  const resumeStatus = order.assigned_card_id ? 'CARD_READY' : 'WAITING_FOR_CARD';
  const accountChanged = order.chatgpt_account_id !== chatgptAccountId;
  await connection.query(
    `INSERT INTO order_session_replacements
     (id, order_id, replacement_no, reason_code,
      previous_customer_email, previous_chatgpt_account_id,
      new_customer_email, new_chatgpt_account_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [crypto.randomUUID(), order.id, replacementNo,
      order.customer_action_code || 'SESSION_REPLACEMENT_REQUIRED',
      order.customer_email, order.chatgpt_account_id,
      customerEmail, chatgptAccountId]
  );
  const [updated] = await connection.query(
    `UPDATE orders SET status = ?, session_ciphertext = ?,
       customer_email = ?, chatgpt_account_id = ?,
       session_replacement_count = ?, last_session_replaced_at = CURRENT_TIMESTAMP(3),
       customer_action_code = NULL, failure_code = NULL, failure_reason = NULL,
       version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
     WHERE id = ? AND version = ? AND status = 'WAITING_FOR_SESSION'`,
    [resumeStatus, sessionCiphertext, customerEmail, chatgptAccountId,
      replacementNo, order.id, order.version]
  );
  if (Number(updated?.affectedRows) !== 1) {
    throw new SessionReplacementError(`Concurrent Session replacement detected: ${order.id}`, 'SESSION_REPLACEMENT_CONFLICT');
  }
  await connection.query(
    `UPDATE tasks SET status = 'PENDING', attempts = 0, available_at = CURRENT_TIMESTAMP(3),
       leased_by = NULL, leased_until = NULL, last_error_code = NULL, last_error_message = NULL,
       completed_at = NULL,
       payload_json = CASE WHEN task_type = 'SUBMIT_RECHARGE'
         THEN JSON_REMOVE(COALESCE(payload_json, JSON_OBJECT()), '$.rechargePermit')
         ELSE payload_json END,
       updated_at = CURRENT_TIMESTAMP(3)
     WHERE order_id = ? AND task_type IN ('BROWSER_PREFLIGHT','PREPARE_RECHARGE','SUBMIT_RECHARGE')`,
    [order.id]
  );
  await connection.query(
    `INSERT INTO order_events
     (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
     VALUES (?, 'WAITING_FOR_SESSION', ?, ?, NULL, ?, ?)`,
    [order.id, resumeStatus, actorType, reason,
      JSON.stringify({ replacementNo, accountChanged })]
  );
  return { resumeStatus, replacementNo, accountChanged };
}
