import { findCustomerOrder } from '../db/repositories/order-status-query-repository.js';
import { PublicApiError } from '../domain/public-api-error.js';
import { createCdkLookup } from '../security/cdk-code.js';

const PUBLIC_NO_PATTERN = /^PJV1-[A-Za-z0-9_-]{20}$/;

const CUSTOMER_STATUS = Object.freeze({
  CREATED: 'QUEUED',
  CARD_PURCHASING: 'PROCESSING',
  CARD_PROVISIONING: 'PROCESSING',
  CARD_READY: 'PROCESSING',
  WAITING_FOR_CARD: 'PROCESSING',
  CARD_FAILED: 'FAILED',
  WAITING_FOR_SESSION: 'ACTION_REQUIRED',
  SUBMITTING: 'PROCESSING',
  RECHARGE_PROCESSING: 'PROCESSING',
  SUBMIT_UNKNOWN: 'REVIEWING',
  RECONCILIATION_REQUIRED: 'REVIEWING',
  RECHARGE_SUCCESS: 'SUCCESS',
  RECHARGE_FAILED: 'FAILED',
  CANCELLATION_PENDING: 'FINALIZING',
  CANCELLATION_REVIEW_REQUIRED: 'REVIEWING'
});

const CUSTOMER_ACTIONS = Object.freeze({
  ACCOUNT_ALREADY_PLUS: {
    code: 'ACCOUNT_ALREADY_PLUS',
    message: '当前账号已是 Plus，请更换一个免费账号的 Session。'
  },
  SESSION_INVALID: {
    code: 'SESSION_INVALID',
    message: '当前 Session 无效，请重新获取完整 Session。'
  }
});

function invalidQuery() {
  throw new PublicApiError('Order query must contain exactly one lookup credential', {
    code: 'INVALID_ORDER_QUERY',
    status: 400
  });
}

function normalizeLookup(input, cdkHashKey) {
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
    cdkLookup: createCdkLookup(cdk, cdkHashKey)
  };
}

function isoDate(value) {
  if (value == null || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

export function mapCustomerOrderStatus(internalStatus) {
  return CUSTOMER_STATUS[internalStatus] || 'REVIEWING';
}

export function createOrderStatusService({
  pool,
  cdkHashKey,
  repository = { findCustomerOrder }
}) {
  return async function getCustomerOrderStatus(input) {
    const lookup = normalizeLookup(input, cdkHashKey);
    const order = await repository.findCustomerOrder(pool, lookup);
    if (!order) {
      throw new PublicApiError('Order was not found', {
        code: 'ORDER_NOT_FOUND',
        status: 404
      });
    }
    const action = CUSTOMER_ACTIONS[order.customer_action_code] || null;
    return {
      publicNo: order.public_no,
      status: mapCustomerOrderStatus(order.effective_status),
      updatedAt: isoDate(order.updated_at),
      ...(action ? {
        actionRequired: action,
        sessionReplacement: {
          used: Number(order.session_replacement_count || 0),
          remaining: Math.max(0, 3 - Number(order.session_replacement_count || 0)),
          expiresAt: isoDate(order.session_repair_expires_at)
        }
      } : {})
    };
  };
}
