# 任务书：落实第⑥步「工作台 + 设置页」（面五②，D-250，含前五块归入的发现）

> 开专门落实窗口做。第一句读 `AGENTS.md` 四份顺序 + `docs/V2.0_EXECUTION.md` §3.A **面五** + 「整体连贯审补丁」+ 「browser-mvp 改动纪律」+ 三张契约表（`docs/contracts/2026-09-18_*`）+ 本任务书。
> **只做本块，做完放回主线验。** 第⑤步已落地（账本 §6 第⑤步节）。
> 本任务书写于 2026-09-18 08:xx UTC；**里面的数字是当时现场，动手前当场重查**。
> **本块不碰 browser-mvp**（D-254：②⑤⑥⑧不碰）。

## 为什么是这一步

前五块把**判断**做完了：什么时候叫人（契约表三）、叫的时候带什么证据（表二）、哪些该响手机（第⑤块白名单）、每天对什么账（第⑤块日对账）、卡从哪来（第③④块）。这些现在全部只存在于 API、脚本和 journal 里——Lemon 要看要点，得 ssh 或翻后台五个页面。本块把它们收进**一屏工作台 + 一页设置**。

D-250 原话：**工作台要用起来舒服、交互好，V1 太差。**

## 目标

**A · 工作台（先做，面二/三落实要用）**
- 三开关（接单 / 派单 / 付款）+ 两个卡台选择（按路线，带面一四项校验，拒切要显示逐项原因）+ CDK 生成。
- **「需要我处理」队列**：契约表三的 A 项 + 第⑤块日对账的**连续两次**差异 + 第④块待销到期 + token/卡台故障。**不新建表**（缝 c），端点聚合各来源。每条带对应按钮——按钮从诊断页搬过来，不是重写（缝 j：人工收口两按钮搬进队列且必须写账本）。
- 今日订单七列 + 面四看板六问（今日单数/成功率/**自动完成率** · 花了多少钱（按台）· 卡用了几张剩几张（按台按产品）· 两路线各自耗时 · 异常支出 · **今天叫了几次为什么** · 卡台状态）。「今天叫了几次」用第⑤块已经写好的 `countPushesByType`（按 `alert_notifications.sent_at`，缝 d），别另拼。
- 日对账看板读 `GET /api/v1/admin/reconciliation/daily`（第⑤块已上）。**注意它有三组「不是差异」的东西**（待登记 / 开卡金额立不起来 / 终态卡与账本占位），页面要能分开显示，别混成一个数字。

**B · 设置页**
- 按台 × 按产品一张表：水位 / 开卡金额 / 每卡单数 / 最低余额 / 每日开卡上限 / 钱包底线与告警线。
- 全局：推送汇总（第⑤块的 `provider_balance_change_push_mode`，EACH / DAILY_DIGEST）· Session 门槛 · 账单地址。
- **每项带审计**（写 `admin_setting_events`）。

**C · UI/交互**
- **先出 2～3 版视觉/交互方案给 Lemon 挑**，再实现（可参考客户页「候光」，`docs/design/`）。
- 验收含 Lemon 实际用一天的反馈。

**D · 归入本块的发现（前五块只报未改）**
1. 后台「库存阈值」控件（`card_stock_low_threshold` / `setThreshold`）**已不驱动任何告警**；`card_replenishment_daily_limit` 全局日限被策略表按台日限取代，但设置服务与总览仍读它 → 设置页重做时清掉（第③步发现 2）。
2. 后台无「付款前失败、放弃并放卡」动作，现在只能跑 `close-rehearsal-order.mjs` → 契约表三 #3 的按钮（第③步发现 8）。
3. **建演练单没有正式脚本**（第④步 D-270 ②：上次用底层 `storeCdkBatch` 造码漏了 `cdk_batches` 行）→ 要不要做成带批次的正式运维工具。
3b. **运营手动用卡登记入口**（哪张卡 / 哪个客户 / 什么套餐 / 多少钱）——**Lemon 2026-09-18 已定要做，归本块**（D-272 ③）。第⑤块的日对账已经把这类扣款单列「待登记」栏（生产现有 7 张），入口上线后回填，那一栏才会清空。
4. **`pojia-bark-notifications` 在生产是哑的**：整个 boot 内 journal 一条日志都没有（Node 非 TTY 下 stdout 块缓冲）。推送出问题无从查 → 运维工具那一档（第⑤步发现 1）。
5. **`ORDER_WAITING_FOR_CARD` 两处产生点共用同一 dedupe_key**（`workflow-repository:480` critical「开不出卡」vs `card-stock-job-service:354` warning「会继续尝试」），同一行被互相覆盖 severity，白名单只能按类型收、两种语义一起推 → 要不要拆成两个告警类型（第⑤步发现 2）。
6. **ZZSHU 零原因失败「停单不退码」仍未做**（契约表三 #11，现状仍是判失败退码）→ 与队列一起做。
7. `state-check.sh` 的 `pojia-web` 一行**偶发**取值失败（同一轮里先失败后通过，疑似取值竞态，未深查；第⑤步发现 11）。

## 上一块（第⑤步）留下的现场，动手前当场重查

第⑤步**代码完成但（写本任务书时）未发布**：生产 release 仍是 `20260918-step4-251a441`，`pojia-bark-notifications` 仍跑 `20260916-unified-4334dc2`，`pojia-daily-reconciliation.timer` **尚未安装**。开工前先确认这三件的当前状态——如果 Lemon 已批发布，白名单与日对账才是活的。

生产当时的数（**一律当场重查**）：OPEN 告警 122、账本 CONSUMED 19 / RELEASED 50 / RECONCILIATION 2、可分配卡 2 张（hnskj 两张出了 15 分钟窗口）、非终态订单 0、日对账差异 2 条 + 待登记 7 张 + 待销到期 4 张。

## 验收

- 工作台一屏加载；队列每条按钮可点、点完状态真的变了（不是只刷新页面）；四项校验拒切能显示逐项原因。
- 「需要我处理」队列的每个来源都有一条真实数据能显示出来（没有真数据的用隔离库造）。
- 看板六项每项能点进明细，只读复验与底表一致；「今天叫了几次」与 `alert_notifications` 实查数一致。
- 设置页每项改动都能在 `admin_setting_events` 里查到对应审计行。
- UI 方案 ≥2 版 + Lemon 试用反馈记录。
- `state-check.sh` 一致；`wrapup-check.sh` 全绿。

## 边界

- 不碰 browser-mvp；不改付款行为；不删表（第⑧步）；不动一卡多单上限值。
- 改生产 systemd timer / 推送进程重启 / 发布：先开口问。
- 范围外发现只报不改，写进收尾「发现」段并登记账本/DECISIONS。

## 先做这个（前置核查，别跳）

1. `admin.js`（2366 行）与 `admin-read-service.getOverview`（**读 21 张表**）当场重读——§2.7 的函数地图是 2026-09-15 的，硬门槛要求不凭它直接改。
2. 队列四个来源各自的当前端点与数据形状：契约表三 A 项、`GET /api/v1/admin/reconciliation/daily` 的 `discrepancies[].persistent`、`GET /api/v1/admin/card-retirement/candidates` 的 `due`、`provider_accounts.supply_fault_state` 与 `PROVIDER_TOKEN_EXPIRED` 告警。
3. 诊断页那几个按钮的现有实现（要搬不要重写）与它们各自写不写账本（缝 j）。
4. 设置页要收的那些键，现在分别散在哪三个页面、谁在读。

## 涉及文件（起点，不是全集）

`v1/public/admin/admin.js` · `v1/src/services/admin-read-service.js` · `v1/src/services/admin-operations-service.js` · `v1/src/app/create-app.js` · `v1/src/services/daily-reconciliation-service.js`（只读）· `v1/src/db/repositories/alert-notification-repository.js`（`countPushesByType`）· `docs/design/`
