# Browser 自动化 Plus 充值执行交接（2026-08-23）

## 0. 范围与事实等级

本报告只覆盖“未来作为 API 充值之外的 Plus 实际履约执行方式”及其直接服务的订单 attempt、Browser dispatch、Worker 控制壳、会话输入边界和状态记录。普通后台页面测试、截图验证、指纹研究、独立 Session A/B、离线实验和容量压力测试不归类为实际 Browser 充值；它们只在关联处列为前置证据或研究输入。

证据标签：

- **代码验证**：文件中存在实现或约束。
- **模拟/隔离测试**：本地 mock、离线 WAL、隔离 MySQL 或合成 soak。
- **运行时验证**：当前本地进程/数据库状态或真实 HTTP/页面观察。
- **用户确认**：用户已确认的业务规则或方向。
- **历史材料**：旧报告、公开项目、公开指南或聊天历史；不能替代运行证据。
- **未验证**：当前没有可复现证据。

本报告没有生产写入、真实开卡、真实卡充值、真实 Checkout、真实付款或退款操作。

## 1. 当前目标和范围

目标是增加一条 Browser Plus 履约执行通道：复用现有订单、CDK、Session 更换、卡片库存、资金栅栏、`recharge_attempts`、审计、对账和后台；Browser Worker 将来在隔离 BrowserContext 中完成账号预检、购买 Plus、确认 Plus 激活、取消自动续费和结果记录。

Browser 是执行器，不是新业务系统；不新建订单、CDK、卡池、Provider 账或资金账。V1 只做 Plus。运营后台是统一中枢，API 与 Browser 是两种充值执行器；未来重点是 Browser，API 在 Browser 真实履约和迁移验收前保留为兼容执行器。

当前真实范围仍停在无付款开发/验证：控制面、队列、Worker 控制壳、本地 BrowserContext mock、只读 manifest 前置。真实外部 Browser、真实 Session、菲律宾网络、Checkout 和付款均未接入。

## 2. 实际存在的直接实现

### 2.1 订单 attempt、Browser route 和队列

- `v1/src/workers/workflow-handlers.js`：`SUBMIT_RECHARGE` 在 `attempt.executorKind === 'BROWSER'` 时只调用 `browserDispatchRepository.enqueue()`，保存 `attemptId/orderId/executorProfileId` 引用后返回；不调用 ZZSHU Provider 创建订单。
- `v1/src/db/repositories/recharge-attempt-repository.js`：现有唯一 `recharge_attempts` 账本仓储。
- `v1/src/db/repositories/browser-dispatch-repository.js`：Browser durable queue 的 enqueue、`SKIP LOCKED` claim、heartbeat、完成、租约丢失和数据库瞬时错误有界重试。
- `v1/migrations/027_browser_execution_control_plane.sql`：`executor_profiles`、`browser_runs`、`browser_checkpoints`、`browser_operations`、`payment_permits`、`checkout_artifacts` 等控制面表。
- `v1/migrations/031_browser_post_payment_lifecycle.sql`：Plus 激活/取消续费的 post-payment 状态和观察记录。
- `v1/migrations/032_browser_dispatch_queue.sql`：`browser_dispatch_jobs`；任务载荷只允许引用，不接受 Session、卡凭据、Checkout authority 或明文密钥。

### 2.2 Worker 和运行时控制壳

- `v1/src/services/browser-worker-service.js`：claim 后创建/绑定 run；每个 runtime action 前 heartbeat 和 recovery guard；租约丢失、`RECONCILE_ONLY`、终态或人工冻结时停止 runtime 动作。
- `v1/src/services/browser-worker-loop.js`：idle/claim/execute/fail-stop 循环。
- `v1/src/services/browser-worker-process.js`：Worker process wrapper，但明确只允许 `LOCAL_MOCK`，非 mock runtime 返回 `REAL_RUNTIME_NOT_APPROVED`。
- `v1/src/worker.js`：现有 API/业务 Worker 入口；它能把 Browser attempt 入队，但不是实际 Browser 页面 Worker 入口。
- `v1/test-support/browser-worker-process-child.js`、`v1/test-support/browser-worker-mysql-crash-recovery*.js`：隔离测试/故障夹具，不是生产启动器。

