# Browser 当前状态（2026-08-25）

## 事实快照

| 项目 | 当前事实 |
| --- | --- |
| worktree | `/Users/lemon/.codex/worktrees/9128/AI充值业务` |
| 分支 | `codex/browser` |
| 当前基线 | `599b130` (`merge(browser): add worker readiness checks`)；本轮独立 Worker 提交见 `git log -1` |
| 上一文档交接提交 | `7855390` (`docs(browser): record shared runtime handoff`) |
| 当前阶段 | F1：独立 production-readonly Browser Worker + systemd 模板已完成，并在临时 MySQL 8.4 + 系统 Google Chrome 上通过正式 CLI 非付款闭环 |
| 跟踪改动 | 无 |
| 未跟踪改动 | `artifacts/browser-checkout-observe/`（历史运行产物，不修改、不提交） |
| Browser MVP | 共享 dispatch/run/resource lease、正式状态合同、服务端 payment permit 边界、付款前安全退出、独立 Worker 进程和 systemd 边界已有；真实 Session/卡材料 production provider、付款 executor 和付款后三方对账未完成 |
| 生产/真实付款 | 未接入、未执行 |

## 当前阶段

阶段 F0：已把 Browser PoC 接到正式共享 MySQL 仓储合同，并新增显式确认、强制只读的 production-shaped Worker composition。最新端到端路径为：共享 dispatch claim → `browser_run`/资源租约 → 本地 Browser fixture → `abortBeforePayment()`；最终无付款调用、无活动 permit、无资金 fence 和资源租约残留。这仍是隔离环境验证，不是生产 Worker 验收。

## 本分支已验证

- 旧 v1 隔离边界、Worker runtime、Provider PoC 定向测试：8/8 通过。
- 全量 v1 测试：75 pass；3 个测试文件因缺少 `express`/`mysql2` 启动失败，结果不能记为全量通过。
- 旧 Browser PoC JSON 产物存在于 `artifacts/browser-poc/`，尚未纳入当前分支追踪。
- `browser-mvp` contract tests：4/4 通过；`node --check`：通过。
- `FileDispatchStore` 并发/租约测试：3/3 通过（总测试 7/7）。
- 本地 Chromium BrowserContext/执行器测试：4/4 通过（总测试 11/11）；漂移、租约丢失、冻结、超时均 fail-closed。
- WAL/重启/reconcile-only 测试：3/3 通过（总测试 14/14）；截断/篡改均阻断恢复。
- 10 分钟 soak：601439ms、5328/5328 完成、重复 0、错误 0、残留 0、WAL 15984 条；报告位于 `/var/folders/vv/y6273_2s7n98r55m2rc96p_w0000gn/T/browser-mvp-soak-SOtfzq/report.json`。
- 共享合同只读适配器与 SessionProvider 合同测试：6/6 通过（总测试 20/20）；active permit 和敏感源字段均拒绝，Session 仅保留 opaque ref/lease 预留。
- 最新 `npm --prefix browser-mvp test`：**71 tests / 70 passed / 1 skipped / 0 failed**；跳过项仅为未设置 `TEST_DATABASE_URL` 的隔离 MySQL composition 测试。`npm --prefix browser-mvp run check`、`git diff --check` 通过。
- 使用全新临时 `mysql:8.4`、完整执行 `001–037` migrations 后，`TEST_DATABASE_URL=... node --test browser-mvp/test/shared-dry-run-mysql-integration.test.js`：**1/1 passed**；测试后容器已删除。
- 正式非付款 composition 只在确认词精确匹配、`browser_payment_writes_enabled=false`、`manifest.allowWrites=false` 时运行；不含 payment submitter，并要求注入跨订单稳定的账号 key resolver，以保持同账号资源互斥。
- 隔离 MySQL 最终状态已核实：order=`CARD_READY`、attempt/funds=`CLEARED`、run=`FAILED_SAFE`、dispatch=`CANCELLED`、活动 permits=0、`PAYMENT_SUBMIT` operations=0、未释放资源租约=0。
- 真实上号器 `1.1.1` popup 可打开；长 Session 拆成 2 个 NextAuth Cookie 分块，ChatGPT 页面打开，`/api/auth/session` HTTP 200，三项身份摘要全部匹配。
- 已真实复现并修复新标签页先发出 `about:blank` 导致 adapter 假失败的竞态；现等待 URL 到达 `https://chatgpt.com` 后才报告成功。
- 真实 Checkout 页面已观察：`Plus`、`USD 20.00`、税费 `0.00`、payment form/submit/card fields 均存在；Stripe Payment Page init HTTP 200。
- `CheckoutObserver` 已从 fixture-only 选择器修正为可识别真实 ChatGPT/Stripe DOM；该历史切片提交 `4004741` 当时为 **48/48 passed**，当前累计结果见上方 **53/53**。
- Checkout Navigation 已接入执行器；问卷在 Plus 点击前/后出现、首页 hydration 和 Stripe iframe 延迟加载均有 fail-closed 处理。
- fixture 卡材料非付款切片已接入执行器：durable card lease → Stripe 安全字段填充 → 失租约停止 → 已写字段清理；测试验证 `fieldsFilled=3`、`fieldsCleared=3`、`submitCalls=0`，材料 source 只读取 1 次。
- 卡材料 lease 在每个字段前都会再次校验；新增 expiry 回归证明租约到期时停止下一字段并清理已写字段。
- `HnskjCardMaterialSource` 已在捕获 provider 响应 fixture 中接入该填充闭环；显式使用 `providerCardRef`，provider 调用次数为 1，错误映射仍 fail-closed。
- HNSKJ 卡材料映射现拒绝过期年份，与非 Browser `mapCardCredentials()` 的已核对口径一致；未改变任何卡台写路径。
- 已新增待统筹确认的上游合同冻结清单：`docs/browser-research/browser-upstream-contract-freeze-checklist-2026-08-26.md`；它记录当前 Browser adapter 的最小字段和待确认决策，不等于共享 schema 已冻结。

## 本分支未验证

