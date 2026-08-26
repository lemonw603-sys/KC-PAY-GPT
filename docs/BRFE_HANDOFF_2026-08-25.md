# BRFE 接班入口（Browser 线，2026-08-25）

## 当前 worktree 与提交

- Worktree：`/Users/lemon/.codex/worktrees/9128/AI充值业务`
- 分支：`codex/browser`
- 当前 Browser 代码提交：`4004741`（`feat(browser): observe live Plus checkout safely`）
- 当前跟踪文件无修改；未跟踪：`.playwright-cli/`、`artifacts/`
- 本入口只维护 Browser 线，不覆盖非 Browser 共享事实源。

## 当前阶段

阶段 F0：队列/租约/WAL/恢复、Google Chrome 专用 Profile、实际上号器 Session Bootstrap、真实身份核对已进入当前分支并通过验证。尚未完成真实 Checkout 只读观察、卡材料真实接线、付款提交和付款后三方对账。

## M0 已完成与验证

- 四个可替换 Port：`BrowserExecutionPort`、`DispatchStore`、`EvidenceSink`、`RuntimeAdapter`。
- 合成 `LOCAL_MOCK` / `NON_PH_FUNCTIONAL` manifest、job envelope 和 evidence fixture。
- 运行时拒绝 Session、卡号、CVV、Checkout authority、密钥等敏感字段；默认 Port 未实现时 fail-closed。
- `npm --prefix browser-mvp test`：4/4 通过。
- `npm --prefix browser-mvp run check`：通过。

## M1 已完成与验证

- `FileDispatchStore`：原子 JSON 持久化、幂等 enqueue、claim、lease heartbeat、complete、过期 recover。
- 8 个并发 mock worker 处理 240 个合成 job：240 次唯一 claim、0 漏领、0 非完成残留。
- 旧 lease token 在接管后无法 heartbeat 或 complete；rename 结果不明时不自动重放 claim。
- M1 测试总计 7/7 通过（含 M0 合同测试）。

## M2 已完成与验证

- `LocalPlaywrightRuntimeAdapter` 打开隔离 headless Chromium BrowserContext，仅允许 `LOCAL_MOCK` 且 `allowWrites=false`。
- `BrowserExecutionService` 做页面 URL/title/marker 检查并记录 frame count；不暴露 submit/payment 写接口。
- 页面漂移、租约丢失、人工冻结、导航超时均 fail-closed；本地集成测试和 `submitCalls=0` 断言通过。
- M2 测试总计 11/11 通过；`npm --prefix browser-mvp run check` 通过。

## M3 已完成与验证

- `AppendOnlyWal` / `WalEvidenceSink`：单写者追加、序列和 SHA-256 哈希链；重启校验通过。
- WAL 截断/篡改均抛 `WalIntegrityError`，恢复不会继续执行。
- `reconcileIncompleteJobs` 将无终态证据的 RUNNING job 置为 `RECONCILE_ONLY`，不自动重放。
- M3 测试总计 14/14 通过；`npm --prefix browser-mvp run check` 通过。

## M4 已完成与验证

- 10 分钟本地/隔离 soak：实际 601439ms，8 workers，100ms 间隔。
- 5328/5328 job 完成，唯一 claim 5328，重复 0，错误 0，残留 0。
- WAL 15984 条、6,520,982 bytes；soak 内校验通过；Chromium preflight `submitCalls=0`。
- 报告：`/var/folders/vv/y6273_2s7n98r55m2rc96p_w0000gn/T/browser-mvp-soak-SOtfzq/report.json`。
- 最终 `npm --prefix browser-mvp test` 14/14，`npm --prefix browser-mvp run check` 和 `git diff --check` 均通过。

## M5 已完成与验证

- `ReadOnlySharedContractAdapter` 只接受规范化 order/attempt/profile projection，输出 Browser job 引用。
- order 仅允许 `CARD_READY`/`RECONCILIATION_REQUIRED`；attempt 仅允许 `PENDING`/`OBSERVING`；资金只允许 `NOT_REQUESTED`。
- active permit、Session/卡凭据/Checkout authority/API key 等源字段直接拒绝。
- 当前 v1 没有已冻结的 `recharge_attempts` 表合同，适配器不会从 tasks/provider calls 猜测。
- `SessionProviderPort` 只是未来可替换边界，不能等同于现有上号器。已核实的上号器是本地 Chromium Cookie 写入扩展，不是 API、Session broker、账号验证器或指纹浏览器；详见 `docs/browser-research/session-loader-and-fingerprint-runtime-facts-2026-08-26.md`。
- Browser MVP 测试总计 20/20；`npm --prefix browser-mvp run check` 通过。

