# 第⑥块 · CDK 页重做（2026-09-20）

> **给执行者（Codex）**：本文是任务书，只写**做成什么样**和**怎么验**，不写怎么改代码。
> 进仓先按 `AGENTS.md` 四份顺序恢复上下文。**动手前先读 `docs/HANDOFF_NOW.md`**。
>
> **状态**：设计与核查已完成（本文），**代码一行未动**。原型已定稿，Lemon 逐条点过头。
> **口径**：本文凡标「实查」的都附查询语句与原始输出；标「代码显示」的只核到代码、未在生产验证。
> **生产**：仍是 `20260918-step5b-b0a36d4`（⑤b 旧后台），第⑥块四页一行都没上生产。

---

## 零、范围与不做

**2026-09-21 补充裁定 D-314**：不做「撤销发出回库存」，原型该按钮不纳入实现，未兑换码不再交付时走作废；保留付款未知锁定及无付款失败自动退码规则。用户不做囤货后拆给多渠道、多价格销售，不新增销售批次/拆批模型，继续采用本任务书批次级渠道与金额。此处是需求更新，旧代码尚未调整。

**2026-09-21 有效期裁定 D-315（覆盖下文旧默认）**：新码从生成起默认30天；可自行设定期限、可人工延期，单张和批量同规则。未填写自定义期限时用30天，不再是不过期。不做发出起算、首次兑换后永久重试、自动延期或复杂售后状态机；沿用现有退码/付款未知锁定规则。历史码不自动改期。实现验收需覆盖默认值、自设、延期、到期拒绝新单与付款未知保护。

**本轮做**：CDK 页按 A 版定稿重做 + 四个必修 bug + 批发（按批发出 / 按渠道记）+ 迁移 056。

**2026-09-21 发码裁定 D-316（覆盖下文留空即库存的规则）**：正常生成不强制去向/备注，不以备注空白判断库存，不要求逐笔补登记；少量应急备码生成时另行标记、可备注，用于网络异常或不方便操作后台时从预存清单发给客户。离线发出不可自动感知，未兑换不等于未出售，统计不得假称实时可售库存；不扩展拆批结算系统。详细最小交互尚待收敛，代码未改。

**D-316 补充已确认**：应急发码时在预存清单标记已发，恢复方便操作后台后补标记；不要求离线打开后台。普通生成直接复制、备注选填；应急备码生成时勾选，可预存手机。以上覆盖“详细最小交互尚待收敛”中的发码流程部分，顶部统计名称尚待收敛，代码未改。

**2026-09-21 卡网裁定 D-317**：有效期增加明确的「不过期」选项，卡网投放批次主动选择该项；普通生成默认30天不变。卡网自动销售发货，不对接销售接口、不逐笔补登记销售；投放码不再当应急备码或重复出售，未兑换不推断未售。不修改已有码，保留应急备码原补登记流程。验收须区分“未传自定义期限→默认30天”与“明确选不过期→无到期限制”，并检查生成请求幂等的一致性。

**本轮不做**：
- 诊断页（维持现状，不动）
- 那 21 张自用期老码的作废（**Lemon 已同意做，但定在本页上线后用页面批量作废**，见 §七）
- 那 16 张 09-07 前的历史残留（Lemon 定不动数据）
- 金额强制化（选填就是选填）

---

## 一、依据清单

| 类型 | 依据 | 关键内容 |
|---|---|---|
| 原型（定稿） | `docs/design/prototypes/step6-cdk-a-interaction.html` | **A 版「一条流水线」可交互稿**，Lemon 2026-09-20 挑定并逐条确认交互 |
| 原型（比稿） | `docs/design/prototypes/step6-cdk-compare.html` | 三版比稿（A/B/C），**A 已选定**；B/C 已否，不要回头实现 |
| 决策 | **D-279** 六条 | 结果区／单码列表／单码作废／生成即复制／状态说人话／全局搜索 —— **已实现，本轮保留** |
| 决策 | **D-286** 两条 | 交付负债可见（`issued_at`）+ 码有效期（`expires_at`）。**`expires_at` 只实现了读，本轮补写入口** |
| 决策 | **D-245** | 两阶段方案退休、305/306 关。首屏说明里「Pro 是两阶段」那句**必须删** |
| 决策 | **D-313**（本轮新立，见 `DECISIONS.md`） | 批发做进来／渠道自由填／批发金额记批次／金额选填／异常剔除 09-07 前历史／绑定订单列换客户邮箱 |
| 决策 | **D-281** | 后台不换栈：原生 JS + CSS 按页拆文件 |
| 决策 | **D-293** | CSS 只许降不许升：新规则用裸 `var(--wb-*)`，不加字面色回退 |
| 硬边界 | **D-254** | 不碰 `browser-mvp/` |