- 生产数据库/部署配置下的真实 Browser Worker 注册、claim/heartbeat 和 Chrome dry-run；
- 生产 artifact vault 与真实账号/订单/卡片/Checkout 资源租约恢复；
- 真实 HNSKJ 只读卡材料、真实 Checkout 填卡、付款 executor；
- Plus 权益、订阅状态、卡台扣款的付款后三方对账；
- 指纹浏览器 runtime、200–300 单/日容量和生产高可用拓扑。

## 暂停条件

- 不把其他 worktree/分支的 commit 当成本分支事实；
- 不删除或覆盖 `.playwright-cli/`、`artifacts/`；
- 不修改非 Browser 共享核心、生产 release 或共享事实源；
- 不执行真实付款、开卡、卡余额充值或生产 Browser 写入。

## 下一步

由统筹窗口提供隔离或预生产的真实 Worker 配置与非敏感测试订单后，运行一次 **真实 Worker/Google Chrome 的只读 dry-run**，继续保持 `browser_payment_writes_enabled=false`、卡台写开关关闭、无 card fill、无 submit。通过后再单独设计真实卡材料与付款闸门验收；首次真实付款必须另行确认。

## M7 历史隔离 MySQL 只读合同（已被 2026-08-27 正式共享接线取代）

以下记录是当时的阶段事实，仅保留用于追溯；当前 adapter 已不再依赖 `browser_upstream_ready_projection`，最新事实见文末 2026-08-27 两节。

- 新增 `browser-mvp/src/mysql-upstream-adapter.js`：使用参数化单次 SELECT，仅读取统筹层冻结的 `browser_upstream_ready_projection` 视图字段；无写方法、无凭据列、无 Provider 调用。
- `rowToProjection()` 只生成 Browser 所需的订单/attempt/profile/cardRef/routeRef/readiness/sessionRef/auditRef；任何凭据形状列直接拒绝。
- 共享状态 `PREPARED` 尚未被自动翻译为 Browser `PENDING`；adapter 会拒绝该行并暴露合同未冻结问题，避免静默改变状态语义。
- 当前本地没有 MySQL 实例，且共享 worktree 尚未提供该视图，所以未做真实数据库连接验证；仅完成 fake mysql2-like pool 的合同测试。
- `npm --prefix browser-mvp test`：**27/27 passed**；`npm --prefix browser-mvp run check`：通过；`git diff --check`：通过。

## 2026-08-26 卡台与非 Browser 事实补充

- 已按代码和隔离测试核实 HNSKJ 卡台的开卡、既有卡补余额、卡片就绪和库存接管语义；详见 `docs/browser-research/nonbrowser-card-funding-and-recharge-map-2026-08-26.md`。
- 非 Browser worktree 的卡片补余额实现属于 `card_funding_attempts` 资金动作，不等于 Browser 的 Plus `recharge_attempt`；当前 Browser 分支未接入它。
- 用户已确认 Browser 的上游是卡台 API + 运营后台；当前 worktree 仍无共享 MySQL adapter、真实卡片引用接线、真实 Session provider、Checkout artifact 或支付 permit。
- 本轮没有修改非 Browser 共享核心、没有调用卡台写接口、没有执行真实付款。
- 调用策略：卡台/Provider 读取改为快照复用、关键阶段读取、递增轮询；安全状态保留，不以删状态换取少调用。

## 2026-08-26 上游非付款接线切片

- 新增 `browser-mvp/src/shared-contract-adapter.js` 的 `projectUpstreamBrowserJob()`：只接受 `cardRef`、`routeRef`、`providerAccountRef` 和带有效期的 `cardReadyEvidence`，校验卡片/路线匹配、库存为 `AVAILABLE`、路线为 `ACTIVE/BROWSER`；不读取或复制 PAN/CVV/Session/API key。
- 新增 `browser-mvp/src/nonpayment-simulation.js`：把上游投影送入 dispatch、claim、隔离 BrowserContext 和证据 sink；明确不提供支付提交能力。
- 新增 `browser-mvp/test/upstream-simulation.test.js`：投影拒绝过期/错配/非 Browser 路线，并验证非付款闭环。
- 本轮 Browser 测试从 20/20 增至 **23/23**；`npm --prefix browser-mvp run check` 通过。
- 这仍是本地合成上游投影，不是 MySQL 生产 adapter，不是真实 Session/Checkout，也不是付款验证。

## Session 上号器与指纹运行时事实修正

- 现有上号器是本地 Chromium MV3 Cookie 写入扩展，不是 API、Session broker、账号验证器或指纹浏览器；它只证明 Cookie 已写入，不证明服务器接受了正确账号。
- 旧项目可复用的真实能力是 Cookie 解析/分块、真实 Session API/UI 探针、独立 Context、代理、locale/timezone 和 Browser Pool；旧 auth overlay/Bearer/localStorage 伪造默认禁止。
- 当前没有已接入的商业指纹浏览器。`playwright-extra + puppeteer-extra-plugin-stealth` 只是现有运行时增强；`ANTIDETECT_LOCAL_PROFILE` 保留为候选 lane，不能把“指纹分数”当成功证据。
- 详细证据：`docs/browser-research/session-loader-and-fingerprint-runtime-facts-2026-08-26.md`。

## MVP 运行时决策（用户已确认）

- 上号器能力是 MVP 必需能力：没有 Session Bootstrap 就无法完整进入账号和走完一单；现有扩展只是第一种输入/注入实现，不是唯一核心。
- 指纹浏览器应进入 MVP：至少用一个本地候选完成一次非付款/模拟付款闭环；它通过可替换 `BrowserIdentityRuntime` 接入，不绑定订单/资金/审计核心。
- 禁止云 Profile、云同步、第三方 Session 托管和真实付款；必须验证 Profile、代理、Session、Worker 绑定、服务器账号身份和失租约清理。
- 具体指纹浏览器产品/安装包尚未提供，故尚未安装、尚未做真实 Session 验证；当前代码仍不能宣称完整业务 MVP。

## 指纹浏览器市场评估（2026-08-26）

