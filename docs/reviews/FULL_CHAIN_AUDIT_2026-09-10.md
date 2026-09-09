# 全链路审计｜从生成 CDK 到订阅成功（2026-09-10）

审计者：执行者窗口 `68c73cc7`（Fable 5.1）。触发：2026-09-09 第一笔 Browser 真单失败后用户要求"整体、完完全全、彻彻底底检查一遍"。
方法：按真单实际经过的路径逐段读代码（v1 + browser-mvp 共 ~30 个文件），只读生产核对关键事实；**主线是找"真单会走、但演练/测试从没真正走过"的路**——09-09 的洞就是这么来的。
标注：`[代码显示]` = 只核对了代码；`[现场已证]` = 生产/现场核过；`[推测]` = 有依据但未证。

## 一、结论先行

链路里**资金安全的骨架是对的**（防重付、未知不重试、CDK 退回规则、卡释放），这次没找到会多扣钱的洞。
但**客户链和恢复链有 3 个 P0**：真单一旦在预检/等待阶段出问题，客户会被卡死，而且没有人能从后台把它救回来。它们都属于"从没有真实客户走过"的路。

| 级别 | 编号 | 一句话 | 状态 |
|---|---|---|---|
| P0 | F-5 | 客户页**永远不显示"重新提供 Session"表单**，打回的单客户无法自救 | 代码显示 + 线上 release 同一行 |
| P0 | F-1 | 预检 5 次失败即 DEAD，**没有任何重开入口、没有告警**，订单永久停在"准备中" | 现场已证（09-09 真单） |
| P0 | F-10 | 等卡/等人工期间客户继续用账号 → 我们存的 session 失效 → 打回 → 撞 F-5 → 死单 | 机制 09-07 已观察到 |
| P1 | F-3 | 取消续费走的接口从没在真实账号上调过；失败后走到的状态，后台按钮不认 | 代码显示 |
| P1 | F-4 | 付款前任何瞬时失败一律终态 + CDK 退回 + 客户看到"未成功" | 代码显示 |
| P1 | F-6 | 手动卡付一单即 DEPLETED/余额 NULL，不重传 Excel 就不能再用 | 代码显示 |
| P1 | F-7 | 后台「取消并释放卡」对跑过 Browser 的 CARD_READY 单一律拒绝 | 现场已证（09-09 演练残单） |
| P1 | F-8 | 客户页文案：失败不告诉客户"可重新提交"；等待写死"一分钟左右" | 代码显示 |
| P2 | F-11 | 结账合同强制 PHP+零税，客户账号若按 USD 计价直接失败 | 推测 |
| P2 | F-12 | 页面文案/按钮依赖中英文；其他语言 UI 直接失败 | 推测 |
| P2 | F-13 | 3DS/OTP/hCaptcha 无处理，只会等 5 分钟判未知→拒付 | 代码显示 |
| P2 | F-14 | 证据表只落第 1 次尝试，后台看不到真正失败那次 | 现场已证 |
| P2 | F-15 | 单一机房出口，自动化次数一多就见 Cloudflare 挑战 | 现场已证（09-09 实验） |

## 二、逐段核对

### 1. 生成 CDK（后台）
`cdk-service.js`：按 planType 生成、批次密文可下载、幂等 request_key、作废。**未发现问题**。库里只存哈希，明文只在生成时交付一次。

### 2. 客户提交（客户页 → `POST /api/v1/orders`）
- 校验（`session-validation.js`）：只查格式（JWE 5 段、accessToken JWT 的 iat/exp、expires），**不上浏览器验**。CORE_SPEC §5.1 写的"坏 Session 在客户贴码时即在常驻身份内验证，秒级打回"**没有实现**——坏 session 要等到预检才发现（几分钟到几小时后）。→ 见 F-10。
- 建单（`order-intake-repository.js`）：路线冻结、按产品最低余额、任务链（ASSIGN_CARD / BROWSER_PREFLIGHT max 5 / PREPARE / SUBMIT）。同码同账号返回原单、未付款终态自动退回再建、他人用同码拒绝。**规则与基线一致**。
- 存库材料：`/api/auth/session` JSON 原样加密。浏览器只用 sessionToken（09-09 已修域）。

### 3. 服务器 Worker（`workflow-handlers.js`、`task-repository.js`）
- ASSIGN_CARD：资格 SQL 完整（余额/账本/分配/RETIRED/PRODUCT_ONLY）；无卡 → WAITING_FOR_CARD，每 60s 重试，attempts 退还。OK。
- PREPARE/SUBMIT 前都重新验 session 格式（`requireFreshCustomerSession`）→ 过期直接 WAITING_FOR_SESSION。OK。
- SUBMIT_RECHARGE 领取条件（`task-repository.js:70-76`）要求 BROWSER_PREFLIGHT `COMPLETED` 且 `outcome=PASSED`。**预检 DEAD 则永远不领**，且没有任何路径把 DEAD 改回 PENDING（全库只有 `session-replacement-service.js:106` 会重置，但前提是订单已在 WAITING_FOR_SESSION）。→ **F-1**。

