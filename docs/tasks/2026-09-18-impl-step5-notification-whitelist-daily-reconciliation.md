# 任务书：落实第⑤步「推送白名单（先坐实静音根因）+ 日对账」（面四①③，D-249，含第③/④步归入的发现）

> 开专门落实窗口做。第一句读 `AGENTS.md` 四份顺序 + `docs/V2.0_EXECUTION.md` §3.A 面四 + 「整体连贯审补丁」+ 「browser-mvp 改动纪律」+ 三张契约表（`docs/contracts/2026-09-18_*`）+ 本任务书。
> **只做本块，做完放回主线验。** 第④步已落地（账本 §6 第④步节）。
> 本任务书写于 2026-09-18 05:xx UTC；**里面的数字是当时现场，动手前当场重查**。
> **本块不碰 browser-mvp**（D-254：②⑤⑥⑧不碰）。

## 为什么是这一步

第④步把「什么时候叫人、叫的时候带什么证据」定成了契约表三，通知面现在可以按表推：推手机改白名单、告警类型两台通用。第④步新产生的四个告警类型（`ORDER_CANCELLATION_UNCONFIRMED` / `ORDER_PAYMENT_UNKNOWN_REVIEW` / 崩溃补核的 `BROWSER_PAYMENT_UNKNOWN` 复用 / 待销到期）现在走「除静音表外全推」的旧规则，白名单不定它们就一直响。日对账（面四③）要用第②步入库的 highvcc 流水/钱包与第④步的账本口径。

## 目标

**A · 推送白名单（面四①）**
- **先坐实 D-176 静音为何未生效**（生产实证：`PHONE_SILENT_TYPES` 在、进程跑当前 release、PAYMENT_UNKNOWN/CONFIRMED 仍各插通知行并 SENT；唯一入队来源是 `alert-notification-repository.enqueueOpenAlerts` 的 `NOT IN (?, ?)`；**原因未知**）。查清写进 DECISIONS 再改同一段代码；不带未知上线。
- `PHONE_SILENT_TYPES` 排除法 → `PHONE_PUSH_TYPES` 白名单，四类：叫人（契约表三 A 项：`BROWSER_HUMAN_VERIFICATION` / `BROWSER_HUMAN_REQUIRED` / `ORDER_PAYMENT_UNKNOWN_REVIEW` / `BROWSER_ORDER_FAILED`（付款前现场保留）/ `CARD_SUPPLY_OPEN_FAILED` / token 要用而没有 / 卡台故障 / ZZSHU 零原因失败）· 供给（`CARD_STOCK_LOW` 按台×产品、`CARD_SUPPLY_WALLET_LOW`、`PROVIDER_WALLET_LOW`）· 资金（拒付必推；`PROVIDER_BALANCE_CHANGED` 每笔推、可设「每日汇总」；开卡费不推）· 客户动态（`BROWSER_ORDER_SUBMITTED`）。**`ORDER_CANCELLATION_UNCONFIRMED`（缝 g「API 取消超时提醒」）入资金类。** 其余只进后台。
- 新产生点：token 失效（按「要用而没有」触发，一段失效期只推一次；D-251 时段外突发缺卡才叫）、卡台故障（`provider_accounts.supply_fault_state=FAULT` 时）。
- 缝 d：「今天叫了几次」从 `alert_notifications.sent_at` 统计（给第⑥块看板）。
- 待销到期要不要每日汇总推：Lemon 定（契约表三 #12）。

**B · 日对账（面四③）**
- 每日一次、两种分开：次数（`card-consumption-audit` 挂 timer，**先按 D-257 结论修判据**：不是放宽白名单能修好的）+ 金额（开卡金额 − 卡台交易合计 vs 卡余额，两台）。
- 差异前期只进看板 + 每日一条汇总推；连续两次日对账仍在才进「需要我处理」。
- 第②步 T3 已把账本补记到 19/20（Dqcn 证据不足未补，原因未知）；本块对账把它当已知差异列出、不猜原因。

