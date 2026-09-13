import { findCustomerOrder } from '../db/repositories/order-status-query-repository.js';
import { PublicApiError } from '../domain/public-api-error.js';
import { createCdkLookup } from '../security/cdk-code.js';
import { productLabel } from '../domain/product-labels.js';
import { CUSTOMER_STAGES, resolveCustomerStage } from '../domain/customer-stage.js';
import { findStageEvidence } from '../db/repositories/customer-stage-repository.js';
import { cdkReturnWouldBeBlocked } from '../db/repositories/cdk-verify-repository.js';

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
  // 付款已提交、结果正在确认——这是**每一单必经的一步**，不是故障：2026-09-13 两次
  // 全自动成功单各在此停 8~9 秒（PAYMENT_SUBMIT → PAYMENT_UNKNOWN → PAYMENT_CONFIRMED）。
  // 它此前和 RECONCILIATION_REQUIRED 一起映射成 REVIEWING，后果是客户在钱已经付掉、
  // Plus 已经开通的那几秒看到橙色的「遇到点问题，我们已经收到通知在处理」，而且前端把
  // 轮询从 4 秒降到 30 秒，于是成功要等下一轮才显示。真正需要人工对账的情况有自己的
  // 状态（RECONCILIATION_REQUIRED），不需要借这个状态表达。
  SUBMIT_UNKNOWN: 'VERIFYING',
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
  repository = { findCustomerOrder, findStageEvidence, cdkReturnWouldBeBlocked }
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

    // The nine stages: what the executor is actually doing inside the five
    // minutes the order status calls RECHARGE_PROCESSING. Evidence failing to
    // load must never take the status response down with it — the customer
    // still gets their order, just without the finer-grained stage.
    let stage = null;
    try {
      const evidence = [
        ...(Array.isArray(order.events) ? order.events : [])
          .map((event) => ({ kind: 'order', token: event.to_status, at: event.created_at })),
        ...await repository.findStageEvidence(pool, order.internal_order_id)
      ];
      const resolved = resolveCustomerStage({ orderStatus: order.effective_status, evidence });
      const floor = resolved.stage.index === 1 ? 0 : CUSTOMER_STAGES[resolved.stage.index - 2].ceiling;
      stage = {
        index: resolved.stage.index,
        code: resolved.stage.code,
        label: resolved.stage.label,
        total: CUSTOMER_STAGES.length,
        floor,
        ceiling: resolved.stage.ceiling,
        since: isoDate(resolved.since)
      };
    } catch (error) {
      console.error('customer stage resolution failed', {
        publicNo: order.public_no, name: error?.name, code: error?.code
      });
    }

    const response = {
      publicNo: order.public_no,
      status: mapCustomerOrderStatus(order.effective_status),
      updatedAt: isoDate(order.updated_at),
      ...(stage ? { stage } : {}),
      ...(order.plan_type ? { product: {
        planType: String(order.plan_type),
        label: order.product_name || productLabel(order.plan_type)
      } } : {}),
      ...(Array.isArray(order.events) ? { timeline: customerTimeline(order.events) } : {}),
      ...(action ? {
        actionRequired: action,
        sessionReplacement: {
          used: Number(order.session_replacement_count || 0),
          remaining: null,
          expiresAt: null
        }
      } : {})
    };
    // 等待中也给出账号：客户在进度屏要能确认这一单是给哪个号充的（设计稿
    // 的明细是「订单 / 账号 / 方案」三行）。查询本来就需要查询码或卡密，
    // 多这一个字段不增加暴露面——它正是客户自己刚提交的那个邮箱。
    if (order.customer_email) response.customerEmail = order.customer_email;
    if (response.status === 'SUCCESS') {
      response.customerEmail = order.customer_email || null;
      response.finishedAt = isoDate(order.finished_at || order.updated_at);
    }
    // 失败单：客户能不能拿同一张卡密再来一次。问的是 `cdkReturnWouldBeBlocked`——
    // 和客户在第一步校验卡密时问的是同一个函数，所以失败页说的和校验接口稍后
    // 给的答案不会前后矛盾。没动过钱就能重来（卡密已退回，或 intake 会当场退）；
    // 点过付款、结果不明的，卡密留在原单上等人工核对，不能让客户再兑一次。
    // 查不出来时按不能重来处理：宁可让客户找客服，也不能许诺一个兑不掉的重来。
    if (response.status === 'FAILED') {
      try {
        response.canRetry = !(await repository.cdkReturnWouldBeBlocked(pool, order.internal_order_id));
      } catch (error) {
        console.error('cdk retry eligibility lookup failed', {
          publicNo: order.public_no, name: error?.name, code: error?.code
        });
        response.canRetry = false;
      }
    }
    return response;
  };
}
