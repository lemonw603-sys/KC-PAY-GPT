# 第⑥块 · 卡片页重构 + 三处自查错误修复（2026-09-20）

> **给审查员**：按 `docs/REVIEW_PROTOCOL.md` 工作。本文每条都带「怎么独立核实」——文件行号、生产只读查询、预期输出。**请优先证伪 A 部分**：那三处是我今天刚引入的错误，自查发现，但自查本身也可能有遗漏。
>
> **状态**：A 部分未改（错误仍在代码里，可直接复现）；B 部分未动。
> **口径**：本文结论凡标「实查」的都附查询语句与原始输出；标「文档」的只有文档依据、未验证。

---

## 零、范围与不做

**本轮做**：A（三处错误修复 + 今日花费补拒付）、B（卡片页按已定稿原型 A 版重构）。
**本轮不做**：卡片列表扛量改造（67 张/天，见 §B.5 说明）、卡端点 23→6 收敛（V2 §4.2 目标）、每卡单数按产品（欠账 3）。

---

## 一、依据清单

| 类型 | 依据 | 关键内容 |
|---|---|---|
| 原型（已定稿） | `docs/design/prototypes/step6-cards-compare.html` **A 版「台账优先」** | 三块：两台卡台并列 → 在役卡片表 → **待销独立成块** |
| 决策 | **D-287** | Lemon 挑 A，**否 B 的理由是「待销混进主列表，删卡按钮与日常行同处易误点」**（安全理由，至今成立） |
| 决策 | **D-280** 八条 | 第 1 条两台四个数含 token；第 7 条删补余额/卡台切换搬工作台/录入降高级；第 8 条导入降「卡台管理」高级入口 |
| 决策 | **D-284 ①** | 供给参数（水位/开卡金额/每卡单数/钱包底线等）**归设置页** |
| 架构 | **V2 §3.3**（Lemon 2026-09-15 拍板） | 卡片＝库存/余额/开卡/导入；设置＝每卡几单/最低余额/开卡金额 |
| 账本 | **face-5 S2** | 卡片＝两台并列：水位/可分配/余额/**token 状态**/**故障标记**/开卡/待销/导入；设置＝按台×按产品一张表含**最低余额** |
| 账本 | **face-5 §6** | Lemon：「后台 4 页是过去定的，**现在可以重新设计、增减改**」；DoD＝**验收含实际用一天** |
| 账本 | **face-2 §1.2** | 两台能力不对称：highvcc 无交易入库、无库存告警、手动删卡 |
| 地图 | **`ADMIN_CONSOLE_MAP` 二** | token 主路径是收藏栏书签；**`/cards/sync` 对 highvcc 卡不生效**，那些卡余额是导入快照 |
| 裁定 | **D-301** | 20X 金额 150 对 / `wallet_floor` 30 对 / 5X 最低余额 95（已改生产）/ **确认词不用留** / **拒付也算** |

**本轮新增、尚无定稿原型的**：§B.5 列表扛量。**故不做**。

---

## 二、A 部分：三处错误修复（我今天引入，自查发现）

三处的共同成因：**新写的三段聚合只在空数据的演示库验过，一次都没在生产跑**。

### A1 · 等卡单数漏了真正的等卡状态

**现状（代码）**：`v1/src/services/admin-read-service.js`，`ordersWaitingForCard` 的查询

```sql
SELECT COUNT(*) AS waiting_for_card FROM orders
WHERE status IN ('CREATED','CARD_PURCHASING','CARD_PROVISIONING')
```

**证据**：
- `v1/src/domain/order-status.js:6` 定义了 `WAITING_FOR_CARD`
- face-2 §1.1 原文：「分卡找不到合格卡 → 订单 `WAITING_FOR_CARD`，排一条按需同步……**然后每 60 秒重试分卡，直到有人开出卡**」
- 同节：「历史 24 次等卡的结局：13 单最后关闭（平均等 8.8 小时）…**等卡 = 等人**」

**错在哪**：漏掉 `WAITING_FOR_CARD`（真正在等卡的状态），多算 `CREATED`（刚建单、还没走到分卡）。

