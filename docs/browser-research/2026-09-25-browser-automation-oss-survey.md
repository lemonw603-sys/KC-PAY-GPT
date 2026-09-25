> 2026-09-25 后台调研（只读：GitHub API + 官方文档源），应 Lemon「去 GitHub 找浏览器自动化成熟项目借鉴」。stars/提交日期为当日读数。结论是否采用待 Lemon 定（D-378 之后）。

# 浏览器自动化开源项目调研（Playwright + CDP + Node）

**结论：** 要少花真钱试跑、让失败能说清原因，最先该用的是项目已有的 Playwright 自带能力，不需要引入新框架：分段 trace、失败证据包、aria 快照、HAR。AI 浏览器 agent 只适合两种用法：失败后只读诊断，开发期修选择器。任何一个都不该进付款链路去决定点什么。

**怎么查的：** 2026-09-25（UTC）用 GitHub API 取 stars（`search_repositories`），最近提交日期取默认分支最新一条 commit（`list_commits`）。WebFetch 这次报错不可用，所以文档改为只读 curl 官方仓库的文档源（`microsoft/playwright/docs/src/api/*.md`、`docs.stagehand.dev/*.md`、`midscenejs.com/*.md`），并读了少量源码核对。本地只读看了一行依赖：`browser-mvp/package.json` 里是 `"playwright": "1.59.1"`，最新发布版是 v1.63.0（2026-09-04）。

**排除范围：** stealth 插件、指纹/反检测、隐藏自动化、验证码破解这一类，按要求完全没有研究，也不推荐。

## 一、推荐借鉴的项目

### 1. Playwright 本体（首选，已经在用）
- 仓库：https://github.com/microsoft/playwright ，96,665★，最近提交 2026-09-25，Apache-2.0，TypeScript/Node。
- 可以借鉴的点，均有文档依据：
  - **只在失败时保留 trace**：`tracing.startChunk()`/`stopChunk({path})`（v1.15）。成功时不传 path 就不导出，失败才写文件。
  - **在 trace 里标出业务步骤**：`tracing.group(name)`（v1.49）。
  - **失败时一次取出现场**：`page.consoleMessages()`、`page.pageErrors()`、`page.requests()`（v1.56），`page.ariaSnapshot()`（v1.59）。
  - **1.60 起在已有 context 上录 HAR**：`tracing.startHar(path, {urlFilter, content:'omit'|'attach', mode:'minimal'})`，调用 `stopHar()` 即写盘。1.59 只能用 `routeFromHAR(..., {update:true})` 录，而文档写明 "The file is written to disk when BrowserContext.close is called"。CDP 默认 context 我们不会关，所以 1.59 下这条路基本走不通。
  - **1.60 起的 `connectOverCDP({noDefaults:true})`**：不再对已有默认 context 套用 Playwright 的焦点模拟和媒体模拟。
  - **1.63 起 trace 每步可带 aria 快照和截图**：`snapshots:{dom,aria,screen}`。
  - **UI 漂移检测**：`toMatchAriaSnapshot`（v1.49）支持正则和局部匹配，适合给"对话框、tab、按钮"这类关键状态做指纹。
  - **意外弹窗处理**：`addLocatorHandler`（v1.42）。
  - **离线回放**：`routeFromHAR` 回放加 `page.setContent`。
- 接入成本：小。部分能力要从 1.59 升到 1.60 或 1.63，这是 browser-mvp 改动，按 D-254 需要 Lemon 单独批，还要跑全量测试加一次 rehearsal。
- 风险：
  - 文档原话说 CDP 连接 "significantly lower fidelity than the Playwright protocol connection"。
  - 文档原话说 "Enabling routing disables http cache"，所以生产运行中不能开 `page.route` 或 HAR 回放。
  - trace-viewer 文档里找不到任何脱敏或 mask 选项，trace 会带请求/响应头和 body。截图有 `mask` 可以遮。
  - **trace 必须在进入填卡段之前停掉**，否则可能违反"日志不得出现完整卡号/CVV/sessionToken"的规则。

### 2. Playwright MCP（只在开发期用）
- 仓库：https://github.com/microsoft/playwright-mcp ，37,562★，最近提交 2026-09-18，Apache-2.0，TS。
- 借鉴：用 `--cdp-endpoint` 接到**隔离账号的 BitBrowser profile**，让编码 AI 看 aria 快照、重新生成 `getByRole` 定位器，修 UI 漂移不用花真钱。它还有 `--save-session`、`--output-dir`、`--secrets`。
- 接入成本：小。
- 风险：AI 在页面上什么都能点，所以只能接到没绑卡、不可能付款的 profile，绝不能接生产 profile。

