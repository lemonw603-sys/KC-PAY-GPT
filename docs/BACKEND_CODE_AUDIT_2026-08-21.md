# 后台代码事实审计（2026-08-21）

> 状态：事实审计稿，不是新的业务决策。本文只记录已从当前代码、测试和既有规格中核实的内容；“建议”与“待确认”单独标出，不能当作已确认需求。

## 1. 审计范围与证据边界

本次检查覆盖：

- `v1/src/` 全部 JavaScript 后端代码（约 10,731 行）；
- `v1/scripts/` 运营、迁移、开卡、通知和只读检查脚本；
- `v1/migrations/001–023` 数据库结构；
- `v1/public/admin/` 后台页面调用的接口；
- `v1/test/` 自动化测试；
- `v1/README.md`、`CLAUDE.md`、`docs/` 中与当前运行边界有关的合同。

仓库根目录的浏览器池、Stripe、hCaptcha、代理等文件属于旧运行时。`v1` 不导入这些模块；隔离测试也验证了 v1 源图不依赖旧自动化模块。因此不能把根目录旧代码描述成当前 v1 后台正在执行的代码。

本地测试结果：283 个测试，262 通过、0 失败、21 个 MySQL 集成测试因未配置 `TEST_DATABASE_URL` 跳过。这个结果证明代码级测试状态，不等于生产成功充值验收。

## 2. 后台实际组成

### 2.1 Web 进程

入口：`v1/src/server.js` → `v1/src/app/create-app.js`。

职责：

1. 客户入口：创建订单、查询订单状态；
2. 后台认证：密码登录、签名 Session、step-up；
3. 后台读：总览、订单、告警、卡片、卡库存、CDK、对账案件、CSV；
4. 后台写：停/开接单、库存同步、卡片接收入库、开卡任务、充值授权、补偿、取消、CDK 批次和投递记录。

生产绑定受 `HOST`、`ADMIN_HOST` 和反向代理约束；后台与客户路由可以按 Host 隔离。

### 2.2 Worker 进程

入口：`v1/src/worker.js` → `worker-runtime.js` → `task-runner.js` → `workflow-handlers.js`。

Worker 只从数据库领取允许的任务类型。允许范围同时受数据库设置和进程环境开关控制：

- `ASSIGN_CARD`：分配已有库存卡；
- `PURCHASE_CARD`：卡台付费开卡；
- `VERIFY_CARD`：读取卡台详情，确认卡状态、余额、凭据；
- `PREPARE_RECHARGE`：只构造并记录直充请求，不发出资金请求；
- `SUBMIT_RECHARGE`：经授权后调用 ZZSHU `create_direct`；
- `POLL_RECHARGE`：查询直充结果；
- `RECHECK_CANCELLATION`：确认自动续费取消；
- `SYNC_CARD_TRANSACTIONS`：读取卡交易并保存证据。

默认 Provider 读写开关均为关闭；开卡写和充值写是分开的开关。

### 2.3 数据库与审计表

核心表实际包括：`cdks`、`orders`、`cards`、`provider_calls`、`recharge_attempts`、`tasks`、`order_events`、`card_transactions`、`refund_cases`、`operator_alerts`、`card_stock_jobs`、`card_sync_jobs`、`reconciliation_cases`、`cdk_delivery_events`、Provider 账户/产品/路由/余额快照等。

设计上把“订单业务状态”“任务执行状态”“Provider 调用审计”“资金风险账本”分开保存；这是当前代码的真实结构，不是推测。

## 3. 一条订单在代码中的真实路径

1. `POST /api/v1/orders` 接收 CDK + Session；
2. `order-intake-service` 校验输入和完整 Session，Session 加密；
3. `order-intake-repository` 在一个事务中锁定设置、校验 CDK、解析产品/路由、创建订单、消费 CDK、写订单事件并创建 `ASSIGN_CARD` 任务；
4. Worker 优先尝试分配满足卡段、余额、凭据和入库状态要求的已有库存卡；
5. 无可用卡时，订单保持 `CREATED`，任务按 60 秒重试，并创建 `CARD_STOCK_LOW` 告警；客户侧映射为 `QUEUED`；
6. 若没有库存且后续执行 `PURCHASE_CARD`，代码会先保存卡台列表基线，再用稳定幂等键开卡；响应不完整时通过卡台列表差异恢复，禁止盲目重开；
7. `VERIFY_CARD` 只在卡台状态、完整凭据和最低余额同时满足时进入 `CARD_READY`；终态失败进入 `CARD_FAILED`，超时进入人工复核；
8. `PREPARE_RECHARGE` 记录脱敏后的请求元数据，不提交；
9. 当前 Foundation v2 路径的 `SUBMIT_RECHARGE` 必须先有后台充值授权。授权消费、资金风险状态、Provider call intent 和订单进入 `SUBMITTING` 在同一事务内完成；
10. ZZSHU 创建成功后保存外部订单号和 `card_key`，生成状态轮询任务；明确失败释放授权并回到 `CARD_READY`，不自动重试；不明确结果进入 `SUBMIT_UNKNOWN`；
11. Provider 状态两次确认失败后才进入 `RECHARGE_FAILED`；成功后进入 `RECHARGE_SUCCESS`；
12. 成功后单独轮询 `is_subscription_cancelled`，值为 `1` 才确认取消自动续费；未确认会保持成功并继续复查，耗尽次数则标记人工复核；
13. 交易同步和对账任务保存卡交易、余额和资金证据；退款只由明确退款交易类型产生候选，退款案件人工处理。

