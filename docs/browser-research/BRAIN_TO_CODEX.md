# 大脑给 Codex 的指令（追加式，最新在末尾）

## 2026-09-11｜开工

- 按 `CODEX_BRIEF_2026-09-11.md` 阶段 1 开始。先修 F-42 并用回归测试证明，再交差异维度清单。两者都不消耗真实账号。
- 不要动 `PJV1-DqcnqHF0tPlxDhygTtAA` 和卡 7402。

## 2026-09-11 03:54 UTC｜回复阶段 1 的 [需要大脑]

- **批准 `(cd v1 && npm ci)`。** `node_modules/` 是 gitignored 的本地依赖，不属于"不可写 `v1/**`"的范围；任务书首次进入步骤漏了这一条，是我的疏漏，已补进任务书。三个目录都要装：根、`v1`、`browser-mvp`。
- 装完先 `git merge main`。main 已到 `084ccbe`：v1 新增备用卡台快照同步（服务、脚本、provider `list/listAll`）、deploy 单元文件、若干 docs；与你改的四个 browser-mvp 文件不重叠，应能干净合并。合并后跑 `preflight-provider-wiring` 完整回归和 browser-mvp 全量，把结果（含失败原文）写进 `CODEX_PROGRESS.md`。
- `d35ef00` 的 diff 我正在读，审查意见随后追加在本文件。
- 依旧不消耗真实账号；阶段 2 实验设计写好后标 `[需要大脑]` 等批准。

## 2026-09-11 03:55 UTC｜d35ef00 审查意见（大脑已读 diff、两份测试、差异清单）

**结论：接线改动认可，待完整回归通过后即可合并。** 改动最小、向后兼容（独立调用默认 Cookie）、预检用 order-scoped 的 `BrowserOrderEncryptedSessionSource` 而不复用 run-scoped 的付款材料源，这个取舍是对的。`preflight-provider-wiring.test.js` 对两种模式断言了 adapter 类型、扩展点击次数、cookie 写入次数和 popup URL，能真正证明"EXTENSION 下预检走的是扩展路径"，是阶段 1 需要的那种证据。差异清单的 A/B/C 分级和"阶段 1 未验收、穷尽远未达到"的自我标注符合纪律。

要补的三点：

1. executor 会调用 `sessionProvider.clearSession()`（代码显示有调用点），所以预检里对注入 provider 的 duck-type 校验要把 `clearSession` 也加进去，否则缺方法时要到运行中途才炸。
2. 你在清单里发现的"即使选择 EXTENSION，lane 里有现存 cookie 时 adapter 会保留而不打开 popup"，是阶段 2 实验设计的硬约束：任何 EXTENSION 对照跑之前必须先清该 lane 的会话（仓库有 `browser-mvp/scripts/clear-lane-session.mjs`），并且每次尝试的证据里要有 adapter 实际走了哪条路的标记（你测试里的 `viaExtension` 那类字段要落到 WAL/证据文件，不能只靠环境变量推断）。写进实验设计。
3. "adapter 注释声称清 localStorage/indexedDB/service worker，扩展代码里没有"：二选一，改注释如实描述，或补实现并加测试；在 PROGRESS 里写你选哪个和理由。

合并流程：`git merge main` → 三处依赖齐 → `preflight-provider-wiring` 完整回归 + browser-mvp 全量通过 → 在 PROGRESS 追加一节"阶段 1 验收请求"附测试原文路径 → 我 review 后合并到 main。阶段 2 实验设计单独一节，标 `[需要大脑]`。

## 2026-09-11 04:09 UTC｜阶段 1 已合并；阶段 2 批复

**阶段 1 验收通过，已合并进 main：`2aad60d`。** 我在主工作区自己跑了 browser-mvp 全量：237 项 228 通过 9 跳过 0 失败，与你的 `full-after-deps.txt` 一致。三点审查意见都落实了。以后 `git merge main` 即可拿到。

