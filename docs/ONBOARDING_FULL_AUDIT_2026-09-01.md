# 接手前全面核对报告（Onboarding Full Audit）｜2026-09-01

> **目的**：新接班模型（Claude）在正式接手前，对整个项目——代码、数据模型、决策、部署、生产、文档——做一次系统性、可核查、分层标注的彻底核对。不是文档转述，而是落到代码与运行证据。
> **边界**：全程只读。不接手、不改代码、不动资金、不做任何生产写操作（开卡/付款/切权限/改配置一律不做）。
> **方法**：按 8 个战役推进；每条结论强制标注证据等级；证据尽量给到 `文件:行` 或运行记录。
> **发起人**：Lemon（要求"整个项目全部细节都了解清楚"）。协作前任：codex（作者账号 lemonw603-sys，670/680 提交）。

## 证据等级图例

- ✅ **已验证事实**：本人现场运行证据（代码执行、生产只读核对、DB 查询）。
- 🟡 **代码已验证·生产未验证**：读过源码/schema 确认，但未在生产实跑核对。
- ⚪ **未验证/待核对**：尚未落到证据，仅来自文档或推断。
- 💡 **存疑/建议**：发现的张力、缺口或改进建议。

---

## 战役进度总览

| # | 战役 | 覆盖 | 状态 |
|---|---|---|---|
| 1 | 数据模型 | 44 migrations + schema：订单/CDK/卡/资金栅栏/消费账本/attempt/任务/Browser | 🟡 进行中（主干+5道资金栅栏已通，6/44 精读） |
| 2 | 核心链路代码 | CDK→订单→分卡→资金栅栏→attempt→执行→对账（services/repos/workers） | 🟡 进行中（付款/对账/取消 handler 全通，主动脉打穿） |
| 3 | 卡台/Provider | hnskj-card + card intake/stock/funding/sync 全生命周期 | 🟡 全链已通（Provider/资格/补余额/开卡/入库/同步，无资金写遗漏） |
| 4 | Browser 线 | browser-mvp/poc + browser-execution/dispatch/recovery repo + browser-admin | 🟡 全貌已通（架构/防重付/恢复/上号/提链；付款未接线待建，Worker disabled） |
| 5 | 后台/客户前端+控制面 | admin-read-service(70KB)/admin.js/customer.js/create-app/config.js | 🟡 全貌已通（开关体系/开始营业含缺口/客户7态契约/人工接管） |
| 6 | 部署与运维 | 18 个 systemd 单元 + release/回滚/备份/通知 | 🟡 全貌已通（拓扑/进程级窄权限/付款gate/Browser单元/Caddy/备份） |
| 7 | 生产实时核对 | KiwiVM root shell + SSH 明文只读查询 | ✅ 完成（服务/权限/DB 明细全核实；资金安全零悬空生产验证）。⚠️更正：早前"release 漂移""透传缺口""文档没记录的新发现"均系未对齐最新 CURRENT_STATE(09-02 00:32)的误判，已收回，详见战役7 节末与更新记录 |
| 8 | 决策与文档收敛 | 211 文档按事实优先级归档，DECISIONS 新旧对齐，产出差异清单 | 🟡 已通（分层+一致性核对+漂移清单；文档诚实高质量） |

---

## 项目地形（本轮现场侦察结论）

- **真业务核心在 `v1/`**：213 个 JS 文件 / 37,448 行 / 105 个测试文件。分层 `src/{app,domain,services,repositories,workers,providers,security,notifications}` + `migrations` + `public`。✅（find 统计）
- **根目录 legacy**（chatgpt.js/human-verification.js/hcaptcha/captcha-platform 等）是上游 fork 隔离代码，默认噪音，不作当前行为证据。🟡（AGENTS.md §噪音地图 + 未读其内容）
- **部署成体系**：`deploy/server/` 18 个 systemd 单元 + Caddy + 运维脚本。生产在 `/opt/pojia/`，release 化 + 回滚点。🟡（读 deploy 目录清单，未在生产核对）
- **git**：680 提交 / 2026-05-06 起 4 个月 / 328 个 docs 提交（近半）。有 `upstream-baseline` 未改动基线分支。✅
- **生产入口**：`deploy/server/bootstrap-host.sh` 含生产 IP、`ops.vibebridge.top`、`DATABASE_URL`（密码为变量占位）。本机 `~/.ssh/config` 为空，**无 SSH 登录凭证**。🚧

---

## 战役 1：数据模型（进行中）

数据模型演化 = 44 个 migration（`v1/migrations/001..044`）。文件名即能力演化史；已逐条精读的资金/容量核心表如下。

### 已核对（🟡 代码/schema 已验证，生产 DB 未核对）

**1. 防重复扣款 — `026_automatic_fulfillment_funds_fence.sql`**
- `provider_calls` 增加生成列 `recharge_create_attempt_id`（`CASE WHEN operation='create_direct' THEN recharge_attempt_id ELSE NULL END` STORED），并加唯一索引 `uq_provider_calls_recharge_create_attempt`（`026:73-99`）。
- 效果：**每个 recharge attempt 至多一次真实扣款调用**，读/轮询为 NULL 不占唯一性。防重复扣款下沉到 DB 强约束。
- 迁移前置守卫：先扫历史重复 `create_direct`，`>0` 则 `SIGNAL SQLSTATE '45000'` 拒绝迁移，要求人工对账（`026:7-22`）。
- 历史回填只处理"已明确失败（DEFINITE_FAILURE）+ 订单 RECHARGE_FAILED + 无 recharge_order_no"的 call，链接到 CLEARED attempt；unknown/未完成/成功/外部标识**故意不回填**，留作 readiness blocker（`026:28-61`）。✅贴合"未知不自动处理"铁律。

**2. 一卡一活动补款 — `030_card_funding_attempts.sql`**
- 新建 `card_funding_attempts` 账本（`030:5-32`）。
- `funds_fence_card_id` 生成列（`funds_risk_state IN ('ACTIVE','UNKNOWN','SETTLED')` 才等于 card_id）+ 唯一索引 `uq_card_funding_funds_fence` → **同一张卡不可并发补两次款**。
- 幂等：`uq_card_funding_idempotency (provider_account_id, idempotency_key)`。
- 注释明确：本迁移不启用任何 provider 写，executor 仍在运行时栅栏后（`030:1-3`）。

**3. 一卡多单容量账本 — `038_card_consumption_capacity.sql`**
- 新建 `card_consumption_ledger`（`038:3-27`），status ∈ {RESERVED,CONSUMED,RELEASED,RECONCILIATION}，带 reserved/consumed/released 时间与 release_reason。
- 唯一键 `uq_card_consumption_order (card_id, order_id)`、`uq_card_consumption_provider_tx (card_id, provider_transaction_id)`。
- 写入 `card_max_successful_payments=3` 到 app_settings（`038:29-31`）→ "全局成功上限=3"的落点。

