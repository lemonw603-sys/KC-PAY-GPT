# 破甲 v1 产品与技术规格

- 状态：草案，待真实 API 合同验证后冻结
- 日期：2026-08-17
- 套餐：仅 ChatGPT Plus

## 1. 结论

v1 建设一条可运营的最小充值链路：客户凭 CDK 提交完整 Session，系统为该订单幂等开一张专属虚拟卡，通过第三方直充接口提交 Plus 订单，异步追踪结果，并在内部后台处理异常、交易和后续退款。

系统追求“可恢复、不会静默重复扣款”，不承诺跨两个外部供应商的绝对一次执行。第三方直充创建接口缺少上游幂等能力，因此不明确的创建结果必须冻结为 `SUBMIT_UNKNOWN`，不得自动重试。

## 2. 用户与职责

### 客户

- 输入未使用的 CDK。
- 提交完整 ChatGPT Session JSON。
- 查看充值状态和必要的失败提示。

客户不查看银行卡、交易、退款和供应商信息。

### 运营人员

- 创建、导入、禁用和查询 CDK。
- 查询订单、卡片绑定、充值状态和失败原因。
- 处理不明确订单。
- 查询银行卡交易与退款。
- 人工确认退款、人工提取退款余额。
- 控制维护状态与并发。

## 3. v1 范围

### 必须实现

- CDK 兑换和一次性占用。
- Session JSON 提交、结构校验与有效期预检。
- MySQL 持久化订单和任务。
- `HnskjCardProvider`：余额、卡段、幂等开卡、卡详情、余额刷新、交易查询、余额提取。
- `ZzshuRechargeProvider`：连通性检查、直充创建、状态批量查询。
- 一卡一单的独占绑定。
- 订单状态机、任务租约、有界重试和异常队列。
- 内部管理面板。
- 停止新建与继续追踪两个独立运行开关。
- Telegram 异常通知。
- 最小成本字段与交易、退款台账。
- 外部 API 运行时 Schema 校验和合同测试。

### 保留但在生产隔离

下列 KC-PAY-GPT 旧能力可以保留在上游基线分支、Git 历史或隔离模块中，但 v1 默认不注册路由、不启动 worker、不要求密钥：

- 本地 Playwright 充值流程。
- Stripe 直连逻辑。
- hCaptcha。
- 浏览器池、代理池、地址池。
- 截图和录屏。
- 旧手工卡池。

### 暂不实现

- Pro 5X、Pro 20X。
- 自动处理 3DS。
- BIN 成功率分析和自动选卡段。
- 多租户和复杂角色权限。
- 完整财务总账、自动会计分录。
- 自动退款余额提取和自动销卡。
- 客户退款查询。
- 多充值供应商自动切换。

## 4. 外部系统合同

### 4.1 卡台

- Base URL：`https://card.hnskj.vip/api/open/v1`
- 认证：`X-API-Key`
- 开卡：`POST /cards/purchase`
- 开卡必须带 16–128 字符的 `X-Idempotency-Key`。
- 超时、502、503 只允许使用原幂等键重试。
- 卡台资金单位为 USD；卡充值只接受正整数 USD。
- 账户充值不在 Open API 中，由运营人员在卡台完成。

v1 不包装卡台网站，不复制其会员、充值或卡段管理页面。

### 4.2 直充平台

- Base URL：`https://card.zzshu.pro/api/v1`
- 认证：固定非空 `X-API-Key`
- 创建：`POST /third-party/orders/direct`
- 查询：`POST /third-party/orders/status`
- v1 固定使用 `orderType=direct`、`planType=plus`。
- 创建成功仅表示已入队；只有最终 `status=success` 表示开通成功。
- 创建接口没有调用方幂等键；每次成功进入创建流程都可能产生新订单。
- 查询必须使用创建响应返回的 `card_key`，并继续使用原 `X-API-Key`。

## 5. 总体架构

