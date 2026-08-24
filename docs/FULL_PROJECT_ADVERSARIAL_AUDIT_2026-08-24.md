# 全项目独立对抗式审查（2026-08-24）

> 审查者：接班执行模型（本窗口）
> 范围：整套系统与横向联动（运营后台 / 客户充值链路 / 卡台与 Provider / CDK 订单追溯 / Browser 工作线 / 后端数据库与运行稳定性）。
> 方式：文档 + 代码 + 隔离测试的独立交叉核验。**本次未做生产运行时核验（无 P 级证据）**，因为生产服务器当前状态未知且不允许资金写入。
> 边界：本次未修改任何业务代码、数据库、配置或生产；未真实开卡、充值、付款、退款、切卡台或启用 Provider 写入；未覆盖、回滚或提交其他窗口的未提交改动。

## 证据等级记号

沿用 `PROJECT_OPERATING_PROTOCOL.md`：`P` 生产运行/日志/DB 证据；`D` 只读 DB/网络证据；`C` 代码证据；`T` 自动化/隔离测试证据；`H` 历史/文档证据；`U` 未核验。本报告每条重要结论标注等级；本窗口只能产出 C/T/H，不产出 P/D。

---

## 一、项目当前真实状态

- **定位**（H）：GPT Plus 自动充值 + 内部运营系统。客户站外付款 → 后台发 CDK → 客户提交 CDK+完整 ChatGPT Session → 系统分配专属虚拟卡、核验、（不足时）补卡余额、执行 Plus 购买、取消自动续费，后台全链路可追溯、可人工兜底。
- **架构**（H）：三端积木——可切换卡台适配层 / 运营后台中枢 / 双执行器（API + Browser）。目标 200–300 单/天。
- **两条工作线**（H）：非 Browser（后台/卡台适配/API 链路/追溯/库存）；Browser（自动化充值，独立推进，共用订单/卡片/资金账本/审计/状态合同）。**不得互相改写。**
- **当前分支**（C）：`codex/mvp-zero-cost-ops-20260819`（非 main）。工作树有大量其他窗口未提交内容（8 个 tracked M + 数十个 ?? 文档/测试支撑文件），本次一律不动。
- **代码成熟度**（C/T）：`v1/` 是成体系实现，非空壳——34 个 service、15 个 repository、5 个 provider、37 个迁移、408 项测试。本窗口独立跑 `node --test`：**408 tests / 374 pass / 0 fail / 34 skipped**（3.67s），与既有快照一致。34 跳过项为需隔离 MySQL/外部条件的集成测试。
- **唯一真实端到端证据**（H）：2026-08-21 一次真实订单到 ZZSHU 返回 `40030`（目标账号已是 Plus），进入 `RECHARGE_FAILED`，无 Provider 充值单号、无确认扣款。**这是失败/拒绝分支的端到端验证，不是成功链路验收。**
- **生产开关默认态**（C）：`accept_new_orders='false'`、`dispatch_new_recharges='false'`、三个 `PROVIDER_*_WRITES_ENABLED` 默认 `false`、`provider_accounts.write_enabled DEFAULT 0`。停单与追踪独立（`poll_existing_orders='true'`、`sync_card_transactions='true'` 默认开）。
- **当前生产实况**（U，关键）：文档层出现时间线不一致——`SINGLE_SOURCE_OF_TRUTH`(08-22) 称生产 Web/Worker/MySQL 正常运行于 `stage3` release；`CURRENT_STATE`(08-24) 称"服务器尚未修好"。两者未在文档内对账。**当前生产 release/迁移/服务/开关的真实值，本窗口无法核验，必须现场只读体检后才能作数，不能沿用旧快照。**

**结论**：核心业务代码与资金安全机制成熟、可测；但整套系统仍停在"代码/隔离测试已验证、生产成功链路未验证"阶段，且当前生产是否可用未知。

---

## 二、已确认业务规则（用户确认，H）

