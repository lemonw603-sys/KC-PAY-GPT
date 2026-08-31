# AI Plus 客户充值页 · 重设计

> 状态：设计 + 可交互原型（未接生产，未创建真实订单）
> 日期：2026-09-01
> 范围：仅客户侧充值页（`v1/public/index.html` + `assets/customer.js` + `assets/customer.css`）的前端重设计
> 不改动：订单/Provider/卡台/自动补给/Browser/资金/付款/对账任何业务逻辑与接口语义

本目录是一份独立的设计交付，不改动生产代码。原型用内存 mock 复现真实客户契约，可完整点击体验八个状态。落地时只需把 `prototype/` 的三个前端文件按现有 `v1/public` 结构接入、并把 `mock-api.js` 换成真实 `fetch`，后端零改动即可上线（见 `HANDOFF.md`）。

---

## 1. 设计思路

### 1.1 现状诊断

现有页面（`v1/public/index.html`）是「左侧固定介绍栏 + 右侧 Tab（提交/查询）」的双栏结构。对照「客户急于完成充值、减少理解成本、明确进展、提升信任」这四个目标，它有四个结构性问题：

| 问题 | 现状 | 代价 |
|---|---|---|
| 焦点分散 | 左栏用大篇幅讲「三步流程 / 三个卖点」，与右侧表单争夺注意力 | 客户要在噪音里找到「我该填哪」 |
| 核对缺位 | 提交前的确认弹窗只说「Session 不会显示」，**不展示充值邮箱** | 客户无法核对「充到哪个号」，充错账号只能事后发现 |
| 成功打断 | 充值成功用 `<dialog>` 模态弹窗通知，需手动关闭 | 打断体验，且信息与状态区重复 |
| 层级混乱 | 表单、结果卡、查询、更换 Session 在同一列堆叠，无「当前该看哪」的引导 | 处理中/失败时客户不知道现在进行到哪、要不要操作 |

### 1.2 设计原则

1. **单任务单焦点**：任何时刻页面只呈现「当前这一步」——填写、核对、或跟踪。删除左侧固定展示栏，改用顶部三步进度条建立心理预期。
2. **核对前置为独立步骤**：把「核对邮箱」从一个一句话弹窗，升级为流程中的**第二步主视图**——大字展示从 Session 读出的邮箱，这是全流程的防呆核心。
3. **确认即承诺，之前零副作用**：第一步「下一步」只在本地解析邮箱，**不发任何网络请求**；只有客户在第二步显式确认后才创建订单。这既是体验要求，也是硬安全边界。
4. **状态区是唯一真相**：订单建立后，进度、查询码、成功信息、失败说明、需更换动作，全部就地渲染在同一张状态卡里，成功不再弹窗。
5. **只说客户听得懂的话**：客户只看到 7 个映射状态和脱敏信息；卡台、Provider、资金锁、技术错误码一律不出现（后端 `order-status-service.js` 已做这层折叠，前端严格只消费映射结果）。
6. **信任来自克制**：安全感靠「明确的下一步 + 脱敏 + 就地进度 + 稳定的视觉」传达，而不是靠一堆安全徽章和营销话术。

---

## 2. 信息架构

### 2.1 视图模型

页面是一个**前端视图状态机**（单页、无刷新），四个主视图对应流程的不同阶段：

```
┌─────────────────────────────────────────────────────────────┐
│  顶栏：品牌 + 「查订单」入口                                    │
│  进度条：① 填写资料 —— ② 核对邮箱 —— ③ 跟踪进度                │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│   view=input     →   view=confirm    →   view=tracking        │
│   填写 CDK+Session    核对邮箱(大字)      状态卡(轮询/就地)      │
│        │                  │  ▲                 │               │
│        │                  │  └─返回修改         │               │
│        └──────「下一步」（仅本地解析，不发请求）─┘               │
│                           └──「确认无误，创建订单」→ 创建 → 跟踪 │
│                                                               │
│   view=query  ←────「查订单」/CDK 已占用时跳转 ──────           │
│   查询码或 CDK 找回 → 直接进入 view=tracking                    │
└─────────────────────────────────────────────────────────────┘
```

- **input**：默认视图。CDK 卡密 + Session 两个输入 + 主 CTA。
- **confirm**：核对邮箱。大字邮箱 + 项目/卡密摘要 + 勾选确认 + 双按钮。
- **tracking**：一张自适应状态卡，按 `status` 呈现「处理中 / 复核中 / 需更换 / 收尾中 / 成功 / 失败」六种形态，含查询码与时间线，非终态自动轮询。
- **query**：次要入口，用查询码或原 CDK 找回订单，成功后并入 tracking。