- 已完成厂商官方文档、GitHub API 示例和社区线索检索；详见 `docs/browser-research/fingerprint-browser-market-review-2026-08-26.md`。
- 首选：Kameleo local profile + Chroma/Chrome fingerprint + Local API；次选 Multilogin Mimic local storage；第三候选 AdsPower Local API；GoLogin 暂不进入首轮（公开开发入口偏 Cloud Browser）。
- 系统 Google Chrome 保留为 control lane；指纹浏览器只作为可替换 `BrowserIdentityRuntime`。两条 lane 共享同一订单/Session/证据合同，不共享可变 Profile。
- Kameleo 官方要求一 Profile 一 BrowserContext，并不建议叠加 `playwright-extra`；如果安装验证通过，Browser MVP 不应继续在 Kameleo 上叠加当前 StealthPlugin。
- 当前尚未安装任何指纹浏览器，尚未进行真实 Session/Checkout/付款验证；以上只是能力匹配推荐。

## 关键动作提醒（运营/审计可见性）

后续任何会产生扣款、冻结或消费的动作，必须记录并可在后台追溯：动作类型、provider account、cardRef/card ID、order/attempt/browser run、幂等键、provider call ID、动作前余额、预计/实际扣款、手续费、动作后余额、外部引用和对账状态。卡台账户余额、卡片余额、卡片补余额、Plus 实际消费金额分栏展示，不能合并成一个金额。M6 仅有 `intent/checkpoint` 观察证据，`submitCalls=0`，无付款副作用。

## 2026-08-26 MVP 范围再收敛

- 用户确认将 MVP 收敛为“核心真实付款纵向切片”，而不是先建设完整生产平台。
- 第一条链路优先使用 Google Chrome 独立 Profile：卡台已就绪 Visa 卡 → Session Bootstrap/账号核验 → Checkout → 真实付款 → 订阅权益与卡台交易核对 → 最小审计与清理。
- 指纹浏览器保留为并行兼容性 Spike，不阻塞第一条 Chrome 真实纵向切片；多机调度、完整后台、复杂 Artifact Vault、多 Provider fallback 和容量压测后移。
- 真实付款采用 `1 笔 → 2–3 笔受控连续` 闸门；首次真实付款提交前仍需单独确认，当前生产付款写开关保持关闭。
- 长期 Browser 能力路线图已由用户于 2026-08-26 确认冻结，见 `docs/browser-research/browser-automation-future-roadmap-2026-08-26.md`。

## 2026-08-26 F0 实施切片

- 新增 `browser-mvp/src/chrome-control-runtime.js`：系统 Google Chrome 独立 persistent Profile control lane；通过 `profileRef` 派生隔离目录，默认 headless、只读、关闭后清理上下文。
- 新增 `browser-mvp/src/session-bootstrap.js`：受控 Cookie source → opaque session lease → BrowserContext 注入；普通事件只记录 session digest 和 Cookie 数量，Session 原文不出边界。
- `BrowserExecutionService` 已接入 Session Bootstrap 前置；有 `sessionRef` 但没有 provider 时 fail-closed。
- 扩展 `CHROME_CONTROL`/`CHECKOUT_OBSERVE` 合同，但 `allowWrites` 仍强制为 false；没有 Checkout 提交和真实付款能力。
- 新增 Chrome runtime、Session Bootstrap 和 executor 集成测试；`npm --prefix browser-mvp run check` 通过，`npm --prefix browser-mvp test` **32/32 passed**。
- 本切片没有调用真实 Session、卡台写接口、Checkout 或付款；下一步是把卡台只读就绪卡投影与真实测试 Session 身份核对接入 Chrome lane。

## 2026-08-26 Session 身份与 Checkout 观察切片

- 新增 `browser-mvp/src/session-identity-probe.js`：在页面同源调用 `/api/auth/session`，只返回身份 digest/HTTP 状态，不返回原始 Session JSON；身份不匹配 fail-closed。
- 新增 `browser-mvp/src/checkout-observer.js`：只读提取套餐、币种、金额和付款表单是否存在，明确 `submitCalls=0`，不点击、不提交。
- `BrowserExecutionService` 已支持可选 `metadata.sessionIdentity` 和 `metadata.checkoutContract`；配置后会在页面签名后执行身份核对和 Checkout 观察。
- 新增本地 HTTP/Browser fixture，验证 `/api/auth/session` 身份匹配/不匹配和 Checkout 摘要读取；`npm --prefix browser-mvp test` **34/34 passed**，`npm --prefix browser-mvp run check` 通过。
- 仍未连接真实测试 Session、目标 ChatGPT Checkout、卡台交易或任何付款写接口；本切片只完成可运行的前置观察能力。

## 2026-08-26 真实 Session 首次观察

- 用户提供的 Session JSON 已在本地临时 Profile 做了一次 Chrome control lane 观察；Session token 按 NextAuth 分块注入成功（仅核对 Cookie 名称，不记录值）。
- `https://chatgpt.com/` 和同源 `/api/auth/session` 均返回 HTTP 403，页面标题为 `请稍候…`，同时出现 `__cf_bm`，运行被 Cloudflare/人机验证页面拦截。
- 该结果不能证明 Session 失效或账号不匹配；真实身份、Checkout 和订阅权益仍未验证。
- 临时 Profile 已删除；未调用卡台写接口、Checkout 提交或付款。
- 详细记录：`docs/browser-research/real-session-observation-2026-08-26.md`。

### 上号器使用事实纠正

- 本次真实 Session 观察**没有启动或操作 `/Users/lemon/Downloads/诺汇盛专用上号器 v1.1.0/` 扩展**；使用的是 Browser MVP 内部的 `CookieSessionBootstrapAdapter`，直接把附件 Session 的 `sessionToken` 分块写入 Chrome Profile。
- 这验证了“上号器所需的 Cookie Bootstrap 能力”，不等于验证了“实际上号器扩展在 Chrome 中工作”。扩展本身仍未接入 Worker。
- 因此当前 F0 仍是前置运行时切片，不应写成已完成上号器集成或完整 MVP。

## 2026-08-26 MVP 再审查结论

- 用户确认需要主动检查后期能力中哪些必须前置；当前判断已把四类硬缺口前置到 F0：实际 Session/上号器 lane、卡片材料 lease、付款后权益/扣款/订阅三方核对、UNKNOWN 锁定与最小人工停止。
- 这不意味着把完整后台、多机高可用或多 Provider fallback 提前；只前置直接决定“能否安全完成第二笔充值”的最小能力。
- 详细复核：`docs/browser-research/mvp-future-capability-frontload-review-2026-08-26.md`。