来源 `FINAL_REQUIREMENTS_BASELINE`、`DECISIONS.md`。逐条核对代码后判断"是否已在代码落地"（见第三节）。

1. V1 只做 Plus；目标账号必须是免费账号，已是 Plus 拒绝（D-001/D-022/D-023）。
2. 默认一单一卡，系统不得自动跨订单复用；特殊复用须人工受控+完整审计（D-002/D-035）。
3. 未知外部结果禁止自动重试/换卡/换执行器（D-004）；付款提交后崩溃先对账不重点（D-060）。
4. CDK 代表已付款；可作废，补发靠重新生成；可生成内部测试 CDK 并标记区分（D-034/D-109-测试）。
5. Session 原订单最多换 3 次，72 小时窗口从首次客户可修复错误起算（D-027/D-033）。
6. 库存不足进入等待补卡+通知；自动补卡每次 1 张/每张 $16/每天≤5 张，可配置（D-029）。
7. 卡余额充值优先复用卡台 `POST /cards/{id}/recharge`，稳定幂等键，pending 禁止换键重打（D-026）。
8. 最终成功 = 支付成功 **且** `is_subscription_cancelled=1`；取消未知进入等待/人工，禁止判失败或重付（D-032）。
9. 退款只保留原始交易+人工案件，不自动识别/提醒/提取（D-031）。
10. 备用卡台人工切换，只影响新订单，旧订单保留冻结路线，暂不自动故障转移（D-028/D-089-卡台路线）。
11. Browser 是未来主执行链路（HNSKJ 卡 + ChatGPT 页面直购），复用现有底座；ZZSHU 退出 Browser 方向仅作旧兼容（D-038/D-039）。硬不变量：不重复扣款、付款未知不自动再付、全链路可审计（D-050）。
12. 客户侧只展示客户自身可处理原因；库存/卡余额/Provider 内部问题只在后台（第 4/13 条基线）。

---

## 三、各模块已完成内容（代码/测试级，附证据）

### A. 资金安全核心（最关键，C/T 已验证）
- **单订单唯一资金栅栏**：`recharge-attempt-repository.js:172-181` 在事务内 `SELECT ... funds_risk_state IN ('ACTIVE','UNKNOWN','SETTLED') FOR UPDATE`，命中即 `FUNDS_FENCE_EXISTS`。（C）
- **create_direct 唯一约束**：`026` 迁移用 generated column `recharge_create_attempt_id`（仅 create_direct 非空）+ unique index，一个 attempt 最多一个创建意图。迁移前置校验历史重复会 `SIGNAL 45000` 阻断。（C）
- **派发/写开关双检查**：`recharge-attempt-repository.js:138`（`DISPATCH_DISABLED`）、`:153`（非 Browser 路由 `PROVIDER_WRITE_DISABLED`）。（C）
- **UNKNOWN 锁定**：`markAttemptUnknown` → `SUBMIT_UNKNOWN`/`funds_risk=UNKNOWN`，无自动重试分支。（C）
- **卡片核验时效**：15 分钟 stale → `CARD_CHECK_STALE`（`:161`）。（C）
- **Browser 路由不伪造 Provider 调用**：`:331 if (!isBrowserRoute)` 才写 `provider_calls.create_direct`。（C，对齐 D-068）
- **幂等键绑定授权项**：`recharge-auth-item:${item}`，重试同项幂等，Session 更换后新授权得新键（`:271`）。（C）