```text
客户页面 ──> 应用 API ──> MySQL
                         │
                         ├─> 持久化任务 Worker
                         │      ├─> HnskjCardProvider ──> 卡台 API
                         │      └─> ZzshuRechargeProvider ──> 直充 API
                         │
内部后台 ────────────────┤
                         └─> Telegram 异常通知
```

应用、后台和 worker 可以先运行在同一个 Node.js 服务中，但任务状态必须保存在 MySQL，不能依赖进程内队列。以后拆 worker 时不改变业务模型。

## 6. 核心不变量

1. 一个 CDK 最多绑定一个本地订单。
2. 一个本地订单最多绑定一张卡；一张卡最多绑定一个本地订单。
3. 开卡幂等键在订单创建时生成并先持久化，之后永不改变。
4. 同一订单的直充创建只允许一个 worker 进入发送区。
5. 直充创建结果不明确时不得自动再次创建。
6. 卡在订单和退款生命周期结束前不得分配给其他订单。
7. 未知外部状态不得映射为成功或普通失败。
8. 暂停新订单不能停止已有订单轮询和退款同步。

## 7. 客户主流程

1. 客户在一次请求中提交 CDK 和完整 Session JSON。
2. 服务端校验 Session 必要字段、JWT/JWE 结构及有效期，不修改其余字段。
3. 在一个数据库事务中锁定并占用 CDK、加密 Session、创建订单、事件和首个任务。
4. worker 查询卡台余额和指定卡段可用性。
5. worker 使用订单的稳定幂等键开一张卡。
6. 保存卡台卡 ID和订单独占绑定，再读取卡资料。
7. 将订单写为 `SUBMITTING` 后，调用直充创建接口。
8. 明确获得 `201 + code=0 + order_no + card_key` 后保存外部标识。
9. 定时查询直充状态，直到成功、失败或需要人工处理。
10. 成功后进入退款观察；取消续费状态异步补查，不阻塞充值成功。

## 8. 订单状态机

| 状态 | 含义 | 自动动作 |
| --- | --- | --- |
| `CREATED` | CDK和 Session 已建立订单 | 等待 worker |
| `CARD_PURCHASING` | 正在幂等开卡 | 仅原幂等键可重试 |
| `CARD_READY` | 专属卡已保存 | 准备提交直充 |
| `SUBMITTING` | 直充创建调用正在进行 | 禁止其他 worker 进入 |
| `SUBMIT_UNKNOWN` | 请求可能送达但没有可靠响应 | 冻结卡并人工核查 |
| `RECHARGE_PROCESSING` | 已获得 `card_key`，等待最终结果 | 持续轮询 |
| `RECHARGE_SUCCESS` | 直充返回最终成功 | 开始退款观察和取消续费补查 |
| `RECHARGE_FAILED` | 延迟复查后仍为失败 | 对账并人工决定关闭 |
| `RECONCILIATION_REQUIRED` | 外部状态、交易或金额矛盾 | 人工处理 |
| `CLOSED` | 订单业务处理完结 | 保留历史记录 |

不得用单一 `failed` 状态承载网络不明确、支付失败、Schema 漂移和人工取消。

## 9. 外部调用重试规则

| 调用 | 自动重试 | 规则 |
| --- | --- | --- |
| GET 类读取 | 是 | 指数退避、有最大次数 |
| 卡台开卡 | 有条件 | 仅超时、502、503，必须使用原幂等键 |
| 卡台提取余额 | 暂不自动 | v1 由运营人员确认后触发，使用稳定幂等键 |
| 直充创建：明确 42902 | 是 | 说明创建前队列已满，退避后重试 |
| 直充创建：明确参数 4xx | 否 | 修正输入或人工处理 |
| 直充创建：连接超时、断流、不完整响应、异常 5xx | 否 | 进入 `SUBMIT_UNKNOWN` |
| 直充状态查询 | 是 | 保留 `card_key`，允许长期补查 |