## 4. 代码为什么这样做，以及是否合理

### 合理且与已确认方向一致的部分

| 代码设计 | 当前事实 | 判断 |
|---|---|---|
| v1 与旧浏览器/Stripe 运行时隔离 | v1 源图不导入根目录旧模块，测试有隔离断言 | 合理，避免旧能力误注册到生产 |
| CDK 哈希保存、恢复密文独立保护 | `cdk-code.js`、`cdk-service.js` 和安全配置分别使用 HMAC/SHA-256 与 AES-256-GCM | 合理，兼顾兑换校验、后台恢复和泄露面控制 |
| 新 CDK 分组格式 | 生成格式为 `PJ-ABCDE-FGHIJ-KLMNO-PQRST`；旧无分组格式仍兼容 | 与当前代码事实一致；文档曾落后，后续需统一描述 |
| 一卡一订单、余额和凭据门槛 | `assignAvailableCard` 使用事务锁、`SKIP LOCKED`、余额和凭据条件 | 合理，避免一张卡被并发分配或低余额卡被使用 |
| 开卡幂等与不确定结果恢复 | 卡台写入使用稳定幂等键，先记录列表基线再差异恢复 | 合理，降低超时重复付费风险 |
| 充值不确定结果禁止自动重试 | Provider 5xx/超时进入 `SUBMIT_UNKNOWN`，资金围栏保留 | 合理，因 ZZSHU 创建接口无调用方幂等键 |
| 成功后独立确认自动续费取消 | `RECHECK_CANCELLATION` 检查 `is_subscription_cancelled` | 与“最终必须取消续费”一致 |
| 最低余额从设置读取并在订单入库时快照 | `default_minimum_required_card_balance` 写入订单 | 合理，避免处理中途配置变化影响既有订单 |
| 客户页只显示有限状态 | 内部状态映射为 QUEUED/PROCESSING/REVIEWING/SUCCESS/FAILED | 安全上合理，但目前无法表达客户可理解的失败原因（见下） |

### 已从代码确认、但与当前新要求不一致的部分

1. **没有独立的“免费账号预检”接口或任务。** `order-intake-service` 只校验 Session 结构和有效期；ZZSHU 适配器只有 `createDirectOrder`、状态查询和连接检查，没有无副作用的套餐查询方法。当前账号为 Plus 时，实际会在 `create_direct` 阶段得到 40030，而不是在本地提前拒绝。
2. **正常充值仍被设计成“后台授权后才提交”。** `rechargeAttemptRepository.beginAuthorizedAttempt` 要求有效的 `recharge_authorization_item`；后台接口还要求 step-up 和确认文本。Worker 自动轮询不等于自动提交。因此当前代码与“客户付费后自动充值、无需逐单确认”的目标不一致。
3. **库存低阈值目前只产生告警，不会自动创建开卡任务。** `card-stock-service` 和 `assignAvailableCard` 会更新 `CARD_STOCK_LOW`；`card-stock-job-service.createJob` 仍要求后台显式提交数量、卡段、金额和确认词。自动补卡触发器在当前代码中不存在。
4. **客户 API 不返回原因。** `order-status-service` 只返回 `publicNo`、四类客户状态和 `updatedAt`。订单的 `failure_code/failure_reason` 目前只在后台/内部数据路径使用；因此“账号已是 Plus”“Session 无效”等不能都在客户页面得到可理解的差异化提示。
5. **Session 替换路径未实现。** 当前客户接口只有创建订单和查询状态，没有同一订单替换 Session 的更新路由。新 Session 会重新走 CDK 消费和新订单创建流程。
6. **产品数据库已可扩展，但业务服务仍是 Plus-only。** `products`、`fulfillment_routes` 和 CDK `plan_type` 已有扩展字段；`cdk-service.js` 的 `PLAN_TYPES` 当前只有 `plus`，因此 Pro 5X/Pro 20X 尚未被代码启用。

## 5. 卡片失败的代码分类

这是代码已经实现的分类，不是对业务的猜测：

- 卡台返回 `failed/failure/invalid/inactive/closed/cancelled/canceled`：`CARD_PROVISIONING_FAILED`，订单进入 `CARD_FAILED`；
- 卡已存在但状态/凭据/余额未达到条件：保持 `PROVISIONING` 或等待，不提交充值；
- 卡活跃但余额低于最低要求：库存标记 `DEPLETED`，不会计入可用库存；
- Provider 响应不明确或卡 ID 无法恢复：进入 `RECONCILIATION_REQUIRED`/人工复核，禁止自动重开；
- 既有库存不足：订单不失败，保持队列等待并产生后台告警。