### B. 客户充值链路（C 已验证）
- 订单提交 `POST /api/v1/orders`（`order-intake-service` + `order-intake-repository`）：CDK 规范化、Session 校验、Session 密文入库、同 CDK 并发只成一单（T 覆盖）。（C/T）
- 状态查询 `POST /api/v1/orders/status`：内部状态→客户状态映射（`order-status-service.js`）：`CREATED→QUEUED`、`CARD_*/WAITING_FOR_CARD→PROCESSING`、`WAITING_FOR_SESSION→ACTION_REQUIRED`。**库存不足对客户显示 PROCESSING，不伪装成客户错误**；只返回 Session 更换次数/剩余/到期，**不泄露 provider/PAN/CVV/recharge_order_no**。（C）
- Session 更换 `POST /api/v1/orders/session`（`session-replacement-service`）：3 次/72 小时窗口（`025` 迁移）。（C）
- 客户可理解失败消息："当前账号已是 Plus，请更换免费账号 Session"、"Session 无效"。（C）

### C. 卡台与 Provider（C 已验证，真实写未验证）
- `HnskjCardProvider`（`hnskj-card.js`）：`purchaseCard`/`rechargeCard`/`withdraw` 强制 `X-Idempotency-Key`（16–128 字符 `assertIdempotencyKey`）；金额正整数；运行时 Schema 校验（`ProviderSchemaError`）。（C）
- 卡资格 SQL（`card-inventory-eligibility.js`）：`order_id IS NULL` + `NOT EXISTS card_assignment_history`（一卡一单双保险）+ `NOT EXISTS PURCHASE 交易` + `NOT EXISTS 未撤销 refund_cases` + 余额门槛 + 15 分钟同步时效 + 有凭证密文。完全对齐基线第 5 节。（C）
- Provider 写分层门禁：进程级 3 个 env（`config.js:339-341` 默认 false）+ DB `write_enabled`（默认 0）+ 派发开关 + 资金栅栏 + 灰度 Permit。（C）
- 履约路线冻结到订单（`fulfillment_routes`/`orders.fulfillment_route_id`），卡台切换不改旧订单路线（`provider-route-admin-service` + `036` 迁移）。（C）
- ZZSHU（`zzshu-recharge.js`）保留为旧兼容 API 执行器；Browser 新订单不调用。（C，对齐 D-039/D-069-API）

### D. CDK / 订单 / 追溯（C 已验证）
- CDK：生成/批次/下载/状态报告/作废/交付（`cdk-service`+`cdk-delivery-service`，`016/018` 迁移），DB 只存哈希，新码 HMAC + 独立恢复密钥。（C）
- 追溯中心（`traceability-operations-service` + `024` 迁移）：订单备注/标签/客户付款登记；订单详情反查 CDK/邮箱/卡片/Provider/金额/状态。（C）
- 补发（`order-compensation-service`）：仅无卡片、无 Provider 调用、任务明确失败的订单，一次补发同套餐 CDK。（C）
- 取消（`order-cancellation-service`）：仅零直充尝试、无外部调用、卡片合格的订单，事务化关单并释放卡回库存。（C）
- 完整卡号仅受控后台详情展示（近期 commit `8107416` "retain full card number in admin detail" 有意保留）；客户侧与普通日志不落敏感值。（C/H）

### E. Browser 工作线（C/T 隔离验证，真实付款未做且禁止）
- 独立控制面：`browser_dispatch_queue`（`032`）、`browser_execution`/`artifact_vault`/`recovery`（`027/028/031`）、独立 repository，不走 API 的 `SUBMIT_RECHARGE` task 队列——**架构上不阻塞 API 线**。（C）
- 复用现有 `recharge_attempts` 资金栅栏，Browser route 不绑 Provider account、不伪造 `provider_calls`（D-068）。（C）
- WAL/崩溃恢复、租约、加密 artifact vault、人工接管、mock gateway、本地 Playwright mock 集成：大量隔离/本地测试通过（D-059~D-065、D-119~D-121）。（T）
- 并发/soak：`browser-worker-service`/`loop`/`process` 存在；bounded soak（5/10/15/30 分钟）、claim race、多 job/lease、崩溃+DB 重启接管均隔离通过（D-084~D-131）。（T）
- 其他窗口**正在进行**的未提交增强：`browser-dispatch-repository.js` 增加连接获取超时、late-connection 销毁、事务超时、死锁/锁等待/连接丢失的有界重试（`inTransactionWithLockRetry`）——对应 D-090/D-101/D-109~111。本窗口不碰、不提交。（C）

