# BRFE 接班入口（Browser 线，2026-08-25）

## 当前 worktree 与提交

- Worktree：`/Users/lemon/.codex/worktrees/9128/AI充值业务`
- 分支：`codex/browser`
- 当前 HEAD：`d8f600e`（`feat(browser): add isolated mysql upstream projection contract`）
- 当前跟踪文件无修改；未跟踪：`.playwright-cli/`、`artifacts/`
- 本入口只维护 Browser 线，不覆盖非 Browser 共享事实源。

## 当前阶段

阶段 M6（上游只读投影 → Browser 非付款执行模拟）已完成；`browser-mvp/` 已接入当前分支，但尚未接入新版 BRFE 控制面或共享核心写路径。不能把其他 worktree/分支中的 Browser 提交视为本分支已完成。

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

## 已完成但尚未进入本分支的 Browser 工作

以下内容在其他 Browser worktree/分支提交中存在，但当前 `codex/browser` 尚未包含：

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
