# Browser 与一卡多单/自动补余额兼容性复核（2026-08-31）

## 范围与边界

- 基线：`main@9d3d5f4`，包含已部署的 `068c070`。
- 只做 Browser adapter、权威付款快照和非付款联调测试。
- 未连接生产 Browser Worker，未读取真实 Session/PAN/CVC，未填卡、未点击付款。
- 未调用 Provider 或卡台写接口；所有 MySQL/Chrome 集成均在一次性本地 MySQL 8.4 中执行。

## 发现并修复

发现一个真实 P0 兼容缺口：共享核心已经允许 `orders.assigned_card_id` 指向由历史订单持有的复用卡，但 Browser 的 MySQL projection、共享卡资料读取和正式绑定检查仍假设 `cards.order_id = orders.id`。结果是第二个订单即使已有 `RESERVED` 消费记录，也无法进入 Browser 非付款执行或取得权威付款快照。

修复后：

1. 新订单优先通过 `orders.assigned_card_id` 解析卡片；仅为旧数据保留 `assigned_card_id IS NULL AND cards.order_id = orders.id` 回退。
2. Browser job 以 `assigned_card_id + RESERVED card_consumption_ledger` 作为当前订单绑定证据；`cards.order_id` 只表示卡片原始拥有订单，不再被误当成当前履约绑定。
3. 权威付款快照应用同一规则，并继续校验 attempt/order/card/route/provider、余额、卡状态、资料、卡同步时间与交易同步时间。
4. Session-only 的真实 ChatGPT 只读 harness 仍不解密卡资料；本次改动没有扩大材料暴露面。

## 四项兼容性结论

### 一卡多单容量

已验证：复用卡由新订单 `assigned_card_id` 绑定，消费账本为当前 attempt 保持 `RESERVED`；Browser 非付款链路可 claim、beginRun、启动本地 BrowserContext，并 safe-abort。结束后 attempt/funds/card reservation/job/run 全部安全释放，`PAYMENT_SUBMIT=0`。

### 自动补余额

Browser 不实现也不调用补余额。它只消费共享核心分配后的卡片和权威快照。低余额、卡状态不合格、卡资料缺失、卡同步或交易证据超时均在 permit 前 fail-closed。补余额完成后必须先由共享同步更新余额/交易事实，Browser 才可能通过门禁。

### 全局默认充值方式

Browser 不读取一个可变的“当前默认值”来改线。订单创建时冻结 route；attempt/job/profile 必须持续为 Browser 且相互一致。现有定向回归确认 Browser dispatch gate 关闭或 Browser Worker 心跳过期时，不能把未来订单默认切到 Browser。

### 15 分钟交易证据门槛

权威 payment snapshot 同时检查 `card_last_synced_at` 和 `card_last_transaction_synced_at`，超过 15 分钟分别返回 `CARD_CHECK_STALE` / `CARD_TRANSACTION_CHECK_STALE`。快照签发后任一事实变化，提交意图阶段返回 `PAYMENT_SNAPSHOT_CHANGED`，不会继续付款。

## 实际验证

```bash
npm --prefix browser-mvp run check
npm --prefix browser-mvp test
node --test v1/test/browser-execution-repository.test.js \
  v1/test/recharge-attempt-repository.test.js \
  v1/test/card-inventory-eligibility.test.js \
  v1/test/card-funding-repository.test.js \
  v1/test/card-funding-executor.test.js \
  v1/test/provider-route-admin-service.test.js \
  v1/test/card-sync-policy.test.js
```

- Browser：109 total / 105 passed / 0 failed / 4 environment-skipped。
- 共享相关定向：55/55 passed。
- 一次性 MySQL 8.4、migration 001–043：
  - Browser execution repository（复用卡 owner 与当前订单不同）：2/2 passed。
  - 复用卡 dispatch→run→本地 Chrome fixture→safe-abort：1/1 passed。
- 故障覆盖沿用并重跑 Browser 全量：租约丢失、动作中断、运行时崩溃、重复投递、页面漂移、提交后 UNKNOWN 均通过；不会自动换卡或重付。

## 未验证边界

- 没有在生产数据库创建新订单、job 或 run。
- 没有启动生产 Browser Worker，也没有执行生产 route 切换。
- 自动补余额的真实卡台 SETTLED/PENDING/UNKNOWN 行为属于共享上游，本轮只验证 Browser 不绕过其余额和证据门禁。
- 没有真实付款；LIVE adapter 的外部结果、3DS、Plus 激活、取消续费及卡台交易对账仍未形成生产证据。

## 建议

合入后先做一次生产只读 schema/配置检查；首个 Browser 灰度仍按单独窗口执行。灰度前必须重新核对该订单的 `assigned_card_id`、`RESERVED` 消费记录、15 分钟内余额及交易证据，且付款开关继续默认关闭。