### F. 后端 / 后台 / 运行（C 已验证）
- 后台 API 面（`create-app.js`）：overview / orders(list/search/detail/notes/tags/customer-payment/sync-tx) / alerts / cards(intake discover/validate/accept) / card-stock(threshold/jobs/replenishment) / card-funding-attempts(list/resolve) / provider-routes(list/switch) / operations(order-acceptance) / recharge-permit+authorizations / compensation / cancellation / cdks(generate/batches/download/status/revoke/deliveries) / reconciliation-cases(list/assign/resolve) / browser/runs(list/detail/control) / exports.csv。（C）
- 分层守卫：`requireAdminApi`（登录）、`adminWriteGuards`（写）、`sensitiveAdminGuards`（登录+Origin+step-up+确认词）。资金/CDK/卡台切换/补发/取消/对账/Browser 控制均走 sensitive。（C）
- 通知：Bark 独立投递进程、脱敏、去重、退避重试、DEAD 显式恢复（`023` 迁移，D-045 阶段四）。（C/T）

---

## 四、各模块未完成内容

- **成功链路验收（U，全项目最大缺口）**：符合规则的免费账号成功充值、`is_subscription_cancelled=1` 终态、成功后交易/扣款对账——从未真实验证。
- **新卡付费开通（U）**：真实开卡成功/失败/超时/原幂等键重试——从未验证（历史 PoC 用的是已有库存卡链路）。
- **HNSKJ `/cards/{id}/recharge` 真实写（U）**：适配器+账本+隔离测试已完成，真实 write scope、pending/unknown 对账未验证。
- **SUBMIT_UNKNOWN 真实人工对账路径（U）**：状态机与后台入口有代码，真实 Provider 未知响应下的人工恢复未演练。
- **卡台幂等键重复调用真实行为（U）**：ROADMAP 阶段 2 明确未打勾。
- **退款/余额提取真实样本（U）**：只有原始交易同步+人工案件模型，无真实样本。
- **自动补卡/卡余额充值生产启用（U）**：代码+隔离测试完成，生产未部署/未启用（ROADMAP 阶段 4/5）。
- **特殊人工复用后台入口（U/未建）**：基线第 7 节+ROADMAP 阶段 5 明确"尚无后台受控入口和审计模型"，仅有规则约束"自动禁止复用"。
- **CDK delivery 接后台闭环、Provider 路线切换页部分项（U）**：ROADMAP 阶段 5 未打勾项。
- **Browser 真实付款（U，且硬禁止）**：五阶段停在阶段 1（A 控制面）未最终关闭；A2 高可用拓扑 `NOT_AVAILABLE_IN_TEST_TOPOLOGY`（单 MySQL，D-115）；真实 Session/Checkout/付款需当次确认。
- **200–300 单/天生产压测（U）**：Browser 侧 soak 全为隔离窄范围合成负载，非生产拓扑、非真实并发连接的持续 24h（首轮 24h soak 曾中断失效，D-118）。

---

## 五、各模块之间的数据对齐情况

- **资金账本单一**（C，好）：API 与 Browser 共用 `recharge_attempts`，不建第二套资金账；Browser 不写 `provider_calls.create_direct`。对齐 D-013/D-068。
- **状态合同单一**（C，好）：`order-status.js` 是唯一状态机；客户可见状态由 `order-status-service` 收敛映射，后台看内部全量状态。同源。
- **卡片归属单一**（C，好）：卡资格 SQL 与资金栅栏都以 `cards.order_id`/`card_assignment_history` 为准，一卡一单一致。
- **开关来源单一**（C，好）：`app_settings` + `provider_accounts.write_enabled` + 进程 env，`loadRuntimeSettings` 缺 key 直接抛错（拒绝隐式默认）。
- **潜在不一致（需现场核验，U）**：`SINGLE_SOURCE`(08-22 生产正常) 与 `CURRENT_STATE`(08-24 服务器未修好) 未对账；后台"卡台 active 卡"与"卡台当前 active 卡数"UI 双字段都渲染 `providerActive`（展示重复，`ADMIN_CONSOLE_SIMPLIFICATION` 已记，底层数据未删）。