## 当前分支已验证

- 旧版 v1 的隔离边界、Worker runtime、Provider PoC 定向测试：8/8 通过。
- 全量 `v1 npm test` 已启动；78 tests 中 75 pass、3 个测试文件因当前 worktree 未安装 `express`/`mysql2` 启动失败。
- 已存在旧 Browser 运行产物：`artifacts/browser-poc/*.json`；它们是未跟踪历史证据，不是当前运行时配置。

## 历史迁移审计快照（已被后续提交取代）

本节是 2026-08-25 迁移当时的历史判断；队列/租约/WAL/恢复已在后续 Browser 提交中实现，不得再把下列条目当成当前缺失。保留此节仅用于解释当时为什么没有整批 cherry-pick：

- Browser Worker control shell、loop、process wrapper；
- dispatch queue、claim/lease/heartbeat、ambiguous claim 修正；
- WAL-backed 编排、artifact vault、资源租约恢复；
- 本地 BrowserContext mock 接线、NON_PH manifest/PoC 合同；
- 阶段 soak 报告、BRFE 当前状态和 Browser 交接文档。

相关提交对象可见但未合并到当前分支：`5c0a600`、`7ead4d6`、`75e119d`、`2ee2518`、`d394b53`、`acba927`。

## 未验证事实

- 当前分支没有新版 Browser Worker/dispatch/WAL/artifact vault 实现，因此不能在本 worktree 宣称这些能力已验证。
- 真实 Session、菲律宾出口、Checkout、付款、生产 Worker、生产高可用均未在本分支验证。
- 当前 worktree 的依赖缺失导致完整 v1 测试未能全绿；需在不改变共享核心的前提下补齐依赖后重跑。

## 迁移审计结果

直接迁移已整理 Browser 小提交被依赖审计阻塞：最早前置 `a84c293` 是包含 108 个文件的混合检查点，含共享资金/Provider/Worker/生产相关改动，不能整批 cherry-pick。详见 `docs/2026-08-25_browser-transfer-audit.md`。

## 下一步唯一动作

按市场评估优先验证 **Kameleo local profile + Chroma/Chrome fingerprint + Local API**；同时把系统 Google Chrome 保留为 control lane。两条 lane 共用 Session、订单、证据和审计合同，只改变 runtime。先完成真实 Session 身份核对和非付款一单闭环。未完成前不进入真实 Checkout 写入、真实付款、Provider 写入或生产 release；不 cherry-pick 混合检查点，不使用 `git add -A`，不清理 `.playwright-cli/`/`artifacts/`。

## 2026-08-26 卡台/非 Browser 交接补充

本轮按“先看卡台 API，再看非 Browser 真实代码”的要求完成只读核实，未修改非 Browser 文件、未调用 HNSKJ 卡余额充值或 Plus 付款写接口。详细地图见：
`docs/browser-research/nonbrowser-card-funding-and-recharge-map-2026-08-26.md`。

已确认：

- HNSKJ `/cards/purchase` 是开卡；`openCardAmount` 是卡片初始余额，不是 Plus 实际扣款。
- HNSKJ `/cards/{id}/recharge` 是既有卡补余额；非 Browser worktree 已有 `rechargeCard()`、`card_funding_attempts`、准备/提交/未知/只读对账/人工结案代码，但当前 `codex/browser` 和 `main` 不包含该批文件。
- 非 Browser Plus 主链路是 HNSKJ 卡台卡片 → ZZSHU `create_direct` → `order_no/card_key` 轮询；这不是 Browser Checkout 链路。
- 当前 Browser 不应直接拿 HNSKJ/ZZSHU 密钥或复用 card-funding attempt 作为 Browser 付款 attempt；只应消费共享卡引用、路线和卡片就绪证明。
- 用户已确认架构方向：卡台 API 与运营后台是 Browser 自动充值的上游；Browser 不是孤立脚本，而是消费上游卡片/路线/订单/审计能力的执行器。

已验证：