**皮肤**：候光 token（与工作台、卡片页同）。CDK 页现在是旧皮，本轮换。参照 `docs/design/prototypes/_frozen/cards-a/README.md` 的冻结规矩。

---

## 二、页面长什么样（A 版定稿）

自上而下四块，没有第五块：

```
① 四格数     欠交付 / 在手可卖 / 已成功交付 / 要看一眼
② 生成条     [数量][产品] (生成并复制)      ← 数量>1 时滑出：发给 / 这批收 / 有效期
③ 一张表     搜索 + 4 个筛选 + 批量操作条 + 表格 + 分页
④ （无）     批次列表整块删掉，退成 ③ 的筛选条件 + 一个「批次与导出」菜单
```

**表格的列**（顺序照此）：勾选框 / 卡密 / 产品 / 状态 / 去向 / **客户邮箱** / 最近动静 / 操作

### 2.1 四格数

| 格子 | 口径 | 生产真值（2026-09-20 实查） |
|---|---|---|
| 欠交付 | `status='AVAILABLE' AND issued_at IS NOT NULL` | **0**（`issued_at` 列尚未应用生产） |
| 在手可卖 | `status='AVAILABLE' AND issued_at IS NULL` | **21**（Plus 19 + 20X 2） |
| 已成功交付 | `status='REDEEMED'` 且订单 `RECHARGE_SUCCESS` | **20** |
| 要看一眼 | `status='REDEEMED'` 且订单 `RECHARGE_FAILED/CLOSED` **且 `COALESCE(orders.finished_at, orders.created_at) >= '2026-09-07 15:00:00'`** | **1** |

**第四格的时间界线不许去掉**（D-313）。理由：退回机制 2026-09-07 才上线（commit `f8c1d30`，release `20260907-cdk-rules-44b00cd`），此前失败单的码没退回是历史，不是当前系统的产出。去掉界线这一格是 17，全是噪音。

> **⚠️ 2026-09-20 订正（Codex 审查 C-「事实源冲突 3」，已查证并认账）**：本条原写 `orders.updated_at >= ...`，**是错的**。`orders.updated_at` 的定义是 `on update CURRENT_TIMESTAMP(3)`（实查 `SHOW COLUMNS FROM orders`），它记的是「最后一次写这行是什么时候」，不是「订单什么时候终结的」。
>
> **生产已经被刷过一次**：15 条订单的 `updated_at` 全是 `2026-09-05 23:10:11.628` 同一秒，而它们的 `created_at` 跨 2026-08-19 ~ 09-01（相差 4~17 天）。再来一次这样的批量写（补记账本、状态订正、数据迁移），这 15 条会**整批涌进「要看一眼」**，那一格从 1 跳到 16。
>
> **改用 `finished_at`**：实查覆盖率 CLOSED 21/21、RECHARGE_FAILED 36/37、RECHARGE_SUCCESS 19/20；那 17 条的 `finished_at` 是真实终结时间（`2026-08-19 17:37:31` 等），不受后续写影响。换字段后当前值**仍是 1**，但语义稳定了。
>
> **1 条 `finished_at IS NULL`**（`PJV1-bCv-NWwyhLEdU9FwxxVH`，08-21），用 `COALESCE(finished_at, created_at)` 兜——它落在界线之前，算历史，与现状一致。**这个 fallback 要写进契约断言，不许留成隐式行为。**

