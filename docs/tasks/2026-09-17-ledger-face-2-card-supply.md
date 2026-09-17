# 清账本 · 第二面：供卡（2026-09-17，给 Lemon 过）

> 四段：现在是什么（证据）、你说过要什么、我看到的真正问题、我建议怎么做 + 要你答的。过了才写进账本 §3.A。这一面吃掉旧 A4 剩余部分、A3（开卡金额/每卡单数）、A5（销卡）、G2 的一半，以及面一留下的「按需同步」缝。

## 1. 现在是什么（代码 + 生产，2026-09-17 08:30 UTC）

### 1.1 缺卡时系统做什么
- 分卡找不到合格卡 → 订单 `WAITING_FOR_CARD`，排一条按需同步（只对 hnskj 卡且同步过期 15 分钟以上的），发一条 critical 告警「订单正在等待卡片」，**然后每 60 秒重试分卡，直到有人开出卡**（`workflow-repository.js:216-380`）。
- 自动开卡两个开关都是 false（`card_auto_replenishment_enabled` / `card_balance_recharge_enabled`），所以分卡时不会触发任何补给动作。
- **历史 24 次等卡的结局**（`order_events`）：13 单最后关闭（平均等 8.8 小时）、5 单成功（平均等 12.3 小时）、6 单失败（15 分钟）。**等卡 = 等人**。
- 客户在等卡期间看到的是「准备中」（`PREPARING`），没有时间承诺。

### 1.2 两台的开卡链路（谁触发、谁执行、入库怎么来）

| | hnskj（101） | highvcc（103） |
|---|---|---|
| 人工开卡 | 后台「人工开卡」建 `card_stock_jobs` PENDING → **没有任何服务执行它** → 要人 ssh 到服务器手跑 `card-stock-job-runner.js`（D-241 就是这么开的 5276） | 后台 `/backup-cards/highvcc/open`（确认词 `开卡 {vid} {amount}`）→ `newCard` → **即时入库**（`recordOpenedCard` 直接 INSERT，`MANUAL_IMPORT`） |
| 自动开卡 | `scheduleAutomaticJob`（同一个 runner 里）：开关 on + 有 WAITING_FOR_CARD + 日限内 + 可分配 ≤ 阈值 → 建 AUTOMATIC job。**但生产有 930 条旧架构残留的 `REVIEW_REQUIRED` job（924 条 error PROVIDER、5 SCHEMA、1 TIMEOUT，09-05 前）命中「未解决付费任务」检查 → 开关一打开就永远返回 `FUNDS_REVIEW_REQUIRED`，一张也开不出来** | **没有**。`openCard` 是即时的，但没人调度它 |
| 另一条自动线 | worker `PURCHASE_CARD` 任务（订单驱动，`workflow-handlers.purchaseCard`，带幂等键、买完靠列表比对识别新卡）——需 worker `CARD_WRITES=true`（现 false）；**代码里没有任何地方创建这个任务**（只有 claim/complete 引用），是死线 | — |
| 开卡撞「钱扣了卡没入库」 | `purchaseCard` uncertain → 列表比对识别，多张则 REVIEW（`identifyPurchasedCard`）；runner 路径同理 | `HIGHVCC_OPEN_NO_PAN` → 错误里带 cardId，**人工**跑 `reconcile-highvcc-card.mjs` 补记；`pan_hmac` 唯一键防重录 |
| 日限 | `card_replenishment_daily_limit=10`（按上海日，只算 AUTOMATIC） | 无 |
| 开卡金额 | `default_open_card_amount=16`（全局；与每卡 3 单打架，A3） | 后台每次手填 |
| 钱包余额 | `card_provider_snapshots` 每 5 分钟（现 $89.48） | 只后台点查 `wallet()`，不入库 |
| 卡余额同步 | read-sync 每 15s 跑一次、每卡按策略排，实际每小时一次（面一 §4） | 1 小时全量快照 |
| 交易入库 | 有 | 无（D-230） |
| 库存告警 | `CARD_STOCK_LOW`：可分配 ≤ 阈值（现 **1**）才报，**只算 hnskj**（`refreshLowStockAlert` 传的是 hnskj 账户） | **没有** |
| 销卡 | `withdraw` API 已接，无流程 | 手动删（无 API） |
| 限流 | 60 次/分钟（实测均值 4.6、峰 22） | 未知 |