- 非 Browser worktree 定向卡资金/库存测试 16/16 通过。
- 非 Browser worktree Browser 控制面、卡台路线、资金栅栏和卡资金组合测试 53/53 通过；证明上游合同在代码/隔离测试中可复用，尚不代表生产接线。
- 当前卡台调用限制已纳入执行约束：后续优先复用快照、关键阶段读取、递增轮询和 UNKNOWN/人工对账，不通过删除安全状态来减少调用。
- 代码和部署证据显示卡余额充值写开关、生产 funding runner 保持关闭；没有真实 Browser 卡片/Checkout/付款接线证据。

未验证：

- HNSKJ `/cards/{id}/recharge` 真实写响应及同幂等键重放。
- Browser 是否已把 HNSKJ 卡片/路线真正接到运行时；方向已确认，但共享写路径、真实 Session/Checkout 和付款仍未接线。

下一步仍保持唯一动作：由统筹窗口冻结 Browser 与共享核心的 `cardRef/routeRef/cardReadyEvidence` 输入合同；在此之前不接卡台 API、不接真实 Session/Checkout、不进入付款写路径。

## 2026-08-26 实施进展

上一条“唯一动作”已在 Browser-only 范围内完成一个非付款切片：上游只读投影 → durable dispatch → claim/lease → 隔离 BrowserContext → evidence → complete。随后已补上 Browser-only 的 MySQL 只读 adapter 合同（`browser-mvp/src/mysql-upstream-adapter.js`）：它只执行一次参数化 SELECT，从统筹层冻结的 `browser_upstream_ready_projection` 视图读取字段，再调用 `projectUpstreamBrowserJob()`；没有写方法，不读取卡凭据，不自行把 `PREPARED` 猜测成 Browser 状态。由于共享窗口尚未提供该视图/正式 schema，真实 MySQL 连接目前会按缺表失败闭合。测试覆盖 27/27 通过；该 adapter 仍是隔离合同，不是生产接线。

卡台调用约束保持不变：adapter 只读投影，默认复用已存在 readiness 快照；不得在每个 Browser 页面动作前重新拉卡台，状态刷新使用关键阶段读取和递增轮询。

## 关键资金动作可见性（设计约束）

运营后台/审计视图不得只显示“成功/失败”。涉及扣款、冻结或消费时，必须显示动作类型、provider account、cardRef/card ID、order/attempt/browser run、幂等键、provider call ID、动作前后账户余额、预计/实际扣款、手续费、外部引用和对账状态；卡台账户余额、卡片余额、卡片补余额金额、Plus 实际消费金额必须分栏展示。当前 Browser M6 只产生 `intent/checkpoint` 观察证据，未产生任何付款副作用。

## 共享事实源边界

本次未修改 `docs/CURRENT_STATE.md`、`docs/DECISIONS.md`、`docs/HANDOFF_LOG.md`。需要跨线更新时，先向非 Browser 统筹窗口提出。

## 2026-08-26 Session/指纹运行时事实修正

- 已完成对 `/Users/lemon/Downloads/诺汇盛专用上号器 v1.1.0/` 的静态核实：它只写 `chatgpt.com` 安全 Session Cookie，不负责真实登录验证、账号核验、Profile/代理租约、Checkout 或付款。
- 已核对旧项目 `session-auth.js`、`browser-runtime.js`、`browser-pool.js`：可拆取 Cookie 解析/分块、真实 Session 探针、独立 Context、代理和运行时管理；auth API 伪造、Bearer 注入和 localStorage bootstrap 不进入默认资金链。
- 已核对指纹能力：项目当前没有商业指纹浏览器接入；已有 `playwright-extra + puppeteer-extra-plugin-stealth`、代理、locale/timezone 和 Browser Pool，不等于指纹浏览器。`ANTIDETECT_LOCAL_PROFILE` 只能作为待验证 runtime lane。
- 因此下一阶段不再把“上号器”作为默认 SessionProvider 实现；先冻结 `SessionMaterialSource`、`SessionBootstrapAdapter` 和 `BrowserIdentityRuntime` 三者边界，再做一单完整的非付款/模拟支付闭环。

## 2026-08-26 MVP 运行时决策（用户已确认）

- MVP 必须具备上号器的 Session Bootstrap 能力，否则无法完成真实账号进入、Checkout 观察和一单闭环；但不把现有扩展硬编码为唯一实现。
- MVP 应纳入一个本地指纹浏览器候选，至少用它完成一次非付款/模拟付款闭环；指纹浏览器属于可替换 `BrowserIdentityRuntime`，不成为订单、资金或审计核心依赖。
- 禁止云 Profile、云同步、第三方 Session 托管和真实付款；先完成本地 Profile、代理、Session、Worker 绑定、身份核验和失租约清理。
- 当前缺少具体指纹浏览器产品/安装包，未开始安装或真实 Session 运行；该事实不阻塞合同设计，但阻塞真实运行时验证。