**改法**：改为 `status IN ('WAITING_FOR_CARD','CARD_PURCHASING','CARD_PROVISIONING')`。

**怎么核实**（生产只读）：
```sql
SELECT status, COUNT(*) FROM orders
WHERE status IN ('CREATED','WAITING_FOR_CARD','CARD_PURCHASING','CARD_PROVISIONING','CARD_READY')
GROUP BY status;
```
预期：当前生产非终态订单 0，所以两种写法都返回 0 —— **这条在生产数据上验不出差异**，只能靠状态机定义与 face-2 的语义判定。审查员可在隔离库造一单 `WAITING_FOR_CARD` 验证改前漏算、改后算上。

### A2 · 按产品的「用了几张」根本不分产品

**现状（代码）**：`v1/src/services/card-inventory-eligibility.js:232-233`

```sql
SUM((SELECT COUNT(*) FROM card_consumption_ledger u
  WHERE u.card_id=c.id AND u.status IN ('RESERVED','CONSUMED','RECONCILIATION'))>0) AS any_used
```

`admin-read-service.js` 的 `byProduct` 把它当成该产品的用量：`used: count(productRow?.any_used)`。

**错在哪**：该子查询**没有任何产品条件**，三个产品查出来的 `any_used` 必然完全相同。页面上「20X 用 1 / 剩 0」里的「用 1」是假的。

**更严重**：我写的测试 fixture（`v1/test/admin-read-service.test.js`）手工造了 `pro_20x any_used=1 / pro_5x any_used=0` 这种**真实 SQL 不可能产出**的数据，于是断言全绿。**测试不但没抓到，还把 bug 盖住了。**

**改法**：在 `providerCardStockSql` 增加按产品的用量列，经 `card_consumption_ledger` JOIN `orders` 取 `plan_type`：
```sql
SUM(EXISTS(SELECT 1 FROM card_consumption_ledger pu
  JOIN orders po ON po.id = pu.order_id
  WHERE pu.card_id = c.id
    AND pu.status IN ('RESERVED','CONSUMED','RECONCILIATION')
    AND po.plan_type = '${normalizedProduct}')) AS product_used
```
`byProduct.used` 改取 `product_used`；`any_used` 保留原义（不分产品的「这张卡用过没」），列名不变以免影响其他调用方。

**同步修测试**：fixture 必须改成真实 SQL 可能产出的形状——三个产品的 `any_used` 相同、`product_used` 不同。

**怎么核实**（生产只读，**这条能验出差异**）：
```sql
SELECT o.plan_type, COUNT(DISTINCT l.card_id) AS cards_used
FROM card_consumption_ledger l JOIN orders o ON o.id = l.order_id
WHERE l.status IN ('RESERVED','CONSUMED','RECONCILIATION')
GROUP BY o.plan_type;
```
**已实查输出**：`plus 15` / `pro_20x 3`（无 `pro_5x`）。改后 `byProduct` 里 plus 与 pro_20x 的 `used` 必须不同；改前必然相同。

### A3 · 开卡费按 `occurred_at` 筛日期，而该列全为 NULL

**现状（代码）**：`admin-read-service.js` 今日花费聚合的 `card_issue_fee` 分支用 `todayCst8WindowSql('t.occurred_at')`。

**证据（实查）**：
```sql
SELECT COUNT(*) total, SUM(occurred_at IS NULL) occurred_null, SUM(first_seen_at IS NULL) first_seen_null
FROM card_transactions;
```
**输出**：`76 / 76 / 0` —— `occurred_at` **全表为 NULL**，`first_seen_at` 全有值。

开卡费那两笔的样子：
```
CARD_ISSUE_FEE  0.750000  occurred_at=NULL  first_seen_at=2026-09-18 00:27:31  trade_time_raw=2026-09-18T00:27:31.922Z
CARD_ISSUE_FEE  0.500000  occurred_at=NULL  first_seen_at=2026-09-18 06:27:19  trade_time_raw=2026-09-18T06:27:19.729Z
```