---

## 六、发现的事实性问题

1. **`DECISIONS.md` 决策 ID 重复（P1，文档完整性）**：`D-069`、`D-089`、`D-109` **各出现两次且内容不同**：
   - D-069 = "Browser SUBMIT_RECHARGE 只建 dispatch job" **且** "API 充值路径不增加独立账号预检"；
   - D-089 = "每个重要节点落盘后自动对抗审查" **且** "Plus 卡台路线人工切换入口"；
   - D-109 = "repository-only 网络故障验证" **且** "可生成内部测试 CDK 并作废"。
   决策账本以 ID 为引用锚点，重复会让"按 ID 核对当前有效决策"产生歧义。建议重编号（不改语义），本窗口未擅自改（属需用户确认的账本编辑）。
2. **时间线冲突未对账（P0 认知风险）**：生产是否可用在两份事实源里不一致，见第一/五节。任何真实动作前必须先现场只读体检，不能沿用任一旧快照。
3. **接单开关单向联动派发开关（P2，语义）**：`admin-operations-service.js:35-40`——"开始接单"强制 `dispatch_new_recharges='true'`；"停止接单"不改派发。不违反"停单≠停追踪"（poll 独立），但与 D-010"三控制面分离"有张力：无独立"接单但不自动派发"UI，需靠 `recharge_dispatch_mode=MANUAL` 隔离。建议确认是否符合运营预期。
4. **Browser worker 无生产进程入口（事实澄清，非缺陷）**：`browser-worker-process/loop/service` 是 v1 代码，但 `scripts/` 无独立进程启动脚本，`package.json` 无对应 start 项。与 D-070/D-071"待进程入口接入"一致——Browser 未注册为生产进程，符合"不接生产"边界。

---

## 七、发现的方向冲突

- **无实质业务方向冲突**。文档层的口径冲突已被 D-128 显式处理（旧 BRFE"阶段1不得进入阶段2"与新主规划"A soak 未关闭 + B 本地 mock 可并行"）。
- **ZZSHU 双重身份需持续留意（H）**：ZZSHU 在 Browser 方向已退出（D-039），但仍是当前 API 执行器的直充实现（`SINGLE_SOURCE` 生产链路图）。这不是冲突，是"API 兼容执行器保留、Browser 不依赖"的既定分工；但描述时必须区分"当前 API 用 ZZSHU"与"Browser 不用 ZZSHU"，否则易误读为矛盾。

---

## 八、发现的遗漏

1. 生产只读体检结论未随 `CURRENT_STATE` 同步刷新（08-24 只说"未修好"，未给 release/迁移/开关现场值）。（U）
2. 特殊人工复用后台入口 + 审计模型缺失（基线承诺项，尚未建）。（U）
3. `SUBMIT_UNKNOWN` 与配置型阻塞（如 `write_enabled=0` 致任务进 DEAD）的**正式后台可审计恢复入口**——`SINGLE_SOURCE` P1 已列，本窗口未在 create-app 路由中看到对应"DEAD 任务恢复"专用 API，可能仍需人工介入。（U，需进一步核 reconciliation/permit 是否覆盖）
4. 卡台账户余额与卡片余额在总览需保持语义分离（`ADMIN_CONSOLE` 已提醒），重构时勿合并成单一库存数字。（H）

---

## 九、可能多余或价值低的内容