直充平台的 `50001` 不能直接自动重试创建。只有在能证明订单未创建时，运营人员才能重新提交。

## 10. 退款与交易

### 10.1 原则

- 客户侧不显示退款状态。
- 退款属于内部资金对账。
- 充值成功后的卡不自动销卡。
- 发现退款后不自动提取余额；v1 由运营人员确认后操作。

### 10.2 退款状态

| 状态 | 含义 |
| --- | --- |
| `MONITORING` | 充值成功，持续观察交易和余额 |
| `REFUND_DETECTED` | 发现疑似退款或相关余额变化 |
| `REFUND_CONFIRMED` | 已确认退款入账且金额明确 |
| `MANUAL_REVIEW` | 交易类型、金额或余额存在矛盾 |
| `WITHDRAWN` | 退款余额已人工提回卡台账户 |

### 10.3 同步策略

- 定期批量刷新处于观察期卡片的余额和交易。
- 保存供应商交易 ID、类型、状态、金额、币种、发生时间和原始响应摘要。
- 交易采用追加或幂等更新，不能覆盖历史状态变化。
- 退款优先依据供应商交易类型和关联 ID匹配；余额变化只能作为辅助证据。
- 未取得真实交易响应样本前，不实现自动确认算法。

### 10.4 内部操作

- 查看某订单对应的卡片、原消费和退款记录。
- 手动刷新余额与交易。
- 标记账号被封或进入重点退款观察。
- 确认或驳回疑似退款匹配。
- 确认后调用卡台余额提取，记录幂等键和结果。

## 11. 数据模型

v1 至少包含以下实体：

### `cdks`

- `id`、`code_hash`、`status`
- `batch_no`、`created_at`、`redeemed_at`
- `order_id`

v1 MySQL 只保存 CDK 的 SHA-256。系统生成的明文仅一次写入运营人员指定的 `0600` 私有文件；导入文件由运营人员自行保管。

### `orders`

- `id`、`public_no`、`status`
- `customer_email`、`chatgpt_account_id`
- `plan_type`，v1 固定 `plus`
- `session_encrypted`
- `card_purchase_idempotency_key`
- `recharge_order_no`、`recharge_card_key`
- `failure_code`、`failure_reason`
- `created_at`、`updated_at`、`finished_at`

### `cards`

- `id`、`provider_card_id`、`order_id`
- `card_type_id`、`last4`、`status`
- `funded_amount`、`current_balance`、`currency`
- `refund_status`、`last_synced_at`

完整卡资料优先按需从卡台读取并直接发送给直充适配器，不作为日常查询数据重复保存。

### `provider_calls`

- `id`、`order_id`、`provider`、`operation`
- `request_key`、`attempt_no`
- `http_status`、`business_code`、`outcome`
- `started_at`、`finished_at`、`duration_ms`
- 脱敏后的响应摘要

### `card_transactions`

- `id`、`provider_transaction_id`、`card_id`
- `type`、`status`、`amount`、`currency`
- `occurred_at`、`raw_hash`、`first_seen_at`、`last_seen_at`

### `refund_cases`

- `id`、`order_id`、`card_id`、`status`
- `original_transaction_id`、`refund_transaction_id`
- `expected_amount`、`confirmed_amount`、`currency`
- `detected_at`、`confirmed_at`、`withdrawn_at`
- `operator_note`

### `tasks` 与 `order_events`

- 任务记录类型、状态、可执行时间、租约、尝试次数和最后错误。
- 事件记录每次状态迁移、操作人或 worker、原因和时间。

## 12. 页面

### 客户页面

- CDK 输入。
- Session JSON 输入与格式提示。
- 提交结果。
- 使用 CDK或订单查询码查看充值状态。

状态查询接口同时支持创建时返回的 `publicNo` 和原 CDK。客户仅看到 `QUEUED | PROCESSING | REVIEWING | SUCCESS | FAILED`，不看到卡片、Provider、退款或内部异常细节。