**4. 订单绑卡权威翻转 — `043_order_assigned_card.sql`**
- 新增 `orders.assigned_card_id` + 索引 + FK（ON DELETE SET NULL）（`043:4-36`）。
- 把"订单→卡"权威指针从 `cards.order_id`（legacy 一卡一单）翻到订单侧，使一卡可服务多单；旧 `cards.order_id` 保留作首单兼容指针（`043:1-3`）。

**5. 原始核心表 — `001_initial.sql`**
- `cdks`（code_hash 不存明文、order_id 唯一）、`orders`（cdk_id 唯一、version 乐观锁、`session_ciphertext` MEDIUMBLOB 加密存 Session、card_purchase_idempotency_key/recharge_card_key 唯一）、`cards`（**order_id 唯一 = 原始一卡一单约束，043 才翻转**）、`provider_calls`（`uq_provider_request_attempt` 幂等键唯一）、`tasks`（**lease 机制** leased_until/leased_by + dedupe_key 唯一 + max_attempts=5 有界重试）、`order_events`（状态迁移审计）、`card_transactions`（raw_hash 去重）、`refund_cases`（MONITORING，只监控不自动处理）、`app_settings`。
- app_settings 初始：`accept_new_orders=false, dispatch_new_recharges=false, poll_existing_orders=true, sync_card_transactions=true`（`001:168-173`）→ ✅印证"停单与追踪是两个独立开关"。

**6. Foundation v2 大重构 — `021_foundation_v2_core.sql`**（provider/account/route 模型，加法式，legacy 列保留）
- `provider_accounts`（**就是 read_enabled/write_enabled/circuit_state 那张表**，purpose=CARD/RECHARGE、rate limit、熔断）、`products`、`fulfillment_routes`（route+version、card/recharge 两个 provider account、executor_kind=API/BROWSER、**immutable=1 路线冻结**）、`recharge_authorizations`+`recharge_authorization_items`、`recharge_attempts`（资金栅栏主表）、`card_intake_batches`+`card_discoveries`（卡隔离校验 QUARANTINED→接管）、`provider_balance_snapshots`、`reconciliation_cases`。
- legacy→v2 全部 evidence-backfill：只在有证据时回填，attempt 状态映射 SUCCESS→SETTLED / PROCESSING→ACTIVE / 明确失败→CLEARED / **其余→SUBMIT_UNKNOWN·UNKNOWN**（`021:461-518`）。

### 🔒 资金安全栅栏全景（战役1 关键洞察）

资金安全 = **5 道数据库强约束栅栏，全部用「生成列 + 唯一索引」实现，不靠应用层软判断**。核心枚举 `funds_risk_state ∈ {NONE, ACTIVE, UNKNOWN, SETTLED, CLEARED}`：ACTIVE/UNKNOWN/SETTLED 会让生成列有值→唯一索引占位→物理上无法建第二条；CLEARED/NONE 释放。

| 栅栏 | 表.生成列（唯一索引） | 保证 | 证据 |
|---|---|---|---|
| 订单级 attempt | `recharge_attempts.funds_fence_order_id` | 一订单同时只能一个活动/未知/已结算 attempt | `021:108-110` |
| 扣款级 | `provider_calls.recharge_create_attempt_id` | 一个 attempt 最多一次 create_direct 真实扣款 | `026:73-99` |
| 卡补款级 | `card_funding_attempts.funds_fence_card_id` | 一卡不可并发补两次款 | `030:23-26` |
| 授权占用级 | `recharge_authorization_items.protected_order_id` | 一个授权内一订单只被保护占用一次 | `021:79-82` |
| 容量级 | `card_consumption_ledger`(uq card+order) + `orders.assigned_card_id` + `card_max_successful_payments=3` | 一卡多单顺序复用 + 全局成功上限 | `038` / `043` |

💡**核心机制**：`UNKNOWN` 会让 `funds_fence_*` 生成列**永远有值 → 唯一索引永久占位 → 物理上不可能重复付款或换卡重付**。"付款未知锁定"不是应用层的 if 判断，而是 MySQL 索引层的硬保证。这解释了 CLAUDE.md 为何说"MySQL 确定性状态机负责资金决策，AI 不参与"——AI 想重付都建不出第二条 attempt。**这是全项目最扎实的一环，也是假懂代价最高的一环。**

### 战役 1 待核对（⚪）

- 002-020 增量表：cancellation/transaction_evidence/operator_alerts/cdk_plan/card_stock/snapshot/compensations/security/reconciliation/runtime_health。
- 022 `foundation_v2_operations`（大重构的 operations 半）。
- 025 session_recovery、027-032/041 browser_* 表、033-035/042 card_funding 后续、036 provider_route_switch、039 consumption_attempt_link、044 operator_alert_actionability。
- 生产 DB 实际 schema 与这些 migration 是否一致（战役 7，需 SSH）。

### 战役 1 存疑（💡）

- （待补）

---

## 战役 2：核心链路状态机（进行中）

### 订单状态机 — `v1/src/domain/order-status.js`（🟡 代码已验证）

显式确定性状态机：**16 个状态** + 合法迁移表（Map），`assertOrderTransition(from,to)` 强制校验，非法迁移直接抛错（`order-status.js:104-111`）。✅印证"状态迁移必须显式、可审计"。

状态集：CREATED / CARD_PURCHASING / CARD_PROVISIONING / CARD_READY / WAITING_FOR_CARD / CARD_FAILED / WAITING_FOR_SESSION / SUBMITTING / SUBMIT_UNKNOWN / RECHARGE_PROCESSING / RECHARGE_SUCCESS / RECHARGE_FAILED / CANCELLATION_PENDING / CANCELLATION_REVIEW_REQUIRED / RECONCILIATION_REQUIRED / CLOSED。

主干路径：`CREATED →(备卡)→ CARD_READY →(可回 WAITING_FOR_SESSION)→ SUBMITTING →(提交)→ RECHARGE_PROCESSING →(轮询)→ RECHARGE_SUCCESS →(取消续费)→ CANCELLATION_PENDING → RECHARGE_SUCCESS → CLOSED`。

💡**第二重防重付（状态机层）**：
- `SUBMITTING` 不能直达 `RECHARGE_SUCCESS`，必须经 `RECHARGE_PROCESSING`；提交不确定 → `SUBMIT_UNKNOWN`。
- **`SUBMIT_UNKNOWN` 的合法出口不含 `SUBMITTING`**（`order-status.js:58-64`）——付款未知后状态机层面就**禁止回到"提交"**，只能靠对账（POLL）向前到 SUCCESS/FAILED 或进 RECONCILIATION。与栅栏层（UNKNOWN 永久占位）构成**双保险**。
- `RECONCILIATION_REQUIRED` 是人工对账枢纽，几乎所有状态可进入；`CLOSED` 是唯一终态（空迁移集）。
- 取消续费（D-032）是 `RECHARGE_SUCCESS` 之后的独立子流程；取消结果未知 → `CANCELLATION_REVIEW_REQUIRED`（人工），不误判失败。

