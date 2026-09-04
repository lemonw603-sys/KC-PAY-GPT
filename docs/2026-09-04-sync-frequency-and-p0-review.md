# 同步频率与 P0 对抗式复查｜2026-09-04

## 现场核对范围

本轮直接核对当前 `main` 代码与部署 unit（未执行 Provider 写入、开卡、补余额或付款）：

- `pojia-card-read-sync.timer`：`OnUnitActiveSec=15s`；runner 每轮只领取 1 个任务。
- `pojia-card-funding.timer`：`5s`，只领取本地待执行补余额任务。
- `pojia-card-funding-reconcile.timer`：`15s`，只检查待确认补余额结果。
- `pojia-card-stock-runner.timer`：`60s`，库存/开卡兜底调度。
- `pojia-card-catalog-sync.timer`：`5min`；`pojia-card-audit.timer`：`30min`（带随机延迟）。
- `card-sync-job-service.js`：同步任务按 `sync_tier` 排序，`FOR UPDATE SKIP LOCKED`；但 claim SQL 使用 `LIMIT 1`，单个 runner 每次仅处理一个任务。

## 结论一：不是“所有机制都过于频繁”，但同步执行器存在结构性滞后风险

5/15/60 秒定时器本身不是每次都调用 Provider：无任务时只做本地查询；补余额 reconcile 也只在存在待确认 attempt 时访问 Provider。真正的问题是多个来源共用同一同步队列，而正常任务、订单紧急任务、补给后的验证任务和历史失败任务没有足够的优先级/隔离与吞吐保护。当前单 worker 每轮一个 job，在历史 `REVIEW_REQUIRED/SCHEMA` 或失败重试堆积时，会让新卡的后台快照落后，造成“卡台有卡、后台显示没卡”。

因此不采用简单地把所有 timer 调得更快的方案；那会增加空转和 Provider 调用压力，却不能解决队列饥饿。

## 结论二：本轮已识别的 P0（应一起修，不应等用户逐个发现）

1. **库存同步队列可靠性 P0**：订单/补给后任务必须优先；历史 `REVIEW_REQUIRED` 隔离；同一卡去重；失败指数退避；受控并发 4–6；记录队列年龄、处理时延、失败率。
2. **自动补余额生产闭环 P0**：低余额卡→唯一 PREPARED attempt→一次补差额→到账 reconcile→原订单继续。当前代码和 runner 已部署，但尚无成功生产闭环证据。
3. **无卡自动开卡生产闭环 P0**：无可分配卡→唯一开卡任务→接管→原订单继续。当前仅有开卡动作历史成功，完整订单恢复尚未验收。

以下属于 P1，不在本批次冒充 P0：营业 readiness 尚未纳入独立 runner 心跳/窄 gate/额度/未决任务；Provider card account `write_enabled` 与 runner 窄 gate 语义不一致；营业后能力漂移不会自动收口。

## 决策与执行顺序

不让用户另行寻找 P0。下一批一次性完成“同步队列可靠性修正包”，加入集成测试与指标，部署后只读复验 `9051` 的 `$0.01` 快照；随后在用户当次确认下验收自动补余额，再验收无卡自动开卡。任何资金写入仍逐次确认。

本报告只记录代码/部署核对和风险判断，不代表自动补余额或自动开卡已经生产验收。

## 进度更新（2026-09-04）

已完成第一版可逆代码修正并提交 `e3def82`：新增 `045_card_sync_priority.sql`，为订单/补给触发的同步任务赋予更高优先级，普通巡检保留低优先级；claim 查询按优先级领取，并新增索引。全量本地测试 `523` 项：`478 passed / 45 skipped / 0 failed`（跳过项均因本机未配置隔离 `TEST_DATABASE_URL`）。

尚未部署：生产迁移、并发 worker 扩容、历史任务隔离和生产 `$0.01` 只读复验仍需在隔离 MySQL/备份前提下完成，不能把本提交写成生产已生效。

已完成最小只读指标接入并提交 `4142fb3`：后台总览增加“卡片同步”一项，仅显示最老任务年龄、近 24 小时平均延迟和失败率；无新定时器、无 Provider 调用、无资金写入。该项同样尚未随 P0 批次部署到生产。

随后提交 `85ec27f`：将 `REVIEW_REQUIRED` 从实时同步 backlog 中分离，仅作为“待复核”数量展示，避免历史案件让实时积压看起来虚高；相关总览测试通过。
