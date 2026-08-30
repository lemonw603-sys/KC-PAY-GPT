# 付款前交易证据门槛修复｜2026-08-31

## 发现
两笔真实 API 链路复查与代码审查发现，卡片分配阶段检查 `last_transaction_synced_at`，但付款前 attempt/Browser 权威快照只检查 `last_synced_at`。因此卡在分配后等待超过 15 分钟时，卡资料仍新鲜可能绕过交易证据门槛。

## 修复
- `recharge-attempt-repository` 在建立 API/Browser 资金 attempt 前同时校验 `last_transaction_synced_at`，缺失、未来时间或超过 15 分钟均 fail-closed 为 `CARD_TRANSACTION_CHECK_STALE`。
- Browser `authoritativePaymentSnapshot` 将交易同步时间纳入锁定快照及 hash；签发 permit 和提交付款 intent 均复核该字段。
- Browser/ API 共用同一 15 分钟交易证据原则；Browser 付款不会因旧快照继续执行。
- API 旧 permit 预检 `recharge-permit-service` 同步增加交易证据门槛。
- 订单提交遇到交易证据过期时，幂等排队一次只读卡交易同步并短延迟重试，不开卡、不付款、不换卡。

## 验证
- 定向回归：Browser repository、recharge permit、recharge attempt、workflow handlers 共 92 项通过，0 失败。
- Browser production-readonly smoke（隔离 MySQL + Chrome）：3 项通过；其中包含共享资金状态机和安全中止流程。
- Browser readonly 配置/ systemd 检查：10 项通过。
- 新增/更新测试覆盖 Browser 付款快照和 API attempt 的交易证据过期场景。
- 尚未部署生产；未执行 Provider 写入、卡台写入或真实付款。

## 当前边界
该修复只收紧付款前证据门槛，不改变库存模型、卡片分配规则、Browser/ API 默认路线或资金未知状态机。部署前仍需运行 v1 全量及 Browser 全量回归，并由用户确认生产部署。

## 订单等待语义
15 分钟是“付款时证据有效期”，不是订单生命周期或客户等待超时。订单等待超过 15 分钟不会自动失败或转人工；进入付款步骤时若证据过期，系统先排队一次只读同步并重试。仅在同步持续失败、结果无法确认时才暂停执行。

## 候选发布包
- 候选提交：`7cee9c3`
- 本地归档：`/tmp/20260831-preflight-7cee9c3.tar`
- SHA-256：`d1c737ae35a402009a830a0e77d5f25238d05db500426668bfcce13cee928a4b`
- 归档来自干净 Git 提交，不包含工作区未跟踪的 `output/`。
