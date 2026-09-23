---
name: Plus 运营后台 · 候光
description: 一个人用的 GPT Plus 代充运营后台。冷绿灰阶、单一深绿主色、等宽数字，内容封顶 1280，密而不挤。
colors:
  canvas: "hsl(168,16%,97%)"
  surface: "hsl(0,0%,100%)"
  surface-2: "hsl(168,20%,97%)"
  surface-3: "hsl(168,16%,95%)"
  hairline: "hsl(168,14%,88%)"
  ink: "hsl(176,18%,11%)"
  ink-2: "hsl(170,10%,38%)"
  ink-3: "hsl(168,9%,50%)"
  accent: "hsl(163,72%,26%)"
  accent-soft: "hsl(163,44%,93%)"
  accent-ink: "hsl(163,76%,22%)"
  on-accent: "hsl(0,0%,100%)"
  gold: "hsl(38,46%,42%)"
  warn: "hsl(32,72%,40%)"
  warn-soft: "hsl(38,78%,94%)"
  ok: "hsl(150,54%,36%)"
  ok-soft: "hsl(150,44%,94%)"
  danger: "hsl(4,66%,50%)"
  danger-soft: "hsl(6,72%,96%)"
  info: "hsl(212,62%,46%)"
  info-soft: "hsl(212,60%,95%)"
typography:
  page-title:
    fontFamily: "Familjen Grotesk, PingFang SC, Hiragino Sans GB, system-ui, sans-serif"
    fontSize: 28px
    fontWeight: 700
    lineHeight: 1.2
  section-label:
    fontFamily: "Familjen Grotesk, PingFang SC, Hiragino Sans GB, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: 0.02em
  body:
    fontFamily: "Familjen Grotesk, PingFang SC, Hiragino Sans GB, system-ui, sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 1.5
  table:
    fontFamily: "Familjen Grotesk, PingFang SC, Hiragino Sans GB, system-ui, sans-serif"
    fontSize: 12.5px
    fontWeight: 400
    lineHeight: 1.45
  caption:
    fontFamily: "Familjen Grotesk, PingFang SC, Hiragino Sans GB, system-ui, sans-serif"
    fontSize: 11.5px
    fontWeight: 400
    lineHeight: 1.4
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: tnum
rounded:
  chip: 7px
  control: 9px
  nav: 10px
  card: 12px
  dialog: 14px
  pill: 999px
spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  gutter: 48px
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.on-accent}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: 34px
    padding: "0 14px"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: 34px
    padding: "0 14px"
  button-danger-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.danger}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: 34px
    padding: "0 14px"
  link-action:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent}"
    typography: "{typography.table}"
    rounded: "4px"
    padding: "0"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    height: 34px
    padding: "4px 10px"
  segment:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink-2}"
    typography: "{typography.table}"
    rounded: "{rounded.control}"
    height: 32px
    padding: "0 11px"
  segment-selected:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.table}"
    rounded: "{rounded.control}"
    height: 32px
    padding: "0 11px"
  chip-neutral:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink-2}"
    typography: "{typography.mono}"
    rounded: "{rounded.chip}"
    padding: "4px 8px"
  chip-ok:
    backgroundColor: "{colors.ok-soft}"
    textColor: "{colors.ok}"
    typography: "{typography.mono}"
    rounded: "{rounded.chip}"
    padding: "4px 8px"
  chip-warn:
    backgroundColor: "{colors.warn-soft}"
    textColor: "{colors.warn}"
    typography: "{typography.mono}"
    rounded: "{rounded.chip}"
    padding: "4px 8px"
  chip-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    typography: "{typography.mono}"
    rounded: "{rounded.chip}"
    padding: "4px 8px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "18px"
  card-inset:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.ink}"
    typography: "{typography.table}"
    rounded: "{rounded.card}"
    padding: "12px 14px"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.dialog}"
    padding: "20px 22px"
    width: "min(440px, 92vw)"
  nav-item-active:
    backgroundColor: "{colors.accent-soft}"
    textColor: "{colors.accent-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.nav}"
    height: 40px
---

# Design System: Plus 运营后台 · 候光

> 生成方式：2026-09-24 从已上线代码扫描提取（`v1/public/admin/assets/workbench.css` 的 `--wb-*` 令牌、`cdks.css` / `orders.css` / `cards.css` 的用法统计），不是凭空拟的。创意语言沿用客户页「候光」定稿（`docs/design/README.md`，Lemon 2026-09-11 定）。**待 Lemon 核对的只有「概览」一节的措辞**；令牌与规则都有代码出处。改令牌先改代码，再回来改这里，不要反过来。

## Overview

**Creative North Star: "候光"**

客户在候，页面有光。客户页把「等待」做成会呼吸的光；后台是同一套光的白天版本：冷绿灰阶（色相 168°）铺底，纯白卡片浮在上面，唯一的彩色是深绿主色，只落在「此刻该点的那一个东西」上。一个人在用这个后台，他要的是一眼看出「今天哪几单要我动手」，所以密度高、层级靠灰阶和字号分，不靠彩色、不靠粗细。