## 2026-08-26 F0 前置能力代码切片（本次）

按已确认的“后期硬能力前置、平台复杂度后移”原则，本 Browser worktree 新增三块**真实可调用但仍不产生付款副作用**的能力：

- `browser-mvp/src/extension-session-runtime.js`：明确的本地 MV3 上号器 lane。它校验扩展 Manifest V3、给 Chrome persistent context 加载解压扩展，并提供 popup 驱动入口；返回值只包含扩展 ID/状态，不返回 Session 输入。当前只完成合同和 fake-context 测试，尚未在 headed Chrome 中操作真实扩展。
- `browser-mvp/src/card-material-lease.js`：`cardRef → 短时材料 lease → callback 内填充` 的最小边界。PAN/有效期/CVC 不进入 job、lease 或 evidence；当前是内存 source 合同，不连接卡台读取或写入。
- `browser-mvp/src/payment-safety-gate.js`：提交前 permit、提交后 UNKNOWN 锁定、订单/卡片/全局停止开关和人工对账结案状态。它独立于当前只读 executor，`allowWrites=false` 仍保持不变。

验证：`npm --prefix browser-mvp run check` 通过；`npm --prefix browser-mvp test` **38/38 passed**。本次没有加载真实扩展、没有调用卡台写接口、没有提交 Checkout、没有真实付款。

下一步唯一动作：在 headed Chrome（有可用 DISPLAY）中运行扩展 lane 的非付款身份核验；若通过，再由统筹窗口提供共享 `card-material`/资金 permit 合同，继续接入最小模拟 Checkout，不开启真实付款写开关。

## 2026-08-26 对抗式审查与修正

对本轮新增方案逐项按“能否误付款、能否错绑资源、能否重复提交、失败后能否安全恢复”复核，发现并已修正：

- 扩展 lane 原先继承 Chrome runtime 的 `headless=true` 默认值；扩展 popup 在该默认下不能作为真实 lane 使用。现改为默认 headed，并显式拒绝 `headless=true`。
- 扩展 Manifest 只校验了入口字段，未确认 popup 文件存在。现增加 popup 文件存在性校验。
- card-material lease 原先只按 `leaseId` 查找，伪造同一 ID 的其它 cardRef 可能造成错绑。现校验 `cardRef/expiresAt/purpose` 全量匹配，并限制 lease 最长 5 分钟。
- PaymentSafetyGate 原先只锁定“同订单+同卡”的 UNKNOWN；换卡或换订单可能绕过不确定扣款。现 UNKNOWN 按订单或卡任一维度锁定，直到人工对账。
- PaymentSafetyGate 原先允许同一 attempt 重复创建 PREPARED permit，存在重复提交前置条件。现对 PREPARED/SUBMITTED/UNKNOWN attempt 拒绝重复 permit，并增加 permit 过期检查。

复测：`npm --prefix browser-mvp run check` 通过；`npm --prefix browser-mvp test` **38/38 passed**。本轮仍未启动真实扩展、未提交 Checkout、未调用卡台写接口或真实付款。

剩余结构性问题（尚未伪装成已解决）：真实扩展需 headed Chrome/可用 DISPLAY；卡材料仍是内存 source；PaymentSafetyGate 尚未接入付款执行器；三方付款后对账仍是待实现合同；`allowWrites=false` 继续强制。

### 对抗式复核追加：上号器无 background worker

继续核对真实扩展 `manifest.json` 后发现它只有 popup，没有 `background.service_worker`。如果只等待 `context.serviceWorkers()`，实际 lane 会永远误报“扩展未加载”。已修正为：优先使用 worker URL（若存在），否则按 Chromium 解压扩展路径算法派生 extension ID，再打开 popup；同时保留 headed 约束。测试仍为 38/38 通过。

## 2026-08-26 P0 持久化切片已完成（仍不付款）

用户同意先解决两个 P0，现完成 Browser-only 的可恢复合同：

- `browser-mvp/src/durable-payment-safety-gate.js`：以现有 AppendOnlyWal 持久化 payment permit、SUBMITTED、UNKNOWN、对账结果和停止状态；新进程初始化时从最新状态恢复，UNKNOWN 仍禁止再次提交。WAL 只记录 opaque ref/status，不记录卡号、CVC 或 Session。
- `browser-mvp/src/durable-card-material-lease.js`：持久化卡片租约元数据，不持久化卡材料；进程重启后 ACTIVE 租约自动变为 `RECOVERY_REQUIRED`，必须人工 release/revoke 后才能复用；材料仅在 `withMaterial()` 回调内从上游 source 重新读取。

验证新增：预先存在其它 WAL 事件时，payment journal 仍使用全局 WAL sequence；模拟新进程恢复 UNKNOWN；模拟新进程将卡租约锁为 `RECOVERY_REQUIRED`。总测试：`npm --prefix browser-mvp test` **40/40 passed**，`npm --prefix browser-mvp run check` 通过。

边界：这仍是 Browser-only 持久化合同，不是共享订单/卡台生产接线；source、资金 permit、Browser dispatch lease 和真实付款 executor 尚未连接。真实付款写开关保持关闭。

### P0 切片的并发复核

又补了一轮并发审查：Durable payment gate 和 Durable card lease 原先若多个调用同时进入，可能在持久化前互相穿插。现增加各自串行锁；同一 attempt 或同一卡并发请求只允许一个成功。并发回归纳入测试，仍为 40/40 通过。

## 2026-08-26 P0 与上游只读投影非付款联调

新增 `browser-mvp/src/frontloaded-p0-integration.js`，把现有上游只读投影、durable card-material lease、dispatch 和 BrowserContext 观察串成一条非付款链：

```text
order/attempt/cardReadyEvidence/route（只读投影）
→ durable card lease
→ callback 内重新读取材料
→ Browser observation
→ lease RELEASED
```

该路径明确不创建 payment permit、不消费 active funds permit、不提交 Checkout。测试验证上游投影经过 BrowserContext 后卡租约被释放，卡材料 source 只在租约校验和 callback 内读取。总测试：`npm --prefix browser-mvp test` **41/41 passed**。

边界：仍未接真实 MySQL 视图、真实卡台材料 source、共享资金 permit 或付款 executor；这是隔离联调切片，不是生产付款接线。