页面不持久化 Session JSON，创建成功后立即清空输入框；仅在当前标签页保留最后一个 `publicNo`。页面对处理中订单有界自动轮询，进入终态后停止。

失败提示应可行动，但不暴露供应商内部细节、卡资料或退款信息。

### 内部后台

1. 总览：订单量、成功率、处理中、异常、卡台余额、供应商健康。
2. 订单：筛选、详情、事件时间线、人工处理。
3. CDK：批量生成、导入、禁用、使用状态。
4. 卡片绑定：订单、卡台 ID、后四位、余额、同步状态。
5. 交易与退款：原交易、疑似退款、确认、人工提取。
6. 异常队列：`SUBMIT_UNKNOWN`、Schema 错误、长期处理中、对账矛盾。
7. 设置：维护开关、并发、轮询频率、卡段和开卡金额。

普通列表不显示完整卡号、CVV 或 Session。确有排障需要时，卡号采用按需读取；CVV 和 Session 不进入日常后台页面。

## 13. 最小安全基线

- 管理后台使用服务端认证。
- Cookie 设置 `HttpOnly`、`Secure`、合适的 `SameSite`；状态变更有 CSRF 防护。
- 登录、CDK 校验和提交接口限流。
- JSON 请求体设置明确大小上限。
- API Key只在服务端配置，不进入前端或普通日志。
- Session 加密存储；日志不记录其原文。
- 所有外部响应先校验 Schema，再进入业务状态机。
- 管理操作和人工状态修改写入事件记录。
- 部署前清理生产依赖漏洞，不能仅以“功能未使用”为理由保留高危运行时依赖。

## 14. 运行控制与通知

### 独立开关

- `accept_new_orders`：客户是否可以创建新订单。
- `dispatch_new_recharges`：是否开卡和提交新直充。
- `poll_existing_orders`：是否查询已提交订单，正常情况下始终开启。
- `sync_card_transactions`：是否同步余额、交易和退款。

### Telegram 告警

仅通知需要动作的异常：

- `SUBMIT_UNKNOWN`。
- 卡台余额低于配置阈值。
- API Schema 不兼容。
- 供应商连续故障或长期处理中。
- 发现疑似退款。
- 退款确认后等待提取。

通知不得包含完整卡号、CVV、API Key 或 Session。

## 15. 上线门槛

### 合同验证

- 卡台相同开卡幂等键、相同请求体的重复调用不会重复开卡或扣费。
- 记录相同幂等键重试时的真实响应。
- 获取开卡响应、卡详情、卡状态、交易和退款的真实 Schema。
- 验证直充创建和状态查询的真实成功与错误响应。

### 单笔真实 PoC

- 一张卡、一个有效 Session、一次 Plus。
- 验证实际开卡资金、费率、PHP 扣款、消费手续费和剩余余额。
- 验证成功状态、取消续费状态和卡台交易。

### 放量

- 先 3–5 单人工逐单核对。
- 再 10–20 单、并发 1，观察重复、失联、金额不足和状态矛盾。
- 指标稳定后才提高并发。
- 充值平台未提供上游幂等或业务单号查询前，`SUBMIT_UNKNOWN` 始终人工处理。

## 16. 待验证事实

1. 卡台相同幂等键重试是否返回第一次创建的相同卡片信息。
2. 卡台开卡响应、卡片状态及交易响应的完整 Schema。
3. 实际 Plus 所需开卡金额和安全余量。
4. 卡片销卡后是否仍能收到原交易退款。
5. 退款进入卡余额还是卡台账户余额。
6. 交易如何区分授权、入账、撤销、退款和拒付，以及能否关联原交易。
7. 退款余额提取规则、费用和幂等响应。
8. 长期保留卡片是否持续占用开卡数量额度。
9. 直充平台能否增加 `clientOrderId`、幂等键或按业务单号查询。

上述事项通过运行证据确认后，结果写入 `docs/contracts/`，并据此冻结本规格。
