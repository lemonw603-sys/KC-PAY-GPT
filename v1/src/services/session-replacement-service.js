import crypto from 'node:crypto';
import { PublicApiError } from '../domain/public-api-error.js';
import { validateChatGptSession } from '../domain/session-validation.js';
import { createCdkLookup } from '../security/cdk-code.js';
import { encryptSecret } from '../security/secret-box.js';

const PUBLIC_NO_PATTERN = /^PJV1-[A-Za-z0-9_-]{20}$/;

function invalidLookup() {
  throw new PublicApiError('A valid order lookup is required', {
    code: 'INVALID_ORDER_QUERY', status: 400
  });
}

function normalizeLookup(input, cdkHashKey) {
  const publicNo = typeof input?.publicNo === 'string' ? input.publicNo.trim() : '';
  const cdk = typeof input?.cdk === 'string' ? input.cdk.trim() : '';
  if (Boolean(publicNo) === Boolean(cdk)) invalidLookup();
  if (publicNo) {
    if (!PUBLIC_NO_PATTERN.test(publicNo)) invalidLookup();
    return { sql: 'BINARY o.public_no = ?', values: [publicNo] };
  }
  if (cdk.length < 8 || cdk.length > 256) invalidLookup();
  const lookup = createCdkLookup(cdk, cdkHashKey);
  return {
    sql: `((c.hash_version = ? AND c.code_hash = ?)
      OR (c.hash_version = ? AND c.code_hash = ?))`,
    values: [lookup.current.version, lookup.current.hash,
      lookup.legacy.version, lookup.legacy.hash]
  };
}

function replacementError(code, status = 409) {
  const messages = {
    ORDER_NOT_FOUND: 'Order was not found',
    SESSION_REPLACEMENT_NOT_ALLOWED: 'Order is not waiting for a new Session',
    SESSION_REPLACEMENT_EXPIRED: 'Session replacement window has expired',
    SESSION_REPLACEMENT_LIMIT_REACHED: 'Session replacement limit has been reached',
    FUNDS_STATE_UNSAFE: 'Order funds state requires manual review'
  };
  return new PublicApiError(messages[code] || 'Session replacement failed', { code, status });
}

export function createSessionReplacementService({
  pool,
  sessionEncryptionKey,
  cdkHashKey,
  now = () => Date.now()
}) {
  if (!pool) throw new TypeError('pool is required');
  return async function replaceCustomerSession(input = {}) {
    const lookup = normalizeLookup(input, cdkHashKey);
    const validated = validateChatGptSession(input.session, { now });
    const sessionCiphertext = encryptSecret(JSON.stringify(validated.session), sessionEncryptionKey);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT o.id, o.public_no, o.status, o.version, o.customer_email,
                o.chatgpt_account_id, o.customer_action_code,
                o.session_replacement_count, o.session_repair_expires_at,
                o.assigned_card_id
         FROM orders o INNER JOIN cdks c ON c.id = o.cdk_id
         WHERE ${lookup.sql} LIMIT 1 FOR UPDATE`, lookup.values
      );
      const order = rows[0];
      if (!order) throw replacementError('ORDER_NOT_FOUND', 404);
      if (order.status !== 'WAITING_FOR_SESSION') {
        throw replacementError('SESSION_REPLACEMENT_NOT_ALLOWED');
      }
      const maxCount = 3;
      if (Number(order.session_replacement_count) >= maxCount) {
        throw replacementError('SESSION_REPLACEMENT_LIMIT_REACHED');
      }
      const expiresAt = new Date(order.session_repair_expires_at).getTime();
      if (!Number.isFinite(expiresAt) || expiresAt <= now()) {
        throw replacementError('SESSION_REPLACEMENT_EXPIRED');
      }
      const [riskRows] = await connection.query(
        `SELECT COUNT(*) AS count FROM recharge_attempts
         WHERE order_id = ? AND funds_risk_state IN ('ACTIVE','UNKNOWN','SETTLED')`,
        [order.id]
      );
      if (Number(riskRows[0]?.count || 0) !== 0) throw replacementError('FUNDS_STATE_UNSAFE');

      const replacementNo = Number(order.session_replacement_count) + 1;
      const resumeStatus = order.assigned_card_id ? 'CARD_READY' : 'WAITING_FOR_CARD';
      await connection.query(
        `INSERT INTO order_session_replacements
         (id, order_id, replacement_no, reason_code,
          previous_customer_email, previous_chatgpt_account_id,
          new_customer_email, new_chatgpt_account_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), order.id, replacementNo,
          order.customer_action_code || 'SESSION_REPLACEMENT_REQUIRED',
          order.customer_email, order.chatgpt_account_id,
          validated.customerEmail, validated.chatgptAccountId]
      );
      const [updated] = await connection.query(
        `UPDATE orders SET status = ?, session_ciphertext = ?,
           customer_email = ?, chatgpt_account_id = ?,
           session_replacement_count = ?, last_session_replaced_at = CURRENT_TIMESTAMP(3),
           customer_action_code = NULL, failure_code = NULL, failure_reason = NULL,
           version = version + 1, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND version = ? AND status = 'WAITING_FOR_SESSION'`,
        [resumeStatus, sessionCiphertext, validated.customerEmail, validated.chatgptAccountId,
          replacementNo, order.id, order.version]
      );
      if (Number(updated.affectedRows) !== 1) {
        throw new Error(`Concurrent Session replacement detected: ${order.id}`);
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
         VALUES (?, 'WAITING_FOR_SESSION', ?, 'customer', NULL,
           'customer replaced Session on the original order', ?)`,
        [order.id, resumeStatus, JSON.stringify({ replacementNo,
          accountChanged: order.chatgpt_account_id !== validated.chatgptAccountId })]
      );
      await connection.commit();
      return {
        publicNo: order.public_no,
        status: 'PROCESSING',
        replacementCount: replacementNo,
        replacementsRemaining: maxCount - replacementNo
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
}