**第三格现在叫「已交付」且值是 37，这是错的**。`summarizeCdkLiability`（`v1/src/services/cdk-service.js:581`）的 `delivered = SUM(status='REDEEMED')` 算的是「码被消费掉多少张」，而同一页的行标签 `cdkStatusLabel`（`v1/public/admin/assets/admin.js:776`）把「已交付」定义成「REDEEMED 且订单成功」＝20 张。**同一个词两个数，本轮统一到「已成功交付＝20」那个口径。**

### 2.2 生成条

- 数量 **= 1**：只有 `[数量][产品](生成并复制)` 三个控件，零噪音
- 数量 **> 1**：滑出三个字段 `发给[自由填] 这批收[金额] 有效期[日期]`，**三项都可留空**（留空＝囤货，算「在手里」）
- 生成后自动做两件：**表格自动筛出刚生成这批**（并清掉其他筛选条件）+ 顶部出提示条 `刚生成 N 张 · 下载 TXT · 复制全部 · 知道了`
- **不自动下载**（D-279 原则：生成只创建批次，下载要单独点）

### 2.3 「去向」列 —— 这是批次的唯一露面方式

Lemon 原话：「我需要都记住批次号吗？可以通过一个 cdk 找到整个批次吗？」答案是**界面上不出现批次号**：

- 批发码：去向列显示**渠道名**（`小李渠道`），**点它＝筛出整批**
- 批发码但没登记去向：显示 `09-20 那批 · 30 张`，同样可点
- 零售单张码：显示客户备注或 `—`，**不可点**（它没有同批）
- 批次筛选下拉：**只列多于 1 张的批次**，用人话 `小李渠道 · 50 张 · 09-19`。生产 66 个批次里 65 个只有 1 张码（实查），全列进去是 66 条噪音
- 批次号只出现在导出文件名与倒查里，页面上不摆

### 2.4 客户邮箱列（Lemon 两次强调）

- 原来的「绑定订单」列**换成**「客户邮箱」
- **完整邮箱，不脱敏**。理由与 D-286 裁定明文码直接显示同一条：后台只有 Lemon 一人使用
- 邮箱**可点，进订单详情**（订单号不单独占一列）
- 数据够：生产 37 条 REDEEMED 码全部有 `customer_email`（实查 `with_email=37`）

### 2.5 历史残留怎么显示（原型逼出来的，Lemon 已认）

那 16 张 09-07 前的残留：
- 列表里**如实显示**「兑了没成 · 码没退回」，行内带灰色 `09-07 前` 标记
- **不进第四格**；第四格小字写明「不含 09-07 前的 16 张」
- 筛这个状态应得 17 行（1 条无标记 + 16 条带标记），而顶部那格是 1 —— 差额由行内标记当场解释

---

## 三、四个必修 bug（都有复现证据）

### 3.1 搜索框搜不到当前页之外的码 【最严重】

`listCdkCodes`（`v1/src/services/cdk-service.js:471`）先 `LIMIT/OFFSET` 取行，**再在 JS 里对取回的那一页过滤 `q`**（同文件 `:527`）。

真实调用复现（隔离库 `step6_demo`）：
```
[全量] total = 30  第 25 行有明文: PLUS-9CJCX-KGNSQ-VN7MQ-WGFR5 (AVAILABLE)
[搜索] limit=24 offset=0 q="PLUS-9CJCX-KGNSQ-VN7MQ-WGFR5"
  返回 codes.length = 0 （期望 1）
  页面分页条会写： 1-0 / 共 30
[对照] limit=200 同一 q → codes.length = 1
```

**生产影响**：75 张码、页大小 50 → **最早的 25 张搜不到**，页面显示「没有符合条件的 CDK」。对外开放后客户报码来问就断线。

对照：顶栏全局搜索走 hash 精确查找（`v1/src/services/admin-read-service.js:1091`），任何码都能搜到。**一个后台两个搜索框，一个对一个错。**

**改完应该**：`q` 参与 SQL 过滤，`total` 是筛后的数，分页条口径与筛选结果一致。

### 3.2 「最近动静」列对已作废的码显示创建时间

取值链是 `redeemedAt || issuedAt || createdAt`（`v1/public/admin/assets/admin.js:3352`），**不含 `revokedAt`**。