### 2.3 本地 Browser mock 与实验代码（不是充值链路）

- `browser-poc/mock-browser-server.js`、`browser-poc/local-mock-page-adapter.js`：本地 Playwright mock 页面/iframe/popup。
- `browser-poc/experiment-core.js`、`experiment-wal.js`、`wal-backed-experiment.js`、`mock-gateway.js`、离线 runner：赛马、WAL、模拟付款和恢复合同的离线实现；不含真实 Session、真实卡或 hosted URL。
- `browser-poc/session-loader.js`、`session-ab-poc.js`、`session-ab-core.js`：Session 研究/装载前置工具；尚未接入订单 Browser Worker 的真实执行链。
- `browser-poc/checkout-link-core.js`：Checkout 提链研究/合同核心；当前不创建真实 Checkout。

### 2.4 manifest

- `browser-poc/manifests/non-ph-functional-baseline-2026-08-22.json`：`AUTH_READ_ONLY`、本地 Chromium、临时 Context、无代理、禁止 Checkout/payment writes/PH 晋级。
- `browser-poc/manifests/non-ph-us-readonly-2026-08-23.json`：历史 `NON_PH_US` 实验材料；只读、禁止 Checkout/payment writes/PH 晋级。用户已确认不再考虑美区 VPN，因此它不属于当前主线、对照或晋级候选，不删除历史文件。

## 3. 测试、脚本和产物

直接相关测试包括：

- `v1/test/browser-dispatch-repository.test.js`
- `v1/test/browser-execution-repository.test.js`
- `v1/test/browser-execution-mysql-integration.test.js`
- `v1/test/browser-worker-service.test.js`
- `v1/test/browser-worker-loop.test.js`
- `v1/test/browser-worker-process.test.js`
- `v1/test/browser-worker-process-smoke.test.js`
- `v1/test/browser-worker-local-mock-integration.test.js`
- `v1/test/browser-recovery-*.test.js`
- `test/browser-local-mock-page.test.js`、`test/browser-nonph-manifest.test.js`及 `test/browser-poc` 下的离线实验测试。

入口脚本：

- `npm run test:browser-poc`：本地 Browser POC 全量测试入口。
- `node --test test/browser-nonph-manifest.test.js v1/test/browser-worker-local-mock-integration.test.js`：只读 manifest + 本地 Worker 集成回归，最近一次 6/6 通过。
- `v1/test-support/browser-mysql-bounded-soak.js`：隔离 MySQL dispatch/lease/heartbeat soak。
- `v1/test-support/browser-detached-soak-runner.js`：启动 detached 24 小时合成 soak；当前运行 PID `48157`，参数为 1 job、2 worker、240000ms 间隔、600s lease。

当前产物：

- `artifacts/browser-soak/24h-2026-08-22T18-45-39-769Z.json`
- `artifacts/browser-soak/24h-2026-08-22T18-45-39-769Z.log`

截至本交接时，PID 48157 仍运行中；最终 JSON、残留和资源结果尚未产生，不能写成 A1 通过。

## 4. 启动方式和依赖

### 当前可运行方式

本地 POC 使用 Node.js、Playwright/Vitest 和本地 mock 页面；Browser process wrapper 只接受 `runtimeMode=LOCAL_MOCK`。隔离 MySQL soak 使用 `TEST_DATABASE_URL`，当前 detached 进程实际使用动态隔离端口 `54741`。

现有 `v1/src/worker.js` 还依赖业务 Worker 配置（数据库、HNSKJ 读/写开关、ZZSHU 兼容配置、Session 加密等），但该入口没有启动真实 Browser runtime。

### 尚不存在的生产启动方式

没有真实 Browser Worker CLI、生产 profile/network resolver、真实页面 adapter、远程人工同 Context 通道或生产部署配置。不能用 `v1/src/worker.js` 的启动方式推断 Browser 已生产接入。

## 5. 与订单、Session、卡片、Provider 等系统的实际接入状态