**错在哪**：`NULL >= ...` 恒为 false，**开卡费永远算不进今日花费**。演示库数据全 0，恒等于 0，看不出来。

**改法**：改用 `first_seen_at`。**语义差异必须写进代码注释**：它是「第一次同步到这笔流水的时间」，不是交易发生时间；当天开卡当天同步到的情况下两者一致，跨日同步会归到同步那天。`trade_time_raw` 才是卡台给的真实交易时间，但它是字符串、需解析，且 `occurred_at` 本该存的就是它。

**顺带报一个不是本轮引入的问题**：`occurred_at` 全表 NULL 本身可能是既有 bug —— `trade_time_raw` 有真实时间却没解析入列。**本轮只报不改**，请审查员判断是否另开一条。

**怎么核实**（生产只读）：
```sql
SELECT DATE(CONVERT_TZ(first_seen_at,'+00:00','+08:00')) d,
       SUM(CASE WHEN LOWER(transaction_type)='card_issue_fee' THEN amount ELSE 0 END) issue_fee
FROM card_transactions GROUP BY d ORDER BY d DESC LIMIT 5;
```
预期 2026-09-18 那天为 `1.25`（两笔 0.75 + 0.50）。改前用 `occurred_at` 则恒为 0。

### A4 · 今日花费补上拒付（D-301 Lemon 裁定「拒付也算」）

**当前口径**（D-298）：给客户实际充值成功的金额 + 开卡手续费。
**目标口径**（D-301）：再加 **拒付 + 拒付手续费**。

**依据**：face-4 N4 看板六问原文「花了多少钱（**开卡 + 付款 + 拒付**，按台）」。

**证据（实查）**：`card_transactions` 按类型
```
purchase 30 笔 $876.91 · card_recharge 16 笔 $309.00 · card_balance_return 13 笔 $147.81
chargeback 4 笔 $462.25 · chargeback_fee 4 笔 $1.60 · card_issue_fee 2 笔 $1.25
risk_cancel_return 5 笔 -$0.05 · normal_cancel_return 2 笔 $0.02
```

**改法**：`card_issue_fee` 那个分支的类型集合扩为 `('card_issue_fee','chargeback','chargeback_fee')`，时间列按 A3 改为 `first_seen_at`。

**明确不算 `card_recharge`**（D-297 已定并保留）：往卡里充钱是资金转移不是消费，与 `consumption` 重复计算。

---

## 三、B 部分：卡片页重构

**结构不动**：A 版三块（两台卡台并列 → 在役卡片表 → 待销独立成块）。理由见 §一 D-287。

### B1 · 删掉「卡片概况 + 卡台管理」整块（现状块 2，675px）

**现状证据**：`#stock-view` 第 2 个子元素，实测高 675px，实拍图见 `docs/design/prototypes/`（审查员可自行 `screenshot.mjs --clip` 复现）。**整块是旧蓝皮**——它从未被重做过，A 版原型里不存在这一块。

**块内四样东西的去向**：

| 内容 | 去向 | 依据 | 前置 |
|---|---|---|---|
| 「卡片概况」四个数（可分配/使用中/暂不可用/永久停用，两台合计） | **删** | 块 1 已有按台的四个数；A 版无此块 | 无 |
| **每张卡最多成功充值次数** | **搬设置页** | D-284 ① / V2 §3.3 / face-5 S2 | **⚠️ 设置页 D-290 未做此项** |
| **最低所需卡余额（按产品）** | **搬设置页** | 同上 | **⚠️ 设置页 D-290 未做此项** |
| 「浏览器自动化充值当前卡台」 | **删** | D-280 第 7 条，工作台营业条已实现 | 无 |
| 「卡台管理」表格（卡台能力/库存快照/告警） | **降折叠高级入口** | D-280 第 8 条 | 无 |

**⚠️ 更正（2026-09-20，本条原文有误，保留以示错在哪）**：上面这段曾写「设置页漏做了『最低余额』与『每卡单数』，必须先补再删块 2」。**错了一半**——