## 2026-08-26 指纹浏览器市场评估

- 已检索厂商官方文档、GitHub API 示例和社区讨论；详细矩阵见 `docs/browser-research/fingerprint-browser-market-review-2026-08-26.md`。
- 首选候选：Kameleo。理由是本地 Local API、Chrome 指纹筛选、Playwright/CDP、local profile 生命周期和官方“一 Profile 一 Context”约束与当前 Worker lease 设计最贴合。
- 次选：Multilogin Mimic + local storage；第三候选：AdsPower Local API。GoLogin 当前公开开发入口偏 Cloud Browser，不进入首轮。
- Google Chrome 不被替换：它作为真实 Chrome control lane；指纹浏览器是另一条可替换 runtime lane。指纹浏览器的 Chrome 模式不等于系统 Google Chrome。
- 以上是能力匹配推荐，不是目标平台风控成功率结论；尚未安装、尚未接入真实 Session、尚未付款。

## 2026-08-26 MVP 范围再收敛（用户确认方向，首次真实付款仍需闸门确认）

上一版“功能较全的非付款扩展 MVP”经对抗式审查后被判定过宽，容易在没有真实 Checkout 产出前堆积后台、容量和运行时复杂度。当前 Browser 线建议收敛为一条核心真实付款纵向切片：

```text
卡台已就绪 Visa 卡
→ Session Bootstrap/账号核验
→ Google Chrome 独立 Profile
→ 单 Worker 顺序执行
→ Checkout/真实付款
→ 订阅权益 + 卡台交易核对
→ 最小审计与清理
```

当前保留：卡片占用、幂等、失败/UNKNOWN 停止、最小队列和结果追溯；后移：双 runtime 同时接入、完整运营后台、分布式调度、复杂 Artifact Vault、多 Provider fallback 和大规模压测。指纹浏览器保留为并行兼容性 Spike，不阻塞第一条 Chrome 真实纵向切片。

真实付款验证采用 `1 笔 → 2–3 笔受控连续` 的闸门；在第一次真实付款提交前单独向用户确认，不在本次文档更新中启用生产付款写开关。

长期能力方向草案见：
`docs/browser-research/browser-automation-future-roadmap-2026-08-26.md`。
用户已于 2026-08-26 确认该路线图作为 Browser 线长期方向冻结；不覆盖共享 `CURRENT_STATE/DECISIONS/HANDOFF_LOG`。

## 2026-08-26 F0 首个代码切片

已在当前 Browser worktree 完成真实付款前的最小运行时切片：

- `GoogleChromeControlRuntimeAdapter` 使用系统 Google Chrome 的独立 persistent Profile；
- `CookieSessionBootstrapAdapter` 将受控 Session Cookie source 转换为 opaque lease 并注入 BrowserContext；
- `BrowserExecutionService` 在页面观察前强制 Session Bootstrap（有 `sessionRef` 但无 provider 直接 fail-closed）；
- 合同新增 `CHROME_CONTROL`/`CHECKOUT_OBSERVE`，但写入仍被 `allowWrites=false` 阻断；
- `npm --prefix browser-mvp run check` 通过，`npm --prefix browser-mvp test` 32/32 通过。

未完成且未验证：卡台真实 ready-card projection、真实测试 Session 身份核对、目标 Checkout 页面观察、真实付款提交、订阅权益和卡台交易对账。下一步只推进这些前置验证，不启用真实付款写开关。

## 2026-08-26 身份核对/Checkout 观察补充

- 新增同源 `/api/auth/session` 身份探针：只比较 email/accountId/userId，并将结果脱敏为 digest；不把原始响应写入事件。
- 新增只读 Checkout observer：提取套餐、币种、金额和付款表单存在性；不点击、不提交、不产生付款副作用。
- Browser 测试累计 34/34 通过。
- 当前仍没有真实站点/真实 Session/真实卡台交易验证；下一步是由统筹窗口提供可用的测试上游投影和测试 Session 入口，在 Chrome control lane 做页面观察。真实付款写入保持关闭。

