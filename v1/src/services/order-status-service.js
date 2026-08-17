import crypto from 'node:crypto';
import { findCustomerOrder } from '../db/repositories/order-status-query-repository.js';
import { PublicApiError } from '../domain/public-api-error.js';

const PUBLIC_NO_PATTERN = /^PJV1-[A-Za-z0-9_-]{20}$/;

const CUSTOMER_STATUS = Object.freeze({
  CREATED: 'QUEUED',
  CARD_PURCHASING: 'PROCESSING',
  CARD_READY: 'PROCESSING',
  SUBMITTING: 'PROCESSING',
  RECHARGE_PROCESSING: 'PROCESSING',
  SUBMIT_UNKNOWN: 'REVIEWING',
  RECONCILIATION_REQUIRED: 'REVIEWING',
  RECHARGE_SUCCESS: 'SUCCESS',
  RECHARGE_FAILED: 'FAILED'
});

function invalidQuery() {
  throw new PublicApiError('Order query must contain exactly one lookup credential', {
    code: 'INVALID_ORDER_QUERY',
    status: 400
  });
}

function normalizeLookup(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalidQuery();
  const hasPublicNo = typeof input.publicNo === 'string' && input.publicNo.trim() !== '';
  const hasCdk = typeof input.cdk === 'string' && input.cdk.trim() !== '';
  if (hasPublicNo === hasCdk) invalidQuery();
  if (hasPublicNo) {
    const publicNo = input.publicNo.trim();
    if (!PUBLIC_NO_PATTERN.test(publicNo)) invalidQuery();
    return { publicNo };
  }
  const cdk = input.cdk.trim();
  if (cdk.length < 8 || cdk.length > 256) invalidQuery();
  return {
    cdkHash: crypto.createHash('sha256').update(cdk, 'utf8').digest('hex')
  };
}

function isoDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

export function mapCustomerOrderStatus(internalStatus) {
  return CUSTOMER_STATUS[internalStatus] || 'REVIEWING';
}

export function createOrderStatusService({
  pool,
  repository = { findCustomerOrder }
}) {
  return async function getCustomerOrderStatus(input) {
    const lookup = normalizeLookup(input);
    const order = await repository.findCustomerOrder(pool, lookup);
    if (!order) {
      throw new PublicApiError('Order was not found', {
        code: 'ORDER_NOT_FOUND',
        status: 404
      });
    }
    return {
      publicNo: order.public_no,
      status: mapCustomerOrderStatus(order.effective_status),
      updatedAt: isoDate(order.updated_at)
    };
  };
}
