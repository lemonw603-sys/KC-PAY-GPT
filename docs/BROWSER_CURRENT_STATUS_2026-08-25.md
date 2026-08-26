# Browser 当前状态（2026-08-25）

## 事实快照

| 项目 | 当前事实 |
| --- | --- |
| worktree | `/Users/lemon/.codex/worktrees/9128/AI充值业务` |
| 分支 | `codex/browser` |
| 当前 HEAD | `cc25b7a` |
| 当前阶段 | M8：Session Bootstrap + 本地指纹浏览器运行时准备 |
| 跟踪改动 | 无 |
| 未跟踪改动 | `.playwright-cli/`、`artifacts/` |
| Browser MVP | `browser-mvp/` M0–M7 合同/模拟切片已完成；Session/指纹运行时和共享控制面写路径仍未接入 |
| 生产/真实付款 | 未接入、未执行 |

## 当前阶段

阶段 M8：用户已确认 MVP 必须具备上号器 Session Bootstrap 能力，并纳入一个本地指纹浏览器候选运行时；当前仍未接入真实 Session、真实 Checkout 或付款。新版 BRFE 控制面和共享适配器写路径尚未进入本分支。

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

## 本分支未验证

- 新版 BRFE Browser Worker/control-plane 接线；
- 生产 artifact vault、账号/订单/卡片/Checkout 资源租约；
- BrowserContext 与共享 Worker 的生产接线；
- 新版 BRFE `NON_PH_FUNCTIONAL` 合同与共享状态适配；
- 菲律宾 cohort、真实 Session、Checkout、付款、生产 Worker、高可用拓扑。
- `recharge_attempts`、资金 permit、审计关联仍需统筹窗口冻结；当前不进入共享写路径或真实付款。

## 暂停条件

- 不把其他 worktree/分支的 commit 当成本分支事实；
- 不删除或覆盖 `.playwright-cli/`、`artifacts/`；
- 不修改非 Browser 共享核心、生产 release 或共享事实源；
- 不执行真实付款、开卡、卡余额充值或生产 Browser 写入。

## 下一步

在 Browser-only 范围选定并安装一个本地指纹浏览器候选；把现有上号器的 Cookie 输入/注入规则接成 `SessionMaterialSource` 和 `SessionBootstrapAdapter`，用真实 Session 身份核对跑通一单非付款/模拟付款闭环。不接共享写入、真实付款或生产 Provider 写入。

## M7 隔离 MySQL 只读合同

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
