# 我的接手理解（2026-09-17，Fable 5.1，待 Lemon 核对）

> 按 `docs/tasks/2026-09-17-handover-verification.md` 做的接手核对产出。三件事：①自己读事实源、核生产、走代码主线；②把理解写下来给 Lemon 核对；③过了才算接手、才动账本。**本文是第②步，没有 Lemon 确认之前不算接手。**
>
> 每条结论后面括号里是证据位置（文件:行、查询、脚本输出）。标 **[代码]** 的只核了代码，标 **[生产]** 的核了 2026-09-17 05:30–05:58 UTC 的现场。全程只读，没改生产、没开卡、没切路线、没发布。

## 0. 三点定位

1. **整体**：V1 闭环已在生产跑（Plus 自动充值，API 与 Browser 两路线都有真实成功样本）；V2 改造在方案阶段，阶段 0/1/2 文档层面走完，2026-09-17 Lemon 加了「阶段 2.5 业务实际终审」，A 组审了 5 项后发现账本多处与真实脱节，于是定 D-243：**先换模型接手核对 → 清账本 → B/C 审 → 整体连贯审 → 落实 → 集成验收**。
2. **现在**：D-243 五步之前的「接手核对」这一步。本文就是产出。
3. **还剩**：接手核对过关 → 清账本定主线（五步①）→ 卡台解耦做不做的方向讨论（Lemon 定的第一个方向节点）→ B/C 组审 → 整体连贯审 → 落实 → 集成验收。

## 1. 项目在哪、为什么这么做

- **业务**：卖 GPT Plus 充值。客户拿 CDK（已付款权益）+ 自己的 ChatGPT Session 来，系统用我们的虚拟卡替客户在 ChatGPT 官网买 Plus，买完立刻取消自动续费，客户就得到一个月 Plus。运营只做三个选择（接不接单、走哪条路、用哪个卡台），系统解决不了才叫人。
- **为什么两条路线**：API 路线（ZZSHU）是黑盒供应商，拿卡+Session 一次做完付款和取消续费，但失败零原因、只认 hnskj 卡台；Browser 路线是我们自己的浏览器自动化（BitBrowser + 菲律宾出口，跑在 Lemon 的 Mac 上），有分步诊断，可接任何卡台，但依赖本机开着。两条路线共用订单/CDK/资金栅栏/消费账本。
- **为什么两个卡台**：hnskj（101，有开卡/查卡/交易/提余额 API，带幂等键）和 highvcc（103 = manual_excel，靠网页 token 调内部接口，能开卡、能读卡，销卡只能手动）。Lemon 2026-09-17 明确两台同等重要、经常来回切（D-242），不是主力+备用。
- **规模目标**：一天几十上百单（记忆 `project_scale_goal_airecharge`），当前近两周日均约 4.6 单（账本 §2.8 的 [I]/[J]，我未复算）。
- **V2 的中心**：CDK 驱动，六个面（展示/执行/资源/控制/通知/对账）各管一单链路的一段；本质是在保留的状态机之上整理执行器接口、卡供给、后台呈现、告警、对账（D-224 发现 B）。

## 2. 一单全链路主线（代码走通的，不是文档抄的）

### 2.1 主线图（文字）

