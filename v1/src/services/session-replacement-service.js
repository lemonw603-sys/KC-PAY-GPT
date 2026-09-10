import { PublicApiError } from '../domain/public-api-error.js';
import { replaceCustomerSessionInTransaction } from '../db/repositories/session-replacement-repository.js';
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
      // Shared with order intake (a sent-back customer resubmitting the same
      // code is also a replacement): funds check, replacement row, order
      // update, task reset, order event.
      let replaced;
      try {
        replaced = await replaceCustomerSessionInTransaction(connection, {
          order, sessionCiphertext,
          customerEmail: validated.customerEmail, chatgptAccountId: validated.chatgptAccountId,
        });
      } catch (error) {
        if (error?.code === 'FUNDS_STATE_UNSAFE') throw replacementError('FUNDS_STATE_UNSAFE');
        throw error;
      }
      await connection.commit();
      return {
        publicNo: order.public_no,
        status: 'PROCESSING',
        replacementCount: replaced.replacementNo,
        replacementsRemaining: null
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  };
}