- **导航层**（`ADMIN_CONSOLE_SIMPLIFICATION_2026-08-24` 已分析，本窗口复核认同）：`异常队列` 顶层入口实为订单 `REVIEW_REQUIRED` 预设筛选（无独立数据模型），可降为订单内筛选；`资金证据核对`+`卡余额充值`可归入"资金与对账"父导航（**底层状态/审计/开关不可删**）。
- **展示重复**：总览"卡台 active 卡"/"卡台当前 active 卡数"双字段同源 `providerActive`，保留其一。
- **首屏过载**：退款观察、泛化"内部提醒"、低频统计建议移出首屏（不删底层）。
- **强约束**：以上均为 UI 收敛建议，**未做每页 API/DB/权限依赖清单前不得声称"删除无副作用"**；卡台路线、Browser 执行独立导航必须保留。

---

## 十、必须保留的安全和追溯能力（不可因精简而动）

1. 单订单唯一资金栅栏 + create_direct 唯一约束（防重复扣款）。
2. 派发开关 + 三 Provider 写 env + DB write_enabled 分层门禁 + 默认全关。
3. UNKNOWN/付款未知锁定，禁止自动重试/换卡/换执行器。
4. 一卡一单（`order_id IS NULL` + `card_assignment_history` 双保险）与卡资格全条件。
5. HNSKJ 稳定幂等键（开卡/补卡/提取）。
6. 客户侧敏感字段隔离 + 库存不足不伪装成客户错误。
7. 追溯链：CDK↔订单↔卡片↔Provider↔交易↔金额↔最终状态↔取消状态，完整卡号仅受控详情。
8. 敏感操作 step-up（登录+Origin+确认词）。
9. Browser 独立队列 + 复用资金栅栏 + 不伪造 Provider 调用。

---

## 十一、需要实测才能确认的事项（U，只有 P/D 级能关闭）

1. 生产当前 release/迁移/服务/定时器/五类开关现场值（服务器是否已修好）。
2. HNSKJ 卡台升级后只读合同（字段/状态是否漂移）。
3. 符合规则账号的成功充值 + 取消续费确认 + 前后余额/交易对账。
4. 新卡付费开通（成功/失败/超时/原键重试）。
5. `SUBMIT_UNKNOWN` 真实响应与人工对账/恢复。
6. 卡台幂等键重复调用真实行为。
7. 200–300 单/天接近生产拓扑的压测与慢查询/首屏接口基线。
8. Browser 真实 Session/Checkout 只读观察（阶段 C，需仓库外 0600 输入）与后续真实付款（阶段 E，需当次确认）。

---

## 十二、后续动作（P0/P1/P2）

### P0（真实动作前的前置，全为只读/文档，无资金写）
- **P0-1 生产只读体检**：核实 release/迁移/服务/定时器/五类开关现场值，产出 D/P 级快照，刷新 `CURRENT_STATE`；对齐 `SINGLE_SOURCE`(08-22) 与 `CURRENT_STATE`(08-24) 的时间线冲突。
- **P0-2 HNSKJ 只读合同复核**：卡台升级后跑 `provider:read-check`，确认无 Schema 漂移。
- **P0-3 真实单笔测试前置闸门核对**：按 `REAL_E2E_SINGLE_ORDER_TEST_PLAN_2026-08-24` 第二节逐项只读核对（expired_task_leases=0 / uncertain_provider_calls=0 / funds_risk=0 / 无活动 Permit）。

### P1（文档/可回滚，执行前说明、完成后验证）
- **P1-1 修 `DECISIONS.md` 决策 ID 重复**（D-069/D-089/D-109 重编号，保语义，需用户确认后改账本）。
- **P1-2 补 DEAD/配置型阻塞的后台可审计恢复入口**（`SINGLE_SOURCE` P1 遗留）。
- **P1-3 统一进程写开关/DB write_enabled/派发开关/Permit 的状态机文档**，避免配置型阻塞伪装成不可恢复 Provider 失败。