- **最低余额：设置页早就做了**，按产品三行 + 保存按钮（`admin.js` `renderSettingsThresholds` 的 `mins`），保存调的就是 `/card-stock/minimum-balance`，**和块 2 里那份是同一个端点**。所以块 2 那份是**重复入口**，删掉即可，没有前置。
- **我为什么误判**：只查了 `card-supply-policy-admin-service.js` 的 `POLICY_FIELDS`（那里管 `card_supply_policies` 与 `provider_accounts` 列），而最低余额不走那个 service。**在一个地方没找到就断言「不存在」** —— 本项目记忆里的第七类惯犯。
- **每卡单数：确实是真前置**。设置页那项此前做成只读（理由是 D-221 要按产品、且块 2 还有可编辑入口），块 2 一删就没入口了。**已于当日改为可编辑**（复用既有端点 `/card-stock/max-successful-payments`，整数 1~4 校验），并加测试钉住。

**结论：删块 2 的前置已清零。**

**怎么核实**：
```bash
grep -n "POLICY_FIELDS\|WALLET_FIELDS" -A6 v1/src/services/card-supply-policy-admin-service.js
grep -n "card-stock/minimum-balance\|card-stock/max-successful-payments" v1/src/app/create-app.js
```

### B2 · token 那格改用权威信号源

**现状（代码）**：
- `v1/public/admin/assets/admin.js:1342` — `const tokenBad = isHighvcc && rig.tokenFault === true;`
- `v1/src/services/card-stock-service.js:520` — `tokenFault: String(row.supply_fault_state || '') === 'FAULT'`

**问题**：`supply_fault_state` 只在**补卡调度器开卡失败**时写；而 token 失效的权威信号是 `PROVIDER_TOKEN_EXPIRED` 告警——`v1/scripts/sync-highvcc-snapshot.mjs:74-82` 在快照同步失败时 `markProviderTokenExpired`、成功时 `clearProviderTokenExpired`（第⑤步为修「token 过期不叫人」而建）。`markProviderTokenExpired`（`card-supply-scheduler-service.js:86-100`）**只写告警，不碰 `supply_fault_state`**。

**证据（实查，生产此刻就是矛盾状态）**：
```sql
SELECT pa.provider_code, pa.supply_fault_state,
       (SELECT COUNT(*) FROM operator_alerts a WHERE a.alert_type='PROVIDER_TOKEN_EXPIRED' AND a.status='OPEN')
FROM provider_accounts pa WHERE pa.provider_code='manual_excel';
```
**输出**：`manual_excel | OK | 1` —— **卡片页据 `supply_fault_state=OK` 显示「已配置」，工作台待办据告警显示「token 已失效」，同一后台两页说法相反。**

**工作台那边是对的**，其代码注释（`admin.js:481-483`）已写明口径：「有 `PROVIDER_TOKEN_EXPIRED` 告警＝确已失效（权威信号）；**没有告警不等于「有效」**」。

**改法**：卡片页 token 那格改用同一信号源（告警），与工作台统一；无告警时按工作台既有口径只报「上次更新时间」，不写「有效」。

**可选增强（需 Lemon 点头，本文不列为必做）**：接 `localStorage.access_overtime` 显示剩余有效期。`browser-mvp/scripts/sync-highvcc-token.mjs:35-42` 已在读它（**已验**）。

### B3 · 去掉确认词（D-301 Lemon 裁定）

| 动作 | 现状 | 误点后果 | 改法 |
|---|---|---|---|
| 「我手动用了这张」 | 走 `POST /card-operational-overrides` set RETIRED | 卡不再分配，**仍在待销清单** | **直接去确认词**（`POLICIES` 含 `NORMAL`，可改回；**但前端有无该入口尚未验证，见下**） |
| 「我已在卡台删掉」 | `POST /card-retirement/confirm`，确认词 `已销卡 {last4}` | 改 `inventory_status=RETIRED`，**卡移出待销清单** | **先补撤销路径，再去确认词** |