## 2026-08-26 真实 Session 首次观察结果

用户提供的 Session 已用于一次本地 Chrome control lane 观察。Session Cookie 分块写入成功，但 ChatGPT 首页和 `/api/auth/session` 返回 403，标题为 `请稍候…`，出现 `__cf_bm`，说明当前先被人机验证/边缘防护拦截。不能把这次结果写成 Session 失效，也没有得到账号身份或 Checkout 证据。

详细记录：`docs/browser-research/real-session-observation-2026-08-26.md`。下一步是 headed Chrome 人工观察/通过验证后再做身份核对；不点击付款、不调用卡台写接口。

### 上号器集成事实纠正

上述运行没有加载或点击实际的“诺汇盛专用上号器 v1.1.0”扩展，而是使用 MVP 内部 Cookie adapter 复现其 Cookie 写入能力。扩展的真实 popup/`chrome.cookies` 路径、Chrome 扩展加载、Worker 调用和状态回写仍未验证。后续需把“实际扩展 lane”作为独立验收项，不能用直接 Cookie 注入替代其证据。

### MVP 前置能力复核

对后期路线做了对抗式复核后，F0 必须补齐四个硬缺口：

1. 实际上号器扩展 lane 或明确等价 Session 路径的运行证据；
2. 卡片材料 lease/填充边界（只有 `cardRef` 不能完成真实付款）；
3. 付款后权益、扣款、订阅状态三方核对；
4. UNKNOWN 锁定、最小人工接管和停止开关。

其余多 Provider、多机高可用、完整运营后台和大规模容量准备仍后移。复核文档：`docs/browser-research/mvp-future-capability-frontload-review-2026-08-26.md`。

## 2026-08-26 交接增量：F0 硬能力前置切片

当前分支 `codex/browser`，本轮提交 `c68fce0`；未跟踪 `.playwright-cli/`、`artifacts/` 保持不动。新增：

1. `ChromeExtensionSessionRuntimeAdapter`：显式加载 `/Users/lemon/Downloads/诺汇盛专用上号器 v1.1.0/` 这类 MV3 扩展，提供 popup 驱动入口；只记录扩展运行状态，不把 Session 原文带出边界。
2. `InMemoryCardMaterialLeaseProvider`：为未来真实 Checkout 预留 card-material lease，不再假设只有 `cardRef` 就足够完成付款；当前不接卡台 API。
3. `PaymentSafetyGate`：UNKNOWN 未对账前禁止同订单/卡片再次提交，并支持单卡、单订单、全局停止；当前写开关仍关闭，未接入付款 executor。

验证结果：

- `npm --prefix browser-mvp run check`：通过。
- `npm --prefix browser-mvp test`：38/38 通过。

已验证事实：新增代码可由单元测试调用；扩展参数拼接、MV3 校验、短 lease 过期、UNKNOWN 锁定和停止开关均有测试。未验证事实：headed Chrome 的真实扩展 popup、真实 Session 身份、卡台材料读取、Checkout/付款和三方对账。

暂停条件不变：不执行真实付款、开卡、卡余额充值；不修改非 Browser 共享核心和共享事实源；不使用 `git add -A`；不覆盖 `.playwright-cli/`、`artifacts/`。

## 2026-08-26 对抗式审查结果

本轮复核发现的具体问题已修正并通过 38/38 测试：扩展 lane 改为 headed 默认并拒绝 headless，增加 popup 文件校验；card-material lease 增加全量 lease 绑定校验和 5 分钟上限；UNKNOWN 改为按订单或卡任一维度锁定；同一 attempt 的活动 permit 不可重复创建，并增加 permit 过期保护。

这些修正只强化 Browser-only 合同，没有接入付款写路径。仍需统筹窗口提供共享卡材料/资金 permit 合同后再做模拟 Checkout；首次真实付款前仍必须单独确认。

追加审查事实：真实上号器 Manifest 没有 background service worker，不能把“观察到 service worker”作为扩展加载的必要条件。代码已增加按 canonical extension path 派生 ID 的 fallback；因此真实 headed 验证应直接检查 popup 打开、Cookie 写入结果和 ChatGPT 身份响应，而不是只看 worker 事件。

## 2026-08-26 P0 持久化切片交接

已按用户同意实现并验证两个 P0：