### 1.3 库存现状（`cards`，08:30 UTC）
- hnskj：1 张可用（5276，$16，只在整点后 15 分钟合格）；12 张 FAILED/REFUND_WATCH 余额 $0（都是 $16 开、一单即光的旧卡）。
- highvcc：AVAILABLE 9 张 $154.56，其中真正能分的只有 29bb（$145）；其余 5 张余额 < $2、3 张标 RETIRED；HELD_FOR_REVIEW 5 张（快照里消失了，`MISSING_FROM_SNAPSHOT`，4dfa 账面 $50）。
- 销卡标记：RETIRED 22 张、PRODUCT_ONLY 1 张（`card_operational_overrides`），最近一次 09-08。
- 单量：近 14 天日均约 5 单，峰值 24（09-13）。目标几十上百单/天 ≈ 每天 20～70 张卡（Plus 3 单/卡）。

## 2. 你说过要什么
- 两台同等重要，hnskj 自动开卡不能排后，随时供得上（D-242）。
- 任何能开出卡的卡台都能用，新卡台要复用（D-246）。
- 每卡单数按产品：Plus 3、5X/20X 各 1；开卡 Plus $50（D-221/D-229）。
- hnskj 卡分卡时按需同步（D-246）。
- 销卡必须做（不销就持续漏拒付费），V2.0 只做待销清单 + 手动删（D-228/D-229/D-232）。
- 余额有变化就要通知（D-228）。
- 缺卡、开卡失败必须推手机（D-219）。
- 系统解决不了才叫人；稳定、不臃肿（D-244）。

## 3. 我看到的真正问题

1. **缺卡时系统不会自愈，只会等人。** 24 次等卡平均等 9～12 小时、过半最后关闭。这是「客户任意时间自助、运营不在场」最直接的断点。
2. **自动开卡在两台上都不成立。** hnskj 那条被 930 条旧残留卡死、开卡金额还是错的（$16 只够一单）；highvcc 那条根本没接调度。「两台并重自动供卡」现在是零。
3. **库存的眼睛只看 hnskj。** 阈值、告警、钱包快照都只有 hnskj；highvcc 缺卡没人知道，钱包多少钱系统不知道。
4. **触发方式是「有订单等了才去开」，不是「库存低了就补」。** 订单驱动意味着第一个客户必然等一次开卡（几十秒到几分钟，还要卡台不故障）。
5. **开卡有三条平行线（stock job / worker PURCHASE_CARD / highvcc openCard），只有一条半活着。** worker 那条没人建任务，是死代码；stock job 那条没人执行，靠人 ssh。臃肿且不可靠。
6. **合格窗口把好卡当没卡。** hnskj 卡每小时只有 15 分钟合格（面一 §4），运营看到的库存数随时刻跳。
7. **销卡没有流程**，22 张 RETIRED 是手工标的，12 张 hnskj 空卡还挂着，5 张 highvcc 卡从卡台消失了系统只能标「待审」。

## 4. 我建议怎么做

**一句话：把供卡从「订单缺卡才开、只认 hnskj、靠人跑脚本」改成「每台各保 N 张、低了就自动补、两台走各自适配器、开不出才叫人」。** 这是减法：三条开卡线合成一条调度，删死代码和残留。

### 4.1 库存水位驱动（替代订单驱动）
- 每卡台 × 每产品设「目标可分配张数 N」（设置页）。一个调度（复用 `scheduleAutomaticJob` 骨架，改成遍历所有 `purpose='CARD'` 账户）每分钟看一次：可分配 < N 且日限内且钱包够 → 按该卡台的适配器开一张（hnskj `purchaseCard`、highvcc `newCard`）。开卡金额按产品（A3：Plus $50、20X 按单价）。
- 订单 `WAITING_FOR_CARD` 仍保留为兜底触发（有单在等也算需求），但不再是唯一触发。
- 代价：改一个调度器 + 两个适配器接同一个接口；hnskj 请求每张卡约 3 次（开卡、列表比对、详情），日开 70 张也在 60/分钟之内。

