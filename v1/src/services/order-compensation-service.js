import crypto from 'node:crypto';
import { generateCdks } from './cdk-service.js';
import { decryptSecret, encryptSecret } from '../security/secret-box.js';

export class OrderCompensationError extends Error {
  constructor(message, code, status = 409) {
    super(message);
    this.name = 'OrderCompensationError';
    this.code = code;
    this.status = status;
  }
}

function hashCdk(code) {
  return crypto.createHash('sha256').update(code, 'utf8').digest('hex');
}

function recover(row, key) {
  return {
    publicNo: row.public_no,
    planType: row.plan_type,
    code: decryptSecret(row.code_ciphertext, key),
    issuedAt: row.compensated_at instanceof Date ? row.compensated_at.toISOString() : row.compensated_at,
    replayed: true
  };
}

export function createOrderCompensationService({ pool, sessionEncryptionKey }) {
  if (!pool) throw new TypeError('pool is required');
  if (!Buffer.isBuffer(sessionEncryptionKey)) throw new TypeError('sessionEncryptionKey is required');

  return async function compensateOrder(publicNo, input = {}) {
    if (typeof publicNo !== 'string' || publicNo.length < 8 || publicNo.length > 64) {
      throw new OrderCompensationError('Order not found', 'ADMIN_ORDER_NOT_FOUND', 404);
    }
    if (input.confirmation !== `补发 ${publicNo}`) {
      throw new OrderCompensationError('Compensation confirmation mismatch', 'COMPENSATION_CONFIRMATION_REQUIRED', 400);
    }
    const reason = String(input.reason || 'system failure before provider side effects').trim();
    if (!reason || reason.length > 500) {
      throw new OrderCompensationError('Invalid compensation reason', 'INVALID_COMPENSATION_REASON', 400);
    }

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT o.id, o.public_no, o.status, o.plan_type,
                oc.code_ciphertext, oc.created_at AS compensated_at,
                (SELECT COUNT(*) FROM cards c WHERE c.order_id = o.id) AS card_count,
                (SELECT COUNT(*) FROM provider_calls pc WHERE pc.order_id = o.id) AS provider_call_count,
                (SELECT COUNT(*) FROM tasks t WHERE t.order_id = o.id AND t.status IN ('PENDING','RUNNING')) AS active_task_count,
                (SELECT COUNT(*) FROM tasks t WHERE t.order_id = o.id AND t.status = 'DEAD') AS dead_task_count
         FROM orders o LEFT JOIN order_compensations oc ON oc.original_order_id = o.id
         WHERE BINARY o.public_no = ? LIMIT 1 FOR UPDATE`,
        [publicNo]
      );
      const order = rows[0];
      if (!order) throw new OrderCompensationError('Order not found', 'ADMIN_ORDER_NOT_FOUND', 404);
      if (order.code_ciphertext) {
        await connection.commit();
        return recover(order, sessionEncryptionKey);
      }
      if (order.status !== 'CREATED') {
        throw new OrderCompensationError('Order has entered the card or recharge workflow', 'COMPENSATION_SIDE_EFFECT_RISK');
      }
      if (Number(order.card_count) !== 0 || Number(order.provider_call_count) !== 0) {
        throw new OrderCompensationError('Provider side effects cannot be excluded', 'COMPENSATION_SIDE_EFFECT_RISK');
      }
      if (Number(order.active_task_count) !== 0 || Number(order.dead_task_count) < 1) {
        throw new OrderCompensationError('Order is not terminally failed', 'COMPENSATION_NOT_ELIGIBLE');
      }

      const code = generateCdks(1)[0];
      const cdkId = crypto.randomUUID();
      const compensationId = crypto.randomUUID();
      const batchNo = `COMP-${order.id}`;
      const requestKey = `compensation-${order.id}`;
      const codeCiphertext = encryptSecret(code, sessionEncryptionKey);
      const batchCiphertext = encryptSecret(JSON.stringify([code]), sessionEncryptionKey);
      await connection.query(
        `INSERT INTO cdk_batches
         (batch_no, request_key, plan_type, requested_count, codes_ciphertext, created_by)
         VALUES (?, ?, ?, 1, ?, 'admin-compensation')`,
        [batchNo, requestKey, order.plan_type, batchCiphertext]
      );
      await connection.query(
        `INSERT INTO cdks (id, code_hash, status, batch_no, plan_type)
         VALUES (?, ?, 'AVAILABLE', ?, ?)`,
        [cdkId, hashCdk(code), batchNo, order.plan_type]
      );
      await connection.query(
        `INSERT INTO order_compensations
         (id, original_order_id, replacement_cdk_id, code_ciphertext, reason, issued_by)
         VALUES (?, ?, ?, ?, ?, 'admin')`,
        [compensationId, order.id, cdkId, codeCiphertext, reason]
      );
      const [closed] = await connection.query(
        `UPDATE orders SET status = 'CLOSED', failure_code = 'COMPENSATED',
           failure_reason = ?, version = version + 1, finished_at = CURRENT_TIMESTAMP(3),
           updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ? AND status = 'CREATED'`,
        [reason, order.id]
      );
      if (Number(closed.affectedRows) !== 1) {
        throw new OrderCompensationError('Order changed concurrently', 'COMPENSATION_ORDER_CHANGED');
      }
      await connection.query(
        `INSERT INTO order_events
         (order_id, from_status, to_status, actor_type, actor_id, reason, metadata_json)
         VALUES (?, 'CREATED', 'CLOSED', 'ADMIN', 'admin', ?, ?)`,
        [order.id, 'replacement CDK issued after verified no-side-effect system failure', JSON.stringify({
          compensationId, replacementBatchNo: batchNo
        })]
      );
      await connection.commit();
      return {
        publicNo: order.public_no,
        planType: order.plan_type,
        code,
        issuedAt: new Date().toISOString(),
        replayed: false
      };
    } catch (error) {
      await connection.rollback();
      if (error?.code === 'ER_DUP_ENTRY') {
        const [existing] = await connection.query(
          `SELECT o.public_no, o.plan_type, oc.code_ciphertext, oc.created_at AS compensated_at
           FROM orders o INNER JOIN order_compensations oc ON oc.original_order_id = o.id
           WHERE BINARY o.public_no = ? LIMIT 1`, [publicNo]
        );
        if (existing[0]) return recover(existing[0], sessionEncryptionKey);
        throw new OrderCompensationError('Compensation state requires review', 'COMPENSATION_RETRY_REQUIRED');
      }
      throw error;
    } finally {
      connection.release();
    }
  };
}
