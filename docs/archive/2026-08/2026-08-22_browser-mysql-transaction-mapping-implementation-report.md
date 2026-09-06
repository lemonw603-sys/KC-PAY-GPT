# Browser MySQL 事务映射实施报告

> 日期：2026-08-22
> 节点：B2 离线 WAL → 现有 MySQL 订单/路线/资金 attempt 事务映射
> 外部操作：无生产连接、无开卡、无真实 Session、无 Checkout、无付款。

## 1. 结果

Browser 控制面已经从纯内存/WAL 原型落到现有 v1 MySQL 资金账边界。新增迁移、Repository、静态测试和真实 MySQL 8.4 隔离集成测试；默认 profile、派发和付款写开关均关闭。

本节点没有建立第二套订单或 Provider 系统。`recharge_attempts` 继续负责订单级唯一资金栅栏，`browser_runs` 只描述该 attempt 的执行过程；Browser 页面动作不写成 HTTP Provider 调用。

## 2. 交付文件

| 文件 | 作用 |
| --- | --- |
| `v1/migrations/027_browser_execution_control_plane.sql` | Browser 表、唯一约束、禁用 profile/route 和默认关闭开关 |
| `v1/src/db/repositories/browser-execution-repository.js` | run、permit、付款意图、未知结果和恢复状态事务接口 |
| `v1/test/browser-execution-schema.test.js` | 迁移静态合同 |
| `v1/test/browser-execution-repository.test.js` | 事务顺序、重放、开关和回滚单元测试 |
| `v1/test/browser-execution-mysql-integration.test.js` | 隔离 MySQL 真实约束与端到端事务测试 |
| `docs/contracts/2026-08-22_browser-mysql-transaction-mapping-contract.md` | 可供后续 Worker/后台接入的冻结合同 |

## 3. 关键实现

### 共享资金账

Browser run 只能绑定已有的 `BROWSER/PREPARED/ACTIVE` attempt，且订单必须为 `SUBMITTING`。attempt 冻结 executor profile；同一 attempt 和同一账号 HMAC 的活动 run 由 MySQL 生成列唯一索引阻止并发。

### 最终提交边界

`commitPaymentSubmissionIntent` 在调用任何外部动作前，原子提交 permit 消费、operation 幂等记录、`PAYMENT_SUBMITTING` checkpoint、run 状态和 attempt 状态。只有事务首次提交返回 `executeExternal=true`；相同 operation ID 的重放永远返回 `false`。

### 未知付款

观察结果丢失时，一个事务同时锁定：

- run → `RECONCILE_ONLY/PAYMENT_UNKNOWN`；
- attempt → `SUBMIT_UNKNOWN/UNKNOWN`；
- order → `SUBMIT_UNKNOWN`；
- reconciliation case → `BROWSER_PAYMENT_UNKNOWN`。

因此重启、重复投递或更换 Worker都不能把未知付款重新解释为可再次提交。

### 敏感工件

数据库只为 Checkout 保存 vault `secret_ref`、URL hash 和 Checkout hash，不保存完整 hosted URL/fragment。实际密文 vault 的跨进程实现仍属于下一节点。

## 4. 验证

```text
定向 Repository/Schema：11 passed
v1 全量：312 passed, 28 skipped, 0 failed
Browser PoC：11 files, 77 passed
Docker MySQL 8.4 DDL：全量首次迁移成功，027 独立重放成功
Docker MySQL 8.4 Repository：1 passed
git diff --check：通过
```

全量历史迁移整体执行第二遍会在既有 `002_workflow_fields.sql` 的未守护 `card_type_id` 上失败；这不是 027 引入的问题。027 已单独重放验证通过，当前没有修改历史迁移。

## 5. 准确停止点

MySQL 事务映射 v1 已完成；尚未把 Browser attempt 创建/任务派发注册到生产 Worker，也没有实现跨进程 artifact 密文和资源租约 Repository。

下一主工程项是：实现 artifact vault 与账号/订单/卡片/Checkout 租约的跨进程持久化、领取、心跳、过期接管和失败关闭恢复。完成后再进入后台接口、并发队列和连续 24 小时 soak。