## 2026-08-26 当前 MVP 与路线落盘索引

用户已确认继续推进，并要求最新 MVP 与后续规划明确落盘。当前唯一执行口径见：

`docs/browser-research/browser-mvp-current-plan-2026-08-26.md`

该文冻结的重点是：MVP 以“卡台就绪卡 → Session/上号器 → Chrome → Checkout → 受闸门控制的真实付款 → 三方核对 → UNKNOWN/人工接管”为核心；完整后台、多 Provider、多机和 200–300 单/日能力按 F1–F5 后置。当前代码仍处于真实付款前的隔离联调阶段。

## 2026-08-26 Google Chrome 实际扩展加载探针

真实运行纠正了两个假设：macOS 上空 `DISPLAY` 没有阻止 headed Chrome 151 启动；真正的阻塞是 Google Chrome 137 起移除了 `--load-extension`，因此 Chrome 151 虽然进程启动，但未加载上号器，popup 返回 `ERR_BLOCKED_BY_CLIENT`。详细证据见 `docs/browser-research/chrome-extension-live-probe-2026-08-26.md`。

代码已增加 `verifyLoaded()`，必须真实打开 popup 并看到输入/按钮控件才能宣称扩展加载成功；测试更新为 43/43。下一步是在专用 persistent Chrome Profile 通过 `chrome://extensions` 一次性安装解压扩展，之后再做 Session 身份核对。该安装是持久化浏览器变更，执行前需在动作点确认。

### 上号器真实安装后的失败与修正

原始 v1.1.0 已实际安装进专用 Chrome Profile，popup 控件验证通过；但用户提供的长 Session 通过 popup 写入失败，Cookie 数量仍为 0，ChatGPT 未打开。原始扩展只写一个 Cookie，不支持 NextAuth/Auth.js 长 Token 分块；同时 Worker adapter 原先未等待 popup 结果，存在假成功。

已在项目内保留派生版 `browser-mvp/extensions/nuohuisheng-session-loader/` v1.1.1（原 Downloads 版本不改），增加 `.0/.1/...` 分块写入、旧分块清理和分块识别；adapter 改为只有 popup 明确成功并打开 ChatGPT 才返回成功。测试更新为 45/45。派生版尚未安装；真实身份仍未验证。

## 2026-08-27 共享合同 adapter 接线与非付款联调（本轮）

本轮限定在 Browser worktree，未修改 nonbrowser worktree、共享 `CURRENT_STATE.md`、`DECISIONS.md` 或 `HANDOFF_LOG.md`。

### 已完成

- `browser-mvp/src/shared-contract-adapter.js` 已从旧 PoC 投影切换到共享运行合同：仅接受 `orders.status=RECHARGE_PROCESSING`、`recharge_attempts.status=PREPARED`、`funds_risk_state=ACTIVE`、`executor_kind=BROWSER`；`CARD_READY`、`RECONCILIATION_REQUIRED`、`PENDING/OBSERVING`、`AVAILABLE`、独立 `auditRef` 和 `fundsGate` 均拒绝。
- adapter 现在校验订单/attempt/卡/冻结 route/Provider 账户绑定；`browser_run.id` 是运行/审计引用。Session 只通过受控 runtime option 传入 opaque ref，原文仍不进入 job。
- `browser-mvp/src/mysql-upstream-adapter.js` 改为按 `browser_run.id` 做一次只读联接查询，移除 `browser_upstream_ready_projection`、readiness TTL 和独立 audit 字段；不选 Session/card credentials。
- 新增 `browser-mvp/src/shared-runtime-integration.js`：调用共享 `workerService.claim()` / `runClaimedJob()`，处理 run lease/resource lease，调用 `abortBeforePayment()`；保留显式 `issueAuthoritativePaymentPermit()` 作为未来付款边界，绝不调用 submit。
- Session 无效/身份不匹配/账号已有 Plus 会回到原订单 `WAITING_FOR_SESSION`；卡余额不足、卡状态、同步时效、route/provider 变化和租约/运行时故障在付款前安全回到 `CARD_READY`。安全退出后要求 attempt/funds 为 `CLEARED`、dispatch 取消、permit 撤销。
- `BrowserExecutionService` 现在接收共享 lease 的 `AbortSignal`，运行中租约丢失可中断页面动作；非付款结果固定检查 `submitCalls=0`。

### 验证证据

```text
npm --prefix browser-mvp run check                 # passed
npm --prefix browser-mvp test                      # 67/67 passed
node --test v1/test/browser-*.test.js（定向套件） # 50/50 passed
隔离 MySQL 8.4：browser-execution + browser-recovery 集成 # 3/3 passed
```

非付款故障注入覆盖：卡余额/状态/同步时效/route/provider 变化、Session 无效、账号已有 Plus、dispatch 租约丢失（动作前/动作中）、运行时崩溃、重复投递/旧 run 恢复；每条路径均验证外部付款调用计数为 0，安全收口后资金 fence 为 `CLEARED`，无活动 permit 残留。付款 permit 单元验证服务端自行计算 snapshot，不接受调用方 snapshot。

### 未验证边界

- 真实生产 MySQL 连接、真实 Browser Worker 注册/部署、真实 HNSKJ 只读 API 和真实卡材料；本轮隔离 MySQL 仅运行共享核心仓储集成，不接 Browser adapter 到生产视图。
- 真实 Checkout 填卡/付款、Plus 激活、取消续费、卡台扣款和三方对账均未执行；`browser_payment_writes_enabled` 与卡台写开关保持关闭。
- 指纹浏览器 runtime、200–300 单/日容量和生产高可用拓扑未验证。

### 本轮修改文件

- `browser-mvp/src/shared-contract-adapter.js`
- `browser-mvp/src/mysql-upstream-adapter.js`
- `browser-mvp/src/shared-runtime-integration.js`
- `browser-mvp/src/executor.js`
- `browser-mvp/src/frontloaded-p0-integration.js`
- `browser-mvp/test/shared-contract-adapter.test.js`
- `browser-mvp/test/mysql-upstream-adapter.test.js`
- `browser-mvp/test/shared-runtime-integration.test.js`
- `browser-mvp/test/upstream-simulation.test.js`
- `browser-mvp/test/session-provider.test.js`
- `browser-mvp/package.json`