| 能力 | 当前事实 | 证据等级 |
|---|---|---|
| CDK | Browser 规划复用现有 CDK→订单链；当前 soak 使用合成 CDK 夹具；没有正式客户 CDK→Browser 成功订单验收 | 代码/模拟测试；真实未验证 |
| 订单 | Browser dispatch/attempt 表有 `order_id` 外键和映射；没有真实订单页面履约闭环 | 代码/隔离测试；运行未验证 |
| Session | Session Loader/安全收件箱和 Session A/B 是独立前置研究；Browser Worker 当前不装载真实 Session | 代码/历史观察；实际履约未接入 |
| Session 更换 | 原订单最多 3 次、72 小时规则由现有订单系统负责；Browser 只复用该结果 | 用户确认/既有代码；Browser 真实联调未验证 |
| 卡片 | Browser attempt 创建前要求订单已有卡；卡库存、HNSKJ 开卡/补余额属于现有卡片服务；Browser 页面 adapter 尚未接收/填写真实卡 | 代码合同；真实未验证 |
| Worker | 业务 Worker 可把 Browser attempt 入 durable queue；独立 Browser Worker 目前仅 LOCAL_MOCK | 代码/模拟测试 |
| 队列 | `browser_dispatch_jobs` 已有唯一 attempt、claim、lease、heartbeat、完成和残留清理 | 代码/隔离 MySQL/soak |
| Provider | Browser route 不要求 Provider account，不写伪造 `provider_calls.create_direct`；现有 ZZSHU Provider 仍是 API/旧系统兼容路径 | 代码/用户确认 |
| 卡片交易 | 现有卡交易同步/对账代码存在；Browser 页面付款后的真实卡交易观察尚未接入 | 代码；真实未验证 |
| 失败处理 | 本地可处理 lease loss、页面漂移、人工冻结、payment unknown 的 fail-closed 控制；真实页面挑战/3DS/验证码恢复未接入 | 模拟测试/合同 |
| 资金账本 | Browser 复用唯一 `recharge_attempts`、资金风险状态和 permit；没有真实资金写入验证 | 代码/隔离 MySQL |
| 自动续费取消 | post-payment 状态和 repository 方法已存在；没有真实页面取消动作和真实账号确认 | 代码/模拟/隔离测试；真实未验证 |

## 6. 当前完成、未完成、阻塞和未验证

### 已完成（代码或模拟/隔离证据）

- Browser route 的 attempt→dispatch 引用映射。
- dispatch 唯一性、`SKIP LOCKED` claim、heartbeat、租约失效和数据库短退避重试。
- run/checkpoint/operation/permit、资金未知锁定和 reconcile-only 控制。
- artifact vault/资源租约/人工控制合同的离线和隔离 MySQL 实现（不代表生产密钥部署）。
- 本地 Playwright mock：导航、页面漂移 fail-closed、租约丢失中止、popup、多页面、人工冻结；最近集成 4/4，manifest+集成 6/6。
- 赛马合同的离线 route 预选、cohort 约束和 fallback 规则。

### 未完成

- 真实 Browser Worker 主进程和真实 Playwright runtime。
- 真实 Session 装载到订单 Browser run。
- 外部页面 adapter、页面定位签名、实际 Checkout/付款前预检。
- 真实卡片输入、付款、Plus 激活观察、取消续费动作。
- 人工同 Context 远程查看/操作通道。
- Browser attempt 与完整客户订单/CDK/卡交易/对账闭环验收。
- 并发 Browser 页面队列、实际多 Worker 资源预算和生产部署。

### 当前阻塞

- A1 24 小时 detached soak 未结束；A2 主从/故障转移没有测试拓扑。
- C 真实只读观察需要仓库外 `0600` Session；当前没有可用于本批的事实输入。
- D 需要独立 PH manifest/cohort 和菲律宾出口；当前未执行。
- E 需要 A-D 退出证据及用户当次明确确认。

### 未验证

