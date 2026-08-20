import { randomUUID } from 'node:crypto';

const MIN_TTL_MINUTES = 1;
const MAX_TTL_MINUTES = 30;

export class RechargeAuthorizationV2Error extends Error {
  constructor(message, code, details = undefined) {
    super(message);
    this.name = 'RechargeAuthorizationV2Error';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function validatePublicNos(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new RechargeAuthorizationV2Error('publicNos must be a non-empty array', 'INVALID_ORDERS');
  }
  const publicNos = value.map((item) => String(item || '').trim());
  if (publicNos.some((item) => item.length < 8 || item.length > 64)) {
    throw new RechargeAuthorizationV2Error('invalid public order number', 'INVALID_ORDER');
  }
  if (new Set(publicNos).size !== publicNos.length) {
    throw new RechargeAuthorizationV2Error('publicNos contains duplicates', 'DUPLICATE_ORDER');
  }
  return publicNos;
}

function validateTtl(value) {
  const ttl = Number(value);
  if (!Number.isInteger(ttl) || ttl < MIN_TTL_MINUTES || ttl > MAX_TTL_MINUTES) {
    throw new RechargeAuthorizationV2Error(
      `ttlMinutes must be an integer from ${MIN_TTL_MINUTES} to ${MAX_TTL_MINUTES}`,
      'INVALID_TTL'
    );
  }
  return ttl;
}

function actor(value) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new RechargeAuthorizationV2Error('authorizedBy is required', 'INVALID_ACTOR');
  }
  return normalized.slice(0, 128);
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

function placeholders(values) {
  return values.map(() => '?').join(', ');
}

function indexByPublicNo(rows) {
  return new Map(rows.map((row) => [String(row.public_no), row]));
}

/**
 * Freezes an explicit set of orders into a single-use authorization. This does
 * not touch task payloads or any global dispatch setting.
 */
export async function createRechargeAuthorization(pool, {
  publicNos,
  ttlMinutes = 10,
  authorizedBy = 'root',
  reason = null,
  now = new Date()
}) {
  const requested = validatePublicNos(publicNos);
  const ttl = validateTtl(ttlMinutes);
  const approvedBy = actor(authorizedBy);
  const authorizationId = randomUUID();
  const expiresAt = new Date(now.getTime() + ttl * 60_000);

  return inTransaction(pool, async (connection) => {
    const [rows] = await connection.query(
      `SELECT o.id AS order_id, o.public_no, o.status AS order_status,
              t.id AS task_id, t.status AS task_status, t.attempts
       FROM orders o
       INNER JOIN tasks t ON t.order_id = o.id AND t.task_type = 'SUBMIT_RECHARGE'
       WHERE BINARY o.public_no IN (${placeholders(requested)})
       ORDER BY o.id
       FOR UPDATE`,
      requested
    );

    const byPublicNo = indexByPublicNo(rows);
    const missing = requested.filter((publicNo) => !byPublicNo.has(publicNo));
    if (missing.length) {
      throw new RechargeAuthorizationV2Error('one or more submit tasks were not found', 'TASK_NOT_FOUND', { publicNos: missing });
    }

    const orderedRows = requested.map((publicNo) => byPublicNo.get(publicNo));
    const ineligible = orderedRows.filter((row) => (
      row.order_status !== 'CARD_READY'
      || row.task_status !== 'PENDING'
      || Number(row.attempts) !== 0
    ));
    if (ineligible.length) {
      throw new RechargeAuthorizationV2Error('one or more orders are not eligible', 'ORDER_NOT_ELIGIBLE', {
        publicNos: ineligible.map((row) => row.public_no)
      });
    }

    const orderIds = orderedRows.map((row) => row.order_id);
    const [fencedAttempts] = await connection.query(
      `SELECT order_id
       FROM recharge_attempts
       WHERE order_id IN (${placeholders(orderIds)})
         AND funds_risk_state IN ('ACTIVE', 'UNKNOWN', 'SETTLED')
       FOR UPDATE`,
      orderIds
    );
    if (fencedAttempts.length) {
      throw new RechargeAuthorizationV2Error('an order already has a funds-risk attempt', 'FUNDS_FENCE_EXISTS', {
        orderIds: fencedAttempts.map((row) => row.order_id)
      });
    }

    const [legacyCalls] = await connection.query(
      `SELECT order_id
       FROM provider_calls
       WHERE order_id IN (${placeholders(orderIds)})
         AND recharge_attempt_id IS NULL
         AND LOWER(provider) = 'zzshu'
         AND operation = 'create_direct'
       FOR UPDATE`,
      orderIds
    );
    if (legacyCalls.length) {
      throw new RechargeAuthorizationV2Error('a legacy provider create call already exists', 'LEGACY_CREATE_ALREADY_ATTEMPTED', {
        orderIds: legacyCalls.map((row) => row.order_id)
      });
    }

    // Expiry must release the generated-column membership fence; otherwise an
    // expired batch would permanently prevent a fresh explicit authorization.
    await connection.query(
      `UPDATE recharge_authorization_items rai
       INNER JOIN recharge_authorizations ra ON ra.id = rai.authorization_id
       SET rai.status = 'EXPIRED'
       WHERE rai.order_id IN (${placeholders(orderIds)})
         AND rai.status = 'PENDING'
         AND (ra.status <> 'ACTIVE' OR ra.expires_at <= ?)`,
      [...orderIds, now]
    );

    const [protectedItems] = await connection.query(
      `SELECT order_id
       FROM recharge_authorization_items
       WHERE order_id IN (${placeholders(orderIds)})
         AND status IN ('PENDING', 'CONSUMED')
       FOR UPDATE`,
      orderIds
    );
    if (protectedItems.length) {
      throw new RechargeAuthorizationV2Error('an order already belongs to an active authorization', 'AUTHORIZATION_EXISTS', {
        orderIds: protectedItems.map((row) => row.order_id)
      });
    }

    await connection.query(
      `INSERT INTO recharge_authorizations
       (id, authorization_mode, status, authorized_by, reason, max_orders, expires_at, created_at)
       VALUES (?, ?, 'ACTIVE', ?, ?, ?, ?, ?)`,
      [authorizationId, requested.length === 1 ? 'SINGLE' : 'BATCH', approvedBy,
        reason == null ? null : String(reason).slice(0, 500), requested.length, expiresAt, now]
    );

    const items = orderedRows.map((row) => ({
      id: randomUUID(),
      orderId: row.order_id,
      publicNo: String(row.public_no)
    }));
    const itemValues = items.flatMap((item) => [item.id, authorizationId, item.orderId, now]);
    await connection.query(
      `INSERT INTO recharge_authorization_items
       (id, authorization_id, order_id, status, created_at)
       VALUES ${items.map(() => "(?, ?, ?, 'PENDING', ?)").join(', ')}`,
      itemValues
    );

    return {
      id: authorizationId,
      mode: requested.length === 1 ? 'SINGLE' : 'BATCH',
      status: 'ACTIVE',
      expiresAt: expiresAt.toISOString(),
      items: items.map(({ id, publicNo }) => ({ id, publicNo, status: 'PENDING' }))
    };
  });
}