明确拒绝过的：卡片顶部一道彩色横条（AI 生成感，已弃用）；用更细的字重做弱化（中文字体没有 440，会掉到 400）；在客户面前出现的「会话数据」类说法（后台文案同样遵守，内部编号 D-xxx 不进界面）。

**Key Characteristics:**
- 一种彩色：深绿 `{colors.accent}` 只做主动作、当前态、链接；警示/成功/危险/信息各有一对「实色 + 浅底」，只用于状态芯片和警示框。
- 灰阶九档全在 168° 冷绿色相上，画布比卡片深一档，卡片纯白。
- 数字一律等宽（IBM Plex Mono + `tnum`）：卡尾号、时间、计数、单号。
- 内容区封顶 1280，多出来的屏幕当页边距；表格最后一列吃余量，其它列按内容定宽。
- 控件高度两档：34（输入/按钮）与 32（分段器）；圆角 9 是控件的默认值。

## Colors

冷绿灰阶打底，一个深绿主色，四组语义色各带浅底。

### Primary
- **深绿主色** (`hsl(163,72%,26%)`)：主按钮底、当前导航项文字、行内文字链接、焦点环。每屏只应有一个实心主按钮。
- **主色浅底** (`hsl(163,44%,93%)`)：当前导航项与选中分段器的底色、卡密精确匹配条、抽屉定位高亮。
- **主色墨** (`hsl(163,76%,22%)`)：浅底上的文字，比主色更深以保对比。

### Neutral
- **画布** (`hsl(168,16%,97%)`)：页面底。
- **卡片** (`hsl(0,0%,100%)`)：所有内容卡片、输入框、表格底。
- **卡片内嵌** (`hsl(168,20%,97%)`) / **控件底** (`hsl(168,16%,95%)`)：历史行、侧栏、中性芯片、抽屉里的「卡与钱」卡。
- **发丝线** (`hsl(168,14%,88%)`)：所有 1px 边框与分隔线。
- **正文墨** (`hsl(176,18%,11%)`) / **次要墨** (`hsl(170,10%,38%)`) / **三级墨** (`hsl(168,9%,50%)`)：三层文字。三级墨在白底 3.6:1，只用于 11.5px 以下的说明与计数，不用于正文（已登记待 Lemon 定是否调到 44%）。
- **金** (`hsl(38,46%,42%)`)：只在品牌标记的「✦」上。

### Semantic
- **警示** `hsl(32,72%,40%)` / 浅底 `hsl(38,78%,94%)`：需要人处理的状态（等 Session、付款待核实、续费待确认）。
- **成功** `hsl(150,54%,36%)` / 浅底 `hsl(150,44%,94%)`：已成功、在线。
- **危险** `hsl(4,66%,50%)` / 浅底 `hsl(6,72%,96%)`：取消放卡这类不可逆动作、页面级错误通知。
- **信息** `hsl(212,62%,46%)` / 浅底 `hsl(212,60%,95%)`：处理中的中性进度。

### Named Rules
**The One Accent Rule.** 一屏只有一个实心深绿按钮；其余动作是描边或文字链接。语义色只出现在芯片、警示框和危险按钮上，不做背景、不做标题。
**The No-Literal-Color Rule.** 页面 CSS 只许引用 `--wb-*` 令牌，不写字面色。`scripts/css-drift-check.mjs` 按文件棘轮守着（orders.css 字面色 0）。

## Typography

**Display / Body Font:** Familjen Grotesk（自托管 400–700），中文回退 PingFang SC / Hiragino Sans GB
**Mono Font:** IBM Plex Mono（自托管 400/500/600）

**Character:** 窄而清楚的无衬线配等宽数字，像一张打印得很整齐的交易单。中文与英文混排时不靠字重区分层级。

### Hierarchy
- **页标题** (700, 28px)：每页一个，顶栏左侧。
- **区块标签** (600, 13px, +0.02em)：卡片内的小标题（「进度」「卡与钱」），颜色用次要墨，不是黑。
- **正文 / 控件** (400, 13px)：按钮、输入框、说明段。
- **表格** (400, 12.5px)：列表主字号；邮箱加粗到 600 作为行锚点。
- **说明** (400, 11.5px)：卡尾号、单号、次行说明，多用三级墨。
- **等宽** (IBM Plex Mono 12px, `tnum`)：时间、卡尾号、计数、单号、角标。

### Named Rules
**The Weight Floor Rule.** 字重不低于 400；弱化只用颜色和字号（README 硬规则，因中文系统字体没有中间字重）。
**The Two Sizes Rule.** 列表里只用 12.5 与 11.5 两档，芯片与角标用等宽 11–12；不再为某一格单独发明字号。

## Layout

