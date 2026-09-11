/* =========================================================================
   客户可见的九个阶段。
   
   为什么需要它：订单状态机里 RECHARGE_PROCESSING 一个状态就覆盖了真实一单
   的 4 分 49 秒（2026-09-11 那次成功单 11:10:04 → 11:15:15）。只按订单状态
   画进度，客户会盯着一个不动的条看五分钟。九阶段把那段时间里执行器真正做
   的事拆出来。

   证据来源（2026-09-12 对生产库实查，不是推断）：
   - order_events.to_status          14 个真实值，见下方 ORDER_STATUS_STAGE
   - browser_run_events.action       7 个真实值，见 RUN_EVENT_STAGE
   - browser_operations.operation_type 12 个真实值，见 OPERATION_STAGE

   为什么不用 browser_runs.last_checkpoint_kind：它只保留最后一个检查点。
   那次成功单的 PLUS_ACTIVATED 被随后的 CANCELLATION_CONFIRMED 覆盖掉了，
   只有 browser_operations 留下了完整轨迹。
   ========================================================================= */

export const CUSTOMER_STAGES = Object.freeze([
  Object.freeze({ index: 1, code: 'ORDER_RECEIVED', label: '已收到订单', ceiling: 10 }),
  Object.freeze({ index: 2, code: 'CARD_PREPARING', label: '正在准备支付卡', ceiling: 22 }),
  Object.freeze({ index: 3, code: 'QUEUED_FOR_RUN', label: '正在排队', ceiling: 32 }),
  Object.freeze({ index: 4, code: 'ACCOUNT_VERIFYING', label: '正在验证账号', ceiling: 46 }),
  Object.freeze({ index: 5, code: 'CHECKOUT_LOADING', label: '正在获取支付信息', ceiling: 60 }),
  Object.freeze({ index: 6, code: 'PAYMENT_SUBMITTING', label: '正在提交支付', ceiling: 74 }),
  Object.freeze({ index: 7, code: 'PAYMENT_AWAITING', label: '正在等待支付结果', ceiling: 88 }),
  Object.freeze({ index: 8, code: 'SUBSCRIPTION_CONFIRMING', label: '正在确认订阅', ceiling: 97 }),
  Object.freeze({ index: 9, code: 'SUBSCRIPTION_ACTIVE', label: '订阅成功', ceiling: 100 })
]);

/** Order statuses, as they actually appear in order_events. */
const ORDER_STATUS_STAGE = Object.freeze({
  CREATED: 1,
  WAITING_FOR_CARD: 2,
  CARD_PURCHASING: 2,
  CARD_PROVISIONING: 2,
  CARD_READY: 3,
  RECHARGE_PROCESSING: 3,
  SUBMITTING: 6,
  SUBMIT_UNKNOWN: 7,
  CANCELLATION_PENDING: 8,
  RECHARGE_SUCCESS: 9
  // WAITING_FOR_SESSION / RECHARGE_FAILED / CLOSED / CANCELLATION_REVIEW_REQUIRED
  // are not stages: they are the branches the caller handles separately.
});

/** browser_run_events.action — the executor's own checkpoints. */
const RUN_EVENT_STAGE = Object.freeze({
  'observe-page': 4,
  'session-bootstrap': 4,
  'page-reset': 4,
  'account-readonly-probe': 4,
  'page-signature': 4,
  'session-replaced': 4,
  'card-material-preflight': 5,
  'checkout-navigation': 5
});

/** browser_operations.operation_type — everything from the payment click on. */
const OPERATION_STAGE = Object.freeze({
  BEGIN_RUN: 4,
  PAYMENT_SUBMIT: 6,
  PAYMENT_UNKNOWN: 7,
  PAYMENT_VERIFICATION: 7,
  PAYMENT_VERIFICATION_ESCALATED: 7,
  MANUAL_VERIFICATION_RESOLVED: 7,
  PAYMENT_CONFIRMED: 8,
  MANUAL_PAYMENT_CONFIRMED: 8,
  PLUS_ACTIVATED: 8,
  CANCELLATION_CONFIRMED: 8
  // PRE_PAYMENT_ABORT and MANUAL_CONTROL say the run stopped or a person took
  // over. Neither is forward progress, so neither advances the stage.
});