```
客户                    服务器 pojia-web            服务器 pojia-worker                外部
─────                   ────────────────            ──────────────────                ────
验码 /cdks/verify ─────▶ cdk-verify-service（只验码，不查卡）
贴 Session /orders ────▶ createOrderFromCdk
                         ├ 锁 4 个 app_settings（含 accept_new_orders）
                         ├ 选路线 fulfillment_routes.accepts_new_orders=1
                         │   API   → 冻结卡台 = fr.card_provider_account_id（必须 hnskj）
                         │   BROWSER → 冻结卡台 = browser_card_source_selections（现 103）
                         ├ INSERT orders(CREATED, open_card_amount=全局16, 最低余额=按产品)
                         ├ CDK → REDEEMED
                         └ tasks: ASSIGN_CARD ──────▶ assignAvailableCard
                                                      ├ 在冻结卡台内按 eligibleInventoryCardSql
                                                      │   FOR UPDATE SKIP LOCKED 取余额最低的一张
                                                      ├ 有卡 → ASSIGNED + card_assignment_history ACTIVE → CARD_READY
                                                      └ 没卡 → WAITING_FOR_CARD + 排一条按需同步 card_sync_jobs
                                                              （自动开卡/补余额两个开关现都 false → 只告警等人）
                                                     PREPARE_RECHARGE：验 Session ≥1800s、有凭证、记 prepayment evidence
                                                     SUBMIT_RECHARGE（workflow-handlers.js:270 分叉）
                                                      ├ 非 MANUAL_IMPORT 卡先查 hnskj 卡详情
                                                      ├ beginAuthorizedAttempt（资金栅栏 recharge_attempts）
                                                      ├ API ────▶ ZZSHU createDirectOrder ─────────────────▶ ZZSHU
                                                      │            uncertain→SUBMIT_UNKNOWN；40030→已是Plus→WAITING_FOR_SESSION
                                                      │            成功→RECHARGE_PROCESSING，POLL_RECHARGE 每 5s 查 ─▶ ZZSHU
                                                      │            success→commitRechargeSuccess：账本 CONSUMED、分配 RELEASED、
                                                      │              卡 DEPLETED、订单 RECHARGE_SUCCESS（已取消）或
                                                      │              CANCELLATION_PENDING + RECHECK_CANCELLATION（60s×60）
                                                      └ BROWSER ─▶ browser_dispatch_jobs（jobKey browser-attempt:{attemptId}）
                                                                                    │
本机 Mac production-live-pool-worker（lane-1，PAY 模式，BitBrowser，菲律宾出口）◀────┘
  每轮三步：post-payment-verification → order-preflight → live
  live = claim job → executor.js：
    observe-page → session-bootstrap（注入 Session、清旧登录态）→ page-reload
    → account-readonly-probe（身份匹配、必须 free）→ card-material-preflight
      （解密 cards.card_credentials_ciphertext，校验卡台 == 订单冻结卡台）
    → checkout-navigation（点升级创建 Checkout）→ payment-stage×N：
        fill-billing-address → fill-billing-email → fill/resolve-secure-card-controls
        → wait-for-zero-tax-requote（PHP、税 0、报价一致）→ final-pre-submit-check
        → commitPaymentSubmissionIntent（持久意图，防重复点）→ submit-payment
        → human-verification-gate → observe-payment-outcome（60s 读页面 + confirmPlus）
    → CONFIRMED：markPaymentConfirmed（分配 RELEASED）→ recordPlusActivation
        → confirmCancellation（/backend-api/subscriptions/cancel）→ readCardTransactions + reconcile
        → recordCancellationConfirmed（run COMPLETED、attempt SUCCESS、订单 RECHARGE_SUCCESS）
    → 不确定：markPaymentUnknown（SUBMIT_UNKNOWN、funds_risk UNKNOWN）→ 排 post-payment-verification
        → 常驻 lane 用 LivePostPaymentRecoveryVerifier 只读复核（confirmPlus→confirmCancellation→reconcile）
        → 到期没定 → escalate → HUMAN_REQUIRED
    → 付款前失败：PRE_SUBMIT_FAILED（现场保留时等 90s 运营接手）→ safe abort → RECHARGE_FAILED、CDK 退回、卡释放
    → 进程崩溃：recovery.js 把 RUNNING 无终态证据的 job 标 RECONCILE_ONLY（人工）
客户查状态 /orders/status ◀── order-status-service：16 内部态 → 10 客户态 + 九阶段圆环
  SUCCESS 只在 RECHARGE_SUCCESS（= 取消续费确认后，D-240 撤回早交付后的统一成功）
```