生产实查（17 张 REVOKED）：
```
created     revoked     相差
2026-09-14  2026-09-18  4 天
2026-08-23  2026-09-01  9 天  （×5）
```

### 3.3 批次列表每 10 秒在 50 和 66 之间抖

`setInterval`（`admin.js:3010`）每 10 秒刷新当前视图，CDK 页刷的是 `loadCdkBatches`（`:3016`），而它带 cursor 累加、`switchView` 又只 `resetCdkCodePaging()` 没 `resetCdkBatchPaging()`。

复刻状态机跑真实接口：
```
进页：            页脚「1 个批次 · 还有更多」
第 1 次自动刷新：  页脚「2 个批次」
第 2 次自动刷新：  页脚「1 个批次 · 还有更多」   … 无限交替
```

生产 66 个批次、页大小 50 → 在「50 个批次 · 还有更多」和「66 个批次」间跳，「加载更多」按钮跟着出现消失。

**注**：本轮批次列表整块删掉，这个 bug 随之消失。但**自动刷新该刷主列表而不是批次**——现在主列表（单码）根本不在自动刷新链里，刷新策略和页面重点是反的。

### 3.4 `expires_at` 只有读没有写

三形态查完（结论可直接引用，不必重查）：
```
1 按名字： v1/src 里对 cdks.expires_at 的引用全是读
          （order-intake 校验 :157 / cdk-verify 读 :17 / cdk-service 读 :490）
2 按内容： 全部 INSERT INTO cdks / UPDATE cdks 语句列完——没有一条写 expires_at
          生成时插的列 = (id, code_hash, hash_version, status, batch_no, plan_type)
                        cdk-service.js:224
3 前端：   没有任何设置有效期的输入框
```
结果：`expires_at` 永远 NULL，「已过期」永远 0，liability 的 expired chip 永远不显示。

**本轮补写入口**：生成条的「有效期」字段 + 批量操作条的「设有效期…」。

---

## 四、批发要新加的东西

### 4.1 迁移 056（Lemon 已同意方向，**应用生产前须单独确认**）

`cdk_batches` 现在只有 `batch_no / request_key / plan_type / requested_count / codes_ciphertext / created_by / created_at / revoked_at / revoke_reason`（实查 `SHOW COLUMNS`），**没有渠道、没有金额、没有发出时间**。

要加：**渠道名（自由填）/ 金额 / 币种 / 发出时间**。只加列、不动存量，全部可空。

**金额记在 `cdk_batches`，不是往 `customer_payments` 加 `batch_no`**（Lemon 定：批发金额记批次，不按张均摊）。

> 背景：`customer_payments` 是**按 cdk_id 一码一行**，生成码时自动插入（`cdk-service.js:234`）。生产 73 行，`payment_channel` 全是 `EXTERNAL_UNSPECIFIED`、`payment_status` 全是 `PAID`、**`amount` 非空 0 行、`paid_at` 非空 0 行**（实查）。零售金额仍走这张表，批发走批次。

### 4.2 「登记去向」的两条路径

- **主路径**：生成时填（数量 >1 自动展开）
- **补登记**：筛出那批 → 全选 → 批量条「登记去向…」

两条路径写的是同一份底数：**码级 `issued_at`**。批次上的渠道/金额只是这批的属性，**不产生第二个分母**。`owed` / `stock` 的口径零售批发共用，不许出现两套。

---

## 五、验收标准（动手前先看，做完逐条走）

发布门槛三件（`HANDOFF_NOW.md`）：**外观符合选定方案 + 数据字段口径正确 + 按钮业务结果正确**。测试数量 / HTTP 200 / SQL 有返回都不算数。

### 5.1 外观层