- `durable-payment-safety-gate.js` 将 permit/提交/UNKNOWN/对账/停止状态写入 AppendOnlyWal；重启后 UNKNOWN 不会丢失。
- `durable-card-material-lease.js` 只持久化租约元数据，重启后活动租约转为 `RECOVERY_REQUIRED`，卡材料仍只在 callback 内从 source 读取。

`npm --prefix browser-mvp run check` 通过；`npm --prefix browser-mvp test` **40/40 passed**。本轮没有接卡台写接口、没有真实付款。下一步是把这两个合同接入统筹窗口冻结的共享 attempt/card readiness/资金 permit，而不是直接打开付款写开关。

P0 持久化切片已补并发串行保护：同一 attempt 的并发 payment prepare、同一卡的并发 material lease 只允许一个成功；测试仍为 40/40。当前提交前仍需把 durable contracts 接到共享 attempt/card 状态和 Browser lease。

## 2026-08-26 P0 与上游只读投影联调切片

已新增 `frontloaded-p0-integration.js`：Browser 只消费上游 order/attempt/card readiness/route 投影，先获取 durable card lease，再在非付款 Browser observation 内执行，最后释放租约。该路径不会创建 payment permit，也不会调用资金或 Provider 写接口。

验证：`npm --prefix browser-mvp run check` 通过；`npm --prefix browser-mvp test` **41/41 passed**。已验证租约在成功观察后进入 RELEASED；未验证真实 MySQL、卡台材料 API、共享资金 permit、真实 Session/Checkout/付款。

## 2026-08-26 当前 MVP/路线正式索引

按用户要求，当前 MVP 和后续路线已集中落盘：

`docs/browser-research/browser-mvp-current-plan-2026-08-26.md`

本轮新增 `provider_card_ref` 只读字段和 HNSKJ card material source 合同；卡台材料读取改为只在 callback 内读取一次，以遵守卡台调用次数限制。测试结果更新为 `42/42 passed`；仍未接生产 MySQL、真实 Session、Checkout、付款或卡台写接口。

## 2026-08-26 上号器真实加载纠正

Google Chrome 151 headed context 已实跑；空 `DISPLAY` 不是当前 macOS 阻塞。真正事实是 Chrome 151 忽略解压扩展命令行加载，Profile 中未出现诺汇盛扩展，popup 返回 `ERR_BLOCKED_BY_CLIENT`。Adapter 已增加真实 popup 验证并 fail-closed，测试 43/43。继续 Google Chrome lane 的唯一动作是把解压扩展一次性安装到专用 persistent Profile；未安装前不能再写“扩展 lane 已运行”。

原始上号器 v1.1.0 已装入专用 Profile，但真实长 Session 写入失败，未产生 Cookie/ChatGPT 页面；原因是扩展缺少 Cookie 分块，同时 adapter 会过早报告成功。项目内已派生 v1.1.1 并修正两点，测试 45/45；原始 Downloads 文件保持不变。派生版安装并再次传入 Session 属于下一动作，完成前不能宣称身份核验成功。

## 2026-08-26 最新交接：真实上号和身份核对已通过

本节覆盖上一节的“派生版尚未安装”历史状态。

- Worktree：`/Users/lemon/.codex/worktrees/9128/AI充值业务`；分支：`codex/browser`。
- Browser 代码提交：`a79c5aa` (`fix(browser): stabilize installed session loader bootstrap`)。
- 未跟踪 `.playwright-cli/`、`artifacts/` 保持不动；未使用 `git add -A`。
- 派生源：`browser-mvp/extensions/nuohuisheng-session-loader/`；Chrome 安装副本：`/Users/lemon/Downloads/Browser MVP 上号器 v1.1.1/`。
- 专用 Google Chrome Profile 真实加载 `Browser MVP 上号器 1.1.1`，popup 控件存在。
- 使用用户已提供 Session 经 popup 写入后，生成 2 个 NextAuth Session Cookie 分块；ChatGPT 成功打开；`/api/auth/session` 返回 HTTP 200；user/email/account 三项摘要全部匹配。
- 不记录 Session/Token/邮箱/账号 ID 原文；未打开 Checkout、未填卡、未付款、未调用卡台写接口。
- 实跑发现 Chrome 新页面先以空 URL/`about:blank` 发出，旧 adapter 会假失败。`a79c5aa` 改为等待 URL 到达 `https://chatgpt.com`，并增加 `installedExtensionId` 以支持 branded Chrome 手动安装路径。
- 修复后已用真实 adapter 重放，`sessionWritten=true`、`openedChatGPT=true`、三项身份摘要再次全部匹配。