（证据：`v1/src/db/repositories/order-intake-repository.js:130-200`、`workflow-repository.js:195-400`、`v1/src/workers/workflow-handlers.js:228/270/365/460`、`workflow-repository.js:920-1025`、`browser-mvp/src/production-live-pool-worker.js:200-270`、`executor.js` 事件 153/251/276/341/405/429/556/620、`live-chatgpt-payment-adapter.js` setStage 9 个、`payment-executor.js:170-359`、`browser-execution-repository.js:1144/1613-1707`、`browser-payment-verification-service.js`、`recovery.js`、`order-status-service.js:15-36`）

### 2.2 六个面各管哪段（对着主线）

| 面 | 管主线哪段 | 现在的实体 |
|---|---|---|
| 展示 | 验码、贴 Session、查状态 | `cdk-verify-service`、`order-status-service`（10 态 + 九阶段）、`public/customer.js`（我没读前端） |
| 执行 | SUBMIT_RECHARGE 分叉之后到 RECHARGE_SUCCESS | API：`workflow-handlers` + `zzshu-recharge.js`；Browser：本机 pool 全套 |
| 资源 | 分卡、等卡、开卡、销卡、余额同步 | `assignAvailableCard`、`card-inventory-eligibility.js`、hnskj 读同步 timer、highvcc 快照 timer、`card-stock-job-runner`、`highvcc-card-service.openCard` |
| 控制 | 三个开关、切路线、切卡台、CDK 生成、人工处置 | `provider-route-admin-service.setDefaultRechargeMethod`、`/card-sources/browser/current`、后台 admin.js |
| 通知 | 每个状态变化的 operator_alerts + Bark | `alert-notification-repository`（默认全推 + 两个静音） |
| 对账 | 消费账本 vs 卡台交易 | hnskj：`card_transactions`（读同步）；highvcc：无交易入库；`card-consumption-audit.js` 只是 npm script 没人调 |

### 2.3 两条路线在哪分叉、两个卡台在哪接入

- **分叉点**：建单时按 `fulfillment_routes.executor_kind` 决定冻结哪个卡台（intake SQL），执行时 `workflow-handlers.js:228/270` 按 `recharge_executor_kind` 分叉。**卡台不是执行器的属性，是建单时从两处不同来源各自冻结的**：API 读 `fr.card_provider_account_id` 且 SQL 硬写 `provider_code='hnskj'`；Browser 读 `browser_card_source_selections`。[代码]
- **hnskj（101）接入点**：`v1/src/providers/hnskj-card.js`（`HnskjCardProvider`：cardTypes/cards/card/purchaseCard/rechargeCard/transactions/withdraw，写请求带 `X-Idempotency-Key`，:404/:425）。被用在：worker（PURCHASE_CARD、付款前 card_details、SYNC_CARD_TRANSACTIONS）、`card-read-sync-runner`（每 15s）、`card-catalog-sync`（每 5min 刷卡段+钱包快照）、`card-stock-job-runner`（手动开卡）、`card-funding-runner`（补余额，开关 false）、本机 pool 的 HNSKJ 交易读取器。`resolveCurrentCardProviderAccount`（`provider-route-service.js:16`）写死 hnskj，读同步与补款跟着它。[代码]
- **highvcc（→103 manual_excel）接入点**：`v1/src/providers/highvcc-card.js`（`createHighvccCardProvider`，`POST /api/card/newCard` :164）+ `highvcc-card-service.js`（token 加密存 `app_settings.highvcc_access_token_ciphertext`，`openCard`）+ `highvcc-snapshot-sync-service.js`（每 1h 拉全量卡 → `manual-card-import-service` 写 cards，只刷 `current_balance`）。后台端点 `/api/v1/admin/backup-cards/highvcc/{status,ranges,wallet,token,quote,open}`。Browser 单从 `cards.card_credentials_ciphertext` 取卡材料，校验卡台 == 订单冻结卡台（`shared-encrypted-materials.js:249-251`）。[代码]
- **API 路线为何用不到 103**：intake SQL 要求 API 路线的卡台 `provider_code='hnskj' AND supports_api_recharge=1`，103 的 `supports_api_recharge=0`。[代码+生产 `provider_accounts`]

## 3. 硬约束（我理解的，对着代码核过的）