1. 冻 `_frozen/cdk-a/` 快照（三份 CSS + README），照 `_frozen/cards-a/README.md` 的规矩
2. 写定稿原型：**link 快照**（不是实时 `/admin/assets/*`）、**被量的树里零原型专属 class**、**带全外壳**（`.admin-shell` 是 `230px + 1fr`，少了侧栏整页被压窄，卡片页因此报过 26 处假差异）
3. `node scripts/visual-parity.mjs` 全绿（1440px + 折叠态）
4. `node scripts/css-drift-check.mjs`、`node scripts/ui-copy-check.mjs` 全绿
5. **界面「像不像设计稿」不许用眼睛判**（D-292）：测量前先断言 `innerWidth`，放大只用 `transform: scale()`

### 5.2 数据口径层 —— 四个数各写一条断言

对着生产同口径 SQL 的值断言，**不是「有返回就算过」**：

| 断言 | 期望（生产 2026-09-20） |
|---|---|
| 欠交付 | 0 |
| 在手可卖 | 21 |
| 已成功交付 | **20**（不是 37） |
| 要看一眼 | **1**（不是 17）。口径用 `COALESCE(finished_at, created_at)`，**不是 `updated_at`** |
| 筛「兑了没成」的行数 | 17（1 条无标记 + 16 条带 `09-07 前`） |

### 5.3 按钮业务结果层

| 断言 | 期望 |
|---|---|
| 搜第 51 名之后的码 | **能搜到**。这条**第一次跑必然红**，红了才证明契约不是空的 |
| 已作废行的「最近动静」 | 显示 `revoked_at`，不是 `created_at` |
| 点去向列的渠道名 | 筛出整批，分页条口径跟着筛选结果走 |
| 数量 1 → 50 | 批发三字段从 `display:none` 变 `flex` |
| 生成 50 张 | 自动筛出这批 + 顶部提示条出现 |
| 批量登记去向 | 选中的码 `issued_at` 被写、批次渠道被写、`owed` 跟着涨 |
| 批量作废 | 只作废未兑换的，已绑订单的拒绝 |
| 客户邮箱列 | 显示完整邮箱、可点进订单详情 |

### 5.4 工程层

- `cd v1 && npm test` —— **基线 1013 / 946 pass / 0 fail**（改前先跑一次确认基线没漂）
- 改 `admin.js` 后**同步 bump `index.html` 里的 `?v=`**（本仓库惯例）
- **这一页现在零测试覆盖**（三形态查过：按端点名 `cdks/codes|cdks/liability`、按函数名 `listCdkCodes|summarizeCdkLiability`、按页面 id `cdk-codes|cdk-liability|cdk-code-q`，`v1/test` 与 `scripts` 全部无命中）。本轮要补上。
- **变异测试**：故意改坏每条断言看它报不报。抓不到的要么补探针，要么**在契约里如实标明盲区**，不许让下一个人以为它守住了

### 5.5 收尾

`bash scripts/wrapup-check.sh` 八项全绿。

---

## 六、边界（越界即停下来问 Lemon）

1. **不碰 `browser-mvp/`**（D-254）
2. **生产写操作先开口问**：应用迁移 056、发布、改开关、作废那 21 张老码
3. **删代码按语法边界（配对大括号），不按字符串距离**（D-289）。卡片页那轮因此误删 14 个顶层事件绑定，**951 条测试全绿而侧边栏点不动**
4. **说「不存在 / 零引用」之前至少查三种形态**：按名字、按内容、按 git 历史。本文里所有「零引用」结论都已经这样查过，可直接引用；新的结论要自己查
5. **CSS 只许降不许升**（D-293）
6. **改需求 / 交互 / 范围 → 停下来问**
7. **有意留红的测试**：全量里唯一那条红（F-65 相关）已在 D-306 结案改写，现在基线是 0 fail。再出现红的**不许为了全绿改断言**

---

## 七、留给 Lemon 的（不要自己做）

| 事项 | 状态 |
|---|---|
| **那 21 张自用期老码作废** | **Lemon 已同意作废**。时点定在**本页上线后用页面批量做**（筛「在手里」→ 全选 → 作废），顺带验收批量作废按钮。现在不要写脚本动它 |
| **迁移 056 应用生产** | 方向已同意，**应用前单独确认** |
| **发布** | 四页 + 迁移 055 + 056 一起发，回滚点 `20260918-step5b-b0a36d4`。**发布与迁移各需当次点头** |
| 那 16 张历史残留 | Lemon 定**不动数据**，只在界面上标 `09-07 前` |