### 2.2 客户状态模型（7 态，与后端映射一一对应）

前端从不感知内部状态，只消费 `POST /api/v1/orders/status` 返回的映射态。映射关系来自 `v1/src/services/order-status-service.js`：

| 客户状态 | 展示 | 内部状态（客户不可见） | 终态 | 轮询 |
|---|---|---|---|---|
| `QUEUED` | 已排队 · 订单已创建 | CREATED | 否 | ~随后转 PROCESSING |
| `PROCESSING` | 处理中 · 正在为你开通 Plus | CARD_PURCHASING / CARD_PROVISIONING / CARD_READY / WAITING_FOR_CARD / SUBMITTING / RECHARGE_PROCESSING | 否 | 有 |
| `REVIEWING` | 复核中 · 订单正在复核 | SUBMIT_UNKNOWN / RECONCILIATION_REQUIRED / CANCELLATION_REVIEW_REQUIRED | 否 | 有（慢） |
| `ACTION_REQUIRED` | 待更换账号 · 需要更换 Session | WAITING_FOR_SESSION | 否 | 有（慢） |
| `FINALIZING` | 收尾中 · 正在确认取消自动续费 | CANCELLATION_PENDING | 否 | 有 |
| `SUCCESS` | 已开通 · Plus 已成功开通 | RECHARGE_SUCCESS | 是 | 停 |
| `FAILED` | 未成功 · 订单未能完成 | CARD_FAILED / RECHARGE_FAILED | 是 | 停 |

> 关键点：`SUBMIT_UNKNOWN`（付款结果不明）被折叠成客户侧的「复核中」，绝不向客户暴露「付款未知」这类内部资金语义——这条边界由后端保证，前端不做任何反向推断。

---

## 3. 桌面端与移动端布局

单列「流程舞台」在两端共用同一套结构，仅间距与堆叠方式变化——不再有桌面双栏 / 移动单栏的两套逻辑。

### 3.1 桌面端（≥ 620px）

- 内容居中，舞台宽 560px，两侧留白营造聚焦感。
- 进度条三步横向展开，带文字标签与填充轨道。
- 卡片内边距 30px，阴影层次更强（`--shadow-lg`），像一张「凭证」浮在页面上。
- 确认页双按钮左右排列（「返回」窄 : 「创建」宽 = 1 : 1.4，主次分明）。

### 3.2 移动端（≤ 480px）

- 舞台占满宽度，卡片内边距收到 18px，圆角略小。
- 进度条标签隐藏，只留三个数字圆点 + 填充轨道（首/中/尾对齐），节省竖向空间。
- 确认页双按钮改为**上下堆叠**，主操作「确认无误，创建订单」在上、拇指易达；「邮箱不对，返回」在下。
- 邮箱用 `clamp(17px,5vw,22px)` 自适应字号 + `word-break` 兜底长邮箱。
- 所有输入 `font-size ≥ 14px`，避免 iOS Safari 聚焦时自动缩放；容器用 `env(safe-area-inset-*)` 适配刘海/底部条。

### 3.3 视觉系统

- **配色**：中性墨 + 翠绿 accent。主按钮用近黑深墨（`--accent-ink`），成功/进度用翠绿（`--brand`），需更换用琥珀，失败用柔和红——比满屏绿更稳重、更像支付场景。
- **主题**：完整 Light / Dark 双主题，跟随系统 `prefers-color-scheme`，可被 `data-theme` 覆盖。所有颜色定义在 `:root`，深色只重定义 token。
- **排版**：系统字体栈（`PingFang SC` / `Microsoft YaHei` 优先），查询码用等宽字体。无任何外部字体 / CDN 依赖。
- **无障碍**：语义化 `role`/`aria`、`:focus-visible` 高亮、复选框键盘可达、`aria-live` 播报状态变化、`prefers-reduced-motion` 关闭所有动效。

---

## 4. 各状态页面

对应截图见 `screenshots/`（命名 `{desktop|mobile}-{序号}-{状态}[-dark].png`）。