| 约束 | 代码里的实体 | 我核到的 |
|---|---|---|
| 一卡同时只服务一单；Plus 3 单/卡 | `eligibleInventoryCardSql`：无 ACTIVE assignment + 账本次数 < `card_max_successful_payments`（全局 3） | 全局值，非按产品 [代码+生产] |
| 付款结果不明 → SUBMIT_UNKNOWN，禁重付/换卡/换执行器 | API：`error.uncertain→markAttemptUnknown`；Browser：`markPaymentUnknown` + `commitPaymentSubmissionIntent` 重放拒点（RECONCILE_ONLY） | 两路线都有，机制不同 [代码] |
| 崩溃先对账不重点 | `recovery.js` → RECONCILE_ONLY | [代码] |
| 卡台写请求稳定幂等键 | `hnskj-card.js:404/425`；ZZSHU 无幂等键（用 recharge_attempts 栅栏） | [代码] |
| 停单与追踪分开 | `accept_new_orders` vs `poll_existing_orders`/`dispatch_new_recharges` | [生产] 三个都 true |
| 日志不出卡号/CVV/Token | 没逐一审 | **未核** |
| 金额定点 | ZZSHU 金额用字符串正则 `^\d+(\.\d{1,6})?$`；SQL 用 DECIMAL | 局部核了 [代码] |
| 零税 | Browser `wait-for-zero-tax-requote` 事前拦；API 托付 ZZSHU、事后拿 payment_amount（Lemon 2026-09-15 裁决可接受） | [代码] |
| 5X/20X 未跑通前不开放 | **与生产冲突，见 §4.2 第 1 条** | |

## 4. 当前生产状态（2026-09-17 05:30–05:58 UTC 现场）

### 4.1 与 CURRENT_STATE 一致的
release `20260916-unified-4334dc2`、web/worker active 且进程 cwd 是该 release、迁移 052、accept/dispatch/browser_dispatch/browser_payment 四开关 true、Plus 默认路线 API（301=1 / 302=0，最近切换事件 55e62934 01:47 UTC）、Browser 卡台 103、`default_card_type_id=23`、`default_open_card_amount=16`、`card_max_successful_payments=3`、最低余额 16/16/150、自动开卡与补余额 false、订单 20/37/18、非终态 0、active_runs 0、hnskj 卡 5276 $16 + 12 张 FAILED、本机 Browser PID 47905（09-16 15:35 UTC 起，supervisor 47620，源码 736c130）、`state-check.sh` 11 项全一致（输出在 scratchpad，exit 0）。

### 4.2 与 CURRENT_STATE 或 CLAUDE.md 对不上的（逐条，只写观察）

