# 契约表二 · 付款不明的两路证据（2026-09-18，面三③ / D-248，第④步落地）

> 状态：代码已落地；生产上尚无新样本（API 付款不明历史 0 次、Browser 崩溃进补核历史 0 次）。
> 原则（CLAUDE.md 硬约束 + D-248）：付款结果不明 → 锁死资金栅栏，**不重付、不换卡、不换执行器**；
> 系统用两路证据自动定；定不了才叫人，**叫的时候必须带两路证据的结果**。

## 1. 两路证据是什么

| 路 | API（ZZSHU，卡固定 hnskj） | Browser |
|---|---|---|
| 账号状态 | ZZSHU `queryStatus(cardKey)`：success / failed / pending | 页面 `confirmPlus` + `confirmCancellation` |
| 卡台扣款 | 当场同步这张 hnskj 卡（详情 1 + 流水 ≥1 页）→ `card_transactions` 里提交后的 OpenAI 成功扣款（`unknown-submission-evidence.assessCardSideCharge`，hnskj `trade_time_raw` 按 UTC+8 解析） | hnskj 卡：卡台流水唯一匹配；highvcc 卡：`card_transactions` 账本（T1 每小时随快照入库）唯一匹配；窗口内无候选且注入了 `refresh` → 用 token 再拉一次（**时段外的突发例外**），token 失效 → 证据带 `tokenExpired=true`、不谎报匹配 |

## 2. 自动收口矩阵

### API（`workflow-handlers.reconcileUnknownSubmission`，由 `markAttemptUnknown` 排的有界 `POLL_RECHARGE`：30 次 × 60s ≈ 30 分钟窗口）

| 有 cardKey？ | 账号一路 | 卡台一路 | 结论 |
|---|---|---|---|
| 有 | success | — | `commitRechargeSuccess` → 走表一 |
| 有 | failed（二次确认） | — | `commitRechargeFailure`（退码） |
| 有 | pending / processing | — | 再等；窗口用尽 → 交人 `PROVIDER_STILL_PENDING` |
| 有 | 查询异常 | — | 再等；用尽 → 交人 `ACCOUNT_QUERY_FAILED` |
| 无 | 不可查 | 有成功扣款 | **交人** `CARD_CHARGED_ACCOUNT_UNVERIFIABLE`（不能自动判成功） |
| 无 | 不可查 | 无 | 再等；用尽 → 交人 `NO_CARD_CHARGE_IN_WINDOW_ACCOUNT_UNVERIFIABLE`（**不自动释放**，30 分钟无扣款 ≠ 证明没扣） |
| 无 | 不可查 | 卡台不可查 | 用尽 → 交人 `NO_EVIDENCE_AVAILABLE` |

交人 = `workflow.escalateUnknownSubmission`：订单 `SUBMIT_UNKNOWN → RECONCILIATION_REQUIRED`；资金栅栏（attempt `SUBMIT_UNKNOWN/UNKNOWN`、账本 `RECONCILIATION`、卡占用）原样；`order_events` + `operator_alerts`（`ORDER_PAYMENT_UNKNOWN_REVIEW`，critical，message 含两路证据摘要）+ `reconciliation_cases`（`API_PAYMENT_UNKNOWN`，`evidence_json` 含全部证据）。

人工收口入口（本块新）：`POST /api/v1/admin/orders/:publicNo/resolve-unknown-submission`，body `{ outcome: CHARGED|NOT_CHARGED, confirmation: "已核实 <publicNo> <outcome>", note }`：
- `CHARGED` → attempt `SUCCESS/SETTLED`、账本 `CONSUMED`、卡 `DEPLETED`、订单 `RECHARGE_SUCCESS` + `cancellation_review_required=1`（进待销 + 提醒）。
- `NOT_CHARGED` → attempt `CLEARED/CLEARED`、账本 `RELEASED`、分配 `RELEASED`、授权项 `RELEASED`、订单 `RECHARGE_FAILED`（`PAYMENT_NOT_CHARGED_VERIFIED`），**不自动重提**。

### Browser（`browser-payment-verification-service` + `live-post-payment-recovery.js`）