**C · 归入本块的发现（第③/④步只报未改）**
1. `operator-watch.mjs` 全局 `CARD_STOCK_EMPTY` 与按台×产品 `CARD_STOCK_LOW` 重叠 → 删全局那条或归白名单外。
2. D-239 诊断事件只在「点击前填写失败」落，`CHECKOUT_NAVIGATION_FAILED` 不落 → 补落页面特征（URL `promo_campaign` / 文案），这也是 D-265 第 1 条「免费试用号 → 该单改走 API」的前提①（换卡走正式释放 + 重新分卡路径，前提②）。
3. `CARD_STOCK_LOW` 现在会推手机、highvcc 那条一直 OPEN 直到充钱开卡 → 白名单 + 去重策略。
4. highvcc 钱包 `usdDeposit`（「$20 押金」）含义未确认，预检只看 `usdBalance` → 问 Lemon/卡台，定了写进预检。
5. **第④步发现**：scheduler 的 dedupe 桶按 60 分钟分，`ASSIGNED`（5 分钟档）/ `RECHARGE_PROCESSING`（1 分钟档）实际也只能每小时同步一次——对账面要不要把付款中卡的同步节奏提上来（`SYNC_CARD_TRANSACTIONS` 任务另有一条线，先查它够不够）。
6. **第④步发现**：browser reader 对 hnskj 卡的 `withinIntentWindow` 用 `Date.parse(tradeTime)` 直接解析 hnskj 的 UTC+8 本地串，服务器 TZ 为 UTC 时会偏 8 小时（Browser 单几乎都走 highvcc，历史未暴露）；第④步 API 侧已按 UTC+8 解析（`unknown-submission-evidence.js`），browser-mvp 侧在白名单内可同修，**归第⑦块**（碰 browser-mvp 的块）或 Lemon 单独批。

## 验收

- 静音根因：DECISIONS 一条，附生产证据（通知行/入队 SQL/进程 release）。
- 白名单单测：四类各一推、其余不推、`ORDER_CANCELLATION_UNCONFIRMED` 推；生产只读复验 `alert_notifications` 新增行只来自白名单类型。
- token 失效 / 卡台故障各一条产生点单测 + 一段失效期只推一次。
- 日对账 timer 有心跳；人为造差异（隔离库）能进看板/汇总推；`card-consumption-audit` 修判据后对生产实跑，差异只剩已知项并逐条有解释。
- `state-check.sh` 一致；`wrapup-check.sh` 全绿。

## 边界

- 不碰 browser-mvp；不改付款行为；不删表（第⑧步）；不动一卡多单上限值。
- 改生产 systemd timer / 推送进程重启：先开口问。
- 范围外发现只报不改，写进收尾「发现」段并登记账本/DECISIONS。

## 先做这个（前置核查，别跳）

1. `alert-notification-repository.js` 全文 + 生产 `alert_notifications` 近 7 天按 `alert_type × status` 分布 + `pojia-bark-notifications.service` 进程的 release（`/proc/<pid>/cwd`）——静音为何没生效，当场查。
2. 第④步新增的四个告警类型在生产有没有已产生的行（发布后才会有）。
3. `card-consumption-audit.js` 当前判据与 D-257 记录的假阴性；`card_consumption_ledger` 当前 CONSUMED / RELEASED / RECONCILIATION 分布。
4. `operator-watch.mjs` 的 `CARD_STOCK_EMPTY` 产生条件与最近一次触发。
5. 第④步留下的待 Lemon 定项处理结果（`production-live-worker.js` 工厂注入 `ledgerSource` 那一行批没批；Browser 核实窗口环境变量改没改）——影响两路证据在 Browser 侧是否已真实生效。

## 涉及文件（起点，不是全集）

`v1/src/db/repositories/alert-notification-repository.js` · `v1/src/db/repositories/browser-alert-repository.js` · `v1/scripts/bark-notification-runner.js` · `v1/scripts/operator-watch.mjs` · `v1/scripts/card-consumption-audit.js` · `v1/src/services/card-supply-scheduler-service.js`（卡台故障产生点）· `v1/src/services/highvcc-snapshot-sync-service.js`（token 失效产生点）· `docs/contracts/2026-09-18_human-intervention-points-contract.md`