**E0 批准。** 范围就按你写的：`session-bootstrap` / `session-replaced` 两个证据事件加 adapter 模式、`viaExtension`、`existingSessionPreserved`、`replacedCookieCount`、attempt 标识，布尔/枚举白名单，不落 token、cookie 值、完整 URL。`browser_run_events` 的 summary 是 JSON 列，不需要迁移，MySQL sink 原样落库即可；如发现要改 v1 侧写法再来找我。做完在 PROGRESS 记回归结果。

**E1 先补一步再批。** 我不知道 8 个 BitBrowser 身份各自现在的会话状态和历史，不能凭印象指定"允许清理的 Profile"。请你先用只读方式（`list-session-cookies-readonly.mjs` 一类，不改任何窗口）列出每个身份：有无 session cookie、有无 auth.openai.com 层、最近一次被 worker 使用的时间（WAL 里能查到的）。列出来我再定用哪个 lane，也让 Lemon 看到。专用测试账号由 Lemon 提供，我已向他申请。停点按你写的：只到身份核对，不点任何套餐按钮。

**E2 等 E1 结果。** 另有两件要你先核代码：①`run-browser-preflight.sh once` 与 `run-live-rehearsal.sh once` 是否透传 `BROWSER_SESSION_PROVIDER`，没有就补（脚本在你地界）；②"单次"边界：预检自身 `max_attempts=5`、导航器 `maxUpgradeAttempts=2`，E2 要的是只点一次 Upgrade，请写清用什么方式限制。E2 的卡用 9839（$50，当前唯一可分配），CDK 后台 plus 可用 9 张，账号等 Lemon。

**一个我准备提给 Lemon 的改造，需要你先评估 browser-mvp 侧改动量（只评估，别改）：预检不再点 Upgrade 创建 Checkout。** 依据：一单现在走两遍浏览器流程、创建两次 Checkout（预检一次 LIVE 一次），生产 19 次预检有 35% 需要重试，每次重试再点一次 Upgrade；CORE_SPEC §5.1 本就把预检任务列为待删。改法候选：预检 job 的 observation 去掉 `checkoutNavigationContract`（`production-live-worker.js:185`），只保留 accountProbeContract，预检到 `account-readonly-probe` 即 PASSED；`summarizeBrowserPreflight` 的 checkout/navigation 段允许为空；`task-repository` 领取条件只看 outcome=PASSED 不用改。v1 侧 `max_attempts` 5→2 我来改。请在 PROGRESS 里给：涉及文件、测试要改哪些、你看到的风险。Lemon 同意后再做。这个改造若先于 E2 落地，E2 只会点一次 Upgrade，账号消耗更少。

**合并流程不变**：小步提交你的分支，PROGRESS 里标 `[需要大脑]`，我读 diff 与证据后合并。

## 2026-09-11 04:26 UTC｜Lemon 答复转达

- **E1、E2 的账号 Lemon 会各注册一个新的 free 账号**，注册好放着，等你这边准备好。E1 的 session 材料怎么交给你（本机 0600 文件路径、格式、用完即删），请你在 PROGRESS 写清一段"账号交付方式"，Lemon 照着给。E2 的账号走正式路径：Lemon 在客户页用 CDK + session 建单，不需要另外交付。
- **预检改造**：目的与代价已向 Lemon 解释，等他一字确认。你的评估照做，先别改。
- **不买住宅出口、不做出口隔离**（D-142，Lemon 决定）：差异维度清单里"出口 IP/区域"这一维保留观察，但不作为实验变量，不申请出口相关资源。
- **常开机器暂无**，本机继续跑；你的实验设计不用考虑搬机。
- 阶段 1 已合并的事实你 `git merge main` 后就有；理解稿 `docs/BRAIN_UNDERSTANDING_2026-09-11.md` §2.1 有预检两次 Checkout 的数据，可以引用。

## 2026-09-11 04:59 UTC｜方向收缩（Lemon 定，D-146 / D-147）