| 情形 | 结论 |
|---|---|
| Plus 确认 + 取消确认 + 卡台唯一匹配 | CONFIRMED → 表一 |
| Plus 未确认 | UNKNOWN，继续查到 deadline |
| Plus 确认但取消未确认 或 卡台无唯一匹配 | UNKNOWN（evidence 带 `cancellationConfirmed` / `transactionMatched` / `transactionCandidateCount` / `transactionEvidence.tokenExpired`），继续查到 deadline |
| deadline 到 | `escalatePaymentVerification` → run `HUMAN_REQUIRED`，`BROWSER_HUMAN_REQUIRED` 告警 **message 含两路证据摘要**，`reconciliation_cases.evidence_json` 含 `evidenceSummary` |

崩溃（进程重启 / 租约丢失）：`browser-recovery-repository.recoverExpiredRun`：
- `PAYMENT_SUBMITTING`（点了付款没等到结果）→ run `RECONCILE_ONLY + PAYMENT_UNKNOWN + VERIFYING_PAYMENT`（deadline = now + 30 分钟）、attempt `SUBMIT_UNKNOWN/UNKNOWN`、账本 `RECONCILIATION`、订单 `SUBMIT_UNKNOWN`、`BROWSER_PAYMENT_UNKNOWN`（静音）→ **重启后自动进补核**。以前只改 `status='RECONCILE_ONLY'`，补核领不到，只能人看。
- `PAYMENT_CONFIRMED` → 保持 `RUNNING`，不发新租约，补核继续。
- 已 `PAYMENT_UNKNOWN` 但核实态丢了 → 补回 `VERIFYING_PAYMENT`。

## 3. 窗口

| 处 | 值 | 来源 |
|---|---|---|
| API 不明轮询 | 30 × 60s | `markAttemptUnknown` 排任务参数 |
| Browser 付款后核实 | `BROWSER_PAYMENT_VERIFICATION_WINDOW_MS`（默认 300000） | `production-live-config.js`（白名单外，**未改**；要放长改环境变量，见 §6） |
| Browser 崩溃恢复补核 | 30 分钟 | `createBrowserRecoveryRepository({ verificationWindowMs })` 默认 |

## 4. 前置与未完成

- highvcc 卡的「卡台扣款」一路要 `transactionReaderFactory` 注入 `ledgerSource`（读 `card_transactions` + 可选 `refresh`）。`browser-card-transaction-reader.js`（白名单内）已支持；**工厂在 `production-live-worker.js`（白名单外，D-254），未改**——未注入时保留旧 marker 行为（恒匹配）。**这一行等 Lemon 批**（见账本 §6 第④步「待 Lemon 定」）。
- Browser 核实窗口放长同样在白名单外的 config 默认值上，可用环境变量 `BROWSER_PAYMENT_VERIFICATION_WINDOW_MS` 放长而不改代码。
- `browser-mvp/src/recovery.js`（本地 dispatch-store 的 `reconcileIncompleteJobs`）实查**无调用者**（死代码），崩溃进补核的真正落点是 v1 `recoverExpiredRun`；未动它。

## 5. 测试

- `test/workflow-handlers-step4.test.js`（API 六种情形，真实流水行形状）、`test/unknown-submission-evidence.test.js`（UTC+8 解析、失败/拒付行不算扣款）、`test/workflow-repository-step4.test.js`（escalate 三处写 + 栅栏不动）、`test/unknown-submission-resolve-service.test.js`（CHARGED / NOT_CHARGED / 拒绝）、`test/recharge-attempt-repository.test.js`（UNKNOWN 排任务）、`test/browser-recovery-repository.test.js`（三种崩溃情形）、browser-mvp `test/browser-card-transaction-reader.test.js`（账本证据 / token 失效 / refresh）、`test/live-post-payment-recovery.test.js`（UNKNOWN 带两路证据）。

## 6. 运维

- 看未收口的 API 不明单：`SELECT public_no, status FROM orders WHERE status IN ('SUBMIT_UNKNOWN','RECONCILIATION_REQUIRED')` + `reconciliation_cases WHERE case_type='API_PAYMENT_UNKNOWN' AND status='OPEN'`。
- 人工收口：后台端点（上文）；第⑥块把它放进「需要我处理」队列前先用 curl/后台脚本。
- 放长 Browser 核实窗口：`run-live-pool.sh` 环境 `BROWSER_PAYMENT_VERIFICATION_WINDOW_MS=1800000`（常驻 worker 重启前问 Lemon）。