### 3. Midscene.js（可选，只做只读诊断）
- 仓库：https://github.com/web-infra-dev/midscene ，15,016★，最近提交 2026-09-24，MIT，TS。
- 借鉴：
  - `new PlaywrightAgent(page)` 直接接收现成的 Playwright page，理论上能接 connectOverCDP 拿到的 page（未实测）。
  - `aiQuery`、`aiBoolean`、`aiAssert` 是只读判断。文档原话 "query results ... will never be cached"。适合失败后问一句"当前在哪个 tab、页面上有什么错误文字"，把结构化结果存进证据包。
  - 自带 HTML 报告，v1.7.0 起可以转成 Markdown。
  - 缓存是本地文件 `./midscene_run/cache/*.cache.yaml`，可以审阅、可以纳入 git。
- 接入成本：中。
- 风险：
  - 截图要发给多模态模型，里面有账号邮箱等个人信息，需要自托管模型或先遮挡。
  - 模型给出的结论只能当观察，不能当事实。
  - 必须禁用 `aiAct`、`aiTap`。
  - 它的 MCP 服务已经退役（最后一个带 MCP 的版本是 1.9.8）。

### 4. Crawlee（只抄模式，不引入框架）
- 仓库：https://github.com/apify/crawlee ，25,893★，最近提交 2026-09-25，Apache-2.0，TS/Node。
- 借鉴：
  - `ErrorTracker` 按错误码、错误名、堆栈、消息分组计数。
  - 源码注释 "Capture a snapshot (screenshot and HTML) on the first occurrence of an error"：同一类错误只在第一次出现时存截图和 HTML。
  - `ErrorSnapshotter` 用堆栈 hash 加错误消息前 30 个字符做文件名。
  - 这是"错误签名聚合加限量存证"，适合单量上来之后控制存储。
- 接入成本：小，照着写大约百行。
- 风险：这是爬虫框架，整体引入太重。现在每一单都很贵，应该每单都存证，暂时别去重。

### 5. Stagehand（只借思路，不建议引入）
- 仓库：https://github.com/browserbase/stagehand ，25,382★，最近提交 2026-09-24，MIT，TS。
- 现在是 v4，官方迁移文档写明：
  - "has no Playwright dependency, so you can't hand a Playwright Page to act(). There is no interop"。
  - 没有 auto-waiting、`getBy*`、`expect`、route 拦截，也没有 trace viewer。
  - 缓存只在 Browserbase 云端有效，原话 "With a local browser ... the cache option has no effect"。
  - 用 `localBrowser.connect({cdpUrl})` 接已有浏览器时，默认会往浏览器里加载 Stagehand 的扩展。
- 可以借的思路：`observe()` 只返回候选动作（`{selector, method}`），先由代码审核，再确定性地执行。也就是"AI 提议、白名单审核、代码执行"。
- 接入成本：大，相当于把整条流程移植过去。
- 风险：对 BitBrowser 生产 profile 有侵入（装扩展），而且我们会失去 Playwright 现有的全部诊断能力。

### 6. Skyvern（只借思路）
- 仓库：https://github.com/Skyvern-AI/skyvern ，23,066★，最近提交 2026-09-25，**AGPL-3.0**，核心是 Python，TS 只有 `@skyvern/client` 这个客户端。
- 可以借的思路：
  - "先用选择器，失败再让 AI 定位"的三档模式：`page.click("#btn", prompt=...)`。
  - `page.validate(prompt)` 返回布尔值，用来判断页面状态。
- 用在我们这边要加限制：AI 兜底只能用于非付款按钮，而且 AI 定位到的元素必须命中代码里的白名单（按钮的 role 加 name）才允许点。
- 接入成本：直接引入的话很大（Python 加 AGPL），所以只借思路。

**看过但不推荐的：**
- browser-use（116,258★，MIT，最近提交 2026-09-15）：本地库只有 Python，而且是自主 agent，Node 栈里没有对应的本地库。
- LaVague（6,388★）：默认分支最后一次提交是 2025-01-21，按停更处理。
- Healenium（201★）：Java/Selenium。
- rrweb（20,212★，MIT）：要往第三方页面注入录制脚本。我们正在查"页面在自动化下表现不同"，注入会再加一个变量；而且 Playwright trace 已经带 DOM 快照。

## 二、四个问题的具体做法