1. **5X/20X 在生产是开着的**：`products` 三个都 ACTIVE；`fulfillment_routes` 305（pro_5x BROWSER）/306（pro_20x BROWSER）`accepts_new_orders=1`；`browser_card_source_selections` 三个产品都指向 103；`cdks` 有 pro_20x AVAILABLE 2 张、REDEEMED 1 张；后台 CDK 生成端点接受 `pro_5x/pro_20x`（`create-app.js:358`，`cdk-service.js:13`）；intake 无产品闸门。历史 pro_20x 订单 9 单全在 09-08～09-10（1 单 RECHARGE_SUCCESS 且 finished_at NULL）。**代码显示一张 20X CDK 现在就能下单进 Browser 路线**（付款后走 UPGRADE_DIALOG_STOP 停在升级对话框交人）。CLAUDE.md 写"当前生产仅启用 Plus"。**冲突，需 Lemon 定：这是有意留着还是该关。**
2. **可分配卡的数随时刻变，且 CURRENT_STATE 原来写错了张**：用生产 release 那份 `eligibleInventoryCardSql`（门槛 16）跑，05:49 UTC 合格卡只有 **29bb（manual_excel，$145，用量 0，无 override）**，5276 因 `last_transaction_synced_at=05:00:05` 超过 15 分钟窗口不合格；06:05 UTC 再跑是 **2 张**（5276 在 06:00:08 又同步了一次，进入窗口）。CURRENT_STATE 原写"1 张：5276"——张数碰巧对、卡不对；`state-check` 只比数字所以报一致，我收尾时它又因为变成 2 张报漂移。**含义**：Plus 现在走 API、冻结 101，只有 5276 能用且每小时只有 15 分钟合格；29bb 是 103 的卡，API 单用不到；窗口外来一单会先 WAITING_FOR_CARD → 排按需同步 → 5276 刷新后 5s 重试分配（代码路径 `workflow-repository.js:216-260`，**未实跑过**）。
3. **hnskj 可用卡的同步节奏实际是每小时**：`card_sync_jobs` 对 5276 的记录是 01:34、02:00、03:00、04:00、05:00 整点；`scheduleDueCardSyncJobs` 默认 `staleMinutes=60`，条件 `next_sync_at <= now-60min`（`card-sync-job-service.js:78-112`），把 `card-sync-policy.js` 里 AVAILABLE 档 10 分钟的策略拉成 ≥60 分钟；`next_sync_at=05:10:05` 已过但无新 job。**观察**：合格窗口是每小时同步后的 15 分钟，其余约 45 分钟这张卡不合格。原因/是否有意 未知。
4. **worker 读开关的来源**：CURRENT_STATE 写"env 文件 `PROVIDER_READS_ENABLED=true`"；现场 `/etc/pojia/runtime.env` 是 `false`，`/etc/pojia/provider.env`（unit 里 `EnvironmentFile=-`，后加载）是 `true`；进程 `/proc/75228/environ` 实际 `READS=true / WRITES=false / CARD_WRITES=false / RECHARGE_WRITES=true`。结论对（进程 true），表的说法不准。
5. **服务器 09-16 23:36:10 UTC 重启过**：`uptime -s`、`journalctl --list-boots` 只有这一个 boot；web 起来时 MySQL 未就绪崩一次（`PROTOCOL_CONNECTION_LOST`），systemd 6 秒后自动拉起（PID 2286）。worker 01:36:56 UTC 又重启一次（D-241 回滚 env）。CURRENT_STATE 的 PID 2359155/2359160 已过期；**重启原因未知**（没有人的记录）。
6. **highvcc 快照 timer 频率**：CURRENT_STATE 一行写"每 10 分钟"，另一行写"已改为每 1 小时"；现场 `OnUnitActiveSec=1h`。同表自相矛盾。
7. **`pojia-card-funding.timer` 行内容错位**：标题是 card-funding，内容写的是 snapshot-sync。现场 card-funding.timer active/enabled、每 5s 跑，runner 因 `card_balance_recharge_enabled=false` 立即退出（journal：`CARD_BALANCE_RECHARGE_DISABLED`）。
8. **告警**：表写 OPEN 16（09-09）；现场 OPEN 116（SUBMITTED 33、FAILED 30、BALANCE_CHANGED 24、PAYMENT_UNKNOWN 10 …）。
9. **备用卡明细陈旧**：表写"卡台现存 5 张"（09-11）；现场 103 库内 AVAILABLE 9 张（$154.56，其中 3 张 RETIRED override、5 张余额 <$2）+ HELD_FOR_REVIEW 5 张（`source_present=0`，04:38 快照标记，其中 4dfa 账面 $50）。
10. **备份**：表写 09-16T14:19；现场最新 09-17T03:24。
11. **表里没有的 timer**：`pojia-operator-watch.timer`、`pojia-card-funding-reconcile.timer`（15s）、`pojia-backup.timer`。
12. **对账数据**：`card_transactions` 50 笔全 hnskj，`provider_balance_snapshots` 7963 条全 hnskj，highvcc 两者 0 —— 与账本 D-230 一致。

## 5. V2 六个面（我理解的方案要点）+ A 组已审结论

（方案本体见 `V2_ARCHITECTURE.md` §3 与 `V2.0_EXECUTION.md` §3；这里只写我核过与主线的对应关系和 A 组审出的东西。）

