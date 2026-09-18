# 契约表一 · 交付判据（2026-09-18，面三② / D-248，第④步落地）

> 状态：代码已落地（提交见 `docs/V2.0_EXECUTION.md` §6 第④步）；生产验证以该节登记为准。
> 这张表回答「一张订单什么时候算 `RECHARGE_SUCCESS`」，两条路线断言同一条件。改判据先改这里，再改实现与测试。

## 1. 判据（两路线同条件）

| 条件 | API（ZZSHU） | Browser | 代码 |
|---|---|---|---|
| ① 付款完成 + 目标套餐确认 | ZZSHU `queryStatus` 返回 `status=success` | 点击后读页面 + `confirmPlus`（`/backend-api/accounts/check` 含目标 plan） | `workflow-handlers.pollRecharge` → `commitRechargeSuccess`；`browser-execution-repository.recordPlusActivation` |
| ② 取消续费确认 | `is_subscription_cancelled=1` | `confirmCancellation`（`/subscriptions/cancel` 后 `willRenew=false`） | `commitCancellationStatus` / `recordCancellationConfirmed` |
| ③ 卡台侧扣款证据（Browser 侧收口用） | 不要求（ZZSHU 一次做完） | `transactionReader.reconcile` 唯一匹配（hnskj：卡台流水；highvcc：`card_transactions` 账本，见表二） | `live-post-payment-recovery.js` |
| → `RECHARGE_SUCCESS` | ① 且（② 或 ②超时） | ① 且 ② 且 ③（或人工 RESOLVE CHARGED） | 同上 |

**② 超时的处理（D-248，本块改）**：取消续费轮询用尽（API `RECHECK_CANCELLATION` 60 次 × 60s）或人工核实付款但未勾续费（Browser `RESOLVE_UNKNOWN_PAYMENT CHARGED`）→ **订单照常 `RECHARGE_SUCCESS`**，只留事实标记 `orders.cancellation_review_required=1`（`subscription_cancelled=0`），推一条 `ORDER_CANCELLATION_UNCONFIRMED`（warning，响手机），**这张卡自动进待销清单**（`card-retirement-service` 的 `CANCELLATION_UNCONFIRMED` 口径）。`CANCELLATION_REVIEW_REQUIRED` 这个订单状态从此**不再由任何自动路径产生**（枚举保留给历史单与后台读）。

## 2. 落表（不变）

- 两路线共用：`orders`（状态机）、`recharge_attempts`（资金栅栏 `funds_risk_state`）、`card_consumption_ledger`（容量账本）、`card_assignment_history`。
- API：`provider_calls`；Browser：`browser_runs` / `browser_operations`（PAYMENT_SUBMIT → PAYMENT_CONFIRMED → PLUS_ACTIVATED → CANCELLATION_CONFIRMED）。

## 3. 测试锁住的断言

- `test/workflow-repository-step4.test.js`：`commitCancellationStatus(exhausted)` → `RECHARGE_SUCCESS` + `cancellation_review_required=1` + `ORDER_CANCELLATION_UNCONFIRMED`；未用尽 → `CANCELLATION_PENDING`。
- `test/browser-resolve-unknown-payment-mysql-integration.test.js`：`CHARGED` 未勾续费 → `RECHARGE_SUCCESS` + 标记 + 提醒（真实 MySQL）。
- `test/workflow-handlers.test.js`：`RECHECK_CANCELLATION` 用尽 / 查询异常用尽 → `exhausted:true` 传入。
- `grep -rn "CANCELLATION_REVIEW_REQUIRED" v1/src` 只剩：枚举/转移表、后台读投影、`manual-cancellation-service`（历史单收口）——无自动产生点。

## 4. 客户看到什么

`RECHARGE_SUCCESS` → 客户页「已开通」；取消续费未确认不展示给客户（D-240）。运营看：`ORDER_CANCELLATION_UNCONFIRMED` 告警 + 待销清单 `due/notYetDue`。
