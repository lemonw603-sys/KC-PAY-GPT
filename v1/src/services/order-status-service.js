import { findCustomerOrder } from '../db/repositories/order-status-query-repository.js';
import { PublicApiError } from '../domain/public-api-error.js';
import { createCdkLookup } from '../security/cdk-code.js';

const PUBLIC_NO_PATTERN = /^PJV1-[A-Za-z0-9_-]{20}$/;

// 客户可见的处理阶段：把内部 16 态映射成客户看得懂的 6 步进展链
// （QUEUED→PREPARING→PAYING→ACTIVATING→CONFIRMING→SUCCESS）；
// 「等卡」与「卡就绪」合并为 PREPARING（准备中）；异常分支（等换号/复核/失败）单列。
const CUSTOMER_STATUS = Object.freeze({
  CREATED: 'QUEUED',
  WAITING_FOR_CARD: 'PREPARING',
  CARD_PURCHASING: 'PREPARING',
  CARD_PROVISIONING: 'PREPARING',
  CARD_READY: 'PREPARING',
  SUBMITTING: 'PAYING',
  RECHARGE_PROCESSING: 'ACTIVATING',
  CANCELLATION_PENDING: 'CONFIRMING',
  RECHARGE_SUCCESS: 'SUCCESS',
  WAITING_FOR_SESSION: 'ACTION_REQUIRED',
  SUBMIT_UNKNOWN: 'REVIEWING',
  RECONCILIATION_REQUIRED: 'REVIEWING',
  CANCELLATION_REVIEW_REQUIRED: 'REVIEWING',
  CARD_FAILED: 'FAILED',
  RECHARGE_FAILED: 'FAILED'
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

function customerTimeline(events = []) {
  return events.map((event) => ({
    status: mapCustomerOrderStatus(event.to_status),
    updatedAt: isoDate(event.created_at)
  })).filter((event, index, list) => index === 0 || event.status !== list[index - 1].status);
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
    const response = {
      publicNo: order.public_no,
      status: mapCustomerOrderStatus(order.effective_status),
      updatedAt: isoDate(order.updated_at),
      ...(Array.isArray(order.events) ? { timeline: customerTimeline(order.events) } : {}),
      ...(action ? {
        actionRequired: action,
        sessionReplacement: {
          used: Number(order.session_replacement_count || 0),
          remaining: Math.max(0, 3 - Number(order.session_replacement_count || 0)),
          expiresAt: isoDate(order.session_repair_expires_at)
        }
      } : {})
    };
    if (response.status === 'SUCCESS') {
      response.customerEmail = order.customer_email || null;
      response.finishedAt = isoDate(order.finished_at || order.updated_at);
    }
    return response;
  };
}