### 4.2 打通两条执行线，删掉第三条
- hnskj：`card-stock-job-runner` 挂成 timer（或并入 worker 循环），后台「人工开卡」建的 job 和调度器建的 job 由同一个执行者跑，不再 ssh。**先清 930 条残留**（标成 `ARCHIVED_LEGACY`，不删行），否则调度器永远 `FUNDS_REVIEW_REQUIRED`。删 worker 的 `PURCHASE_CARD` 死线。
- highvcc：`openCard` 接进调度；`HIGHVCC_OPEN_NO_PAN` 自动转 `recordExistingCard`（重试补记，不重开）；`wallet()` 入库（G1 的一半）作钱包水位。token 过期 = 开卡失败 → 告警叫人贴 token。
- 幂等与资金安全不变：hnskj 幂等键、`pan_hmac` 唯一、列表比对识别、多张则 REVIEW。

### 4.3 库存的眼睛两台都要有
- `CARD_STOCK_LOW` 改成按卡台 × 产品，阈值 = 目标 N；highvcc 钱包快照入库后同样报「余额变化」（D-228）。
- 可分配数按「同步后」口径（4.4）。

### 4.4 按需同步（面一的缝在这里闭合）
- 分卡时若候选卡同步过期，**当场同步这一张再判**（1～2 次请求），不再「排 job → 等 15s runner → 等下一次分卡重试」。去掉「每小时一次、15 分钟合格」的抖动。
- 定时全量同步降频（每卡每小时改每卡 3 小时或只同步 ASSIGNED/RECHARGE_PROCESSING 的），把请求预算让给按需。
- 限流预算：按需每单 ≤2 次 + 开卡每张 ≤3 次 + 定时；峰值 24 单/天完全够，200 单/天要算一次（约每分钟 1～2 次），仍远低于 60。

### 4.5 销卡待办（D-232 范围内，不自动删）
- 清单口径：不再服务新单（用满 N 单 或 DEPLETED 或 RETIRED）+ 开卡时间 + 最短存活期已到 → 进「待销清单」，进「需要我处理」，两台都手动删；删完靠快照/同步事后确认。
- 现在就要处理的两批：hnskj 12 张 $0 空卡（`withdraw` 没意义，要不要在卡台销掉）；highvcc 5 张 HELD_FOR_REVIEW（是不是你删的，4dfa 那 $50 回钱包了吗）。

### 4.6 不做 / 删
- 补余额整条线（`card_balance_recharge_enabled`、`card_funding_attempts`、funding timer 每 5 秒空跑）：D-218 已弃，删。
- 旧每分钟自动开卡架构的残留（930 条 job 归档、`pojia-card-stock-runner.timer` 已停）。
- worker `PURCHASE_CARD` 死线。

## 5. 要你定 / 答的

1. **每台各保几张？** 按现在日均 5 单、峰 24，我建议 Plus：hnskj 3 张、highvcc 3 张起步，设置页可调；Pro 各 1 张。你定数。
2. **开卡金额**：Plus $50 定了；20X 门槛 150、基线写「20X 需 220 以上的卡」——20X 开多少？5X 开多少？
3. **每台每天最多开几张**（资金安全上限，替代现在的日限 10）？
4. **钱包最低水位**：hnskj 现 $89.48；基线写「HNSKJ 开卡要求账户余额 250 以上」——这条还成立吗？低于水位只告警还是也停开卡？
5. **hnskj 卡台故障时**（常发生）：调度器开卡失败 → 只告警，还是自动改开 highvcc 顶上？
6. **highvcc token**：能不能拿到不过期的 API key？拿不到就得接受「过期 → 告警 → 你贴」这个人工点。
7. **销卡那两批**（4.5）现在怎么处理？
8. 4.1 的「水位驱动替代订单驱动」你认不认？不认的话我按「订单驱动 + 修好两条线」缩。