### 任务模型 — `v1/src/domain/task.js` + `001` tasks 表（🟡）

- TaskStatus：PENDING / RUNNING / COMPLETED / **DEAD（死信，不再重试）**。
- 8 个 TaskType：`ASSIGN_CARD, PURCHASE_CARD, VERIFY_CARD, PREPARE_RECHARGE, SUBMIT_RECHARGE, POLL_RECHARGE, SYNC_CARD_TRANSACTIONS, RECHECK_CANCELLATION`。
- 领取靠 **lease**（leased_until/leased_by）+ dedupe_key 唯一 + max_attempts=5 有界重试。✅印证"任务处理用租约和有界重试，单个失败订单不阻塞队列"。

### 付款执行链路的资金安全 — `workflow-handlers.js`（🟡 644 行全读）

8 个 handler = 8 个 TaskType（`:634-643`）。三个最关键：

**`submitRecharge`（付款，`:268-460`）**——扣款前后每步都为资金安全服务：
- 扣款前所有失败（写权限关/状态不符/Session 失效/卡未就绪/配置阻塞/交易证据陈旧）一律 **retryable 且不扣款**（多带 refundAttempt 释放预留）。
- `beginAuthorizedAttempt` 建 ACTIVE 资金栅栏后才调外部 `create_direct`（zzshu, sideEffecting）。
- **扣款异常三分支**（SUBMIT_UNKNOWN 铁律落地，`:408-439`）：`error.uncertain`→`markAttemptUnknown`（UNKNOWN 永久占位）→**retryable:false 绝不自动重试**；business `40030`（账号已 Plus）→`markAttemptCleared` 释放 + 让客户换 Session；其他明确失败→`markAttemptRejected` 释放。
- **扣款成功但本地 commit 失败**→也进 `markAttemptUnknown`（RECHARGE_COMMIT_UNKNOWN），retryable:false，"ACTIVE fence 保持权威"（`:447-459`）。
- Browser 路线只 `enqueue` 派发，enqueue 失败保留 fence 不退款、幂等重试——**Browser 不在此处点付款**（`:360-383`）。
- `holdBeforeProvider`（仅测试）在外部调用前停、保留 SUBMITTING attempt = "付款前暂停演练"实现（`:354-358`）。

**`pollRecharge`（对账，`:516-543`）**：pending/processing→重试；**failed 不轻信**，等 2.5s 复查确认才 commit 失败（防瞬时误判）；success→commit；未知状态→抛错不猜。

**`recheckCancellation`（取消续费，`:545-590`）**：`isSubscriptionCancelled===1` 才算成功；未确认重试（60s）；重试耗尽仍未确认→exhausted 进人工，不误判。✅落地 D-032。

**`purchaseCard`（`:116-190`）**：开卡结果不明→**不重开**，去卡列表识别刚开的卡；多张匹配或超时→人工复核，禁止自动 rebuy。

💡至此可**完整讲清一笔订单从下单→备卡→付款→对账→取消的每步状态迁移与崩溃行为**。资金安全 = 数据模型强约束（战役1）× 状态机单向性（战役2状态机）× handler 逐分支锁定（本节）三重叠加。

### 战役 2 待深读（⚪）

- `workers/task-runner.js` + `worker-runtime.js`：领取/租约续约/DEAD 判定/重启恢复（崩溃恢复的另一半）。
- `services/order-intake-service.js`：客户下单入口（CDK 兑换→建单→冻结路线）。
- `db/repositories/workflow-repository.js`（52KB）：状态持久化、attempt/fence 写入（beginAuthorizedAttempt 等的实现）。
- `db/repositories/recharge-attempt-repository.js`（28KB）：markAttemptUnknown/Cleared/Rejected/Submitted 的 DB 实现。
- `services/recharge-permit-service.js` + `recharge-authorization-v2-service.js`：付款许可闸门。

## 战役 3：卡供给链（进行中）

### 卡台 Provider 适配器 — `providers/hnskj-card.js`（🟡 460 行全读）

外部接口唯一边界，业务层不直接碰卡台。
- **运行时 Zod 校验**：envelope/profile/balance/cardTypes/cards/transactions 全 schema 化；`objectDataSchema` 兜底保证 provider 边界至少是对象，scalar/null 不泄漏进 workflow。✅印证"外部响应必须运行时 Schema 校验"。
- **幂等键强制**：`assertIdempotencyKey` 16-128 字符；purchase/recharge/withdraw 全强制 `X-Idempotency-Key`。
- **超时/错误资金语义**（`:128-149, :351-359`）：status≥500→uncertain；502/503→retryable；timeout/transport 时**只读或幂等写才 retryable，非只读→uncertain**。✅"超时和 502/503 只能原 Key 重试，不明进 UNKNOWN"。
- 端点：account profile/balance、card-types、cards 列表/详情、cards/purchase（开卡）、cards/{id}/recharge（补余额）、refresh-balance、transactions、withdraw（提现/销卡）。
- mapper 与边界分离：mapPurchasedCard（无 cardId→uncertain，触发识别不重开）、mapCardRechargeResult、mapCardCredentials、mapCardProvisioning（ready = active + 凭证齐 + 余额≥minimum）。字段漂移用多路径 valueAt 容忍（含 chargeback 无 currency 按 USD 的真实故障修复）。

### 库存资格判定 — `services/card-inventory-eligibility.js`（🟡）

`eligibleInventoryCardSql` = "哪张卡能分配"的门禁 SQL，一次串起所有资金安全条件：余额≥minimum；consumption_ledger(RESERVED/CONSUMED/RECONCILIATION) 计数 < 上限；**NOT EXISTS `card_assignment_history` ACTIVE（一卡同时只一个活动订单）**；NOT EXISTS card_funding_attempts PREPARED/ACTIVE/UNKNOWN（补款中不分配）；NOT EXISTS refund_cases ≠WITHDRAWN（退款中不分配）；NOT EXISTS overrides RETIRED/PRODUCT_ONLY 不匹配（退役卡、专卡如 4744=Claude）。另有 `fundableInventoryCardSql`/`refreshableInventoryCardSql`。

### 补余额执行链 — 付款的完整镜像（🟡）

- `db/repositories/card-funding-repository.js`（207 行）：PREPARED→SUBMITTING(ACTIVE fence)→SETTLED/PENDING/UNKNOWN/CLEARED；prepare 幂等（provider+key）；**finish 把 provider call 审计 + 状态迁移放同一事务**（防 SUCCESS call 配 SUBMITTING attempt 的崩溃裂缝，`:170-204`）；SETTLED 自动排 sync job；reconcile 按余额≥minimum 判到账；nextPrepared 允许 order-linked 补款即使全局低余额扫描关闭。
- `services/card-funding-executor.js`（53 行）：与付款 `submitRecharge` **同构三分支**——provider 接受后本地失败→`uncertain`→UNKNOWN（`:30-37`）；catch 里 `unknown=providerAccepted||uncertain`→UNKNOWN/CLEARED。💡补余额也是真花钱，享受和付款**同等资金安全**。