- **G1 highvcc 交易+钱包入库**：地基，B1/B3/B4/A3 都依赖。现状 0 条已实证（§4.2 第 12 条）。
- **G2 账本计数可靠 + 发布 A5 口径**：账本说生产资格 SQL 与工作区不同（`7efec865` vs `525b7e1b`）；我看到 state-check 已改为从生产 release 拉规则，**当前生产那份已含 D-217 的 LEAST(同步,账本)**（我拉下来的文件里有），是否还有差异未比对。
- **A1 执行面接口三段 + 切换解耦卡台**（已审）：两套卡台机制并存（`resolveCurrentCardProviderAccount` 写死 hnskj / `browser_card_source_selections`）— **我核到了，且更具体：intake SQL 把"API=hnskj"也写死了**；生产切换 `setDefaultRechargeMethod` 不查卡池（切 API 完全不查，切 Browser 只查 dispatch 开关+profile+心跳 60s）— **核到了**（`provider-route-admin-service.js:117-165`）；`switchRoute` 是死代码 — 核到了（无路由挂它）。解耦技术可行（ZZSHU 不认卡台）— 核到 `buildDirectOrderRequest` 只发卡号/exp/cvv/token/planType。**做不做 = 待讨论（D-243）。**
- **A2 verify 作交付判据**（已审）：Browser 侧 confirmPlus/confirmCancellation/补核 lane 齐全 — 核到了；API 侧 pollRecharge 查 ZZSHU — 核到了；崩溃 RECONCILE_ONLY 人工 — 核到了。
- **A3 按产品化开卡金额/每卡单数**（已审）：全局 16 与 3 单打架 — 核到 `default_open_card_amount=16`、无后台写端点（端点表里只有 default-card-type / max-successful-payments / minimum-balance）。
- **A4 供卡两台并重**（已审，D-242 纠正）：hnskj 手动开卡断点（后台建 PENDING job，靠手跑 runner）— 核到 D-241 记录与 `card-stock-job-service`；worker `PURCHASE_CARD` 需 `CARD_WRITES=true`（现 false）— 核到 `worker-runtime.js:13`；highvcc `openCard` 有 — 核到。
- **A5 销卡半自动**：hnskj `withdraw` 有（:455）；highvcc 无删卡 API — 我 grep 没找到（与账本一致）。V2.0 只做待销清单（D-232）。
- **A6 卡可用性查询**：减法审查（§5）说砍，A 组顺序里又留着。**账本自相矛盾，待清账本时定。**
- **B 组**（未审）：通知默认全推+两静音 — 核到 `PHONE_SILENT_TYPES`；看板依赖 G1。
- **C 组**（未审）：客户 10 态 → 四态；后台 4 页；删表前先改 `getOverview`。

## 6. 我不确定 / 看不懂 / 没核的（诚实列）

1. **20X 路线开着是有意还是遗留**（§4.2 第 1 条）。这决定本机 Browser 常驻是不是必须（Plus 走 API 后，Browser 只会接到 Pro 单、人工路由单和补核）。
2. **服务器 09-16 23:36 UTC 重启的原因**。没有记录，我不猜。
3. **hnskj 可用卡每小时才同步一次是有意的吗**（§4.2 第 3 条）。它直接决定 API 路线来单要不要先等一次按需同步。
4. **D-207/D-229 说的账本计数错**（`1657` 用了记 0）我没复核。
5. **Browser 单 18/56 未分到卡的原因**（账本 §2.8 说待查）我没查。
6. **客户页前端** `public/customer.js` 我没读，只读了后端映射。
7. **两路线交付后 Session 的处置不同**：API 把 ZZSHU 返回的 `latestSession` 存回订单；Browser 不存。含义我不确定。
8. **`fulfillment_routes` 305/306 的 `card_provider_account_id=101` 但 Browser 实际用 bcs 的 103**——账本已记"该字段不是实际选卡依据"。但 `resolveCurrentCardProviderAccount` 要求 `accepts_new_orders=1` 且 hnskj，现在 305/306 也满足——它到底解析到哪条路线的 101 无所谓（都是 101），但若将来有非 hnskj 的 API 路线会错。是否重要我不确定。
9. **HELD_FOR_REVIEW 的 5 张备用卡**（4dfa 账面 $50）是 Lemon 手动删的吗、钱回钱包了吗。
10. **日志脱敏、`getOverview` 读 20+ 表、后台 admin.js 2366 行**：我没审。
11. **账本 §2 的若干行号**与我读到的有出入（例如 `payment-executor.js:265` 我读到 confirmPlus 在 :227 与 :262 附近），不影响方向，清账本时对一遍。
12. **本机 lane 只有 1 条、BitBrowser 免费版每日 50 次打开额度、Mac 睡眠即停**：这些是 UNVERIFIED_LEDGER 里的旧记录，我没重新核。

