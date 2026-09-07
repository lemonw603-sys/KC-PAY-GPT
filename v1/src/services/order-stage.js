// Projects orders / recharge_attempts / browser_runs state onto the customer-line
// stages of CORE_SPEC §1. No new state machine: every stage is derived read-only
// from persisted rows, and the "what do I need to do" line comes from the same
// inputs so the list, the drawer and (later) the customer page agree.

export const STAGE_META = Object.freeze({
  RECEIVED: ['已收到', 'blue'],
  SESSION_INVALID: ['等客户重贴 Session', 'orange'],
  QUEUED: ['排队中', 'blue'],
  LOGIN: ['登录核对中', 'blue'],
  CHECKOUT: ['填写结账中', 'blue'],
  PAYING: ['付款中', 'blue'],
  VERIFYING: ['核实开通中', 'blue'],
  UPGRADING: ['升级 Pro 中', 'blue'],
  DONE: ['已完成', 'green'],
  CLOSED_NO_PAYMENT: ['付款前关闭', 'gray'],
  PAYMENT_UNKNOWN: ['付款结果不明', 'orange'],
  FAILED_AFTER_PAYMENT: ['已付款未交付', 'red']
});

const CUSTOMER_ACTION_TEXT = Object.freeze({
  ACCOUNT_ALREADY_PLUS: '账号已是 Plus：等客户换一个免费账号的 Session',
  SESSION_INVALID: 'Session 无效：等客户重新提供完整 Session'
});

const CONTROL_TEXT = Object.freeze({
  REQUESTED: '已请求人工接管', FROZEN: '自动化已冻结，等人工', TRANSFERRED: '已转交人工'
});

const CHECKOUT_CHECKPOINTS = /checkout|card|quote|address|payment|billing/i;
const ACTIVE_RUN_STATUSES = new Set(['READY', 'RUNNING', 'HUMAN_REQUIRED']);
const PAID_FUNDS_STATES = new Set(['SETTLED']);

function minutesSince(value, now) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, Math.floor((now - timestamp) / 60_000));
}

function stageOf(stage, action = '') {
  const [label, tone] = STAGE_META[stage];
  return { stage, label, tone, action };
}

function runStage(run) {
  if (['PAYMENT_ARMED', 'PAYMENT_SUBMITTING'].includes(run.paymentState)) return 'PAYING';
  if (CHECKOUT_CHECKPOINTS.test(String(run.lastCheckpointKind || ''))) return 'CHECKOUT';
  return 'LOGIN';
}

function runAction(run) {
  if (!run) return '';
  if (CONTROL_TEXT[run.controlState]) return `人工接管中：${CONTROL_TEXT[run.controlState]}`;
  if (run.status === 'HUMAN_REQUIRED') return '自动化等待人工：在抽屉里接管或收口';
  if (run.status === 'FAILED_SAFE') {
    return `自动化安全停止${run.lastErrorCode ? `（${run.lastErrorCode}）` : ''}：等系统重试或人工处理`;
  }
  return '';
}

/**
 * @param {object} input
 * @param {string} input.status order status
 * @param {string|null} [input.failureCode]
 * @param {string|null} [input.customerActionCode]
 * @param {string|null} [input.planType]
 * @param {boolean} [input.cancellationReviewRequired]
 * @param {boolean} [input.requiresRechargeConfirmation] CARD_READY with prepare done and submit untouched
 * @param {string|null} [input.confirmationReadyAt]
 * @param {boolean} [input.reconciliationIssue]
 * @param {{status?: string, fundsRiskState?: string, executorKind?: string}|null} [input.attempt] latest attempt
 * @param {{status?: string, paymentState?: string, postPaymentState?: string, controlState?: string,
 *          lastCheckpointKind?: string, lastErrorCode?: string}|null} [input.run] latest browser run
 * @param {number} [input.now]
 */