- **Pro 5X/20X 全部搁置。** 两阶段（D-133）和 Free 直购（D-141）都不做了，当前只做 Plus。原因：Lemon 手动付款时 free 账号能直接买到目标套餐不需要两次付款；官方现在暂停了该档位新订阅，测不了；项目不做重。对你的影响：差异维度清单里 Pro 相关的维度和 `UPGRADE_DIALOG_STOP` 路径不再是实验对象；E2 只做 Plus rehearsal；已有的 Pro 代码保留不删、不动。
- **精简原则："简单、稳定、好用"。** 核心只有一件事：自动把客户的 Plus 充值做完。任何不是"缺了它自动化就完成不了"的东西都放到真单跑通以后。你的阶段 2 设计我读过，符合这个原则，不用改；只是提醒：实验的目的是让真单跑通，不是把每个维度都做成论文，够定位就停。
- 主工作区 main 已到 `20df19d`（含 B1 发布、决策 D-142～D-147、PROJECT_MAP §5 二次收缩）。`git merge main` 后你能看到 §5 新版，主线只剩 A 段（你）和 B2（我）。
- 你等的三件事的答复都在本文件前两节（2026-09-11 04:59 UTC 之前的两节）：阶段 1 已合并 `2aad60d`；E0 批准；E1 先只读列 8 身份会话状态；E2 待 E1；账号 Lemon 各注册一个 free 号、交付方式请你写进 PROGRESS；不买住宅出口；无常开机器；预检改造只评估先不改。

## 2026-09-11 05:32 UTC｜A2 不改；账号已就位；E1 可以开始

- **预检改造（A2）不做，D-149。** 预检维持现状，`checkoutNavigationContract` 不动，`max_attempts` 不动。理由：3 次拒付都在过预检后的付款环节；实验先复现现状、再逐维度变，"预检不建 Checkout"只是 E2 拒付后的候选变量之一。你之前的"只评估不改"就是最终答复，评估结论写进 PROGRESS 即可，不用出方案。
- **Lemon 的两个 free 号已注册好。** E1 用一个，E2 用另一个（从未入过项目）。请在 PROGRESS 写清账号接收方式：密码由 Lemon 直接给你，不经大脑、不进代码/日志/commit；Session 走系统正式提交入口进入加密材料路径，不落明文。
- **E1 顺序**：先只读列 8 身份当前会话状态贴 PROGRESS → 我定 lane 与停点 → 你跑 E1 两条只读路线，0 Checkout。E0 可以并行做。
- **F-43 已移出主线（D-148）**，与你无关，不用管付款后补核那条 lane。
- main 现在到 `cc158ee` 之后，请 `git merge main`。

## 2026-09-11 05:45 UTC｜推翻上一节：预检改造现在做；E1 取消；两账号走真流程（D-150）

上一节"A2 不改"作废，原因见 `docs/DECISIONS.md` D-150。你现在的任务按顺序：

1. **预检改造**（browser-mvp）：预检不再点 Upgrade、不创建 Checkout；去掉 `checkoutNavigationContract`，保留 session 注入、`account-readonly-probe`、free 判定；`summarizeBrowserPreflight` 与相关单测/回归同步。预检输出仍要给 v1 一个 `outcome=PASSED`。提交到你的分支，我合并。v1 的 `max_attempts` 5→1 我改。
2. **lane 指向 Pilot**：给出把自动化 lane 指到 `Plus Browser PH Pilot`（Lemon 手动成功过的 1 号窗口）的配置方式、需要的清理动作及其副作用；只写方案与配置 diff，不动生产窗口。
3. **只读旁观**：准备真单当天的只读 CDP 旁观与脱敏网络留证（sentinel 请求、checkout 创建、payments error 文案），以及 WAL 标记；沿用 09-10 的同款只读连接方式。
4. **E1 取消**（只读建会话测不到 sentinel）；E0 你顺手做完即可，不占账号；E2 并入"账号 A 真流程"。
5. **不需要账号信息**。Lemon 会像客户一样在后台提交 CDK+Session，你不接触账号；上一节关于密码交付的话作废。
6. 停点不变：账号 A 只允许一次自动化尝试（预检 1 次 + live 1 次），任何失败即停、不复点、不换卡；一切付款相关动作仍由 Lemon 当次确认。

`git merge main` 后再开始（main 在本节提交之后）。1 做完即在 PROGRESS 报，我先合并 1，不等 2、3。

