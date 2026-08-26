# Browser 后台追溯与人工控制合同

> 状态：B2 后台接口与运营视图 v1 已实现。它只管理同一 run 的追溯和控制权，不提供真实付款、重付、换卡或 Checkout 重建能力。

## 1. 接口

### 只读

- `GET /api/v1/admin/browser/runs`：按 run、付款、控制状态和精确订单查询码筛选；
- `GET /api/v1/admin/browser/runs/:runId`：返回订单/attempt/run、profile、检查点、幂等 operation、permit 状态、artifact 元数据、资源租约、人工接管历史和对账案件；
- 运营后台新增“Browser 执行”视图和脱敏详情抽屉。

所有只读接口要求后台登录并设置 `Cache-Control: no-store`。响应禁止包含：

- Checkout URL/fragment、`secret_ref` 或密文；
- Session、Access Token、卡片凭据；
- Worker lease token/hash；
- resource/account HMAC；
- permit nonce/snapshot hash。

历史 `evidence_json` 和 `public_result_json` 返回前仍经过递归脱敏。

### 控制

`POST /api/v1/admin/browser/runs/:runId/control` 同时要求：后台登录、同源 Origin、写限流、密码 step-up、唯一 `operationId` 和与 run ID 绑定的中文确认词。

允许动作：

| 动作 | 前置状态 | 结果 |
| --- | --- | --- |
| `REQUEST` | 活动 run + `AUTOMATION` | 创建 `REQUESTED` intervention；不停止心跳 |
| `FREEZE` | `REQUESTED` | run=`HUMAN_REQUIRED`、control=`FROZEN`；自动化不得继续页面输入 |
| `TRANSFER` | `FROZEN` | 记录唯一 human owner，进入 `TRANSFERRED` |
| `RELEASE_SAFE` | `TRANSFERRED`，付款仍在 `NOT_STARTED/PAYMENT_ARMED` 且不存在已提交付款 operation | intervention=`RELEASED`、控制权回到自动化 |
| `MARK_PAYMENT_UNKNOWN` | 人工持有 `FROZEN/TRANSFERRED`，付款非确定终态 | run/attempt/order 同事务进入未知与仅对账，建立对账案件 |
| `CANCEL` | 尚未冻结的 `REQUESTED` | 取消请求并回到自动化 |

不存在“人工重付”“清除资金栅栏”“换卡”“重建 Checkout”“返回 authority”动作。

## 2. 幂等与审计

- `run + operationId` 写入 `browser_operations`，同 action 重放只返回既有公开结果；换 action 复用 operation ID 返回冲突；
- 每个动作追加 `CONTROL_*` checkpoint 并推进 run 的最后检查点；
- 接管生命周期写入 `browser_interventions`；
- 人工付款结果未知时同步写入 order event 和去重 reconciliation case；
- Browser 页面动作仍不写为 `provider_calls`。

## 3. 失败关闭

- 已存在付款提交证据时，`RELEASE_SAFE` 返回 `RECONCILE_ONLY`；
- 已确认或已拒绝的付款终态不能被人工降级成未知；
- control/intervention 状态不匹配返回冲突，事务整体回滚；
- 旧 Worker 因 `control_state != AUTOMATION` 无法签发/消费新的付款许可；资源心跳仍可维持，避免人工接管时上下文被另一 Worker 抢占。

## 4. 仍未覆盖

- 人工远程查看/操作同一 BrowserContext 的流媒体或桌面通道；
- Browser attempt 创建、队列派发和 Worker 注册；
- 并发队列、长时间租约压力与连续 24 小时 soak；
- 生产或菲律宾真实输入验证。