真实账号登录、真实页面可达性、菲律宾网络下 Session 连续性、价格/税费/支付可用性、账号风控概率、Checkout artifact 实际生命周期、真实资金结果、Plus/取消确认、生产容量和高可用拓扑。

## 7. 当前证据清单

- **代码证据**：上述 migrations、repositories、services、workflow handler 和 tests 中的约束。
- **模拟测试证据**：`npm run test:browser-poc` 历史 11 files/77 tests 全通过；最近 manifest+Worker 6/6 通过；这些都不含真实付款。
- **隔离 MySQL 证据**：claim race、lease、连接恢复、队列积压、故障注入和 bounded soak 报告；当前单 MySQL 容器不能证明生产 HA。
- **运行时证据**：detached soak PID `48157` 仍在运行；当前只有 `CLAIMED` 运行中状态，无最终 24h 结论。
- **历史/研究证据**：Session Cookie A/B、非 PH 页面 403、公开 GitHub/X/市场研究；只能作为研究输入或网络事实，不能升级为付款/风控结论。
- **生产证据**：没有。

## 8. 本窗口未提交工作区文件

用户已明确确认：本窗口期间涉及 Browser 自动化充值的代码、测试、脚本、manifest、产物和文档，均由本窗口产生或维护。该用户确认是本条归属结论的依据；Git 状态只用于确认是否已提交，不再作为 Browser 文件作者归属的否定证据。

本窗口维护的 Browser 相关未提交内容包括：

- 已修改：`v1/src/db/repositories/browser-dispatch-repository.js`、`v1/test/browser-dispatch-repository.test.js`、`v1/test/browser-worker-service.test.js`，以及 Browser 状态/决策/接班/规划文档；
- 已新增或维护：Browser Worker service/loop/process 及其测试、Browser dispatch/recovery/execution 相关测试夹具、`browser-poc` 本地 mock/实验代码、两份 NON_PH manifest、soak/故障测试脚本与 `artifacts/browser-soak` 产物、Browser 合同/阶段报告/规划文档；
- 本报告文件：`docs/archive/2026-08/BROWSER_AUTOMATION_HANDOFF_2026-08-23.md`。

项目中其他非 Browser 的未提交文件不在本交接范围内。不得据此清理、移动、删除或重命名任何文件；完整机器清单仍以 `git status --short` 为准。

## 9. 正在使用与禁止破坏的文件

以下是当前 Browser 运行/接班必需的文件，禁止在未确认前移动、删除或重命名：

- `v1/migrations/027_browser_execution_control_plane.sql`、`031_browser_post_payment_lifecycle.sql`、`032_browser_dispatch_queue.sql`；
- `v1/src/db/repositories/browser-dispatch-repository.js`、`browser-execution-repository.js`、`browser-recovery-repository.js`、`recharge-attempt-repository.js`；
- `v1/src/services/browser-worker-service.js`、`browser-worker-loop.js`、`browser-worker-process.js`；
- `v1/src/workers/workflow-handlers.js`；
- `browser-poc/manifests/*.json`；
- `v1/test-support/browser-mysql-bounded-soak.js`、`browser-detached-soak-runner.js`及对应测试；
- `docs/archive/2026-08/BROWSER_CURRENT_STATUS_2026-08-22.md`、`docs/archive/2026-08/BRFE_HANDOFF_2026-08-22.md`、当前 BRFE 主规划/合同/决策文件。

这些文件的“禁止破坏”是项目交接纪律，不是 Git 文件系统锁；任何迁移或重构必须先更新引用和事实源。

## 10. 外部依赖和固定状态

- 工作目录：`/Users/lemon/code/AI充值业务`。
- Node.js、npm 依赖、Playwright/Vitest；实际版本以本机 `package-lock`/运行环境为准。
- Browser soak 依赖隔离 MySQL `pojia_test` 和运行时 `TEST_DATABASE_URL`；当前 detached 进程环境中是动态端口 `54741`，不可写死为旧端口。
- 真实只读观察未来依赖仓库外、权限 `0600` 的 Session 输入；Session 不应进入仓库、任务 JSON、普通日志或本报告。
- PH 阶段未来依赖单独的菲律宾出口证明和新 manifest/cohort；当前没有该状态。当前主线不再依赖或推进 `NON_PH_US`。
- 不依赖其他聊天窗口的隐含上下文；依赖的是仓库文件和当前 detached 进程/数据库状态。
- 不存在已接入的生产浏览器 Cookie、云 Profile、长期浏览器状态或真实付款浏览器状态。