### 一卡多单容量 — `services/card-consumption-ledger-service.js`（🟡）

`reserveCardConsumption` 在 **card 行锁 FOR UPDATE** 下原子预留：串单检查（ORDER_RESERVATION_EXISTS）、RECONCILIATION 拒绝、**COUNT≥limit→CARD_CONSUMPTION_LIMIT（上限3）**、RELEASED 可复活、否则 INSERT RESERVED，幂等。transition：RESERVED→CONSUMED/RELEASED/RECONCILIATION，affectedRows≠1→RESERVATION_NOT_ACTIVE。全程事务+行锁防并发超发。

### 自动开卡与入库隔离（🟡）

- **开卡决策 — `card-stock-job-service.js`（357）**：读 `card_auto_replenishment_enabled`/`card_replenishment_daily_limit`/threshold；**库存低于阈值 + 日限额内才排开卡 job**（`used>=limit→reason:DAILY_LIMIT`，`:230-232`）= D-029"每天最多 N 张"实现；job 靠 lease（1800s）+ progress/complete/fail 有界可恢复。
- **开卡服务 — `card-stock-service.js`（557）**：卡运营状态分类（mapStockCard/classify/summarize）；`maxSuccessfulPayments` 设置强制 **1-4**（`:524-526`）= 每卡成功上限入口。实际开卡执行仍走 workflow `purchaseCard`（战役2，开卡不明→不重开）。
- **入库隔离 — `card-intake-service.js`（356）**：新卡 QUARANTINED → `validateBatch` 记录校验快照 → **双快照一致（`secondSnapshotHash`）+ 规则通过才 `acceptDiscovery`**（`:332`），否则 reviewRequired。✅D-014"新卡先隔离、双快照校验后接管"。

### 战役 3 其余（🟡 已确认，无资金写遗漏）

- **卡同步 — `card-sync-job-service.js`（270）**：读 `sync_card_transactions` 开关；只写 cards 的 sync_tier/next_sync_at/失败计数（同步元数据），**不写卡台、不涉资金**；job lease 120s；分层同步 + 交易证据只读拉取（`card-transaction-reader.js`）。
- **运营覆盖 — `card-operational-override-service.js`（62）**：策略 NORMAL/PRODUCT_ONLY/RETIRED 手动干预（如 4744=claude、8590=RETIRED），纯配置。
- **补给配置 — `card-replenishment-settings-service.js`（80）**：日限额读写，变更记 `admin_setting_events` 审计。

### 💰 战役 3 核心洞察：统一资金安全范式

所有"花钱"动作共用**同一套栅栏范式**：`PREPARED → SUBMITTING(ACTIVE fence) → SETTLED/UNKNOWN/CLEARED`，provider 接受后本地失败一律锁 `UNKNOWN` 绝不自动再付，幂等键，"审计 + 状态迁移同事务防崩溃裂缝"。
- 付款 `submitRecharge`（战役2）与补余额 `card-funding-executor`（战役3）**完全同构** —— 补余额是付款的镜像。
- 开卡也花钱，但走 workflow `purchaseCard`：结果不明→不重开，去卡列表识别。
- 选卡门禁（资格 SQL）、开卡门禁（阈值+日限额）、入库门禁（双快照）三道各管一段。

**至此当前生产实际在跑的完整闭环（下单→备卡/开卡/补余额→付款→对账→取消续费）已全部代码级打通，资金安全一以贯之。**

### 战役 3 待生产核对（⚪ 战役7）

- 新见表：`card_assignment_history`、`card_sync_jobs`、`card_stock_jobs`、`cards.inventory_status/card_credentials_ciphertext`、`app_settings`（default_minimum_required_card_balance / card_replenishment_daily_limit / card_auto_replenishment_enabled）——生产 DB 是否存在、真实值。

## 战役 4：Browser 未来主链路（进行中）

⚠️ **当前完成度（防止把未完成当完成）**：`browser-mvp` README 明确——这是"隔离控制能力 PoC，正向 F0 真实付款 MVP 演进；**尚未启用真实付款写入**"，"不连接共享订单/MySQL/真实 Session/Checkout/卡片/Provider/付款接口"，"身份核对和真实 Checkout 付款仍未接线"，"只完成真实付款前的纵向前置切片"。生产 Browser Worker `disabled/inactive`。✅与 PROJECT_MAP/CURRENT_STATE 一致，不得当成已完成。