---

## 八、演示库与生产的已知差异（别被它误导）

隔离库 `step6_demo` 在几处会**假装成 bug 或掩盖 bug**，验收时对照这张表：

| 项 | 生产 | 演示库 | 后果 |
|---|---|---|---|
| 迁移 055 三列 | **无** | 有 | 生产上 `/cdks/codes` 与 `/cdks/liability` 现在会 500 |
| 总码数 | 75 | **30** | **30 < 页大小 50 → 搜索 bug 在演示库上永不可见** |
| REVOKED | 17 | **0** | 「已作废」行与它的时间 bug 验不到 |
| REDEEMED 能 JOIN 上订单 | 37 | **0** | 客户邮箱列全空、状态标签全退化成「使用中」 |
| `batch_no IS NULL` | 0 | **24** | 演示库 30 行里 28 行显示「—（批次未留明文）」；生产是 68/75 有明文 |
| `pro_5x/20x` 路线 `accepts_new_orders` | **0（关）** | **1（开）** | 生产那 2 张 20X 码应标「暂不可兑」，**D-286 ② 的功能在演示库上验不到** |

**另附一条教训**：本窗口第一版探针用 `mysql.createPool(DATABASE_URL)`，漏了 `timezone:'Z'`（生产是 `v1/src/db/pool.js:23`），得出「批次翻页第 2 页恒空」的**假结论**。自己写的探针必须与生产同连接池配置。

---

## 九、生产实查原始输出（本文所有数字的来源）

`browser-mvp/scripts/prod-query.sh`，2026-09-20：

> **2026-09-20 晚补（Codex 指出本节「只列输出、未附对应 SQL」，认账）**：下面每段都补上原句，按 D-234「查询语句 + 关键原始输出」。执行者可直接复制复跑。

```sql
-- 状态分布
SELECT status, plan_type, COUNT(*) FROM cdks GROUP BY status, plan_type ORDER BY status, plan_type;
SELECT COUNT(*) AS total, COUNT(DISTINCT batch_no) AS batches FROM cdks;
SELECT COUNT(*) AS null_batch FROM cdks WHERE batch_no IS NULL;

-- 批次大小分布
SELECT n AS codes_per_batch, COUNT(*) AS batches
  FROM (SELECT batch_no, COUNT(*) AS n FROM cdks GROUP BY batch_no) t GROUP BY n ORDER BY n;

-- REDEEMED 按订单状态（决定行标签「已交付」还是「使用中」）
SELECT o.status, COUNT(*) FROM cdks c JOIN orders o ON o.id=c.order_id
 WHERE c.status='REDEEMED' GROUP BY o.status ORDER BY COUNT(*) DESC;

-- 四格数（迁移 055 后的口径；owed/expired 因 issued_at/expires_at 列尚未应用生产而恒 0）
SELECT SUM(status='AVAILABLE') AS stock, SUM(status='REDEEMED') AS delivered_old_wrong FROM cdks;
SELECT COUNT(*) AS delivered_ok FROM cdks c JOIN orders o ON o.id=c.order_id
 WHERE c.status='REDEEMED' AND o.status='RECHARGE_SUCCESS';
SELECT COUNT(*) AS needs_look FROM cdks c JOIN orders o ON o.id=c.order_id
 WHERE c.status='REDEEMED' AND o.status IN ('RECHARGE_FAILED','CLOSED')
   AND COALESCE(o.finished_at, o.created_at) >= '2026-09-07 15:00:00';

-- 退回机制上线后有没有漏网
SELECT o.status, c.status AS cdk_status, COUNT(*) FROM orders o JOIN cdks c ON c.order_id=o.id
 WHERE o.status IN ('RECHARGE_FAILED','CLOSED') AND o.updated_at >= '2026-09-07 15:00:00'
 GROUP BY o.status, c.status;
SELECT DATE(created_at) d, COUNT(*) FROM cdk_delivery_events
 WHERE event_type='RETURNED' AND created_at >= '2026-09-07 15:00:00' GROUP BY d ORDER BY d;

-- updated_at 不是终结时间的证据（Codex C-「事实源冲突 3」）
SHOW COLUMNS FROM orders LIKE '%_at';         -- updated_at: on update CURRENT_TIMESTAMP(3)
SELECT updated_at, COUNT(*) FROM orders GROUP BY updated_at HAVING COUNT(*)>3
 ORDER BY COUNT(*) DESC LIMIT 5;              -- 2026-09-05 23:10:11.628 → 15 条
SELECT status, COUNT(*) n, SUM(finished_at IS NOT NULL) has_finished FROM orders
 WHERE status IN ('RECHARGE_SUCCESS','RECHARGE_FAILED','CLOSED') GROUP BY status;

-- customer_payments
SELECT COUNT(*) n, SUM(amount IS NOT NULL) with_amount FROM customer_payments;
SELECT payment_channel, payment_status, COUNT(*) n, SUM(amount IS NOT NULL) amt,
       SUM(paid_at IS NOT NULL) paid, SUM(operator_note IS NOT NULL) note
  FROM customer_payments GROUP BY payment_channel, payment_status;

-- 取不到明文的码
SELECT SUM(b.batch_no IS NULL) AS no_batch_row,
       SUM(b.batch_no IS NOT NULL AND b.codes_ciphertext IS NULL) AS no_cipher, COUNT(*) AS total
  FROM cdks c LEFT JOIN cdk_batches b ON BINARY b.batch_no = BINARY c.batch_no;
```