### 4. 本机预检（`browser-order-preflight.js`）
- 每次失败 30s 后重试，max 5，LEASE_LOST 也算一次（`fail()` 不退还 attempts）。09-09 真单：3 次租约超时 + 2 次结账页 403 = 5 次用尽 → DEAD（`tasks.id=135`）。→ **F-1**。
- DEAD 时只写一条 `order_events`"Browser preflight exhausted"，**不发告警**（告警类型只有 BROWSER_ORDER_FAILED / PAYMENT_UNKNOWN / PAYMENT_CONFIRMED / ORDER_COMPLETED / HUMAN_REQUIRED / UPGRADE_HANDOFF 六种）；后台首页"需要处理"的统计（`admin-read-service.js:565-583`）也不含这种单。运营看不到。
- 客户页此时显示"准备中：通常一分钟左右完成"（`customer.js:39`），无限期。

### 5. 打回与客户重贴（`WAITING_FOR_SESSION` → 客户页）
- 后端：`order-status-service.js:107-114` 返回 `sessionReplacement.remaining: null`（09-07 基线：不限次数）。
- 客户页：`customer.js:259` `canReplace = status==='ACTION_REQUIRED' && Number(replacement.remaining || 0) > 0 && !expired` → `Number(null||0)` 恒为 0 → **`canReplace` 恒为 false** → 表单永远隐藏（`:281`），文案永远是"更换次数或时间窗口已用完，请保留查询码联系人工处理"（`:260-261`）。
- 线上 release `cc3bba0` 的 `customer.js:259` 同一行（已 ssh 核对）。
- 影响：SESSION_INVALID / ACCOUNT_ALREADY_PLUS 两种打回，客户都无法自助；`UNVERIFIED_LEDGER`"系统打回→客户页重贴→预检再过"闭环之所以没人走过，是因为走不通。→ **F-5**。修法一行：`(replacement.remaining == null || Number(replacement.remaining) > 0)`。

### 6. 派发与执行（`shared-runtime-integration.js`、`executor.js`）
- 资金三道门：DB 开关 → permit → intent 落库 → 单次 click → 非 CONFIRMED 即 UNKNOWN；pre-click 的 CHECKOUT_DRIFT 等不污染 attempt。**与 CLAUDE.md 硬约束一致**。
- 付款前失败分类（`classifySafeAbort`）：SESSION_* → WAITING_FOR_SESSION；卡类/LEASE → CARD_READY 重试；**其余一律 RECHARGE_FAILED**（含 CHECKOUT_NAVIGATION_FAILED、OBSERVATION_FAILED、ACTION_TIMEOUT、PAGE_DRIFT、ACCESS_BLOCKED）→ CDK 退回 + 卡释放 + 告警 + 客户看"未成功"。`maxDispatchAttempts=3` 的有界重试机制存在，但被分类绕过（只对回 CARD_READY 的类型生效）。与预检 5 次重试不对称。→ **F-4**。
- session 注入域：09-09 已修（D-140），`__Host-` 保持 host-only。
- 结账观察（`checkout-observer.js`）：强制 `PHP` + 税 ≤ 0.01 + 总额=小计+税；标签中英文；安全字段 45s 等待。→ **F-11/F-12**。
- 填卡/地址/邮箱/重报价（`live-chatgpt-payment-adapter.js`）：演练两次验证过到点击前；点击后清卡字段（D-137）。