### 三块结构
- **browser-mvp/**（~40 模块 + ~30 测试）：当前 worker 主实现。**Port 化架构**（BrowserExecutionPort/DispatchStore/EvidenceSink/RuntimeAdapter/SessionProviderPort 可替换边界）；session-bootstrap、checkout-navigator/observer、payment-executor + payment-safety-gate、WAL + recovery、production-readonly-worker（当前 main 跑的只读 smoke）。全部 fail-closed；跨边界只用引用+digest，不接受卡号/CVV/Session 原文。
- **browser-poc/**：早期 Session A/B（session-ab）+ 提链（checkout-link-core）实验 + mock/crash/capacity fixture（历史证据，轻读）。
- **v1/src browser 集成层**（3134行）：dispatch(330)/execution(1141)/recovery(671)/admin(703)/worker 运行时。

### 派发复用主系统资金栅栏 — `browser-dispatch-repository.js`（🟡 330行全读）
**Browser 不建第二套资金账，挂在同一套 `recharge_attempts` 栅栏上**：
- `enqueue` 幂等；校验 attempt 必须 **executor_kind=BROWSER + PREPARED + funds_risk_state=ACTIVE + order RECHARGE_PROCESSING** 才可派发（复用 ACTIVE fence）。
- `claim`：**FOR UPDATE SKIP LOCKED**（并发不阻塞）+ 校验 `browser_dispatch_enabled=true` + lease token hash（10-3600s）；**无幂等键 → 歧义事务不重试**（`retryAmbiguous:false`，防重复领取执行付款）。
- `complete`：必须对应 `browser_runs` run_status=COMPLETED 才能完成（幂等）。
- 事务基础设施极硬：连接/事务超时、死锁重试、歧义事务错误区分（`isAmbiguousTransactionError`）不盲目重试。

### 付款安全闸门 — 两层防重付（🟡）

Browser 侧防重付分两层，与主系统栅栏叠加：
- **主系统层**（v1 `recharge_attempts`）：Browser attempt 挂 ACTIVE fence；dispatch claim SKIP LOCKED + 歧义不重试（见派发节）。
- **Browser worker 层**（mvp `payment-safety-gate.js` 127行）：permit 状态机 `PREPARED→SUBMITTED→UNKNOWN→(SETTLED/FAILED/MANUAL_REVIEW)`；`prepare` 拒绝同 attempt 重复许可；**`_assertAllowed`：order/card 有任一 UNKNOWN permit 就锁死、禁止新付款直到对账**（`:120-125`）；三级 stop（global/order/card）；`stopOnFundsDifference` 金额不符自动全局停；金额用 minor units 整数。
- **崩溃恢复**（`durable-payment-safety-gate.js` 79行）：每次状态变更 append WAL checkpoint，崩溃重启从 WAL restore——**UNKNOWN 锁定跨崩溃不丢**，reconcile 前不重付。✅落地"Browser 点付款后崩溃必须先对账、不能重新点"。WAL 只存 opaque refs/digest，无 PAN/CVC/Session。

### 崩溃恢复与 run 状态机（🟡 侦察）
- **run 状态机 — `browser-execution-repository.js`（1141）**：run 三维状态 `status`（READY/RUNNING/RECONCILE_ONLY/HUMAN_REQUIRED）× `payment_state`（NOT_STARTED→PAYMENT_ARMED→提交意图）× `post_payment_state`。每步严格前置校验（run RUNNING + payment_state 正确才推进）；`assertPaymentWritesEnabled` 付款写开关；beginRun/issuePaymentPermit/commitPaymentSubmissionIntent/abortBeforePayment。
- **崩溃恢复 — `browser-recovery-repository.js`（671）**：`recoverExpiredRun` 把过期 run 转 **RECONCILE_ONLY（不自动重放）**；多处 RECONCILE_ONLY 守卫——进 reconcile-only 后不能获取可变资源/创建 checkout artifact；**"Checkout authority is unavailable after submission"**（提交后不能 reveal/destroy artifact）= 付款后崩溃只能对账。资源租约 + checkout 工件保管库（敏感 authority 隔离）。

### Session 上号与 checkout 提链（🟡 侦察）
- **上号 — `session-bootstrap.js`**：`CookieSessionBootstrapAdapter`（SessionProviderPort）只接受 secure ChatGPT session cookie，清理 \r\n\0，**只记 digest、原文留 adapter 边界内**，opaque sessionRef。
- **提链 — poc `checkout-link-core.js`**：识别 hosted checkout（`pay.openai.com`/`checkout.stripe.com`），解析 Stripe `cs_live_/cs_test_` id，**只记 fingerprint（sha256 前16）不记原始 URL**。对应 D-047 hosted Checkout discovery。

### 🌐 战役 4 核心洞察与完成度判断
- **Browser 安全设计比 API 更谨慎**：多层防重付（主系统 attempt fence + mvp payment gate UNKNOWN 锁 + WAL 持久化 + run reconcile-only 守卫 + payment_state 前置校验），全 fail-closed，跨边界只用 ref/digest（不碰卡号/CVV/Session 原文）。
- **但真实付款从未接线**（README 与代码一致）：身份核对、真实 Checkout 付款执行、与主系统完整联调都未完成；生产 Worker disabled；当前 main 只有只读 smoke（production-readonly-worker）。
- 💡**要上线还差**：真实 Session 身份核对接线、真实 Checkout 付款执行接线、Browser↔主系统完整集成联调、菲律宾 sticky 出口验证、单独确认后的真实付款灰度。这是 Browser 从"设计完备"到"生产可用"的剩余工作，也是你未来主推的重点。

### 战役 4 待生产核对（⚪ 战役7）
- 新见表：`browser_dispatch_jobs`、`browser_runs`（status/payment_state/post_payment_state）、run 资源租约表、checkout artifact vault 表。
- `browser-admin-service`（703）后台追溯/人工控制 → 并入战役5（后台）一起看。

## 战役 5：后台控制面 + 客户前端（进行中）

### HTTP 入口地图 — `create-app.js`（🟡 70 路由）
- **客户 API（仅 3 个）**：`POST /api/v1/orders`（下单）、`/orders/status`（查状态）、`/orders/session`（换 Session）。✅无退款查询入口（客户侧不提供退款）。
- **admin 认证**：login/session/**step-up（二次验证）**。
- **admin 运营控制**：`operations/start-business`（开始营业）、`operations/order-acceptance`（接单开关）、`operations/recharge-dispatch`（派发开关）、`operations/default-recharge-method`（默认路线切换）、`provider-routes/:id/switch`（卡台路线切换）——**独立开关**，印证"停单与追踪独立""路线切换≠充值方式切换"。
- **admin 订单/卡/CDK/对账/授权/导出**：全套（notes/tags/customer-payment/compensation/cancellation/recharge-permit；card intake/stock/funding/overrides；cdk generate/download/revoke/deliveries；reconciliation assign/resolve；recharge-authorizations/revoke）。
- **admin Browser**：runs/dispatch-jobs/runs/:id + **runs/:id/control（人工接管入口）**。

### 两层开关（权限门禁）
- **进程/环境层 — `config.js`**：`PROVIDER_READS_ENABLED` / `PROVIDER_WRITES_ENABLED` / `PROVIDER_CARD_WRITES_ENABLED` / `PROVIDER_RECHARGE_WRITES_ENABLED`（**四权限分离，默认全 false**，写开启需对应 API key 校验）。systemd drop-in 控制 = "能不能做"的硬门禁。当前生产仅 recharge_writes=true。
- **业务/DB 层 — `app_settings`**：accept_new_orders / dispatch_new_recharges / default_recharge_method / browser_dispatch_enabled / card_auto_replenishment_enabled 等 = "要不要做"的运营开关。
- `start-business` 综合两层 + 卡供给 readiness。

### 开始营业检查 — `admin-start-business-service`(23) + `admin-readiness-summary`(54)（🟡）
- start-business：`readiness.ready` 才依次开 接单→派发；**dispatch 失败补偿回滚接单**（防 partial-open）；不改 systemd/Provider account/资金写权限。
- readiness **只检查当前路线需要的门禁**（API 不查 Browser，反之亦然）：EXECUTION_ROUTE（API 需 worker 健康 + rechargeWritesEnabled；BROWSER 需 browserRechargeReady）+ CARD_SUPPLY（有卡 READY / 需补且开启→AUTO_HEAL / 无卡但自动开卡就绪→AUTO_HEAL / 否则 BLOCKED）。
- 💡**代码级确认文档缺口**：`admin-readiness-summary.js:25` —— API 权限关闭的 BLOCKED check **唯独没有 actionId**（其他 6 个 BLOCKED 都有跳转），这就是"API 执行权限关闭只有文字提示、没有去处理入口"的代码根源。✅文档自标缺口属实。
- 另一缺口：readiness 是开始营业快照，只看 overview 的 stock/health/runtime，**不检查独立 runner 心跳/日限额/未决任务**；营业后能力漂移不自动关接单。

### 客户前端 — `customer.js`（🟡 439行全读）
视图状态机，4 条硬不变量（文件头声明）：①核对邮箱只**本地解析**不发请求 ②确认勾选后才 `createOrder` ③Session/Token 不回显、成功后清空 ④只显示**客户契约 7 态**（QUEUED/PROCESSING/REVIEWING/ACTION_REQUIRED/FINALIZING/SUCCESS/FAILED），从不暴露内部 16 态/卡台/资金状态。
- 三步：输入(CDK+Session)→本地提取邮箱→确认页(邮箱+打码CDK)→createOrder→tracking 轮询。
- `parseSessionInput` 剥离扩展追加的尾随文本只取首个完整 JSON；换 Session（remaining+expiresAt 窗口）；轮询按态 5s/10s/30s，30 分钟暂停，隐藏页跳过。✅隐私 + 防重复提交细致。

### 操作与后台服务（🟡）
- `admin-operations-service`：`setOrderAcceptance`/`setDispatch` **要求 confirmation 短语匹配**（'开始接单' 等）才改 app_settings——防误操作。
- `admin-read-service`（70KB）：getOverview/getOrder/listOrders/getCard/traceability 等只读聚合层（展示层，无资金决策，侦察确认）。
- `browser-admin-service`（703）：Browser 人工接管状态机 **AUTOMATION→REQUESTED→FROZEN(HUMAN_REQUIRED)**，confirmation + operation ID 防冲突；列表 RECONCILE_ONLY/HUMAN_REQUIRED 优先显示。
- `admin.js`（135KB）：后台 UI 渲染层，纯展示（未逐行；展示层无业务不变量）。

### 🖥️ 战役 5 核心洞察
控制面 = **分层开关 + 确认防误 + 契约隔离**：进程层 PROVIDER 四权限（硬门禁）× 业务层 app_settings（运营开关）；每个营业动作要 confirmation 短语；客户只见 7 态契约，内部 16 态/资金/卡台全隐藏。已知缺口（代码坐实）：API 权限关闭 BLOCKED 无跳转 actionId、开始营业快照不查 runner 心跳/日限额、营业后漂移不自动关接单——待收敛项，不影响资金安全。

### 战役 5 待生产核对（⚪ 战役7）
- app_settings 各开关真实值、admin 认证/step-up 生产配置、customer 页公网 CSP。

## 战役 6：部署与运维（进行中）

### 生产拓扑 — `deploy/README.md`（🟡）
- AlmaLinux 9 共用主机独立边界：MySQL 8.4.11 容器仅 `127.0.0.1:3306`；Web 仅监听 `127.0.0.1:3100`，**公网入口由 Caddy**；web/worker/bark 用无登录 `pojia` 账号。
- **凭证分层**：`/etc/pojia/` root 管理不进 Git；Web 只加载 `card-read.env`（HNSKJ 只读），**不加载 provider.env**（充值密钥）。供应商开关初始全关。
- 部署顺序：bootstrap-host → admin.env(0640) → 迁移(迁移账号随后锁定) → web/worker → bark → caddy(校验后 reload 不覆盖现有)。

### 权限注入 = 默认全关 + drop-in 精确覆盖（🟡）
- `pojia-worker.service` **ExecStart 硬编码三个 PROVIDER_*=false**（`:14`），provider.env 可选（`-` 前缀）。开 API 充值必须装 `api-recharge-enabled.conf` drop-in（**只覆盖 recharge_writes=true**，通用/卡片写仍 false）；停止时删 drop-in + reload + restart。**部署后必须等 Worker 心跳 + 确认 readiness `apiRechargeExecutionEnabled=true`，不能只看进程 active**。当前生产即此状态。
- systemd **沙箱极严**：NoNewPrivileges / PrivateDevices / PrivateTmp / ProtectSystem=strict / Protect* / Restrict* / CapabilityBoundingSet=（清空）/ UMask=0077。

### 付款走 Permit gate，不碰 systemd（🟡）
- `pojia-recharge-gate.sh`：`arm <订单>` = DB 事务内付款前复核 + 签发唯一短时 Permit + 开 dispatch；`close` = 关 dispatch + 撤未消费 Permit（不停 Worker，轮询继续）。**不得直接编辑 env 绕过 Permit**；Permit 消费后失败进终态/人工。

### Browser 独立单元（🟡）
- `pojia-browser-worker.service` 独立（不由 pojia-worker 消费），**现阶段只 readonly canary 无付款**；仓库不自动 enable/start；启动前置：迁移 001-041、`browser_payment_writes_enabled=false`、profile BROWSER/ACTIVE + productionWritesEnabled=false、所有资金写 false。真实只读 harness 目标精确 `https://chatgpt.com/`，只注入 Session 核对登录/订阅/Plus/Checkout 后安全退出。回滚 stop/disable，**不通过回滚重派 UNKNOWN/RECONCILIATION 任务**。

### 备份恢复（🟡）
- `pojia-ops.sh`：status/backup/verify/**restore-test（无网络临时容器真实恢复演练，不碰生产库）**/check。加密备份 + 哈希校验。

