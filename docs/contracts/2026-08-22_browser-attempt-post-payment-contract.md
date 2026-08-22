# Browser attempt 与付款后终态合同（2026-08-22）

状态：实现 v1，仍不接生产、不使用真实 Session/卡片/付款。

## 1. Attempt 创建

- Browser route 仍由现有 `recharge_attempts` 持有唯一资金风险 attempt。
- `executor_kind = BROWSER` 时，`recharge_provider_account_id` 和 `provider_code` 可以为空；这是明确的 Browser route 分支，不是缺失路由。
- 创建前仍必须通过订单状态、准备任务、卡片新鲜度、余额门槛、授权 item、全局 dispatch 开关和资金栅栏。
- Browser attempt 创建不写 `provider_calls.create_direct`；Browser 外部动作由 Browser operation/permit/checkpoint 账记录。
- 非 Browser route 保持现有 Provider account、write_enabled 和 `provider_calls` 行为不变。

## 2. 付款后终态

```text
PAYMENT_SUBMITTING
  -> PAYMENT_CONFIRMED / PLUS_PENDING
  -> PLUS_ACTIVATED / CANCELLATION_PENDING
  -> CANCELLATION_CONFIRMED / RECHARGE_SUCCESS
```

- `PAYMENT_CONFIRMED` 不是交付成功。
- Plus 激活和取消确认分别要求独立 operation、checkpoint、证据哈希和观察记录。
- 任何付款后页面漂移、延迟、未知或观察失败，必须进入人工/对账路径，禁止再次付款。
- 只有 Plus 激活与取消确认都落盘后，attempt 才能清算、run 才能完成、订单才进入 `RECHARGE_SUCCESS`。
- 所有方法按 run/attempt/order 行锁和幂等 operation 运行；重复 operation 返回既有结果，不重复外部动作。

## 3. 数据边界

- `browser_runs.post_payment_state` 记录当前付款后阶段。
- `browser_post_payment_observations` 只保存证据哈希和脱敏摘要，不保存完整 Session、Checkout authority、卡片敏感字段或页面秘密。
- 迁移 `031_browser_post_payment_lifecycle.sql` 为增量、可重放迁移。

## 4. Dispatch queue v1

- `032_browser_dispatch_queue.sql` 建立持久化 Browser dispatch job；`job_key` 和 `recharge_attempt_id` 双重唯一，重复入队只返回既有 job。
- 入队前再次锁定并确认 `BROWSER/PREPARED/ACTIVE/SUBMITTING` 上下文；非 Browser attempt 不得进入队列。
- Worker claim 使用短租约、`FOR UPDATE SKIP LOCKED` 和过期接管；heartbeat 必须证明 worker、lease token 和租约仍有效。
- queue 不保存 Session、卡号、CVV、Checkout authority、完整页面 URL 或任何可直接付款的敏感 payload；Worker 后续必须通过受控 repository/短期 vault 读取。
- 当前只完成 durable queue/lease contract；真实 BrowserContext 和付款动作仍未接入。

## 5. Isolated Worker control shell

- Worker 领取 job 后，先用受控 resolver 获取 `executorProfileId` 和 `accountKeyHmac`，再调用 `beginRun`；队列本身不暴露身份或 Session 原文。
- 每个导航、点击、表单提交等 runtime action 前必须 heartbeat dispatch lease，并读取 Browser run recovery state。
- heartbeat 失败、run 进入 `RECONCILE_ONLY`/终态或控制权不再属于自动化时，action 在调用 runtime 前失败关闭。
- 当前实现是 Worker control shell 和故障测试，不启动真实浏览器进程、不装载真实 Session、不创建 Checkout。

## 6. Worker iteration

- iteration 只负责 `claim → runClaimedJob → executeJob`；无 job 返回 `IDLE`。
- executeJob 抛错时 control shell 立即停止，job 保留为租约状态等待过期恢复；不得在 loop 层自动重付或换卡。
- 当前 loop 仍是独立服务模块和 mock 测试，尚未接入主 worker 进程入口。
