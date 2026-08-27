# Browser 上游合同冻结清单（待统筹确认）

日期：2026-08-26
范围：Browser worktree 的只读输入合同；不修改共享 `CURRENT_STATE/DECISIONS/HANDOFF_LOG`，不代表生产 schema 已冻结。

## 目的

在接真实 HNSKJ 只读材料源和真实 MySQL 投影前，先把 Browser 消费的最小上游字段、状态映射和读取频率固定下来，避免 Browser 自己猜共享表结构或重复调用卡台。

## Browser 当前 adapter 需要的最小投影

```text
order_id
order_status
attempt_id
attempt_status
profile_id
card_ref
provider_card_ref
card_route_ref
card_provider_account_ref
card_inventory_status
card_readiness_status
card_readiness_digest
card_readiness_observed_at
card_readiness_valid_until
route_ref
route_card_provider_ref
route_executor_kind
route_status
session_ref                 # 可空
audit_ref                   # 可空
```

当前 Browser 只读 SQL 位于：

```text
browser-mvp/src/mysql-upstream-adapter.js
```

它使用参数化 `WHERE attempt_id = ? LIMIT 1`，拒绝 wildcard SELECT、凭据形状列和 0/多行结果。

## 已有 Browser 侧规则（代码事实）

- `order.status`：当前只接受 `CARD_READY`、`RECONCILIATION_REQUIRED`。
- `attempt.status`：当前只接受 `PENDING`、`OBSERVING`；`PREPARED` 不自动翻译，避免猜状态语义。
- `card.inventory_status`：当前只接受 `AVAILABLE`。
- `card_readiness_status`：必须为 `READY`，digest/observedAt/validUntil 必须存在且未过期。
- `route.executor_kind`：必须为 `BROWSER`。
- `route.status`：必须为 `ACTIVE`。
- `card.route_ref == route.ref`，`route.card_provider_ref == card.provider_account_ref`。
- `provider_card_ref` 只作为 opaque 引用传入 HNSKJ 只读材料源，不进入普通日志或 evidence。
- `fundsGate` 当前只能是 `NOT_REQUESTED`；Browser 不消费 active funds permit。
- 每个 Browser job 只进行一次上游投影读取；卡材料在短 lease callback 内按关键阶段读取一次，不循环刷新。

## 必须由统筹窗口确认的事项

1. `attempt.status` 的 Browser 可执行映射是否就是 `PENDING/OBSERVING`，以及 `PREPARED` 的正式含义。
2. `provider_card_ref` 的正式列名、归属 Provider 和历史卡迁移规则。
3. `card_readiness_status`、digest、observedAt、validUntil 的权威来源及失效时钟。
4. `card_ref`、`route_ref`、`provider_account_ref` 的唯一性和租约占用规则。
5. `session_ref` 是否由 Browser SessionProvider 消费，还是由控制面先完成身份核验。
6. 投影快照的刷新触发点、最小 TTL 和卡台限流下的读取上限。
7. `audit_ref` 与 order/attempt/browser run 的正式关联方式。

## 冻结验收

冻结后必须能用一行脱敏 fixture 完成：

```text
MySQL projection (one read)
→ projectUpstreamBrowserJob()
→ provider_card_ref
→ durable card lease
→ HNSKJ read-only material source (one read)
→ Checkout fixture fill/clear
→ lease release
```

验收仍要求：

- 不读取或落盘 PAN/CVC/Session/API key；
- 不调用卡台写接口；
- 不创建 payment permit；
- `submitCalls=0`；
- 0 行、多行、过期 readiness、错配 route、未知状态全部 fail-closed。

## 当前状态

本文是待统筹确认的 Browser 侧冻结清单。共享 schema 尚未由统筹窗口确认前，Browser 不接真实 MySQL 生产视图，不把本清单写成“已冻结事实”。
