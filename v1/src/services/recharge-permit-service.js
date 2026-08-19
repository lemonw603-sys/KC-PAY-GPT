import { OrderStatus } from '../domain/order-status.js';
import { validateChatGptSession } from '../domain/session-validation.js';
import { decryptSecret } from '../security/secret-box.js';

export class RechargePermitError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'RechargePermitError';
    this.code = code;
  }
}

function parsePayload(value) {
  if (!value) return {};
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function validatePublicNo(value) {
  const publicNo = String(value || '').trim();
  if (publicNo.length < 8 || publicNo.length > 64) {
    throw new RechargePermitError('invalid public order number', 'INVALID_ORDER');
  }
  return publicNo;
}

async function inTransaction(pool, action) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await action(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export function validateRechargePreflight(row, { sessionEncryptionKey, now }) {
  if (!Buffer.isBuffer(sessionEncryptionKey) || !row.session_ciphertext) {
    throw new RechargePermitError('Session cannot be verified', 'SESSION_INVALID');
  }
  try {
    const session = JSON.parse(decryptSecret(row.session_ciphertext, sessionEncryptionKey));
    validateChatGptSession(session, { now: () => now.getTime(), minimumAccessTokenLifetimeSeconds: 300 });
  } catch {
    throw new RechargePermitError('Session is expired or invalid', 'SESSION_INVALID');
  }
  const syncedAt = row.card_last_synced_at ? new Date(row.card_last_synced_at).getTime() : NaN;
  if (!Number.isFinite(syncedAt) || now.getTime() - syncedAt > 15 * 60_000) {
    throw new RechargePermitError('Card verification is stale', 'CARD_CHECK_STALE');
  }
  const active = ['active', 'available', 'usable', 'ready'].includes(String(row.card_status || '').toLowerCase());
  if (!active || Number(row.card_balance) < Number(row.minimum_required_card_balance)
    || !row.card_credentials_ciphertext) {
    throw new RechargePermitError('Card is not ready for recharge', 'CARD_NOT_READY');
  }
}

export async function armRechargePermit(pool, {
  publicNo,
  ttlMinutes = 10,
  approvedBy = 'root',
  enableDispatch = true,
  now = new Date(),
  sessionEncryptionKey = null,
  preflight = validateRechargePreflight
}) {
  const orderNumber = validatePublicNo(publicNo);
  const ttl = Number(ttlMinutes);
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 30) {
    throw new RechargePermitError('ttlMinutes must be an integer from 1 to 30', 'INVALID_TTL');
  }
  return inTransaction(pool, async (connection) => {
    const [rows] = await connection.query(
      `SELECT o.id AS order_id, o.status AS order_status, o.session_ciphertext,
              o.minimum_required_card_balance, t.id AS task_id,
              t.status AS task_status, t.attempts, t.payload_json,
              c.status AS card_status, c.current_balance AS card_balance,
              c.card_credentials_ciphertext, c.last_synced_at AS card_last_synced_at
       FROM orders o INNER JOIN tasks t ON t.order_id = o.id
       LEFT JOIN cards c ON c.order_id = o.id
       WHERE BINARY o.public_no = ? AND t.task_type = 'SUBMIT_RECHARGE'
       LIMIT 1 FOR UPDATE`,
      [orderNumber]
    );
    if (rows.length !== 1) throw new RechargePermitError('submit task not found', 'TASK_NOT_FOUND');
    const row = rows[0];
    if (row.order_status !== OrderStatus.CARD_READY || row.task_status !== 'PENDING' || Number(row.attempts) !== 0) {
      throw new RechargePermitError('order is not eligible for one-time recharge', 'ORDER_NOT_ELIGIBLE');
    }
    preflight(row, { sessionEncryptionKey, now });
    const [priorCalls] = await connection.query(
      `SELECT id FROM provider_calls
       WHERE order_id = ? AND provider = 'zzshu' AND operation = 'create_direct'
       LIMIT 1 FOR UPDATE`,
      [row.order_id]
    );
    if (priorCalls.length) {
      throw new RechargePermitError('a recharge create call was already attempted', 'CREATE_ALREADY_ATTEMPTED');
    }
    const [otherPermits] = await connection.query(
      `SELECT id FROM tasks
       WHERE task_type = 'SUBMIT_RECHARGE' AND id <> ?
         AND JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.rechargePermit.status')) = 'ARMED'
         AND STR_TO_DATE(
           JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.rechargePermit.expiresAt')),
           '%Y-%m-%dT%H:%i:%s.%fZ'
         ) > UTC_TIMESTAMP(3)
       LIMIT 1 FOR UPDATE`,
      [row.task_id]
    );
    if (otherPermits.length) {
      throw new RechargePermitError('another order already has an active permit', 'ANOTHER_PERMIT_ACTIVE');
    }
    const payload = parsePayload(row.payload_json);
    const expiresAt = new Date(now.getTime() + ttl * 60_000);
    payload.rechargePermit = {
      status: 'ARMED',
      approvedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      approvedBy: String(approvedBy).slice(0, 128)
    };
    await connection.query(
      `UPDATE tasks SET payload_json = ?, available_at = CURRENT_TIMESTAMP(3),
         updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?`,
      [JSON.stringify(payload), row.task_id]
    );
    await connection.query(
      `INSERT INTO order_events
       (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
       VALUES (?, ?, ?, 'OPERATOR', ?, 'one-time recharge permit armed', ?)`,
      [row.order_id, OrderStatus.CARD_READY, OrderStatus.CARD_READY,
        String(approvedBy).slice(0, 128), JSON.stringify({ expiresAt: expiresAt.toISOString() })]
    );
    if (enableDispatch) {
      const [dispatch] = await connection.query(
        `UPDATE app_settings SET setting_value = 'true', updated_at = CURRENT_TIMESTAMP(3)
         WHERE setting_key = 'dispatch_new_recharges'`
      );
      if (dispatch.affectedRows !== 1) throw new Error('Recharge dispatch setting is missing');
    }
    return { publicNo: orderNumber, status: 'ARMED', expiresAt: expiresAt.toISOString() };
  });
}

export async function revokeRechargePermit(pool, { publicNo, revokedBy = 'root', now = new Date() }) {
  const orderNumber = validatePublicNo(publicNo);
  return inTransaction(pool, async (connection) => {
    const [rows] = await connection.query(
      `SELECT o.id AS order_id, o.status AS order_status, t.id AS task_id, t.payload_json
       FROM orders o INNER JOIN tasks t ON t.order_id = o.id
       WHERE BINARY o.public_no = ? AND t.task_type = 'SUBMIT_RECHARGE'
       LIMIT 1 FOR UPDATE`,
      [orderNumber]
    );
    if (rows.length !== 1) throw new RechargePermitError('submit task not found', 'TASK_NOT_FOUND');
    const payload = parsePayload(rows[0].payload_json);
    const previousStatus = payload.rechargePermit?.status || 'LOCKED';
    if (previousStatus === 'CONSUMED') {
      return { publicNo: orderNumber, status: 'CONSUMED' };
    }
    payload.rechargePermit = {
      ...(payload.rechargePermit || {}),
      status: 'REVOKED',
      revokedAt: now.toISOString(),
      revokedBy: String(revokedBy).slice(0, 128)
    };
    await connection.query('UPDATE tasks SET payload_json = ? WHERE id = ?', [JSON.stringify(payload), rows[0].task_id]);
    await connection.query(
      `INSERT INTO order_events
       (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
       VALUES (?, ?, ?, 'OPERATOR', ?, 'recharge permit revoked', ?)`,
      [rows[0].order_id, rows[0].order_status, rows[0].order_status,
        String(revokedBy).slice(0, 128), JSON.stringify({ previousStatus })]
    );
    return { publicNo: orderNumber, status: 'REVOKED' };
  });
}

export async function getRechargePermitStatus(pool, { publicNo }) {
  const orderNumber = validatePublicNo(publicNo);
  const [rows] = await pool.query(
    `SELECT o.status AS order_status, t.status AS task_status, t.attempts, t.payload_json
     FROM orders o INNER JOIN tasks t ON t.order_id = o.id
     WHERE BINARY o.public_no = ? AND t.task_type = 'SUBMIT_RECHARGE' LIMIT 1`,
    [orderNumber]
  );
  if (rows.length !== 1) throw new RechargePermitError('submit task not found', 'TASK_NOT_FOUND');
  const permit = parsePayload(rows[0].payload_json).rechargePermit || {};
  return {
    publicNo: orderNumber,
    orderStatus: rows[0].order_status,
    taskStatus: rows[0].task_status,
    attempts: Number(rows[0].attempts),
    permitStatus: permit.status || 'LOCKED',
    expiresAt: permit.expiresAt || null
  };
}
