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

/*
   ceiling 与 typicalMs 的来历（2026-09-13 改，D-193）——**必须一起读**：
   百分点不是按"九个阶段"平均分的，是按**每个阶段真实占用多少时间**分的。
   原分配（10/22/32/46/60/74/88/97/100）每段 9~14 个点，而真实耗时差 600 倍：
   阶段 5+6 吃掉全程 80% 的时间却只分到 28 个点，阶段 1+2 几乎不花时间却占 22 个点。
   客户看到的就是"开头唰一下冲到二十几，中段磨很久"——Lemon 2026-09-13 的原话是
   "一段快一段慢，我希望尽可能是匀速从零到 100"。

   分母写明：**两单**，2026-09-13 仅有的两次全自动无干预成功单
   （`PJV1-KLZokl…` 总 150.3 秒、`PJV1-L_fKJY…` 总 220.5 秒），三张表对齐取的分段耗时：

     阶段      单1       单2       平均      新跨度   速度(%/秒)
     1         0.65s     0.16s     0.4s      2        —（太短，看不到）
     2         0s        0s        0s        4        等卡的让步，见下
     3         3.75s     1.34s     2.5s      3        —
     4         24.8s     24.1s     24.5s     11       0.45
     5         75.4s     89.6s     82.5s     42       0.51
     6         36.7s     96.5s     66.6s     32       0.48
     7         8.9s      8.8s      8.85s     4        0.45
     8         0s        0s        0s        1        —（同事务提交，零停留）

   阶段 4~7 占全程 99% 的时间，速度落在 0.45~0.51 %/秒——这就是"匀速"。

   **阶段 2 是唯一的例外，是有意的**：成功单里它耗时为 0（有卡就直接过），但没卡时
   订单会停在 WAITING_FOR_CARD 很久。按占比它该拿 0 个点，那样客户等卡时环完全不动。
   给它 4 个点 + 15 秒的 typicalMs，等卡时环还能慢慢爬到 5，配合文案说明在做什么。

   **样本只有两单，阶段 6 的波动已经很大（36.7s vs 96.5s）。** 攒够更多无干预成功单后
   要回来重算——改这里只需改下表，前端从状态接口读 typicalMs，不另存一份。
*/
export const CUSTOMER_STAGES = Object.freeze([
  Object.freeze({ index: 1, code: 'ORDER_RECEIVED', label: '已收到订单', ceiling: 2, typicalMs: 1_000 }),
  Object.freeze({ index: 2, code: 'CARD_PREPARING', label: '正在准备支付卡', ceiling: 6, typicalMs: 15_000 }),
  Object.freeze({ index: 3, code: 'QUEUED_FOR_RUN', label: '正在排队', ceiling: 9, typicalMs: 3_000 }),
  Object.freeze({ index: 4, code: 'ACCOUNT_VERIFYING', label: '正在验证账号', ceiling: 20, typicalMs: 24_500 }),
  Object.freeze({ index: 5, code: 'CHECKOUT_LOADING', label: '正在获取支付信息', ceiling: 62, typicalMs: 82_500 }),
  Object.freeze({ index: 6, code: 'PAYMENT_SUBMITTING', label: '正在提交支付', ceiling: 94, typicalMs: 66_600 }),
  Object.freeze({ index: 7, code: 'PAYMENT_AWAITING', label: '正在等待支付结果', ceiling: 98, typicalMs: 8_850 }),
  Object.freeze({ index: 8, code: 'SUBSCRIPTION_CONFIRMING', label: '正在确认订阅', ceiling: 99, typicalMs: 1_000 }),
  Object.freeze({ index: 9, code: 'SUBSCRIPTION_ACTIVE', label: '订阅成功', ceiling: 100, typicalMs: 1_000 })
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
  'page-reload-after-inject': 4,
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
 * 兜底段长：阶段表里没给 typicalMs 时用它。正常路径不会走到——九个阶段都带了自己的
 * 典型耗时（见 CUSTOMER_STAGES 上方那段来历）。
 */
export const STAGE_SEGMENT_MS = 90_000;

/**
 * 要画的百分比。**段内匀速**，按这一阶段自己的典型耗时走完自己的区间，
 * 而不是所有阶段共用一条指数曲线。
 *
 * 为什么从指数改成线性（2026-09-13，D-193）：原曲线 1-e^(-2.6t) 在段内前 1/4 的时间就
 * 走完近一半区间，越到后面越慢——叠加"百分点按阶段数平均分、而耗时差 600 倍"这个问题，
 * 客户看到的是一段快一段慢。区间改按真实耗时占比分配之后，段内再匀速，整体就匀速。
 *
 * 不变的是安全语义：**永远停在本阶段上限下方一个百分点**，只有真正订阅成功才置 100。
 * 一个阶段拖得比典型耗时久，就贴着上限等着——"字还写着正在提交支付，数字却已经是下一段"
 * 比爬得慢更糟。
 */
export function stagePercent(stage, elapsedMs, { segmentMs } = {}) {
  if (!stage) return 0;
  if (stage.index === CUSTOMER_STAGES.length) return 100;
  const floor = stage.index === 1 ? 0 : CUSTOMER_STAGES[stage.index - 2].ceiling;
  // 半个点会被四舍五入回上限，所以留满一个点：客户读到的数字永远在文字描述的那个阶段内。
  const cap = stage.ceiling - 1;
  const reach = cap - floor;
  const budget = Number(segmentMs) || Number(stage.typicalMs) || STAGE_SEGMENT_MS;
  const t = Math.max(0, Number(elapsedMs) || 0) / budget;
  // 典型耗时之内：匀速走完这一段的 94%。
  if (t <= 1) return floor + reach * 0.94 * t;
  // 超过典型耗时：剩下那 6% 用指数逼近 cap，永远到不了。
  // 为什么不干脆停住：这一单比典型慢是常事（两单样本里阶段 6 就差了 36.7s vs 96.5s），
  // 停住的环和卡死的环长得一模一样。留一条越来越慢的尾巴，既照实说"比预期久了"，
  // 数字又始终在变。
  return floor + reach * (0.94 + 0.06 * (1 - Math.exp(-1.5 * (t - 1))));
}