export function deriveOrderStage(input) {
  const status = String(input.status || '');
  const attempt = input.attempt || null;
  const run = input.run || null;
  const now = Number.isFinite(input.now) ? input.now : Date.now();
  const paidEvidence = PAID_FUNDS_STATES.has(attempt?.fundsRiskState) || run?.paymentState === 'PAYMENT_CONFIRMED';
  const unknownEvidence = attempt?.fundsRiskState === 'UNKNOWN' || run?.paymentState === 'PAYMENT_UNKNOWN';
  const proPlan = /^(pro|5x|20x)/i.test(String(input.planType || ''));
  let result;

  if (status === 'RECHARGE_SUCCESS') {
    result = stageOf('DONE', input.cancellationReviewRequired ? '取消续费失败：人工在账号里取消自动续费' : '');
  } else if (status === 'CANCELLATION_PENDING') {
    result = stageOf('VERIFYING');
  } else if (status === 'CANCELLATION_REVIEW_REQUIRED') {
    result = stageOf('VERIFYING', '取消续费失败：人工在账号里取消自动续费');
  } else if (status === 'SUBMIT_UNKNOWN' || status === 'RECONCILIATION_REQUIRED' || (unknownEvidence && !['CLOSED'].includes(status))) {
    result = stageOf('PAYMENT_UNKNOWN', '先对账：核对卡交易与账号套餐后人工收口；禁止重付');
  } else if (status === 'RECHARGE_FAILED') {
    result = paidEvidence
      ? stageOf('FAILED_AFTER_PAYMENT', '已扣款但未交付：人工核实账号套餐并处理')
      : stageOf('CLOSED_NO_PAYMENT');
  } else if (status === 'CLOSED') {
    result = stageOf('CLOSED_NO_PAYMENT');
  } else if (status === 'CARD_FAILED') {
    result = stageOf('QUEUED', '开卡失败：补卡后重试，或取消订单');
  } else if (status === 'WAITING_FOR_SESSION') {
    result = stageOf('SESSION_INVALID', CUSTOMER_ACTION_TEXT[input.customerActionCode] || '等客户重新提供 Session');
  } else if (status === 'CREATED') {
    result = stageOf('RECEIVED');
  } else if (['WAITING_FOR_CARD', 'CARD_PURCHASING', 'CARD_PROVISIONING'].includes(status)) {
    result = stageOf('QUEUED', status === 'WAITING_FOR_CARD' ? '没有合格卡：补卡后自动继续' : '');
  } else if (status === 'CARD_READY') {
    if (run && ACTIVE_RUN_STATUSES.has(run.status)) {
      result = stageOf(runStage(run), runAction(run));
    } else {
      const waited = minutesSince(input.confirmationReadyAt, now);
      const stalled = input.requiresRechargeConfirmation && waited != null && waited >= 30;
      result = stageOf('QUEUED', run?.status === 'FAILED_SAFE'
        ? runAction(run)
        : stalled ? `等待自动执行已 ${waited >= 60 ? `${Math.floor(waited / 60)} 小时` : `${waited} 分钟`}：检查自动充值、浏览器付款开关与 Worker` : '');
    }
  } else if (status === 'SUBMITTING') {
    result = stageOf('PAYING', runAction(run));
  } else if (status === 'RECHARGE_PROCESSING') {
    if (run?.paymentState === 'PAYMENT_CONFIRMED') {
      const upgrading = proPlan && run.status === 'HUMAN_REQUIRED' && run.postPaymentState === 'PLUS_CONFIRMED';
      result = upgrading
        ? stageOf('UPGRADING', '人工完成 Pro 升级后点「确认 20X 已升级」')
        : stageOf('VERIFYING', runAction(run));
    } else {
      result = stageOf('PAYING', runAction(run));
    }
  } else {
    result = stageOf('RECEIVED');
  }

  if (input.reconciliationIssue && !['CLOSED_NO_PAYMENT'].includes(result.stage)) {
    result.action = result.action ? `${result.action}；资金证据不一致，需核对` : '资金证据不一致，需核对';
  }
  return result;
}