### Caddy 与进程级窄权限隔离（🟡 侦察）
- **Caddy**：严格 CSP（全 `'self'`，无 unsafe-inline，`frame-ancestors 'none'`）+ nosniff + no-referrer + X-Frame DENY；reverse_proxy 127.0.0.1:3100；zstd/gzip。
- **窄权限贯彻到进程级**（关键）：每个 runner ExecStart 只开一个 PROVIDER 权限——`pojia-card-stock-runner` 仅 `CARD_WRITES=true`；`pojia-card-funding` 仅 `CARD_WRITES=true`；API worker drop-in 仅 `RECHARGE_WRITES=true`；主 worker 全 false。
- 💡**解答历史矛盾**：`provider_accounts.write_enabled=0` 但补给能跑——因为 **runner 用进程级 ExecStart gate，不看 DB 字段**。正是 CURRENT_STATE 所述，现有配置级证据。
- **timer 调度**：backup 每日 03:17 UTC；card-funding 5s、reconcile 15s、read-sync 15s、catalog-sync 5min、stock-runner 60s 兜底、card-audit 30min。

### 🔧 战役 6 核心洞察
部署把"最小权限"贯彻到极致：worker 默认全关 → drop-in 精确覆盖单个权限 → 每个补给 runner 只开自己那一个进程级 gate → 付款走 DB Permit 不碰 systemd → Browser 独立单元只读。叠加 systemd 沙箱 + Caddy 严格 CSP + 凭证分层（card-read.env vs provider.env）。**运维纪律与资金安全同级**。

### 战役 6 待生产核对（⚪ 战役7）
- release 符号链接指向、各单元 active/enabled 实况、drop-in 是否已装、备份定时器与最新备份哈希、Caddy 实际生效。

## 战役 8：文档收敛（已通）

### 文档分层构成（🟡）
- 208 `.md` + 20 contracts + 子目录（architecture/browser-research/design/security）。
- **过程证据占绝大多数**：review 48（adversarial 47）/ report 44 / audit 27 = 一大半；权威事实源仅 6 核心（PROJECT_MAP/CURRENT_STATE/OPERATING_MODEL/DECISIONS/V1_SPEC/ROADMAP）+ contracts。
- 💡**47 个对抗式审查**是资金安全扎实的文化根源——几乎每个实现配一个自我攻击审查。