- **外壳**：左侧固定侧栏（品牌 + 六个一级导航 + 登录状态）+ 右侧主内容区。主内容区内边距 26px / clamp(20px, 3vw, 42px)。
- **内容封顶 1280px**（`.main-area .topbar, .main-area .view`，2026-09-24 第八轮 Lemon 定）：与 GitHub Primer `container-xl`、Linear 内容宽相同。宽屏上多出的空间是右侧页边距，不是表格里的空洞。
- **卡片间距 16–18px**；卡片内边距 18px；筛选条控件间距 10px。
- **表格列节奏（订单页冻结，`docs/design/parity/orders-page.json` 量的就是这些）**：客户列按最长邮箱定宽、右内边距 0 → 产品列左内边距 4 → 路线组左 32 → 时间列左 22 → 进度列左 48 并作为最后一列吃余量。规则是「组内贴紧、组间拉开、余量给最后一列」。
- **响应**：≤900px 侧栏折到顶部横排；≤760px 表格保底 900px 横向滚动；≤620px 卡片内边距缩到 15，抽屉全宽。
- **间距刻度**：4 / 8 / 12 / 16 / 24 / 32 / 48。表格内边距例外用 7（历史行）与 10（主行），来自 cdks.css 冻结值。

## Elevation & Depth

以色阶分层为主，阴影为辅。画布比卡片深一档就是第一层深度；卡片用 1px 发丝线 + 一道上沿内高光 + 两段投影（近处 1px、远处 14px 偏移 30px 模糊）。弹层再高一档。

### Shadow Vocabulary
- **卡片** (`inset 0 1px 0 hsla(0,0%,100%,.85), 0 1px 2px hsla(176,25%,10%,.06), 0 14px 30px -14px hsla(176,25%,10%,.22)`)：所有内容卡片。
- **弹层** (`0 10px 24px -8px hsla(176,25%,10%,.28)`)：确认框、通知条、抽屉。

### Named Rules
**The No-Stripe Rule.** 不用卡片顶部彩条表示状态或层级；用上沿内高光 + 投影。

## Shapes

- 圆角刻度：芯片 7 / 控件 9 / 导航项 10 / 卡片 12 / 弹窗 14 / 角标与状态点 999。
- 边框一律 1px 发丝线；焦点环 2px 主色、外扩 2px。
- 状态芯片前面的点：圆＝中性/成功，45° 方块＝警示，方块＝危险。用形状区分，不只靠颜色。
- 历史小标「N ▾」：18px 高胶囊，三角用 CSS 边框画（不是图标字体）。

## Components

- **button-primary**：深绿实心，34px 高，圆角 9，一屏一个。
- **button-outline**：白底主色墨字，用于次要动作（「同步卡交易」「标为已手工充值」）。
- **button-danger-outline**：白底红字红边，只给不可逆动作（「取消并放卡」）；真正的红实心只出现在确认框里的确认键。
- **link-action**：行内文字链接动作（「去核实 ›」「取消并放卡 ›」），与芯片同行、主色、600 字重、悬停下划线；危险动作用红。
- **input / select**：34px 高、圆角 9、1px 发丝线、白底。
- **segment / segment-selected**：分段器 32px 高，按钮之间 1px 竖线，选中项主色浅底 + 主色墨 + 600 字重，角标数字等宽。
- **chip-\***：状态芯片，7px 圆角，前置形状点，等宽 12px。
- **card / card-inset**：内容卡 18px 内边距；内嵌卡（抽屉「卡与钱」）用 surface-2 底、12/14 内边距。
- **dialog**：确认框 14px 圆角、20/22 内边距、最宽 440。
- **table**：表头 12.5px 次要墨、行高由内容定、行悬停底色 surface-2、历史行 surface-2 底 + 12px 字 + 26px 左缩进。
- **drawer**：右侧抽屉，标题是邮箱、副行是单号 · 产品 · 路线；分区顺序固定：此刻可做 → 进度 → 客户与卡密 → 卡与钱 → 技术证据（折叠）。

## Do's and Don'ts

### Do
- 令牌之外不写颜色；改颜色先改 `--wb-*`。
- 数字用等宽 + `tnum`；时间一律 `MM-DD HH:mm`（北京时间）。
- 需要人处理的状态用警示色芯片 + 同行文字链接；一眼看到「做什么」。
- 宽屏留页边距，不拉宽表格；余量给最后一列。
- 每次动后台页面，跑 `scripts/visual-parity.mjs`（几何契约）、`scripts/css-drift-check.mjs`（棘轮）、`scripts/ui-copy-check.mjs`（文案）三件，加真实页验收脚本，视口至少 1440 与 1920。

### Don't
- 不用更细字重做弱化；不低于 400。
- 不在界面里出现内部编号（D-xxx / F-xx）与开发备忘。
- 不用弹窗确认「跳转定位」这类可逆动作；确认框只给不可逆动作。
- 不用彩条、渐变、图标字体做装饰。
- 不给 `.main-area` 以外的容器再设一个最大宽度，避免双重封顶。