原始输出：

```
=== 状态分布 ===
AVAILABLE  plus     19
AVAILABLE  pro_20x   2
REDEEMED   plus     36
REDEEMED   pro_20x   1
REVOKED    plus     17
总计 75 条 / 66 个 batch_no / batch_no IS NULL 0 条

=== 批次大小分布 ===
1 张码 → 65 个批次
10 张码 → 1 个批次

=== REDEEMED 按订单状态 ===
RECHARGE_SUCCESS  20
CLOSED             9
RECHARGE_FAILED    8

=== 迁移 055 后四格数会显示什么 ===
owed 0 / stock 21 / delivered(旧口径) 37 / 已成功交付 20 / 要看一眼(剔历史) 1 / 不剔 17

=== 退回机制上线后有没有漏网 ===
09-07 15:00 之后终结的 FAILED/CLOSED 单，码还卡在 REDEEMED 的：1 条
  （PJV1-8DB4vPHrXotbcNBJHETH，第④步演练单，CURRENT_STATE 写明「CDK 停在 REDEEMED 作死码」，故意的）
同期 RETURNED：09-08 6 / 09-09 1 / 09-10 1 / 09-11 3 / 09-12 5 / 09-13 19 / 09-14 2 / 09-16 1 / 09-18 2
→ 机制上线后零漏网

=== customer_payments ===
73 行，payment_channel 全 EXTERNAL_UNSPECIFIED，payment_status 全 PAID
amount 非空 0 行 / paid_at 非空 0 行 / external_reference 非空 0 行 / operator_note 非空 6 行
recorded_by: admin 67 + migration:024 6

=== 取不到明文的码 ===
7 条（4 个 batch_no 在 cdk_batches 里没有行 + 3 个有行但 codes_ciphertext 为 NULL）
```

---

## 十、页面上要删掉的文案（逐句判过）

| 句子 | 为什么删 |
|---|---|
| 「Pro 是两阶段：先开通 Plus，再在同一账号里升级」 | **D-245 已作废**，可从 Free 直升 20X |
| 「外部付款只记录『已确认』，实际金额和付款时间可在订单详情中补录；未补录时导出显示『未记录』」 | 说的是订单详情页的事；且生产 73 条付款记录 `amount` 全空，从没补录过 |
| 「一次可生成 1–1000 个」 | 生产 65/66 批只生成 1 个；数量框本身已经写着 min/max |
| 「数据库保存不可逆 HMAC，批次恢复副本加密保存」 | 实现细节，运营据此做不了任何事 |

**保留**：「下载文件不代表已经交付客户」（它对着「登记发出」这个动作）、「作废只影响尚未兑换的卡密」（作废前要知道）。