本轮提交：`63f9294`（`feat(browser): wire shared runtime contract and dry-run aborts`）。未跟踪 `artifacts/browser-checkout-observe/` 保持原样，不纳入提交。

## 2026-08-27 正式共享 Worker 非付款 composition（最新）

代码提交：`8c17412`（`feat(browser): compose shared nonpayment dry run`）。本节覆盖上一节“尚未把 Browser adapter 接到真实共享 MySQL composition”的未验证项。

### 已完成

- 新增 `createSharedNonPaymentDryRun()`，直接组合共享核心的 dispatch、execution、recovery repositories 与 `createBrowserWorkerService()`，不再使用 Browser-only 平行队列作为此入口的业务真相。
- 运行前必须精确确认 `RUN SHARED BROWSER NONPAYMENT DRY RUN`，并从 `app_settings` 核实 `browser_payment_writes_enabled=false`；manifest 必须 `allowWrites=false`。
- composition 没有 payment submitter；无论页面观察成功与否，非付款流程都通过共享 `abortBeforePayment()` 收口。
- `resolveAccountKey()` 为必需注入项。调用方必须返回跨订单稳定、但不含账号明文的 key；composition 再用本地 HMAC key 生成 `accountKeyHmac`，避免同一账号跨订单并发失去资源互斥。
- runtime、artifact、resource 使用三个显式 32 字节 key 输入；普通输出仅保留状态和计数。

### 验证命令与结果

```bash
npm --prefix browser-mvp run check
# passed

npm --prefix browser-mvp test
# 71 tests / 70 passed / 1 skipped / 0 failed

# 新建临时 mysql:8.4，连续 SQL 就绪后执行完整 001–037 migrations
TEST_DATABASE_URL='mysql://root:root@127.0.0.1:<dynamic-port>/pojia_test' \
  node --test browser-mvp/test/shared-dry-run-mysql-integration.test.js
# 1/1 passed；临时容器随后删除

git diff --check
# passed
```

隔离 MySQL 断言：

```text
external payment calls = 0
order = CARD_READY
attempt = CLEARED
fundsRiskState = CLEARED
run = FAILED_SAFE
dispatch = CANCELLED
active permits = 0
PAYMENT_SUBMIT operations = 0
live resource leases = 0
```

### 修改文件

- `browser-mvp/package.json`
- `browser-mvp/src/shared-dry-run-composition.js`
- `browser-mvp/test/shared-dry-run-composition.test.js`
- `browser-mvp/test/shared-dry-run-mysql-integration.test.js`

### 未验证边界与下一步唯一动作

本轮只使用全新隔离 MySQL 和本地 Playwright fixture；未连接生产、未读取真实 Session/卡材料、未填写真实卡、未调用卡台写接口、未点击付款。下一步唯一动作是取得统筹窗口提供的隔离/预生产 Worker 配置和非敏感测试订单，在真实 Worker + Google Chrome 上运行一次同合同的只读 dry-run；仍保持付款写开关关闭。首次真实付款前必须另行确认。

## 2026-08-27 真实 Worker + Chrome dry-run 准备核对（当前停止点）

- 已确认当前分支仍为 `codex/browser`、HEAD 为 `e50777d`；工作区只有历史未跟踪 `artifacts/browser-checkout-observe/`，无 Browser 未提交改动。
- 当前环境只发现 `AGENT_BROWSER_EXECUTABLE_PATH`，没有 `TEST_DATABASE_URL`、`DATABASE_URL`、`MIGRATION_DATABASE_URL`、Worker 配置或非敏感测试订单；因此没有启动 Worker、没有连接任何数据库。
- `deploy/server/pojia-worker.service` 的部署样例显式设置 `PROVIDER_RECHARGE_WRITES_ENABLED=true`。在没有隔离覆盖配置并确认卡台写开关关闭前，不能使用该部署样例执行只读 dry-run；本次未加载、未修改、未启动该服务。
- 本轮实际执行仅为本地文件/环境核对；没有读取 Session/PAN/CVC，没有 Chrome 页面动作，没有卡台或付款调用。

### 阻塞项与解除条件

需要统筹窗口提供：隔离或预生产 `DATABASE_URL`、完整迁移状态、Browser Worker 启动配置、非敏感测试订单，以及明确的 `browser_payment_writes_enabled=false` 与卡台写开关关闭证明。获得这些输入后，才可执行真实 Worker + Google Chrome 只读 dry-run。

## 2026-08-27 客户安排前紧急只读复验

为在不接生产的前提下尽快确认当前安全基线，重新创建临时 `mysql:8.4` 容器（动态端口，完整执行 migrations `001–037`），并重跑共享 Browser 非付款集成：

```text
node --test browser-mvp/test/shared-dry-run-mysql-integration.test.js
→ 1/1 passed

npm --prefix browser-mvp test
→ 71 tests / 70 passed / 1 skipped / 0 failed
```

容器在测试后已删除；本次没有启动真实部署 Worker、没有连接生产/预生产数据库、没有启动 Chrome 访问外部页面、没有读取 Session/PAN/CVC、没有卡台或付款调用。该复验只能证明隔离 composition 仍可安全收口，不能替代真实 Worker 验收。

## 2026-08-27 Dry-run 配置模板与启动命令

- 新增模板：`docs/browser-research/browser-worker-dry-run-config.example.env`。模板明确：统筹窗口必须提供隔离/预生产数据库 URL、迁移状态和 Worker 参数；`isolated-fixture` 模式可完全使用本地临时 MySQL 8.4 与项目 fixture，无需真实凭证。
- 新增命令：`npm --prefix browser-mvp run dry-run:shared`，实现于 `browser-mvp/scripts/run-shared-dry-run.sh`。
- 启动器默认 fail-closed：必须声明 `BROWSER_DRY_RUN_ENV`；`isolated-fixture` 自动创建并清理临时 MySQL；`isolated/preprod` 必须显式提供 `TEST_DATABASE_URL`；所有 `BROWSER_PAYMENT_WRITES_ENABLED`、Provider 写开关和卡资金写开关都必须**明确等于** `false`。
- 启动器拒绝环境中存在 `CHATGPT_SESSION_COOKIE`、`CHATGPT_TOKEN`、`SESSION_JSON`、`CARD_NUMBER`、`CARD_EXPIRY`、`CARD_CVC`，避免把真实材料带入非付款进程；不读取或写入部署样例。