| # | 状态 | 视图 | 关键设计 | 截图 |
|---|---|---|---|---|
| 1 | **默认 / 输入** | input | 单卡片双输入；CTA 文案「下一步：核对邮箱」预告下一步；底部两行极简保障说明 | `*-01-input` |
| 2 | **确认邮箱** | confirm | 大字邮箱居中于绿色 plate；「Plus 将充值到这个邮箱」；卡密打码；勾选后才亮起「创建订单」；底注「点击前不会创建订单，也不会发起任何充值」 | `*-02-confirm` |
| 3 | **处理中** | tracking / PROCESSING | 蓝色主题条 + 脉冲状态点；时间线含已完成（绿）/当前（脉冲）/未来（灰·待进行）；「每隔几秒自动刷新」 | `*-03-processing` |
| 4 | **需更换 Session** | tracking / ACTION_REQUIRED | 琥珀主题；就地展开更换表单（复用 `POST /orders/session`）；显示「还可更换 N 次 · 截止时间」；desc 直接用后端 `actionRequired.message` | `*-05-action-required` |
| 5 | **失败** | tracking / FAILED | 柔和红主题；helpbox 说明「已转人工核对，保留查询码」；不暴露任何技术原因；时间线收尾 | `*-06-failed` |
| 6 | **成功** | tracking / SUCCESS | 就地打勾勋章（一次性描边动画）；成功摘要（充值账号 + 完成时间）；查询码；完整时间线；**不弹窗** | `*-04-success`（含 `-dark`） |
| 7 | **订单查询** | query | 单输入（查询码或 CDK）；`PJV1-` 前缀自动判定走 publicNo，否则走 cdk；查到后并入状态卡 | `*-07-query` |
| 8 | **复核中** | tracking / REVIEWING | 中性灰主题；「订单正在复核」；`SUBMIT_UNKNOWN` 等内部不确定态的统一客户表达 | （复用状态卡，演示面板可切） |

各状态共用同一张 `.status-card`，通过 `data-status` 切换主题色（顶部条、状态胶囊、时间线当前节点），保证「同一个地方看进度」的连续感。

---

## 5. 动效方案

克制、有信息量、可关闭。全部动效在 `prefers-reduced-motion: reduce` 下自动降级为无动画。

| 动效 | 触发 | 作用 | 实现 |
|---|---|---|---|
| 视图进入 | 切换 input/confirm/tracking/query | 建立「翻到下一步」的空间感 | `translateY(10px)+opacity` 0.38s |
| 进度条填充 | 步骤前进 | 强化「正在推进」 | `width` 过渡 0.5s |
| 状态点脉冲（ping） | 非终态状态卡 | 传达「系统在动、无需操作」 | 圆点外扩淡出循环 |
| 时间线当前节点呼吸 | 非终态当前节点 | 指示「进行到这一步」 | `box-shadow` 呼吸 1.8s |
| 轮询指示点闪烁 | 非终态 poll-note | 暗示「会自动刷新」 | opacity 闪烁 1.4s |
| 成功打勾描边 | 进入 SUCCESS（每单一次） | 就地、正向的完成反馈，替代弹窗 | `stroke-dashoffset` 0.5s + 勋章弹入 |
| 按钮 loading | 创建/更换/查询请求中 | 防重复点击的即时反馈 | 转圈 + 文字隐藏 + `disabled` |
| 复制反馈 | 复制查询码 | 明确「已复制」 | 文案+配色 1.6s 回弹 |

**终态即静默**：SUCCESS / FAILED 会加 `.is-terminal`，停止所有循环动效与轮询——页面「安静下来」本身就是「结束了」的信号。

---

## 6. 可交互本地预览

原型是纯静态三件套（`index.html` / `styles.css` / `app.js`）+ 内存 mock（`mock-api.js`），无构建、无外部依赖、离线可跑。

```bash
cd docs/design/customer-recharge-redesign/prototype
python3 -m http.server 8848 --bind 127.0.0.1
# 浏览器打开 http://127.0.0.1:8848/index.html
```

> 直接双击 `index.html`（file://）在部分环境会因相对路径 / CSP 限制不加载脚本，请用上面的本地服务器方式。

**演示面板**：页面顶部「演示面板」按钮打开一个浮层（仅原型，生产不含），可一键跳转任意状态、填入示例、切换深/浅色、观看「自动演进」（订单从排队自动走到成功）。真实体验路径：填入示例 → 下一步 → 勾选确认 → 创建订单 → 观察自动轮询到成功。

截图由 `prototype/capture.mjs`（Playwright，可选工具，不属运行时）自动生成到 `screenshots/`。

---

## 7. 接口字段：已用的 / 还缺的