### 文档 vs 代码一致性（🟡）
- **核心事实源与代码高度一致**：OPERATING_MODEL §2.2 开始营业检查表逐条对应 `admin-readiness-summary` 代码（含"API 权限无 actionId"标 `[已知缺陷]`）；§5 资金边界与五道栅栏完全吻合；§10 已知缺陷 6 条核对全属实。
- **文档诚实**：未发现文档撒谎或与代码实质冲突；自标缺口都被代码坐实。治理有制度（OPERATING_MODEL §11 定义各事实源职责与更新时机）。

### 发现的漂移（都是时效/未提交，非实质冲突）
1. **DECISIONS.md 新旧未提交**：工作区 64 行精简版 vs HEAD 147 行账本，未 commit。
2. **OPERATING_MODEL §8/§6 生产快照停在 08-31**（release `…55b6ec4`）落后于 CURRENT_STATE 09-01（`…2bce69e`）——属设计分工（CURRENT_STATE 管高频生产事实），但 §8 写死具体 release 文件名就会过时。
3. **⚠️ CURRENT_STATE/PROJECT_MAP（09-01 11:02）已被当日 14:01 事件超越**：那张"可分配 $16 卡（1839/尾号1013）"在 14:01 被订单 `412JIT` 用掉 → ZZSHU 明确"卡片被拒"（外部订单 8849）→ 用户删卡，现 `invalidating/$0.01`。**此刻实际可分配库存已非 11:02 所述**。见 `2026-09-01_order-412JIT-card-decline-investigation.md`。

### 🔑 412JIT 事件对当前理解的更新（重要）
- 继"2 笔历史成功"后的**新真实链路数据点**：完整 API 链路跑通到真实提交（外部订单 8849），上游判**卡片被拒**（非余额/Session/超时/未知）。
- **资金安全代码正确处理**：attempt FAILED + funds_risk_state CLEARED + 消费账本 RECONCILIATION + 不自动换卡重付 ✅（印证战役2）。
- ~~展示缺口：failure_reason 不透传~~ → **已收回**：该透传在 `7bad460` 已部署（CURRENT_STATE 第 113 行），后台已能显示 Provider 脱敏原文。我引用的 412JIT 调查(09-01)描述的是修复前状态。
- 💡坐实：连"当前生产快照"文档也会滞后于最新事件——真正掌握此刻生产事实必须靠**战役7 SSH 核对**。

## 战役 7：生产实时核对（部分完成 · 2026-09-02）

途径：Lemon 已登录浏览器 → 搬瓦工客户区 → KiwiVM「根壳-基础版」网页 root shell，我在其中只读核对。生产机 `elegant-unicorn-1` / 144.34.180.184 / AlmaLinux 9 / 多项目共用主机。**全程只读，未执行任何写/资金/服务变更。**

### ✅ 已生产核实
- **release（✅ 与文档一致 · 早前"漂移"结论已收回）**：`/opt/pojia/current` → `…20260901-browser-access-block-7bad460…`。**这与最新 `CURRENT_STATE`(09-02 00:32) 第 9 行、以及对话初始 git log 的 `7bad460` 完全一致——没有漂移。** 早前误报"漂移"，是我拿过时的 `2bce69e` 记忆当当前文档、未对齐最新 CURRENT_STATE 所致（违反项目三道闸门第三道），已收回。教训见更新记录 2026-09-03 条。
- **服务状态**（`systemctl is-active`）：pojia-web=active、pojia-worker=active、pojia-browser-worker=**inactive**、card-funding/card-stock-runner/card-funding-reconcile timer=active。✅与 CURRENT_STATE 一致。
- **worker 进程权限**（`/proc/<MainPID>/environ`）：`PROVIDER_READS_ENABLED=true`、`PROVIDER_WRITES_ENABLED=false`、`PROVIDER_CARD_WRITES_ENABLED=false`、`PROVIDER_RECHARGE_WRITES_ENABLED=true`。✅与 CURRENT_STATE + drop-in 设计一致。
- 环境：无 mysql CLI（有 node）；MySQL 为 Docker 容器（127.0.0.1:3306）；凭证在 `/etc/pojia/*-password` 与 `runtime.env`（未读取任何密码内容）。

### ✅ DB 明细已核实（2026-09-03 · Lemon 代跑 SSH 明文只读查询）
> 途径记录：KiwiVM 网页终端因**会话超时 / Cloudflare 人机验证 / 吞首字符 / 引号解析 bug** 不适合系统核对；base64 绕过被安全分类器正确拦截（编码执行属危险模式，未绕过）。最终经 Lemon `ssh root@144.34.180.184` 代跑明文只读查询一次取全。

- **app_settings（20 项）**：营业中（accept_new_orders / dispatch_new_recharges / poll_existing_orders=true）、`worker_recharge_writes_enabled=true`、`browser_payment_writes_enabled=false`、自动补给全开（auto_replenishment + balance_recharge=true）、`card_max_successful_payments=3`、开卡/最低余额=16、`recharge_dispatch_mode=AUTOMATIC`、`browser_worker_heartbeat_at=""`（Browser 无心跳，符合 inactive）。✅与文档一致。
- **provider_accounts（2）**：`…101 write_enabled=0`（卡台账户）、`…102 write_enabled=1`（充值账户），circuit 均 CLOSED。✅印证 OPERATING_MODEL"card account write=0 但 runner 走进程 gate"。
- **cards（9）— ⚠️ 库存告急**：无一张 AVAILABLE；唯一有钱的 `2338`（active/$16）被 RECONCILIATION 占用（ASSIGNED）；`1839`（412JIT 那张）=invalidating/$0.01；`1477`=invalid；其余多为 DEPLETED/$0.01。**此刻无立即可分配的健康卡**，下一单将触发自动开卡。
- **orders（近10）**：2 笔 RECHARGE_SUCCESS（08-27/08-29）✅印证历史两单；但 **08-31 / 09-01(412JIT) / 09-02(两笔) 接连 4 笔 RECHARGE_FAILED**——近期充值失败在持续，非孤例。
- **资金安全（关键 ✅）**：recharge_fence 仅 2 笔 SETTLED，**无 ACTIVE/UNKNOWN**；funding_fence=0；consumption 有 2 条 RECONCILIATION（失败订单正确保留占用不释放）。**连续失败流中零 UNKNOWN 悬空、零重复扣款——资金安全设计经真实验证。**