代码没有把这些情况统一成一个“卡片失败”概念；这是正确的，因为付款失败、开卡失败、卡未就绪和库存不足的资金含义不同。

## 6. 目前必须修正的优先项（建议，不是已确认决策）

### P0：在重新开启真实自动充值前

1. 明确并实现免费账号校验策略：先核实卡台/上游是否提供无副作用套餐查询；若没有，不能把 `create_direct` 当作预检。需要定义 Plus 账号发现后的同单 Session 替换或补偿规则。
2. 将“自动充值”从逐单后台授权改为可审计的批量/规则授权，同时保留全局急停、额度/余额围栏和未知结果人工锁定。否则 100–300 单/日与当前逐单确认机制矛盾。
3. 将 40030、Session 无效、库存不足、卡台开卡失败分别映射为内部可追踪原因，并决定哪些原因可展示给客户；库存不足必须只在后台告警，不泄露为客户责任。

### P1：库存与运营

1. 把“可用且余额达标卡数量低于阈值”连接到预配置开卡批次；批次数量、开卡金额、卡段、每日上限必须由后台设置快照；自动任务仍需幂等、单活跃批次和余额/限额门禁。
2. 后台库存统计统一使用“成功开通且满足余额/凭据要求”的定义；失败开卡不能计入成功库存，也不能混入历史成功卡数。
3. 给“等待补卡”增加明确内部状态/原因和通知去重记录，便于一个管理员处理。

### P1：可追溯性

1. 验证每次真实 `create_direct` 都有对应 `recharge_attempts`、`provider_calls`、订单事件和外部订单号；历史兼容路径可能存在没有资金账本关联的调用记录，必须单独审计，不可直接定性为漏洞。
2. 保留 CDK→订单→卡→Provider 订单→卡交易→失败/退款案件→客户邮箱/时间的查询和 CSV 导出链路。

### P2：未来产品

在 Plus 成功链路稳定并完成灰度后，再启用 Pro 5X/Pro 20X；当前不应提前改变 `PLAN_TYPES` 或 Provider 路由，否则会把未核实的产品能力带入生产。

## 7. 本轮结论

- 后台代码的核心骨架已经存在：订单、库存卡、开卡、直充、轮询、取消续费、交易证据、CDK、告警、对账和人工补偿均有明确模块。
- 当前最重要的偏差不是“没有后台”，而是**自动化目标与现行资金授权门禁不一致**、**没有免费账号预检**、**低库存未自动开卡**、**客户看不到可理解原因**。
- 以上四点是代码事实与用户已表达目标之间的直接差异；不是对 Provider 行为或未来运营效果的猜测。
- 本文不改变 `docs/DECISIONS.md`、`docs/ROADMAP.md` 等正式决策文件；待宝宝逐项确认冲突规则后，再同步正式规格和实现计划。

## 8. API 对接/连通性核对（特别区分“卡网”和“卡台”）

当前仓库里能核实到的外部 API 只有两组：

| 系统 | 代码中的 Base URL/适配器 | 已核实范围 | 结论 |
|---|---|---|---|
| 自有管理后台 API | `v1/src/app/create-app.js`、`v1/src/server.js` | 路由注册、认证、Origin、step-up、错误映射和本地自动化测试 | **代码连通和接口保护已核实；不是每个生产接口都做过逐个真实请求验收** |
| 卡台 HNSKJ | `HnskjCardProvider`，`https://card.hnskj.vip/api/open/v1` | 账户、余额、卡段、卡列表、卡详情、开卡、交易读取；曾做过真实读调用和单笔开卡 PoC | **已证明与卡台 API 连通；开卡写入有真实 PoC 证据** |
| 充值 Provider ZZSHU | `ZzshuRechargeProvider`，`https://card.zzshu.pro/api/v1` | 连接检查、`create_direct`、状态查询；曾有一次真实成功 PoC，也有一次正式订单真实 40030 明确拒绝 | **已证明与充值 API 连通；成功、失败、取消续费路径分别有证据，但不是所有异常分支都已生产验证** |
| “卡网”（如果指独立于 HNSKJ 卡台的另一套 API） | 当前代码、环境变量、迁移和文档中未发现独立的 `CARD_NETWORK_*` 配置、Provider 或路由 | 无 | **不能声称已经对接或连通；当前项目没有可指认的“卡网 API”实现** |

因此，若宝宝说的“卡网”不是 HNSKJ 卡台，而是另一个独立平台，那么这部分目前没有被核实。需要先拿到它的准确域名、API 文档或现有接口名称，才能做事实核对；在此之前不能把 HNSKJ 卡台的连通性当成“卡网”连通性。