### 7.1 本设计使用的现有接口与字段（后端零改动）

**接口**（均来自 `v1/src/app/create-app.js`，语义完全不变）：

| 接口 | 入参 | 出参 | 本设计用途 |
|---|---|---|---|
| `POST /api/v1/orders` | `{cdk, session}` | `{order:{publicNo,status}}` | **仅在确认后**创建订单 |
| `POST /api/v1/orders/status` | `{publicNo}` 或 `{cdk}` | `{order}` | 查询与轮询 |
| `POST /api/v1/orders/session` | `{publicNo, session}` | `{order}` | 需更换态更换 Session |

**字段**（来自 `order-status-service.js` 的客户响应）：

- `publicNo` — 查询码（`PJV1-` + 20 位），展示 + 复制 + 找回
- `status` — 7 态映射，驱动整张状态卡
- `updatedAt` — 「更新于」
- `timeline[].{status,updatedAt}` — 时间线已发生节点
- `actionRequired.{code,message}` — 需更换态的说明文案（直接展示，不自造）
- `sessionReplacement.{used,remaining,expiresAt}` — 更换次数与截止
- `customerEmail`（仅 SUCCESS）— 成功摘要里的充值账号
- `finishedAt`（仅 SUCCESS）— 完成时间

**前端本地读取（不经任何接口，是「确认前零请求」的关键）**：

- `session.user.email` — 确认页展示的邮箱。**与后端 `order-intake-service.js` 写库用的 `customerEmail: session.user.email` 完全同源**（见 `v1/src/domain/session-validation.js:73`），所以确认页展示的邮箱和最终真正充值的账号一致，无需后端预校验接口即可可靠核对。
- `cdk` — 客户自己的输入，确认页打码展示（前 4 + 后 2）。

### 7.2 设计已覆盖、但如需更强体验后端可补的展示字段

以下都是**可选增强**，当前原型在不新增字段的前提下已有兜底方案，不构成落地阻塞：

| 缺口 | 现在如何兜底 | 建议后端补的字段（须只读/脱敏） | 收益 |
|---|---|---|---|
| 确认前无法校验 Session 有效性（有效期/JWT/是否已 Plus），只能校验「读到邮箱」 | 前端仅解析邮箱；有效性由创建接口判定并回错误码 | 可选新增只读 `POST /api/v1/orders/preview`（**不写库、不占卡、不发充值**）返回 `{email, valid, reason}` | 把「过期/已 Plus」提示提前到确认页，减少一次失败往返 |
| 失败无客户可见原因分类，所有 FAILED 文案相同 | 通用文案「已转人工核对」 | `customerResult.{code,message}`（脱敏后的客户结果码） | 区分「卡密问题 / 账号问题 / 需人工」，减少客服咨询 |
| 时间线未来节点无真实时间 | 前端用固定客户流程模板补 `future` 灰节点 | 无需——或提供阶段说明文案 | 锦上添花 |
| 处理中无「还要多久 / 排第几」 | 脉冲 + 「每隔几秒自动刷新」传达在动 | 可选 `queuePosition` / `etaSeconds` | 缓解等待焦虑 |
| 创建接口只回 `{publicNo,status}`，首帧无时间/时间线 | 前端首帧自造 `QUEUED + now`，随首次轮询补齐 | 可选让创建返回带 `createdAt` | 消除首帧空窗 |
| 产品名写死「ChatGPT Plus 月度会员」 | v1 仅 Plus，写死正确 | 未来多产品时于响应带 `planName` | 支持多产品 |

> 详细的「已确认 / 待确认 / 被否定」见 `DECISIONS.md`；实现边界、mock 说明、未验证项见 `HANDOFF.md`。

---

## 8. 目录

```
customer-recharge-redesign/
├── README.md          本文件：设计说明
├── DECISIONS.md       已确认 / 待确认 / 被否定
├── HANDOFF.md         实现边界、接口依赖、mock 说明、启动方式、未验证项
├── prototype/
│   ├── index.html     结构（视图容器 + 演示面板）
│   ├── styles.css     Light/Dark 双主题、响应式、动效
│   ├── app.js         视图状态机 + 客户契约消费（含「确认前零请求」保证）
│   ├── mock-api.js    内存假后端（严格对齐真实客户契约；生产替换为 fetch）
│   └── capture.mjs    可选：Playwright 截图脚本（非运行时）
└── screenshots/       桌面/移动 × 各状态（含深色成功）
```