/** Revokes only still-pending members; consumed members remain immutable. */
export async function revokeRechargeAuthorization(pool, {
  authorizationId,
  revokedBy = 'root',
  now = new Date()
}) {
  const id = String(authorizationId || '').trim();
  if (!id) throw new RechargeAuthorizationV2Error('authorizationId is required', 'INVALID_AUTHORIZATION');
  const operator = actor(revokedBy);

  return inTransaction(pool, async (connection) => {
    const [authorizations] = await connection.query(
      `SELECT id, status
       FROM recharge_authorizations
       WHERE id = ?
       FOR UPDATE`,
      [id]
    );
    if (authorizations.length !== 1) {
      throw new RechargeAuthorizationV2Error('authorization not found', 'AUTHORIZATION_NOT_FOUND');
    }

    const [items] = await connection.query(
      `SELECT id, order_id, status
       FROM recharge_authorization_items
       WHERE authorization_id = ?
       ORDER BY id
       FOR UPDATE`,
      [id]
    );
    const pending = items.filter((item) => item.status === 'PENDING');
    if (!pending.length) {
      throw new RechargeAuthorizationV2Error('authorization has no revocable items', 'NOT_REVOCABLE');
    }

    const pendingIds = pending.map((item) => item.id);
    const [itemUpdate] = await connection.query(
      `UPDATE recharge_authorization_items
       SET status = 'REVOKED'
       WHERE id IN (${placeholders(pendingIds)}) AND status = 'PENDING'`,
      pendingIds
    );
    if (itemUpdate.affectedRows !== pendingIds.length) {
      throw new RechargeAuthorizationV2Error('authorization changed concurrently', 'AUTHORIZATION_CONFLICT');
    }
    await connection.query(
      `UPDATE recharge_authorizations
       SET status = 'REVOKED', revoked_at = ?
       WHERE id = ?`,
      [now, id]
    );

    return {
      id,
      status: 'REVOKED',
      revokedBy: operator,
      revokedItems: pendingIds.length,
      consumedItems: items.filter((item) => item.status === 'CONSUMED').length,
      revokedAt: now.toISOString()
    };
  });
}

/** Returns operational status only; task payloads and provider responses are never selected. */
export async function getRechargeAuthorizationStatus(pool, { publicNo, now = new Date() }) {
  const [orderNumber] = validatePublicNos([publicNo]);
  const [rows] = await pool.query(
    `SELECT o.status AS order_status, t.status AS task_status, t.attempts,
            ra.id AS authorization_id, ra.authorization_mode, ra.status AS authorization_status,
            ra.expires_at, rai.id AS authorization_item_id, rai.status AS item_status,
            rat.id AS attempt_id, rat.status AS attempt_status, rat.funds_risk_state
     FROM orders o
     INNER JOIN tasks t ON t.order_id = o.id AND t.task_type = 'SUBMIT_RECHARGE'
     LEFT JOIN recharge_authorization_items rai ON rai.order_id = o.id
     LEFT JOIN recharge_authorizations ra ON ra.id = rai.authorization_id
     LEFT JOIN recharge_attempts rat ON rat.authorization_item_id = rai.id
     WHERE BINARY o.public_no = ?
     ORDER BY rai.created_at DESC
     LIMIT 1`,
    [orderNumber]
  );
  if (rows.length !== 1) {
    throw new RechargeAuthorizationV2Error('submit task not found', 'TASK_NOT_FOUND');
  }
  const row = rows[0];
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  let effectiveStatus = row.item_status || 'LOCKED';
  if (effectiveStatus === 'PENDING' && expiresAt && expiresAt.getTime() <= now.getTime()) {
    effectiveStatus = 'EXPIRED';
  }
  return {
    publicNo: orderNumber,
    orderStatus: row.order_status,
    taskStatus: row.task_status,
    taskAttempts: Number(row.attempts),
    authorization: row.authorization_id ? {
      id: row.authorization_id,
      mode: row.authorization_mode,
      status: row.authorization_status,
      itemId: row.authorization_item_id,
      itemStatus: effectiveStatus,
      expiresAt: expiresAt?.toISOString() || null
    } : null,
    attempt: row.attempt_id ? {
      id: row.attempt_id,
      status: row.attempt_status,
      fundsRiskState: row.funds_risk_state
    } : null
  };
}