### 本地命令验证

```bash
BROWSER_DRY_RUN_ENV=isolated-fixture \
BROWSER_PAYMENT_WRITES_ENABLED=false \
PROVIDER_WRITES_ENABLED=false \
PROVIDER_CARD_WRITES_ENABLED=false \
PROVIDER_RECHARGE_WRITES_ENABLED=false \
CARD_FUNDING_WRITES_ENABLED=false \
npm --prefix browser-mvp run dry-run:shared
```

结果：静态检查通过，临时 MySQL 迁移后共享 Browser 集成 `1/1 passed`，容器自动删除。将付款开关设为 `true` 或注入 `CHATGPT_TOKEN` 的负向测试均以退出码 2 拒绝。

完整复验记录：`docs/browser-research/browser-worker-dry-run-2026-08-27.md`。本次实际 exit code=0；集成测试断言 order=`CARD_READY`、attempt/funds=`CLEARED`、run=`FAILED_SAFE`、dispatch=`CANCELLED`、active permits=0、`PAYMENT_SUBMIT`=0、资源租约=0、external payment calls=0。该 launcher 仍运行本地 Playwright fixture，不等价于真实部署 Worker + Google Chrome。

另新增本地 Worker + Google Chrome fixture 回归：`node --test browser-mvp/test/local-worker-chrome-fixture.test.js` **1/1 passed**。它实际驱动 `createBrowserWorkerProcess` 的 claim/run/complete，并用系统 Chrome 临时 Profile 访问本地 `data:` 页面后关闭；固定无付款提交。该证据仍不代表外部站点或生产 Worker 已验收。

## 2026-08-27 主线合并后 readiness 与 fixture 复验

- 已核对主线合并提交 `6580871`；当前 Browser worktree 的代码树与该提交一致（`git diff 6580871..HEAD` 为空；本轮 readiness 文件尚未合并）。
- 新增一次性 readiness 命令：`npm --prefix browser-mvp run dry-run:readiness`。在 `isolated-fixture` 模式下已通过数据库 fixture、Chrome executable、Worker 默认参数、五个写开关全 false、无 Session/PAN/CVC 环境变量检查。
- 按五个写开关为 false 执行 `npm --prefix browser-mvp run dry-run:shared`：静态检查通过，共享 MySQL 集成 `1/1 passed`，临时容器自动清理。
- `node --test browser-mvp/test/local-worker-chrome-fixture.test.js`：`1/1 passed`，实际启动系统 Google Chrome 临时 profile，驱动本地 Worker claim/run/complete 和本地页面观察，`submitCalls=0`。
- 详细记录：`docs/browser-research/browser-worker-readiness-2026-08-27.md`。

## 2026-08-27 独立 production-readonly Browser Worker（当前最新）

生产部署审查确认的缺口已在 Browser 线修复：`v1/src/worker.js` 仍只做上游业务任务与
Browser dispatch 入队；新增 `browser-mvp/src/production-readonly-worker.js` 作为正式、独立的
Browser 队列消费进程，并新增 `deploy/server/pojia-browser-worker.service`。

### 已完成

- 正式 CLI 直接组合共享 MySQL dispatch/execution/recovery repositories、`createBrowserWorkerService()`、
  resource lease、Google Chrome runtime、WAL 和 `abortBeforePayment()`。
- 支持 `--check`/`--once`/常驻轮询；`--check` 不启动 Chrome、不 claim 任务。
- 环境五个写开关必须精确为 false，数据库 `browser_payment_writes_enabled` 也必须为 false。
- 启动检查新增 executor profile 校验：必须存在、`BROWSER/ACTIVE`，且
  `config_public_json.productionWritesEnabled=false`。
- dispatch claim 现可按 executor profile 隔离，并在原子 claim 时把未绑定 job 冻结到当前
  profile；不会消费已显式绑定到其他 profile 的 job。
- systemd 不加载 `provider.env`，在 unit 内再次覆盖五个写开关为 false；不复用旧
  API Worker 的充值写开关。Chrome Profile/cache/WAL 位于专用 StateDirectory。

### 实际验证

```bash
npm --prefix browser-mvp run smoke:worker:readonly
# CLI --check READY
# config/systemd 8/8 passed
# 正式 CLI --once + 临时 MySQL 8.4 + 系统 Google Chrome 1/1 passed

npm --prefix browser-mvp run check
# passed

npm --prefix browser-mvp test
# 81 tests / 79 passed / 2 skipped / 0 failed
# 两个 skip 均为未设 TEST_DATABASE_URL；独立 smoke 已用真 MySQL 覆盖 production Worker 路径

node --test v1/test/browser-dispatch-repository.test.js
# profile-scoped claim 定向回归通过
```

最新 smoke 实际经过正式 CLI 子进程，不是直接调用测试替身。数据库终态：
order=`CARD_READY`、attempt/funds=`CLEARED`、run=`FAILED_SAFE`、dispatch=`CANCELLED`、活动 permit=0、
`PAYMENT_SUBMIT`=0、未释放资源租约=0、external payment calls=0。

### 未验证与停止点

未在 AlmaLinux/systemd 实机安装，未连接生产/预生产数据库，未消费真实订单，未访问外部
ChatGPT，未读取真实 Session/PAN/CVC，未填卡、未付款、未调用卡台写接口。

当前进程是**正式部署形态的 readonly Worker**，不是付款 Worker。它会把非付款观察后的订单通过
`abortBeforePayment()` 退回，所以不得向它派发真实客户充值订单。现阶段也只允许一个被批准的
Browser profile lane 竞争未绑定 job；多 profile 上游路由是后续显式缺口。

详细文档：`docs/browser-research/production-readonly-browser-worker-2026-08-27.md`。

## 2026-08-27 付款执行器代码切片（仅 mock）