## 7. 我给 Lemon 核对的「我理解的决定」清单

- Lemon 是贯穿所有窗口的人，方向与连贯由他判断；AI 的活是摸真实、摆选择、给建议、停下来讨论。
- 先清账本再审 B/C；"一单全链路"是连贯基准。
- 卡台↔支付方式解耦：**待讨论**，不是已定。
- 两卡台同等重要、经常切；hnskj 自动开卡不能排后。
- 客户成功 = Plus 确认 + 取消续费 + 内部核对完成后（早交付已撤回，不再重做）。
- 每卡单数按产品：Plus 3、5X/20X 各 1；开卡 Plus $50。
- 验收去时间化：测试（真实响应）+ 脚本 + 生产只读复验；稳定性是运营期观察。
- 自动销卡推 V3，V2.0 只做待销清单+手动删。
- 5X/20X：文档说不开放。**生产是开着的，这条我需要你定。**

## 7.1 Lemon 的核对回复（2026-09-17，D-244）

- §4.2 第 1 条 **5X/20X**：有意开着。5X/20X 是要充的产品，至少要能走 Browser 路线（手动充也是比特浏览器，只是套餐不同），合适时接入 Browser 自动化；API 路线能否充 Pro 未知。→ CLAUDE.md 旧硬约束待按此重写。**我还要确认**：「10X」是否指 20X；他是否知道现在 20X 码下单会自动走到 Plus 付款再停在升级对话框。
- §4.2 第 3 条 / §6 第 2 条 **服务器重启**：Lemon 判断是欠费到期，已续费。
- §6 第 8 条 / A1 **API 绑死 hnskj**：现状；「绑别的卡台行不行」是想法未试，= 解耦待讨论。
- **新事实**：hnskj 每分钟最多 60 次请求、超出收费；实测现在均值 4.6、峰值 22（`provider_calls`，不含 catalog-sync 与本机 pool）。
- **协作方式**：不拘泥过往决策；需求一起梳理清楚再升级；稳定、不臃肿；B/C 与 A 一样逐面重问「要不要、怎么做、有没有更好」，我可以出自己的方案。

## 7.2 Lemon 第二轮回复（D-245）

- 「10X」是笔误，指 20X。
- **ChatGPT 现在可从 Free 直接升级到 20X，「先 Plus 后升级 20X」两阶段方案退休。** 来源是 Lemon 手动充值实操；代码里的旧观察相反（`shared-live-composition.js:206`），落实前要先非付款 PoC 冻结。Pro 单与 Plus 同型，只换套餐。
- **由此核出的当前风险**：组合层结账计划固定 `plus`（:210），20X 码下单会自动买 Plus 再停在升级对话框；生产有 2 张 20X 可用码。是否先关 305/306 接单位，待 Lemon 定。
- 对 V2：A1 的 `fromPlan` 分支、基线「5X/20X 自动化前置」5 条、UNVERIFIED 两阶段条目、PROJECT_MAP §5 相应作废或重写（已改）。

## 8. 本次没做的

没改账本、没改方案、没碰生产、没开卡、没切路线、没发布。CURRENT_STATE 里 §4.2 列出的漂移行按 AGENTS.md 收尾要求已改成现场值（只改文档）。