验证命令与结果：

```bash
npm --prefix browser-mvp run check
npm --prefix browser-mvp test
git diff --check
```

```text
check passed
47/47 passed
git diff --check passed
```

已验证边界：Google Chrome 专用 Profile → 派生上号器 popup → Session Cookie 分块 → ChatGPT → `/api/auth/session` 身份匹配。

未验证边界：真实 Checkout 页面合同；卡材料真实读取/填充；共享 MySQL/资金 permit 生产接线；付款提交；权益/订阅/卡台扣款对账；指纹浏览器 runtime Spike。

下一步唯一动作：在当前已核对身份的专用 Chrome Profile 中执行 Checkout **只读观察**，记录套餐/币种/金额/表单存在性并保持 `submitCalls=0`。首次真实付款仍必须另行向用户确认。

## 2026-08-26 最新交接：Checkout 只读观察已通过

本节覆盖上一节的“Checkout 尚未观察”状态。

- Browser 代码提交：`4004741` (`feat(browser): observe live Plus checkout safely`)。
- 真实路径：ChatGPT 首页 → 价格弹窗 → 升级至 Plus → 可选用途问卷/跳过 → Checkout Session → Stripe Payment Page。
- 价格弹窗显示当前免费版、Plus `$20/月`、地区“美国”。
- 真实 Checkout 显示 `Plus 套餐`、`USD 20.00`、预估税费 `0.00`、按月自动续订；Stripe Payment Page init HTTP 200。
- Stripe 安全字段 `cc-number/cc-exp/cc-csc` 和“订阅” submit 控制存在；支付方式 UI 显示银行卡/PayPal。
- hCaptcha/invisible challenge frame 已加载，但没有证据表明本次已弹出可见验证码，不得写成“已解决验证码”。
- 安全结果：`checkoutCreated=true`、`fieldsFilled=0`、`submitCalls=0`、`paymentClicked=false`、`cardApiCalls=0`。
- 旧 `CheckoutObserver` 只匹配本地 fixture；已根据真实 DOM 增加 `CHATGPT_PLUS_CHECKOUT_CONTRACT`，实际重放能返回币种/金额/税费/表单/卡字段/提交控件存在性，不触发提交。
- `npm --prefix browser-mvp run check`通过；`npm --prefix browser-mvp test` **48/48 passed**；`git diff --check` 通过。
- 详细证据：`docs/browser-research/real-checkout-observation-2026-08-26.md`。
- 本地未跟踪证据：`artifacts/browser-checkout-observe/2026-08-26-live/`；不提交、不覆盖历史 artifact。

已验证边界：真实 Session/身份 → 价格页 → Checkout Session 创建 → Stripe Checkout 只读摘要，最终付款提交为 0。

未验证边界：自动 Checkout Navigation 状态机；真实卡材料读取/填充；payment gate 与 submit executor 强制串接；付款提交；权益/订阅/卡台扣款对账；指纹浏览器 Spike。

下一步唯一动作：实现 fail-closed 的 Checkout Navigation 状态机，把价格弹窗/可选问卷/Checkout Session 创建接入 `BrowserExecutionService`，到达 Checkout 后只调用 `observeCheckout()`，仍然不填卡、不 submit。

## 2026-08-26 最新交接：Checkout Navigation 自动闭环已通过

本节覆盖上一节的“自动 Checkout Navigation 状态机尚未验证”历史状态。

- Worktree：`/Users/lemon/.codex/worktrees/9128/AI充值业务`；分支：`codex/browser`。
- Browser 代码提交：`d9b19e6` (`feat(browser): automate checkout navigation read-only`)。
- 未跟踪 `.playwright-cli/`、`artifacts/` 保持不动；未使用 `git add -A`。
- `BrowserExecutionService` 已真实自动完成：身份核对 → 首页 hydration → 价格弹窗 → 可选用途问卷 → Checkout Session → Stripe 安全字段就绪 → `observeCheckout()`。
- 状态机只允许明确的导航控件；`type=submit`、form 内按钮、按钮歧义和未知页面均 fail-closed。开启 Navigation 时必须同时提供只读 Checkout observer。
- 每次点击前检查 Browser 租约和人工停止；Checkout URL 只记录 digest，不记录 Checkout Session ID。

真实运行发现并修复三个竞态：