判断标准（D-312 的教训）：**界面上每多一句话，先问它对着的人能不能据此做点什么。做不了的，写得再准确也删掉。**

---

## 十一、Codex 接班评估提出的待裁定项（2026-09-20，`docs/reviews/2026-09-20_cdk-takeover-report.md`）

统筹已读原报告并逐条查证。**下面七条里，有四条是已查证的代码事实、三条是设计缺口**；除 C-04 前半与本文 §2.1 的订正外，**其余全部需要 Lemon 裁定后才动**，执行者不要自行选一个解法。

| 编号 | 性质 | 已查证的部分 | 待裁定 |
|---|---|---|---|
| **C-01** 撤销发出的语义 | 设计缺口 | `markCdkIssued(issued=false)` 只清 `issued_at/issued_note`（`cdk-service.js:559-577`），建单不看 issued 标记 | 「纠正误登记」与「客户退货」必须分开。退货后的码能不能直接回库再卖 |
| **C-02** 批次＝生成单位又＝销售单位 | **设计缺口，统筹认账** | 迁移 056 把渠道/金额/发出时间放在唯一的 `cdk_batches` 行，而原型允许任意选码批量登记 —— 两者矛盾 | 整批只能卖给一个渠道（页面须**限制**而不是暗示可拆卖），还是支持囤货后分批销售（那金额就不能挂批次） |
| **C-03** 整批 TXT ≠ 本次交付清单 | **已查证属实** | `downloadCdkBatch`（`:370-384`）只解密 `codes_ciphertext`，不查码级状态/去向/到期 | 「原始备份」与「本次交付」要拆成两个动作，文案与按钮分开 |
| **C-04** 四格不表示完整履约 | 前半**已查证属实**，后半待裁定 | `stock = SUM(AVAILABLE AND issued_at IS NULL)`（`:585`）**不排除过期与路线停用**——生产 2 张 20X 路线关着却算在「在手可卖 21」里 | 在途单（已 REDEEMED、订单未终态）四格都不算；作废已发码会让「欠交付」消失而不证明已退款。这些要不要有落点 |
| **C-05** 有效期语义没定全 | 设计缺口 | 退码不改 `expires_at`（`cdk-return-repository.js:69`），建单拒到期码（`order-intake-repository.js:157`） | 系统自身失败导致错过期限，重试权归谁；日期按 UTC+8 哪个时点截止；已售码能否缩短期限 |
| **C-06** 批量写的事务与幂等 | **已查证属实** | `revokeCdkCode`（`:540-553`）与 `markCdkIssued`（`:563-575`）都是更新与审计**分两次 `pool.query`、无事务**；批次幂等键只核数量与产品（`decodeStoredBatch:129`） | 新增批量写必须事务化 + 新字段进幂等判定。**不要靠循环调用现有单码函数实现批量** |
| **C-07** 退码后的历史追踪 | 设计缺口 | 退码清空 `order_id`（`:69`），列表只按当前 `order_id` JOIN 邮箱（`:492`） | 退回的码会显示成「在手里 / 无客户邮箱」，与从未发出的库存分不开。数量=1 隐藏去向字段加重了漏登记 |

**统筹对这份评估的判断**：C-02 是我的设计缺口，我没想清楚「囤货后分批卖」；C-03/C-04 前半/C-06 是已存在的代码事实，我在对数时漏了；C-01/C-05/C-07 是外售开张前必须定义的业务语义，属于 Lemon 的决定。

**Codex 对本文的两条批评，统筹认账并已改**：① §九 只列输出未附 SQL（已补，见上）；② 第四格用 `orders.updated_at` 判历史是错的（已改 `COALESCE(finished_at, created_at)`，见 §2.1 订正框）。

**这份评估没做的**（它自己标明了，接手别当已验证）：未连生产、未做并发与事务故障验证、未做公网安全审计、未验证真实外售与退款流程。它跑的 `node --test test/cdk-service.test.js test/cdk-return-repository.test.js test/cdk-verify-service.test.js` 得 29/29 通过，**只证明既有单测没被破坏，不覆盖上面任何一条**。