新增 `browser-mvp/src/payment-executor.js`：独立 feature gate 默认关闭，先调用共享权威 payment permit 和 submit-intent，再调用仅接受 `MOCK_CHECKOUT` 的本地 adapter。提交后不确定/拒绝一律 `PAYMENT_UNKNOWN`，绝不自动重试或换卡；确认后的 Plus 激活、取消自动续费、卡台交易读取和对账均通过独立 verifier 接口调用。`LIVE` 模式强制拒绝，不连接外部付款端点。

本轮仅做代码和 mock 故障注入验证，未开启 gate、未填卡、未付款、未调用卡台写接口。

### 付款执行器共享 MySQL 模拟验证

一键 smoke 已纳入两条真实共享 MySQL 状态机测试：mock confirmed 完整推进至 `RECHARGE_SUCCESS`，mock submit crash 推进至 `PAYMENT_UNKNOWN/RECONCILE_ONLY` 并证明重放不二次提交。运行发现并修复 checkpoint `payment_risk` 使用不存在的 `CONFIRMED` 枚举的问题；现与迁移合同统一为 `SETTLED`。该测试只在临时库短时开启 DB gate，外部付款调用仍为 0。

## 2026-08-27 Browser 第一阶段推进：Dispatch 只读可见性（本轮）

### 已完成

- 核实后台真实入口：`GET /api/v1/admin/browser/runs` 只查询 `browser_runs`；只入队、尚未创建 run 的 `browser_dispatch_jobs` 原先不可见。
- 在 Browser 控制面新增只读 `GET /api/v1/admin/browser/dispatch-jobs`，仅展示队列状态、排队/领取时间、领取次数、Worker owner/租约到期、attempt/资金/订单状态、profile 摘要和最新 run 摘要。
- `QUEUED` 且无 run 的任务现在可追溯；`CLAIMED`、过期重领线索通过 `attemptCount`/`lastErrorCode`/lease 时间展示。
- 后台和 API 均不查询或返回 lease token/hash、Session、卡凭据、密文、account HMAC；不复制卡片 readiness 或库存判断。
- Browser 页面同时刷新 dispatch 队列与 run 列表；未增加写操作。

### 验证

```text
node --test v1/test/browser-admin-service.test.js --test-name-pattern='Browser|dispatch|rejects'
→ 5/5 passed
node --test v1/test/app.test.js --test-name-pattern='Browser timelines'
→ Browser timeline/dispatch 路由通过
npm --prefix browser-mvp test
→ 既有 Browser 测试保持通过（2 个 MySQL 集成测试因未配置 TEST_DATABASE_URL 跳过）
```

`v1/test/app.test.js` 中已有的 isolated customer page 测试仍因基线 `create-app.js` 指向根目录 `public/`、而当前 v1 页面位于 `v1/public/` 的既有路径问题失败；本轮未修改该非 Browser 基线问题。

### 当前边界

本轮只读后台可见性已补齐，但尚未在 AlmaLinux/systemd 实机、生产/预生产数据库或外部 ChatGPT 上运行；未读取真实 Session/PAN/CVC、未填卡、未付款、未调用卡台写接口。`CARD_READY → RECHARGE_PROCESSING/PREPARED → dispatch → run` 的状态合同继续由共享核心负责；Browser 不在本线复制卡片库存同步/readiness。

## 2026-08-28 migration 039 消费预留对齐（Browser 线）

- Browser adapter 与权威 payment snapshot 同时验证 `card_consumption_ledger`：必须为 `RESERVED`，且 `recharge_attempt_id/order_id/card_id` 与当前 attempt、订单、卡完全一致；否则以 `CARD_CONSUMPTION_NOT_RESERVED` fail-closed。消费预留 ID/status 纳入 snapshot 事实。
- 隔离 shared dry-run 使用共享 `beginAuthorizedAttempt()` 生成真实 RESERVED 记录，安全 abort 后核实为 `RELEASED`；未实现或复制库存规则。
- `codex/browser` 已安全 rebase 到主线 `5eb0967`，保留 Browser 控制面改动且无主线 migration 删除。
- 验证：`npm --prefix browser-mvp test` 85 passed/4 skipped/0 failed；本地 Worker+Google Chrome 非付款 1/1；五个写开关均为 false 的 `dry-run:shared` 隔离 MySQL 1/1 passed。
- 未连接生产、未启动生产服务、未读取真实 Session/PAN/CVC、未填卡、未付款、未调用卡台写接口。

## 2026-08-29 首次灰度前生产化就绪检查

- 分支与主线同步到 `16cec70`，统筹已合入的 profile 绑定修复无重复提交/冲突。
- 修正 production-readonly readiness：从仅检查 migration 037 改为强制 039/040，并强制 payment executor gate=false、MODE=MOCK。
- production-shaped smoke 实跑 config/systemd 8/8、MySQL mock/正式 readonly CLI + Google Chrome 3/3；共享 isolated dry-run 1/1，均无真实付款。
- 部署说明更新为 migration 001–040，并补 Browser 专属停止、disable 和 previous-release 回滚入口。
- 当前 readonly Worker 不接 Session/card material/payment submitter，不能用于真实客户充值；首单前的准确缺口见 `docs/browser-research/BROWSER_FIRST_GRAY_READINESS_2026-08-29.md`。

## 2026-08-29 共享 Session/card-material production adapter

- 基线已同步 `a88f4dc`；Browser 旧提交已由主线吸收，无重复 patch。
- 新增 run-bound 共享密文 adapter：Session/card 分别从 v1 权威记录即时解密，使用 opaque `browser-run:<id>` 和短内存租约，不建立平行事实源。
- pre-payment 状态、profile、route、Provider、attempt/order/card 的 `RESERVED` 账本不一致均 fail-closed。
- 正式 readonly CLI 的共享材料模式默认关闭；隔离启用时只完成 Session bootstrap、卡资料内存预检和页面观察，字段写入/付款提交均为 0。
- 验证：smoke 9/9 + 3/3；Browser 全量 94 tests / 90 passed / 4 skipped / 0 failed；isolated shared dry-run 1/1。
- 未连接生产/预生产，未读取真实 Session/PAN/CVC，未访问外部 ChatGPT，未填卡、未付款、未调用卡台写接口、未部署。
- 证据与下一缺口：`docs/browser-research/BROWSER_SHARED_MATERIAL_ADAPTER_2026-08-29.md`。