**证据**：`v1/src/app/create-app.js:673,686` —— `card-retirement` 只有 `candidates` 与 `confirm` 两个端点，**无反向端点**（已 grep 确认）。

**未验证项（审查员请重点核）**：`card_operational_overrides` 改回 `NORMAL` 在**前端有没有入口**。我只看到服务层 `POLICIES = new Set(['NORMAL','PRODUCT_ONLY','RETIRED'])`（`card-operational-override-service.js:4`），**没有验证页面上能不能做**。若前端无入口，则「我手动用了这张」同样需要先补撤销再去确认词。

### B4 · 五个折叠入口合并成一个「高级」区

**现状**：`#stock-view` 的 9 个子块里有 5 个是 57px 的折叠入口——导入卡台、HNSKJ 开卡、highvcc 开卡、补卡执行记录、新卡接管记录。

**依据**：D-280 第 8 条只要求「降到高级入口」，未要求五个独立块；V2 §4.2「4 页 + 1 高级入口」。

**注意**：`card-intake`（新卡接管）**链路必须保留**——face-5 §6 Lemon 已答：它是 hnskj 新卡的自动录入链路（`pojia-card-catalog-sync.timer` 每 5 分钟发现新卡、两次快照一致才入库），**只是页面降高级入口，不删**。

### B5 · 列表扛量 —— 本轮不做，登记

**问题**：V2 §3.2 原文「**200 单/天 = 67 张/天，这条不自动化其余全白做**」。现在卡片列表一次渲染全部、只有一个「历史」折叠；A 版原型按 4 行画的。一个月 2000 张卡时这页会废掉。

**为什么不做**：这是我提的新需求，**无定稿原型**，与 B1~B4（全部有明确依据）混做会拖长本轮。建议单独出原型定稿后再做。

---

## 四、验收（动手前定，做完逐条走）

**业务层**
- A1：隔离库造一单 `WAITING_FOR_CARD`，改前漏算、改后算上。
- A2：生产只读跑 §A2 的核实查询，`byProduct` 里 plus 与 pro_20x 的 `used` 必须不同（预期 15 / 3）。
- A3/A4：生产只读跑 §A3 的核实查询，2026-09-18 那天 `issue_fee` 应为 1.25；拒付类型纳入后金额随之变化。
- B1：设置页能改「最低余额」「每卡单数」，改完用**新连接**独立复核 `app_settings` 与 `admin_setting_events`。
- B2：生产只读复现 §B2 的矛盾查询；改后卡片页与工作台对同一状态说法一致。
- B3：撤销路径可用（误点后能恢复），再去确认词。

**界面层**
- 先冻 `docs/design/prototypes/_frozen/cards-a/` 快照（三份 CSS），补 `docs/design/parity/cards-page.json` 契约，`node scripts/visual-parity.mjs` 全绿。
- **契约写完必须做变异测试**（故意改坏看它报不报），否则不算数——D-293 有过「参照跟着被测物一起变，比对永远通过」的事故。

**工程层**
- `npm test` 全量，基线 976 / 908 pass / 1 fail（唯一 fail 是既有 F-65，不许为全绿去改它）。
- 三个闸门：`scripts/visual-parity.mjs`、`scripts/css-drift-check.mjs`、`scripts/ui-copy-check.mjs` 全绿。
- **A2 的测试 fixture 必须改成真实 SQL 可能产出的形状**——这轮的教训就是假 fixture 盖住了 bug。

---

## 五、请审查员重点证伪的

1. **A 部分三条我是否判断正确**，尤其 A1（生产数据验不出差异，只能靠状态机语义）。
2. **B1 的硬前置是否成立**——设置页真的漏做了那两项吗？还是有我没找到的入口？
3. **B3 的未验证项**——`card_operational_overrides` 改回 `NORMAL` 前端到底有没有入口？
4. **我自查是否还有遗漏**：本轮我改过的代码全部列在 `git log --oneline` 的 D-292~D-301 对应提交里，请核对是否还有「只在演示库验过、没在生产跑过」的聚合。
5. **`occurred_at` 全表 NULL** 是否该另开一条修（本文只报不改）。