const EVIDENCE_TABLES = Object.freeze({
  order: ORDER_STATUS_STAGE,
  event: RUN_EVENT_STAGE,
  operation: OPERATION_STAGE
});

/**
 * The stage a customer should see, given everything recorded about the order.
 *
 * Takes the furthest evidence, never the latest. The real timeline goes
 * SUBMIT_UNKNOWN → RECHARGE_PROCESSING → RECHARGE_SUCCESS, so reading only the
 * current status would walk the customer back from stage 7 to stage 3 twenty
 * seconds before delivery. A progress bar that goes backwards reads as a bug.
 *
 * `evidence` is `{ kind, token, at }` rows — kind being which table the row
 * came from, token its status/action/operation value, at its timestamp.
 * Returns the stage plus the moment it was first reached, which is what lets
 * the page creep toward the stage ceiling instead of jumping to it.
 */
export function resolveCustomerStage({ orderStatus = null, evidence = [] } = {}) {
  let index = 0;
  let since = null;
  for (const row of evidence) {
    const table = EVIDENCE_TABLES[row?.kind];
    const candidate = table ? table[String(row.token)] : undefined;
    if (!Number.isInteger(candidate)) continue;
    const at = row.at instanceof Date ? row.at : (row.at ? new Date(row.at) : null);
    const usable = at && Number.isFinite(at.getTime()) ? at : null;
    if (candidate > index) {
      index = candidate;
      since = usable;
    } else if (candidate === index && usable && since && usable < since) {
      // Several rows can carry the same stage; the earliest is when it began.
      since = usable;
    }
  }
  // The current status is authority on delivery, and on an order that has no
  // other evidence yet: it has still been received, which is stage 1.
  const fromStatus = ORDER_STATUS_STAGE[String(orderStatus)];
  if (String(orderStatus) === 'RECHARGE_SUCCESS') {
    if (index !== 9) since = null;
    index = 9;
  } else if (Number.isInteger(fromStatus) && fromStatus > index) {
    index = fromStatus;
    since = null;
  }
  if (index < 1) { index = 1; since = null; }
  return { stage: CUSTOMER_STAGES[index - 1], since };
}

/**
 * How long a stage "should" take, for curve purposes only — it is not a promise
 * and is never shown. Set from the real delivery of 2026-09-11, whose stages
 * ran from 22 seconds (the payment steps) to 2 minutes 36 (the queue): at 90
 * seconds the curve is still visibly moving across that whole range, which is
 * the entire job of the number.
 */
export const STAGE_SEGMENT_MS = 90_000;

/**
 * The percentage to draw. Each stage owns a band and approaches its ceiling
 * without arriving: the longer a stage lasts the slower it creeps. Only a real
 * subscription sets 100 — "the bar finished but the order didn't" is worse
 * than a bar that crawls.
 */
export function stagePercent(stage, elapsedMs, { segmentMs = STAGE_SEGMENT_MS } = {}) {
  if (!stage) return 0;
  if (stage.index === CUSTOMER_STAGES.length) return 100;
  const floor = stage.index === 1 ? 0 : CUSTOMER_STAGES[stage.index - 2].ceiling;
  const span = stage.ceiling - floor;
  const t = Math.max(0, Number(elapsedMs) || 0) / segmentMs;
  const approached = floor + span * (1 - Math.exp(-2.6 * t));
  // The curve never reaches the ceiling in algebra, but it does in doubles:
  // exp(-2.6t) underflows to 0 somewhere past an hour in one stage, and the
  // bar would then sit exactly on the next stage's floor while the wording
  // still shows this stage. Hold it a full point short — half a point rounds
  // back up to the ceiling — so the number the customer reads always stays
  // inside the stage the words describe, however long the stage lasts.
  return Math.min(approached, stage.ceiling - 1);
}