### 🔑 战役 7 收尾洞察
- 生产实况与最新 `CURRENT_STATE`(09-02 00:32) 整体一致，**无 release 漂移**（早前"漂移"是未对齐最新文档的误判，已收回）。CURRENT_STATE 本身已详细记录 412JIT、09-02 两笔失败、失败原因透传已部署、自动开卡被卡台余额不足阻断——即"充值失败/库存/透传"并非文档缺失，是我当时未对齐所致。
- **两个运营级新事实**（文档未反映，需 Lemon 关注）：① 近期充值失败率上升（卡被 ZZSHU/下游反复拒付）；② 库存告急（无可用健康卡，靠自动开卡兜底）。
- **资金安全是全系统最硬的部分**：真实连续失败里零悬空、零重复扣，铁律 hold 住。这是"彻底了解"最有分量的生产结论。

---

## 更新记录

- 2026-09-01：报告创建。完成地形侦察；战役 1 精读 4 张资金/容量核心表（026/030/038/043）。战役 7 因无 SSH 凭证阻塞。
- 2026-09-01：战役 1 补读 001（原始核心表）+ 021（foundation v2 大重构）。梳理出「5 道资金安全栅栏全景」——全部 DB 生成列+唯一索引，UNKNOWN 永久占位物理防重付。主干+资金栅栏已通。
- 2026-09-01：战役 2 骨架。订单 16 状态显式状态机（order-status.js）+ 8 类任务模型（task.js）。发现「第二重防重付」：SUBMIT_UNKNOWN 状态机出口不含 SUBMITTING，付款未知后回不到提交。
- 2026-09-01：战役 2 主动脉。workflow-handlers.js 644 行全读，付款(submitRecharge)/对账(pollRecharge)/取消(recheckCancellation)/开卡(purchaseCard) handler 全通。资金安全 = 数据强约束 × 状态机单向 × handler 逐分支锁定三重叠加；可完整讲清一笔订单生死。
- 2026-09-01：战役 3 前半。Provider 适配器(hnskj-card 460行,Zod+幂等+超时资金语义)、资格判定 SQL、补余额链(付款的完整镜像)、一卡多单容量(行锁原子预留上限3)全通。开卡/入库/同步待读。
- 2026-09-01：**战役 3 收口**。开卡决策(阈值+日限额 D-029)、开卡服务(上限1-4)、入库隔离(双快照 D-014)、同步/覆盖/配置(只读或配置,无资金写)全通。梳理出「统一资金安全范式」：所有花钱动作共用同一栅栏。当前生产完整闭环已全部代码级打通。
- 2026-09-02：战役 4 开局。厘清 Browser 三块结构与**真实完成度(付款从未接线,PoC→MVP 演进中,Worker disabled)**；派发层(dispatch-repository 330行)已确认 Browser 复用同一套 ACTIVE 资金栅栏,claim 用 SKIP LOCKED + 歧义不重试防重复执行。付款闸门/恢复待读。
- 2026-09-02：**战役 4 收口**。付款安全闸门(两层防重付 + WAL 崩溃不丢 UNKNOWN 锁)、run 三维状态机、RECONCILE_ONLY 恢复(付款后只对账)、上号(digest)、提链(fingerprint)全通。判断:Browser 安全设计比 API 更谨慎但真实付款从未接线;要上线还差身份核对/Checkout付款/联调/PH出口/灰度。
- 2026-09-02：战役 5 开局。70 路由入口地图(客户仅3端点,无退款查询)+ 两层开关(进程 PROVIDER 四权限分离默认全关 / 业务 app_settings)厘清。控制面核心/前端待读。
- 2026-09-02：**战役 5 收口**。开始营业检查(代码坐实"API权限关闭无跳转"缺口)、操作确认防误、客户契约7态隔离(内部16态全隐藏)、Browser人工接管状态机全通。控制面 = 分层开关 + 确认防误 + 契约隔离。
- 2026-09-02：战役 6 主体。生产拓扑(回环+Caddy+pojia账号+凭证分层)、权限注入(worker ExecStart 硬编码全关 + drop-in 精确覆盖 recharge_writes)、付款 Permit gate、Browser 独立只读单元、备份恢复演练全通。systemd 沙箱教科书级。Caddy/timer 待侦察。
- 2026-09-02：**战役 6 收口**。Caddy 严格 CSP、进程级窄权限(每 runner 只开一个 PROVIDER gate)、timer 调度全通。坐实"runner 用进程级 gate 不看 DB write_enabled"。**至此本地可做的战役 1-6 全部完成**；仅剩战役7(生产核对,需 SSH)与战役8(文档收敛)。
- 2026-09-02：**战役 8 收口**。文档分层(208+20,过程证据过半,47对抗审查)、核心事实源与代码高度一致、文档诚实(自标缺口全被代码坐实)。漂移:DECISIONS新旧未提交、OPERATING_MODEL §8停08-31。~~CURRENT_STATE 11:02快照被412JIT超越~~（09-03 收回：CURRENT_STATE 实为 09-02 00:32 版，已详记 412JIT，是我当时对齐了旧版而非最新版）。本地战役1-6+8全部完成,仅剩战役7(生产核对,需SSH)。
- 2026-09-02：**战役 7 部分完成**。经 Lemon 浏览器登录的 KiwiVM 网页 root shell 只读核对:服务状态与 worker 权限均与文档一致。~~抓到 release 漂移~~（此结论 09-03 收回，见下）。DB 明细因网页终端环境受限(会话超时/CF人机验证/吞首字符/复杂查询解析失败)未取到,待真 SSH 或代跑 node 查询。全程只读。
- 2026-09-03：**战役 7 完成 · 八大战役收官**。Lemon 代跑 SSH 明文只读查询取全 DB:app_settings/provider/库存/订单/资金栅栏全核实。开关权限与文档吻合;两个运营事实(充值失败率上升、库存告急)**经复核 CURRENT_STATE 已记录,非新发现**;**资金安全在真实连续失败流中零悬空/零重复扣,经生产验证**(此项 CURRENT_STATE 亦印证)。base64 绕过被安全分类器正确拦截,未绕过。整个"彻底了解"任务八大战役全部走完。
- 2026-09-03：**重要更正与教训（接手窗口自记）**。登记报告前重读最新 `CURRENT_STATE`(09-02 00:32)，发现三处结论基于过时信息误判、已收回：① "release 漂移"不存在——生产 `7bad460` = CURRENT_STATE 记录，亦见对话初始 git log 的 `7bad460`/`c0e24cf`；② 我建议的"透传失败原因"已在 `7bad460` 部署(CURRENT_STATE 第 113 行)；③ "充值失败/库存告急/自动开卡"CURRENT_STATE 均已详记，且更精确(自动开卡当前真实阻断是**卡台账户余额 $19.43 < 卡段最低 $25**，非泛论)。**根因**：生产核对后未执行项目铁律第三道闸门(新证据与最新 CURRENT_STATE/PROJECT_MAP 冲突检查)，用了早期记忆。这是跨窗口接手最典型的断层源。**固化为过渡第一纪律：任何"当前状态/问题/方案"结论落地前，必先重读最新 CURRENT_STATE + PROJECT_MAP 做冲突检查，再下笔。**
