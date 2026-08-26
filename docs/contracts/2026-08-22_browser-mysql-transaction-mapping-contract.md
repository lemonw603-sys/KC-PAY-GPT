# Browser MySQL 事务映射合同

> 状态：B2 数据库映射 v1 已实现并在隔离 MySQL 8.4 验证。生产 Browser profile、派发和付款写开关保持关闭。

## 1. 边界

该合同把离线 Browser WAL 的关键不变量映射到现有 MySQL 订单和 `recharge_attempts` 资金账，不创建第二套订单、卡池或资金系统。

- `orders`：客户履约状态；
- `recharge_attempts`：唯一资金风险 attempt；
- `browser_runs`：一个 attempt 下可租约、可恢复的 Browser 执行；
- `browser_checkpoints`：追加式步骤和付款风险边界；
- `browser_operations`：`run + operation_id` 幂等账；
- `payment_permits`：一次性最终付款许可；
- `reconciliation_cases`：未知付款人工对账入口。

Browser 页面动作不得伪装成 `provider_calls`。卡台 Open API 调用仍使用 `provider_calls`；Browser run 通过 `recharge_attempt_id` 进入同一资金账。

## 2. 已冻结表和唯一约束

| 表/字段 | 作用 | 数据库约束 |
| --- | --- | --- |
| `executor_profiles` | 冻结 runtime/adapter 版本 | `profile_code + profile_version` 唯一；初始 profile 为 `DISABLED` |
| `recharge_attempts.executor_profile_id` | 冻结 attempt 实际 Browser profile | 外键指向 `executor_profiles` |
| `browser_runs` | run、Worker 租约、控制权和付款状态 | 同一 attempt、同一账号 HMAC 最多一个活动 run |
| `browser_checkpoints` | 追加式检查点 | `run + sequence`、`run + operation_id` 唯一 |
| `browser_operations` | 外部动作幂等凭据 | `run + operation_id` 唯一 |
| `payment_permits` | 最终提交许可 | 同一 attempt 最多一个活动 permit、最多一个已消费 permit |
| `checkout_artifacts` | Checkout 工件索引 | 只存 `secret_ref`、URL hash、Checkout hash；不存完整 URL |
| `execution_resource_leases` | 后续跨进程资源租约 | 活动 `resource_type + resource_key_hmac` 唯一 |
| `browser_interventions` | 人工接管状态 | 同一 run 最多一个活动接管 |

`browser_dispatch_enabled=false`、`browser_payment_writes_enabled=false` 是迁移默认值。迁移不会注册 Worker、修改现有订单路线或执行外部操作。

## 3. Repository 接口

实现：`v1/src/db/repositories/browser-execution-repository.js`。

### `beginRun`

输入一个已由订单核心建立的 `BROWSER/PREPARED/ACTIVE` attempt，锁定 attempt、订单、路线和 profile 后创建活动 run。

前置条件：

- attempt 和 fulfillment route 都是 `BROWSER`；
- attempt 为 `PREPARED/ACTIVE`，订单为 `SUBMITTING`；
- executor profile 为 `ACTIVE`；
- 订单已绑定卡片；
- 同一 attempt、账号不存在另一个活动 run。

方法返回一次 Worker lease token，数据库只保存 SHA-256。按 `start_operation_key` 重放只返回既有 run，不返回旧 token，也不创建第二个 run。

### `issuePaymentPermit`

只有 `browser_payment_writes_enabled=true`、Worker lease 有效、自动控制权仍属于该 Worker、run 为 `RUNNING/NOT_STARTED` 且 attempt 为 `PREPARED/ACTIVE` 时才能签发。

数据库只保存 nonce hash 和付款前 snapshot hash。permit 明文 nonce 只返回一次。

### `commitPaymentSubmissionIntent`

同一事务执行：

1. 锁定并验证 operation ID、运行开关、run/attempt/order、Worker lease 和控制权；
2. 验证未过期的 permit nonce；
3. 追加 `PAYMENT_SUBMITTING` checkpoint；
4. 写入已提交的 `PAYMENT_SUBMIT` operation；
5. 消费 permit；
6. 将 run 改为 `PAYMENT_SUBMITTING`；
7. 将共享 attempt 改为 `SUBMITTING/ACTIVE`。

事务首次提交返回 `executeExternal=true`。相同 `run + operation_id` 的任何重放返回 `executeExternal=false`，即使之后打开了紧急停付也只读识别既有提交，不会再次授权外部动作。

### `markPaymentUnknown`

仅允许从 `run=PAYMENT_SUBMITTING`、`attempt=SUBMITTING/ACTIVE` 进入：

- run：`RECONCILE_ONLY/PAYMENT_UNKNOWN`；
- attempt：`SUBMIT_UNKNOWN/UNKNOWN`；
- order：`SUBMIT_UNKNOWN`；
- 新增追加式 checkpoint、operation、order event 和去重 reconciliation case。

上述写入处于同一事务。任一步冲突时全部回滚；未知后禁止新 Checkout、换卡或再次付款。

### `getRecoveryState`

只要存在已提交的 `PAYMENT_SUBMIT` operation，或 run/attempt 已进入 submitting/unknown，就返回 `RECONCILE_ONLY`。它不会根据超时猜测付款未发生。

## 4. 当前未覆盖

以下不属于本合同；其中 artifact/租约项已由后续恢复合同完成：

- Browser attempt 的订单调度/授权创建入口和 Worker 注册；
- artifact vault 密文跨进程存取、销毁，以及 `execution_resource_leases` 领取/心跳/过期接管已在 `2026-08-22_browser-artifact-vault-resource-lease-recovery-contract.md` 实现；在线密钥轮换作业仍未完成；
- 后台 Browser 时间线与人工恢复操作；
- 并发队列和连续 24 小时 soak；
- 菲律宾 sticky 出口真实 Session/Checkout 验证。

## 5. 验证证据

- Repository/Schema 定向测试：11/11；
- v1 全量测试：312 通过、28 个因未配置常驻 `TEST_DATABASE_URL` 跳过、0 失败；
- Browser PoC：11 文件、77 测试通过；
- 一次性 Docker MySQL 8.4：全量迁移执行一次、027 单独重放成功；8 张 Browser 表、外键、禁用 profile 和默认关闭开关均已查询确认；
- 一次性 Docker MySQL 8.4 Repository 集成：首次付款意图 `executeExternal=true`，相同 operation 重放为 `false`，最终持久化为 `RECONCILE_ONLY/PAYMENT_UNKNOWN`、attempt `SUBMIT_UNKNOWN/UNKNOWN`、订单 `SUBMIT_UNKNOWN`，已消费 permit 和 submit operation 均为 1。
