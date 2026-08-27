import crypto from 'node:crypto';

export class TraceabilityOperationError extends Error {
  constructor(message, code, status = 400) {
    super(message);
    this.name = 'TraceabilityOperationError';
    this.code = code;
    this.status = status;
  }
}

function normalizePublicNo(value) {
  const publicNo = String(value || '').trim();
  if (publicNo.length < 8 || publicNo.length > 64) {
    throw new TraceabilityOperationError('Order not found', 'ADMIN_ORDER_NOT_FOUND', 404);
  }
  return publicNo;
}

function normalizeText(value, { field, max }) {
  const text = String(value || '').trim();
  if (!text || text.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text)) {
    throw new TraceabilityOperationError(`${field} is invalid`, `INVALID_${field.toUpperCase()}`);
  }
  return text;
}

export function createTraceabilityOperationsService({ pool, paymentReferenceHmacKey = null } = {}) {
  if (!pool) throw new TypeError('pool is required');

  async function addOrderNote(publicNoInput, input = {}) {
    const publicNo = normalizePublicNo(publicNoInput);
    const note = normalizeText(input.note, { field: 'note', max: 2000 });
    const [result] = await pool.query(
      `INSERT INTO order_notes (id, order_id, note_text, created_by)
       SELECT UUID(), o.id, ?, 'admin' FROM orders o
       WHERE BINARY o.public_no = ?`,
      [note, publicNo]
    );
    if (Number(result.affectedRows) !== 1) {
      throw new TraceabilityOperationError('Order not found', 'ADMIN_ORDER_NOT_FOUND', 404);
    }
    return { publicNo, note, recorded: true };
  }

  async function addOrderTag(publicNoInput, input = {}) {
    const publicNo = normalizePublicNo(publicNoInput);
    const tag = normalizeText(input.tag, { field: 'tag', max: 64 });
    try {
      const [result] = await pool.query(
        `INSERT INTO order_tags (order_id, tag, created_by)
         SELECT o.id, ?, 'admin' FROM orders o
         WHERE BINARY o.public_no = ?`,
        [tag, publicNo]
      );
      if (Number(result.affectedRows) !== 1) {
        throw new TraceabilityOperationError('Order not found', 'ADMIN_ORDER_NOT_FOUND', 404);
      }
      return { publicNo, tag, recorded: true, replayed: false };
    } catch (error) {
      if (error?.code === 'ER_DUP_ENTRY') {
        return { publicNo, tag, recorded: true, replayed: true };
      }
      throw error;
    }
  }

  async function completeCustomerPayment(publicNoInput, input = {}) {
    const publicNo = normalizePublicNo(publicNoInput);
    const amount = String(input.amount || '').trim();
    if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(amount) || Number(amount) <= 0) {
      throw new TraceabilityOperationError('amount is invalid', 'INVALID_PAYMENT_AMOUNT');
    }
    const currency = String(input.currency || '').trim().toUpperCase();
    if (!/^[A-Z]{3,8}$/.test(currency)) {
      throw new TraceabilityOperationError('currency is invalid', 'INVALID_PAYMENT_CURRENCY');
    }
    const channel = normalizeText(input.channel, { field: 'payment_channel', max: 32 }).toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(channel)) {
      throw new TraceabilityOperationError('payment channel is invalid', 'INVALID_PAYMENT_CHANNEL');
    }
    const paidAt = new Date(input.paidAt);
    if (Number.isNaN(paidAt.getTime()) || paidAt.getTime() > Date.now() + 5 * 60_000) {
      throw new TraceabilityOperationError('paidAt is invalid', 'INVALID_PAYMENT_TIME');
    }
    const externalReference = String(input.externalReference || '').trim();
    if (externalReference.length > 191) {
      throw new TraceabilityOperationError('external reference is invalid', 'INVALID_PAYMENT_REFERENCE');
    }
    if (externalReference && (!Buffer.isBuffer(paymentReferenceHmacKey)
      || paymentReferenceHmacKey.length !== 32)) {
      throw new TraceabilityOperationError(
        'payment reference hashing is not configured', 'PAYMENT_REFERENCE_HASH_UNAVAILABLE', 503
      );
    }
    const referenceHmac = externalReference
      ? crypto.createHmac('sha256', paymentReferenceHmacKey).update(externalReference).digest('hex') : null;
    const referenceMasked = externalReference
      ? `${'*'.repeat(Math.max(3, Math.min(12, externalReference.length - 4)))}${externalReference.slice(-4)}` : null;
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [rows] = await connection.query(
        `SELECT o.id AS order_id, o.cdk_id, p.id AS payment_id, p.order_id AS payment_order_id,
                p.amount, p.currency,
                p.payment_channel, p.paid_at, p.external_reference_hmac
         FROM orders o INNER JOIN customer_payments p ON p.cdk_id = o.cdk_id OR EXISTS (
           SELECT 1 FROM order_compensations oc
           INNER JOIN orders original ON original.id = oc.original_order_id
           WHERE oc.replacement_cdk_id = o.cdk_id
             AND (p.order_id = original.id OR p.cdk_id = original.cdk_id)
         )
         WHERE BINARY o.public_no = ? ORDER BY p.created_at LIMIT 1 FOR UPDATE`,
        [publicNo]
      );
      const row = rows[0];
      if (!row) throw new TraceabilityOperationError('Order payment not found', 'ADMIN_PAYMENT_NOT_FOUND', 404);
      if (row.amount != null || row.paid_at != null) {
        const replayed = String(row.amount) === Number(amount).toFixed(6)
          && row.currency === currency && row.payment_channel === channel
          && new Date(row.paid_at).getTime() === paidAt.getTime()
          && (row.external_reference_hmac || null) === referenceHmac;
        if (!replayed) {
          throw new TraceabilityOperationError('Payment details are already fixed', 'PAYMENT_DETAILS_ALREADY_RECORDED', 409);
        }
        await connection.commit();
        return { publicNo, recorded: true, replayed: true };
      }
      await connection.query(
        `UPDATE customer_payments SET order_id = ?, payment_channel = ?, amount = ?,
           currency = ?, paid_at = ?, external_reference_hmac = ?,
           external_reference_masked = ?, updated_at = CURRENT_TIMESTAMP(3)
         WHERE id = ?`,
        [row.payment_order_id || row.order_id, channel, amount, currency, paidAt,
          referenceHmac, referenceMasked, row.payment_id]
      );
      await connection.query(
        `INSERT INTO order_notes (id, order_id, note_text, created_by)
         VALUES (UUID(), ?, ?, 'admin')`,
        [row.order_id, `客户付款详情已补录：${amount} ${currency} / ${channel} / ${paidAt.toISOString()}`]
      );
      await connection.commit();
      return { publicNo, recorded: true, replayed: false };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return { addOrderNote, addOrderTag, completeCustomerPayment };
}