## 11. 与主项目规则逐条对照

| 规则 | 状态 | 证据/说明 |
|---|---|---|
| V1 只做 Plus | 已实现/用户确认 | Browser 状态和目标只定义 Plus；无 Pro 实现 |
| 目标已是 Plus 时不能充值 | 代码/规划已实现，真实 Browser 未验证 | 订单资格/Session 恢复规则存在；真实页面预检未接 |
| 运营后台中枢；API 与 Browser 为共用底座的两种执行器，未来重点为 Browser | 已确认架构；Browser 真实履约未验证 | API Worker 仍是现有入口；Browser 仅在 BROWSER attempt 分支入队，不能据此宣称真实履约已完成 |
| Session 可在原订单更换，最多 3 次 | 既有订单代码/用户确认；Browser 联调未验证 | Browser 未自行实现替换规则 |
| 卡台未来可替换，旧订单必须保留 | 规划/既有路线规则 | Browser route/profile 版本可冻结；真实卡台切换未联调 |
| 已消费或已绑定卡原则上不复用 | 既有卡片规则/代码；Browser 真实未验证 | Browser attempt 只要求已有分配卡；页面付款未发生 |
| 库存不足进入等待补卡 | 既有订单/卡片代码；Browser 联调未验证 | Browser 不另建库存逻辑 |
| 成功必须确认 Plus 且自动续费已取消 | 代码状态/隔离测试；真实未验证 | `browser_post_payment_observations` 和终态方法存在，无真实页面动作 |
| 订单、CDK、卡片、Provider、交易、失败信息可追溯 | 结构/规划已实现，端到端真实未验证 | 外键、attempt、run/checkpoint/audit 结构存在；无真实客户闭环 |
| 生产写入、开卡、充值、付款、退款未经确认不得执行 | 已实现/当前运行未执行 | Browser process 只允许 LOCAL_MOCK；当前无生产写开关/付款 |

## 12. 冲突、需要确认和下一可执行项

### 已发现冲突

1. 旧 Browser roadmap/handoff 曾写“阶段 1 未关闭，不进入阶段 2”；当前事实是 A1 长 soak 与 B 本地无付款子闸门可并行。旧文档不能覆盖当前主规划。
2. 24h soak 历史文档曾记录另一组参数；当前实际 detached 参数已按 PID/命令修正为 1 job/2 worker/240s/600s。
3. 单 MySQL 测试拓扑不能证明主从/故障转移；该项是未验证，不是通过或失败的生产结论。
4. 旧规划曾把 `NON_PH_US` 作为可选观察 cohort；用户最新确认已将主线收敛为 PH-only。US manifest/结果仅保留历史，不得继续推进或外推 PH。

### 需要用户确认的事项

- 提供仓库外 `0600` 测试 Session 后，是否启动 C 阶段真实只读观察（不创建 Checkout、不付款）。
- 未来进入 PH cohort、Checkout 创建或任何真实资金动作前，必须重新进行当次明确确认。

### 下一可执行项

1. 等待并核验 PID `48157` 的 24h soak 完整结果、独立残留、资源指标和对抗式审查。
2. 在没有 Session 前继续保持 C 只读观察器/manifest 前置，不伪造真实观察。
3. A-D 证据全部满足且用户当次确认前，不启动真实 Browser 充值。

## 13. 交接结论

当前仓库拥有 Browser 充值的控制面骨架、唯一 attempt/资金状态映射、队列/租约/Worker 控制壳和本地 mock 验证；没有实际可运行的真实 Plus 浏览器充值执行器。下一模型必须把它接着做成真实页面的非付款观察，再经过 PH cohort 和单独确认，不能把现有代码或测试描述成真实充值已完成。