**1. 让每次运行都能查清原因**
- 每单一个证据目录，里面放：
  - `trace.zip`：只在失败时保留，每个业务步骤用 `group` 标出，在进入填卡段之前 `stopChunk`。
  - 失败瞬间的一组现场：`consoleMessages`、`pageErrors`、`requests`（记 URL、状态码、耗时，不记 body）、`ariaSnapshot`、`page.content()`、打了 mask 的截图。
  - 每步一行结构化日志：步骤名、URL、识别出的页面状态、按钮当时是否 enabled、UTC 时间。
- 控制体积：
  - HAR 用 `urlFilter` 只录目标域名。
  - 用 `content:'omit'`（只留时序，不存 body）。
  - 证据按天数定期清理。
- 视频：`recordVideo` 是 `newContext` 的选项，CDP 默认 context 大概率用不上（未专门核实）。可以用 trace 里的截图时间轴代替。

**2. 扛住 UI 漂移**
- 把"找到按钮就点"改成**显式状态机**：每一步先用 aria 快照指纹识别当前页面状态，识别不出来就停下、存证、转人工，思路和 `SUBMIT_UNKNOWN` 一样。
- "对话框默认停在别的 tab"要用断言确认，比如检查 `aria-selected`，不要默认假设。
- "按钮加载中暂时 disabled"本来就在 Playwright 的 auto-wait 覆盖范围里：click 前会检查 Visible/Stable/Receives Events/Enabled。
- AI 只做两件事：失败后只读诊断，开发期修定位器。

**3. 离线复现失败**
- 把证据包里的 HTML 和 aria 快照变成回归用例：用 `setContent` 加断言，离线测"状态识别器"和定位器，修完不用再跑真单就能验证。
- 需要网络时用 `routeFromHAR` 回放。
- 局限要说清：第三方支付 iframe 带动态 token，HAR 回放大概率复现不出"支付表单加载失败"本身。它只能验证我们的代码在那种页面状态下反应对不对。

**4. 自动化和真人操作的差异（只谈可靠性）**
- Playwright 官方文档的 Hydration 一节原话："As a very fast user, Playwright will start interacting with the page the moment it sees it"，按钮可能已经 enabled，但事件监听器还没挂上。
- 文档把 `networkidle` 标为 **DISCOURAGED**。建议改成：先等业务就绪信号（`waitForResponse` 等关键前置请求返回，加上目标元素的断言），再点击；点完后断言状态确实变了。
- 自动重试只允许用在非付款按钮上。
- `connectOverCDP` 相关的几点：它保真度较低；浏览器不是 Playwright 启动的，文档原话 "some of Playwright functionality may be broken"；它还会对默认 context 套默认覆盖设置，1.60 起的 `noDefaults` 可以关掉。
- 以上都只是**可以去验证的假设**。"Unable to load payment form"的真实原因目前未知，要等有了 trace、控制台和网络证据才能判断。

## 三、先做什么（按顺序）
1. **Playwright 1.59 现在就能做的失败证据包**：分段 trace、`group`、`consoleMessages`/`pageErrors`/`requests`、`ariaSnapshot`、`content`、打 mask 的截图。成本小，收益最大。落地要在 D-254 的白名单里加文件；付款前三件的 submit 段一行都不动，trace 停在它们前面。
2. **申请升到 1.63**（需 Lemon 批）：换来 `startHar`/`stopHar`、`noDefaults`、trace 自带 aria 和截图快照、`artifactsDir`。
3. **证据包转离线回归测试**：给状态识别器和定位器用，这一步最能减少"拿真单当测试"。
4. **Playwright MCP 用于开发期修漂移**：只接隔离、无卡的 profile。
5. **单量上来后**加 Crawlee 式的错误签名聚合。
6. 可选：Midscene 只读诊断员，前提是先解决截图外发的隐私问题。
- 不进生产执行链的：Stagehand v4、browser-use、Skyvern、LaVague。

## 四、没有核实的项
- `startHar` 和 `noDefaults` 在 BitBrowser 的 CDP 默认 context 上实际表现如何：只看了文档和客户端源码，没实跑。
- `routeFromHAR` 的 update 模式：客户端源码显示它只录不拦截（`if (options.update) { await this.tracing._recordIntoHAR(...); return; }`），但对页面行为有没有影响没实测。
- trace 会不会录到跨域支付 iframe 里的输入值：没实测，按最坏情况处理。
- Midscene 能否接 connectOverCDP 的 page、Stagehand v3 是否能和 Playwright 互通：都没核实，我只看了 Stagehand v4。
- 各项目的 stars 数和最近提交日期都是 2026-09-25 从 GitHub API 读到的值，会随时间变化。