### P2（低优先，非阻塞）
- **P2-1 后台导航收敛**（异常队列降为筛选、资金合并父导航、总览首屏瘦身）——按 `ADMIN_CONSOLE_SIMPLIFICATION` 先做依赖清单再改。
- **P2-2 接单/派发联动语义确认**（是否需要独立"接单不派发"开关）。
- **P2-3 总览展示重复字段合并**（providerActive）。

---

## 十三、不建议修改的稳定核心

`recharge-attempt-repository.js`（资金栅栏与状态机）、`026` 迁移（create_direct 唯一约束）、`card-inventory-eligibility.js`（卡资格）、`order-status.js`（状态机）、`hnskj-card.js`（幂等键+Schema 校验）、`config.js` 写开关默认、`order-status-service.js`（客户状态收敛）。这些经代码+测试验证且承载全部资金安全语义，非必要不动；确需调整先加决策并保留资金硬不变量。

---

## 十四、是否可以进入实施

**结论：可以进入"只读/文档类"实施（P0 + P1），不可进入任何真实资金动作。**

- 允许即刻做：生产只读体检、HNSKJ 只读合同复核、真实单笔前置闸门只读核对、决策账本修订（经确认）、文档补全、UI 收敛的依赖清单。
- 暂不可做：真实开卡/卡余额充值/Plus 充值/退款/余额提取/切换生产卡台/启用 Provider 写/Browser 真实付款——受硬约束 + 当前生产状态未知双重阻断。

---

## 十五、如果不能，明确阻塞原因

**真实资金链路阻塞（U）**：
1. 生产服务器当前状态未知（`CURRENT_STATE`(08-24) 称未修好），无 P/D 级现场证据。
2. 成功充值/新卡开通/HNSKJ 真实写/SUBMIT_UNKNOWN 人工对账/退款/取消续费，全部从未真实验证。
3. 硬约束：未经操作确认不得真实开卡、充值、退款、切卡台、启用 Provider 写。

解除路径：先完成 P0（只读体检 + 只读合同 + 前置闸门核对），再由用户单独确认后按 `REAL_E2E_SINGLE_ORDER_TEST_PLAN` 执行并发 1 的单笔真实测试。

---

## 附录：本窗口独立验证清单（C/T）

| # | 结论 | 等级 | 证据 |
|---|---|---|---|
| 1 | 测试 408/374/0/34 | T | 本窗口 `node --test` |
| 2 | 单订单唯一资金栅栏 | C | `recharge-attempt-repository.js:172-181` |
| 3 | create_direct 唯一约束 + 迁移前置阻断 | C | `migrations/026` |
| 4 | 接单/派发默认关，追踪默认开 | C | `migrations/001:169-172` |
| 5 | 三 Provider 写 env 默认 false + DB write_enabled 默认 0 | C | `config.js:339-341`、`migrations/021:13` |
| 6 | 一卡一单 + 卡资格全条件 | C | `card-inventory-eligibility.js` |
| 7 | HNSKJ 幂等键强制 | C | `hnskj-card.js:115/336/357/393` |
| 8 | UNKNOWN 锁定不重试 | C | `recharge-attempt-repository.js:379-390` |
| 9 | Browser 不伪造 provider_calls | C | `recharge-attempt-repository.js:331` |
| 10 | 客户状态收敛 + 库存不足伪装 PROCESSING + 不泄露敏感 | C | `order-status-service.js:8-12`、grep 无 PAN/CVV/provider 泄露 |
| 11 | 后台 9 模块 API + 敏感 step-up | C | `create-app.js` 路由枚举 |
| 12 | 接单联动派发 | C | `admin-operations-service.js:35-40` |
| 13 | 决策 ID 重复 D-069/D-089/D-109 | C | `DECISIONS.md` |
| 14 | Browser 独立队列不阻塞 API 线 | C | `migrations/032`、独立 repository |

**未产出**：任何 P（生产）/D（只读 DB/网络）级证据——本窗口不接触生产。
