# Browser 共享合同兼容层（只读设计，2026-08-25）

## 目的

在不修改 `v1` 订单、任务、卡片、资金或 Provider 核心的前提下，为 Browser 线冻结一个只读输入投影。Browser 只接收引用、状态和 digest；它不能直接读取 Session、卡片凭据或资金 permit，也没有共享核心写入口。

实现：`browser-mvp/src/shared-contract-adapter.js`。

## 当前事实

| Browser 输入 | 当前 v1 事实 | 兼容处理 |
| --- | --- | --- |
| `orderRef` | `orders.id` 为内部 ID；`orders.status` 使用 `OrderStatus` | 只生成 `order:<id>` 引用，不复制订单状态机 |
| `attemptRef` | 当前 v1 主要以 `tasks.id`/`dedupe_key` 与 provider call `attempt_no` 表达尝试；没有本轮新增 `recharge_attempts` 表 | 适配器只接受统筹层提供的规范化 `attempt.id`，不自行猜测映射 |
| `profileRef` | Browser profile/runtime digest 不属于当前 v1 订单表 | 只接受规范化 profile 引用，不读取 Session |
| `fundsGate` | 当前 v1 迁移中未发现 Browser permit 合同 | 只接受 `NOT_REQUESTED`；任何 active permit 直接拒绝 |
| 审计 | `order_events` 记录订单状态事件 | 只带 `auditRef`，不写 `order_events` |

## 当前允许状态

- order：`CARD_READY`、`RECONCILIATION_REQUIRED`
- attempt：`PENDING`、`OBSERVING`
- funds：`NOT_REQUESTED`

这是 Browser 非付款观察阶段的保守白名单，不代表共享核心已批准 Browser 写入或付款。

## 明确拒绝

- `session_ciphertext`、Session token、access token；
- `card_credentials_ciphertext`、卡号、CVV/CVC；
- Checkout authority、API key、secret；
- 任意 active funds permit；
- `SUBMITTING`、`SUBMIT_UNKNOWN`、`RECHARGE_PROCESSING` 等需要外部写入/不确定状态的订单。

## 未决合同

1. `recharge_attempts` 是否作为正式共享表、其主键/状态/幂等键如何定义，需非 Browser 统筹窗口确认。
2. 资金 permit 的字段、生命周期和 Browser 读取边界尚未冻结。
3. Browser 审计事件与 `order_events` 的关联方式尚未接入；本适配器只保留引用。
4. 本轮没有 MySQL adapter，也没有任何共享核心写操作。

验证命令：

```bash
npm --prefix browser-mvp test
npm --prefix browser-mvp run check
```