### 7. 付款后（`payment-executor.js`、`chatgpt-post-payment-verifier.js`、`live-post-payment-recovery.js`）
- 点击后：`confirmPlus` 轮询 `accounts/check` 最多 5 分钟（页内 fetch，不刷新）；不确认 → PAYMENT_RESULT_UNKNOWN → `markPaymentUnknown` → 5 分钟核实 → 账号仍 free 判 DECLINED → RECHARGE_FAILED 释放卡；超时 → `escalatePaymentVerification` → run HUMAN_REQUIRED + reconciliation_case + 告警。**资金逻辑对**；3DS/OTP/hCaptcha 出现时就是这条路（客户看到失败，无扣款）。→ **F-13**。
- Plus 确认后：`markPaymentConfirmed` 账本 CONSUMED、分配 RELEASED、**卡 → DEPLETED 且 current_balance=NULL**（`browser-execution-repository.js:1138-1143`）。手动卡没有同步来源，之后不再合格；重传 Excel 会更新余额/库存（`manual-card-import-service.js:200-202`）。→ **F-6**。
- 取消续费：`POST /backend-api/subscriptions/cancel {account_id}`（`chatgpt-post-payment-verifier.js:9,64-84`）**从未在真实账号上调过**；`purchase_origin` 为 apple/google 直接不做。失败 → POST_PAYMENT_UNKNOWN → 核实 lane 重跑 → 仍失败 → 到期 escalate → run HUMAN_REQUIRED、订单仍 RECHARGE_PROCESSING。此时「已在账号里取消续费」按钮**不可用**（只认 CANCELLATION_REVIEW_REQUIRED 或 RECHARGE_SUCCESS+review=1，`manual-cancellation-service.js:44-45`）；运营只能走 run 控制面（CONFIRM_MANUAL_PAYMENT 等，也没跑过）。→ **F-3**。
- 20X 第二阶段：弹窗停下 + 人工 Pay now + 「确认 20X 已升级」——09-08 只读验证过弹窗，付款后接入未验证（已知）。

### 8. 后台收口（`order-cancellation-service.js`、`browser-admin-service.js`）
- 「取消并释放卡」：CARD_READY 分支要求 `browser_run_count=0`、非 QUEUED 派发=0（`:167-179`），即**只要跑过一次 Browser 就拒绝**，哪怕栅栏已 CLEARED、账本已 RELEASED。09-09 演练残单、真单预检失败单都撞这条，只能靠 `close-rehearsal-order.mjs` / `close-manually-fulfilled-order.mjs`。→ **F-7**。
- 「已在账号里取消续费」：只覆盖 API 路线的复核态；Browser 路线的 HUMAN_REQUIRED 不覆盖。→ 并入 F-3。

### 9. 客户端显示（`customer.js`、`order-status-service.js`）
- 16 态映射到 6 步：CARD_READY/WAITING_FOR_CARD 都是"准备中·通常一分钟左右"；RECHARGE_FAILED → "未成功，请联系客服"，但此时 CDK 已退回、客户可以直接重新提交同一 CDK，页面没说。→ **F-8**。
- 轮询 30 分钟后停止自动刷新（`:312`），合理。

### 10. 证据与可观测
- `browser_run_events` 唯一键 `job_id+sequence`：同一预检任务重试 5 次只落第 1 次，后台时间线看不到真正失败的那次；完整证据只在本机 `pool/lane-4.wal`。→ **F-14**。
- 出口：全部窗口同一机房 IP；09-09 实验第二轮已见 Cloudflare 挑战（`401 …/challenge-platform/…`）。→ **F-15**。

## 三、核对过、没发现问题的

- 防重复扣款状态机与三道门；未知结果不重试不换卡。
- CDK 绑定/退回/不退（有付款证据）/同码同账号返回原单。
- 建单路线冻结、按产品最低余额、卡资格 SQL 与覆盖项。
- 付款前失败释放卡（D-131）、付款前清卡字段（D-137）、付款确认后账本/分配/告警。
- session 注入域（D-140，对照实验）。

**没审到的**：HNSKJ 自动开卡/补余额（停用中）、API 路线（zzshu，旧）、后台每个页面的交互、备份恢复演练。

## 四、建议的修复顺序（不做则每笔真单都可能撞）

1. **F-5**（一行，需发布）：`customer.js:259` 改为 `order.status==='ACTION_REQUIRED' && !expired && (replacement.remaining == null || Number(replacement.remaining) > 0)`。
2. **F-1**：①预检 DEAD 时发 `BROWSER_HUMAN_REQUIRED` 告警并进首页"需要处理"；②后台/脚本"重开预检"（把 DEAD → PENDING、attempts=0）；③LEASE_LOST 退还 attempts；④max_attempts/退避按真实账号实测（预检一次 2–4 分钟，30s 退避 5 次≈15 分钟就 DEAD）。
3. **F-10**：客户提交时在常驻身份内做一次只读 session 探测（CORE_SPEC 已写、未实现），坏 session 秒级打回；配合 F-5 才有意义。
4. **F-3**：真单前用测试号（付款后）只调一次 cancel 接口验证；把 CANCEL_RENEWAL 失败映射到 `RECHARGE_SUCCESS + cancellation_review_required=1`，复用现有按钮。
5. **F-4/F-7/F-8**：分类改为有界重试；后台取消条件改为"无 PAYMENT_SUBMIT 且 attempt 全 CLEARED"；客户页失败文案改为"可重新提交同一 CDK"。
6. **F-11**：真单前用测试号确认非 PH 地区账号在 PH 出口下的计价币种。

以上 1–2 不做，下一笔真单只要在预检阶段出任何问题，仍然是死单 + 客户无法自救 + 运营看不到。