1. `DOMContentLoaded` 时 ChatGPT 标题/升级控件可能尚未 hydration，现等待必需首页标记后再校验。
2. 用途问卷可能在 Plus 点击前或后出现，并可能覆盖已定位的按钮；现按页面状态处理两种顺序后重试导航。
3. Checkout 主 form 先出现，Stripe 卡号/有效期/CVC iframe 后加载；现要求三项安全字段在 10 秒内全部就绪，否则停止。

最终真实结果：

```text
status=OBSERVED
sessionIdentity.verified=true
sessionIdentity.httpStatus=200
checkoutCreated=true
questionnaireSkipped=true
currency=USD
amount=20.00
estimatedTax=0.00
paymentFormPresent=true
submitControlPresent=true
submitControlEnabled=true
cardNumber/expiry/cvc present=true
fieldsFilled=0
submitCalls=0
paymentClicked=false
cardApiCalls=0
```

证据序列为 `intent(1) → page-signature(2) → checkout-navigation(3)`；执行后已关闭本次新建的 Checkout 页面，不复用旧 Checkout Session。

验证命令与结果：

```bash
npm --prefix browser-mvp run check
npm --prefix browser-mvp test
git diff --check
```

```text
check passed
53/53 passed
git diff --check passed
```

已验证边界：专用 Chrome Profile 中的真实 Session/身份 → 自动导航 → Checkout 创建 → Stripe 安全字段就绪 → 只读摘要，全程没有填卡和付款副作用。

未验证边界：真实卡材料读取/填充；共享 MySQL/资金 permit 生产接线；payment gate 与 submit executor；付款提交；权益/订阅/卡台扣款三方核对；指纹浏览器 runtime Spike。

下一步唯一动作：进入非付款卡材料切片，先用 fixture 卡材料验证 durable card lease → Stripe 安全字段填充 → 失租约立即停止 → 字段清理，并强制 `submitCalls=0`；本阶段不读取真实卡、不提交付款。

## 2026-08-26 最新交接：fixture 卡材料非付款填充闭环已通过

本节覆盖上一节的“卡材料填充切片尚未验证”状态。

- 当前 Browser worktree：`/Users/lemon/.codex/worktrees/9128/AI充值业务`；分支：`codex/browser`。
- 本轮仍未触碰 `.playwright-cli/`、`artifacts/`，未使用 `git add -A`；共享 `CURRENT_STATE/DECISIONS/HANDOFF_LOG` 未修改。
- 新增 `browser-mvp/src/nonpayment-card-fill.js`：仅接受短时 card-material lease callback，定位 Stripe-like `cc-number/cc-exp/cc-csc` 安全字段，逐字段检查租约/人工停止后填充；只清理本次实际写入字段，不暴露 PAN/CVC，不提供 click/submit。
- `BrowserExecutionService` 新增显式非付款选项 `cardMaterialLeaseProvider + cardMaterialLease + fillCardFields=true`；未同时满足 Checkout observer、lease 和 provider 时 fail-closed。返回值只包含状态/计数，固定 `submitCalls=0`。
- `runFrontloadedNonPaymentIntegration()` 已支持该选项：fixture 填充路径在 Browser 页面存活期间只读取一次材料，完成后释放 durable lease；原有 observation-only 路径仍保持 callback 内一次读取约束。
- 上游只读投影现在可携带 `checkoutNavigationContract` 和 `checkoutContract`，仍经过 `assertSafeObject`，不携带卡凭据/资金 permit。

验证结果：

```text
npm --prefix browser-mvp run check   # passed
npm --prefix browser-mvp test        # 56/56 passed
git diff --check                     # passed（提交前再次执行）
```

其中包含：成功填充 3 个 fixture 字段并清理 3 个字段；租约在下一个字段前失效时立即停止，已写字段仍全部清理；上游→dispatch→Checkout fixture→card lease→fill→release 集成通过，材料 source 读取次数为 1，submit/付款调用为 0。

已验证边界：本地 Playwright fixture、durable card lease、失租约停止、字段清理和非付款集成；未验证真实 HNSKJ API/真实卡材料、真实 Stripe 字段写入、付款提交、付款后三方对账、生产 Worker。

下一步唯一动作：把 `HnskjCardMaterialSource` 接到该填充合同的捕获/模拟 provider 响应，证明显式 `providerCardRef`、单次读取和错误闭环；仍不读取真实卡、不打开 payment submit。
