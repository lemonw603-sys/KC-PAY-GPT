# 审查记录（REVIEW_RECORD）

> 按 `docs/REVIEW_PROTOCOL.md` §3 只追加。审查员只写本文件；处置记录在 `DISPOSITIONS.md` 由执行者写。

## 批次 1｜截至 2026-09-10 01:03 UTC｜commit `a367bcf`｜release `20260909-askform-cc3bba0`｜板块 D（Browser 路线，主）+ A（客户下单链）+ B（供给链）+ F（运维脚本）

审查员：本窗口（Fable 5.1）。用户指定本窗口先审后做，因此审查员与后续执行者是同一窗口；记录格式与只读约束按协议执行，处置仍另写 `DISPOSITIONS.md`。
范围：`REVIEW_SCOPE_2026-09-10.md` 第一节全部、第二节里付款前释放/退回三处与三个收口脚本，加真单路径上审计未打开的组件。方法：逐文件读源码；本机四个 WAL 按任务汇总动作序列；生产只读查询（`browser_runs`、`browser_operations`、`browser_post_payment_observations`、`browser_run_events`、`tasks`、线上 `customer.js`）。未改任何代码，未跑 worker，未做生产写操作。
标注：`[代码显示]` 只核对了代码；`[现场已证]` 有生产或本机运行证据；`[推测]` 有依据但未证。

### 一、核对过、未发现问题的（与 FULL_CHAIN_AUDIT §三一致，本批独立复核）

- 三道门：`browser_payment_writes_enabled` 在 permit 与 intent 两处 `FOR UPDATE` 断言（`browser-execution-repository.js:244-253, 535, 595`）；permit 绑定 worker、租约、快照哈希（`520-573`）；`PAYMENT_SUBMIT` 唯一 operation 且重放返回不执行（`575-684`）。
- 点击后非 CONFIRMED 一律 UNKNOWN，三处入口（`payment-executor.js:201-231`）；`getRecoveryState` 有 PAYMENT_SUBMIT 或 UNKNOWN 即 RECONCILE_ONLY（`1693-1722`）；`abortBeforePayment` 检查无 PAYMENT_SUBMIT、无 CONSUMED permit 才清栅栏（`745-760`）；`recoverExpiredRun` 同（`browser-recovery-repository.js:377-393`）。
- 一单一 attempt：`beginAuthorizedAttempt` 已有 ACTIVE/UNKNOWN/SETTLED 只允许幂等复用 PREPARED 的 Browser attempt（`recharge-attempt-repository.js:210-247`）；`claimNextTask` 同样排除（`task-repository.js:85-89`）。
- 资格 SQL 含账本容量、ACTIVE 分配、RETIRED/PRODUCT_ONLY、退款案例、补款进行中（`card-inventory-eligibility.js`）；派发 claim 要求 attempt PREPARED/ACTIVE 且订单 RECHARGE_PROCESSING（`browser-dispatch-repository.js:240-249`）。
- CDK 退回只在无付款证据时（`cdk-return-repository.js:16-33`）；三个收口脚本均有付款痕迹守卫与 `--dry-run`。
- D-137 付款前清卡字段（`live-chatgpt-payment-adapter.js:171-187`）；D-140 域放置（`session-bootstrap.js:96-130`）；D-131 释放卡保留 MANUAL_IMPORT（`card-release-repository.js:26-49`）。
- 恢复仓库租约互斥与接管条件；身份探测三种假登录识别；账单地址卡自带优先。

### 二、发现

#### 板块 D｜Browser 路线

### F-24 付款后核实 lane 每次核实新开一个 chatgpt.com 标签且从不关闭、无退避，累积标签使同 lane 下一次 executor 抛 PROFILE_PAGE_AMBIGUOUS
- 板块 / 严重度：D / P1 功能错误（真单进入核实态后，同 lane 后续订单全部失败，直到人工关标签）
- 观察：`LivePostPaymentRecoveryVerifier.verify()` 每次 `runtime.context.newPage()` 并 `goto` 首页，`finally` 只 detach/close runtime，不关页面；resident 模式 close 即 detach，页面留在窗口。核实服务对 UNKNOWN 结果写 `nextCheckAt: observation.nextCheckAt || null`，而 verify() 从不返回 `nextCheckAt`；`listPaymentVerificationsDue` 取 `verification_next_check_at IS NULL OR <= now`。executor 复用页面时匹配 urlPrefix 的页面多于一个即抛 PROFILE_PAGE_AMBIGUOUS。
- 结论：违反 CORE_SPEC §5"一单一身份、页面复用"的运行前提；与硬约束无冲突（不多扣钱）。
- 证据：`browser-mvp/src/live-post-payment-recovery.js:63-66, 140-146`；`bitbrowser-control-runtime.js:104-121`；`v1/src/services/browser-payment-verification-service.js:96-100`；`v1/src/db/repositories/browser-execution-repository.js:322`；`browser-mvp/src/executor.js:50-59`。现场：生产 run `04f159af`（09-08 真单 `_VjIN`）6 条 PAYMENT_VERIFICATION 观察，04:22:46 至 04:23:19，间隔 6 到 7 秒，即每 tick 一次；`pool/lane-3.wal` 09-08 00:27 任务 91 两次 `PROFILE_PAGE_AMBIGUOUS`，证明多标签会打断预检。`[现场已证]`
- 影响条件：任何进入 PAYMENT_UNKNOWN 或 PAYMENT_CONFIRMED 未收口的真单；5 分钟窗口约 40 次核实即 40 个标签。
- 反证或不确定性：09-08 那 6 次核实后被人工收口，未观察到"核实标签导致后续 ambiguous"的直接样本；00:27 的 ambiguous 来自演练脚本开的页面。
- 参考验证办法：在测试库把一个 run 置为 PAYMENT_UNKNOWN/VERIFYING_PAYMENT 跑核实 lane 30 秒，数窗口标签；或单测断言 verify() 关闭自开页面。
- 建议：verify() 在 finally 关闭自己开的页面；UNKNOWN 分支给 `nextCheckAt = now + verificationIntervalMs`。
- 置信度：高

### F-25 运行中关闭付款开关会让正在跑的订单被判 RECHARGE_FAILED 终态、CDK 退回、卡释放，而不是暂停
- 板块 / 严重度：D / P1 功能错误（客户看到"未成功"，运营决定"暂停付款"被系统解释成"这单失败"）
- 观察：`issuePaymentPermit` 断言开关失败抛 `BROWSER_PAYMENT_WRITES_DISABLED`；`BrowserPaymentExecutor.execute` 在 `try` 之前调用 permit；executor 把异常按原 code 包装；`classifySafeAbort` 不识别该 code，走默认分支 RECHARGE_FAILED；常驻池 `safeAbortOnFailure` 直接落终态并退 CDK、放卡、发告警。
- 结论：与 CORE_SPEC §6 五个决定里"能不能付钱"的语义不符（应为暂停）；与 D-004 不冲突。
- 证据：`v1/src/db/repositories/browser-execution-repository.js:244-253, 535`；`browser-mvp/src/payment-executor.js:168-186`；`browser-mvp/src/executor.js:419-421`；`browser-mvp/src/shared-runtime-integration.js:53-103, 413-420`。`[代码显示]`
- 影响条件：worker 已领单、尚未发 permit 时开关被关。`stop-live.sh` 先 kill 再关开关通常不触发；后台首页"浏览器真实付款"开关随时可关。
- 反证或不确定性：未在生产触发过。
- 参考验证办法：单测 `classifySafeAbort({code:'BROWSER_PAYMENT_WRITES_DISABLED'})` 期望 CARD_READY。
- 建议：把该 code 加入 `SAFE_CARD_RETRY_CODES` 类（回 CARD_READY 等待）。
- 置信度：高

### F-26 点击付款后 worker 被停止时，run 停在 PAYMENT_SUBMITTING，没有任何自动核实排程，且同 lane 会在该派发上每 15 秒空转
- 板块 / 严重度：D / P1 功能错误（钱可能已扣，订单无人核实，只剩手工 SQL；F-16 的一个具体入口）
- 观察：点击后 worker 同步等待 `confirmPlus` 最多 300 秒；`markPaymentUnknown` 只由该进程在 catch 里调用。进程被杀后 run 仍 RUNNING/PAYMENT_SUBMITTING。`listPaymentVerificationsDue` 只取 RECONCILE_ONLY+PAYMENT_UNKNOWN 或 RUNNING+PAYMENT_CONFIRMED 且 VERIFYING_PAYMENT。租约过期后同 job 再被 claim 时 `recoverExpiredRun` 只把 run 置 RECONCILE_ONLY，不设 verification_state；`runPaymentOnce` 得到 RUN_NOT_RESUMABLE 抛错，lane 退避 15 秒再来。
- 结论：违反"付款结果未知必须进入对账并可核实"的运行模型（PROJECT_OPERATING_MODEL §5）；RUNBOOK §1 D-139"卡超过 5 分钟即 stop-live"与 confirmPlus 5 分钟窗口重叠，执行者按规矩操作就可能触发。
- 证据：`browser-mvp/src/payment-executor.js:187-192, 203-207, 217-221`；`v1/src/db/repositories/browser-execution-repository.js:318-322`；`v1/src/db/repositories/browser-recovery-repository.js:384-393`；`browser-mvp/src/shared-runtime-integration.js:156-168, 400`；`browser-mvp/src/production-live-pool-worker.js:166-171`；`browser-mvp/scripts/stop-live.sh` 直接 `kill`。`[代码显示]`
- 影响条件：点击后 5 分钟内 kill worker，或进程崩溃。
- 反证或不确定性：无生产样本。
- 参考验证办法：测试库造 PAYMENT_SUBMITTING run，跑 `listPaymentVerificationsDue` 期望为空；跑 `recoverExpiredRun` 看 verification_state。
- 建议：真单前在 RUNBOOK §1 第③段写明"看到 PAYMENT_SUBMIT 落库后 5 分钟内不得 stop-live"；代码上 `recoverExpiredRun` 对 PAYMENT_SUBMITTING 应同时置 PAYMENT_UNKNOWN 与核实排程。
- 置信度：高

### F-27 D-140"两套 session cookie 并存导致 403"的因果有本机 WAL 反例；修复方向无害，但"根因已定位"不成立，真单 403 风险未消除
- 板块 / 严重度：D / P2 与事实源偏差（影响今天真单的预期与失败归因，不影响资金）
- 观察：本机 WAL 汇总显示，09-08 Lane3 任务 95 首次 bootstrap `cookieCount=2`（注入 host-only 分块），此后同窗口所有任务 `cookieCount=4`（注入的 2 个 + 网站 .chatgpt.com 的 2 个并存）且无 `session-replaced`；在这种并存下 09-08 03:17、04:03、04:20 三次 `checkout-navigation checkoutCreated=true`，04:21 run `d7238d0e` 付款成功（生产 `PAYMENT_SUBMIT` 04:21:59）。Lane4 09-08 07:47、08:03、10:22 与 09-09 04:29、04:31 同样 `cookieCount=4` 并存下结账页成功。09-07 `live.wal` 在 `session-replaced`（清登录态后注入 host-only 分块）之后结账页也成功。09-09 真单第 4、5 次 `cookieCount=2`（单块 host-only + 网站 1 个）时 403。
- 结论：D-140 的机制陈述"两者并存 → 会话被判过期 / 结账页 403"在 09-07 与 09-08 有多次并存却成功的反例；对照实验的 ①→② 差异可能来自别的变量（单块 token、清登录态后的重签、具体账号）。修复（放 .chatgpt.com 域、只剩一套）与成功样本不冲突，保留；但 D-140、CURRENT_STATE"已知未修①"、HANDOFF_NOW 里"根因已定位并修复"应降级为"候选修复，真单未验"。
- 证据：`~/Library/Application Support/pojia-browser-live/pool/lane-3.wal`、`pool/lane-4.wal`、`live.wal` 按 jobId 汇总（本批用 python 只读解析，字段 action/cookieCount/checkoutCreated/reason）；生产 `browser_operations` PAYMENT_SUBMIT 09-08 04:21:59（run `04f159af`）。`[现场已证]`
- 影响条件：真单 403 再现时的归因与应对。
- 反证或不确定性：09-08 的并存样本是"注入后网站轮换"路径，09-09 真单与对照实验①是"清登录态后注入"路径，两者的 cookie 集合不完全相同；ChatGPT 服务端在 09-08 与 09-09 之间可能改了行为。本记录只指出反例，不给替代根因。
- 参考验证办法：用 free 测试号在同窗口做一次"注入单块 token（≤3936 字节）、不清登录态"的对照，看结账页。
- 建议：真单前不再动 D-140；真单若再 403，按 D-139 转人工，不在 D-140 方向继续排查。
- 置信度：中

### F-28 付款点击后 confirmPlus 内任何一次页面求值失败即判 UNKNOWN，不重试；成功付款也会先走 UNKNOWN 再靠核实 lane
- 板块 / 严重度：D / P2 与运行模型偏差（叠加 F-24 后放大）
- 观察：`confirmPlus` 先 `probeSessionIdentity`（含 `page.evaluate` 读 document.scripts），再 `#poll` 里循环 `page.evaluate` fetch；两处都没有对"执行上下文被替换"的重试，只有 SESSION_INVALID 一次阶梯。付款点击后页面可能跳转，evaluate 抛错 → outcomeObserver 抛 → adapter 包装 PAYMENT_RESULT_UNKNOWN → `markPaymentUnknown`。
- 结论：与 CORE_SPEC §5 步骤 5"观察页面结果 → 账户检查核实开通"的预期不符：真单成功时也很可能落 SUBMIT_UNKNOWN 态。
- 证据：`browser-mvp/src/chatgpt-post-payment-verifier.js:130-143, 169-191, 227-263`；`browser-mvp/src/live-chatgpt-payment-adapter.js:158-162, 188-193`。现场：09-08 run `04f159af` PAYMENT_SUBMIT 04:21:59 → PAYMENT_UNKNOWN 04:22:38（39 秒，早于 5 分钟窗口，说明 confirmPlus 是抛错而非等满）；三次拒付单 PAYMENT_SUBMIT 到 PAYMENT_UNKNOWN 均约 5 分 10 秒（等满窗口）。`[现场已证]`
- 影响条件：付款成功且页面在点击后跳转或重绘。
- 反证或不确定性：09-08 那次 39 秒失败当时归因为旧 accessToken 401（D-136），不是 evaluate 失败；本条是代码路径分析。
- 参考验证办法：夹具页在 poll 期间导航一次，断言 confirmPlus 不抛错。
- 建议：`#poll` 与 probe 对 "Execution context was destroyed / Target closed" 类错误重试到窗口结束再判 UNKNOWN。
- 置信度：中

### F-29 session lease 60 秒覆盖不了首页加载加身份探测；超时后替换常驻会话的分支以 PAGE_CHECKPOINT_FAILED 失败
- 板块 / 严重度：D / P2 功能错误（真实客户账号首页慢时预检或 live 直接失败，且 live 走终态）
- 观察：`sessionProvider.open` 未传 ttlMs，默认 60000；探测失败后用同一 lease 调 `bootstrap(replaceExisting:true)`，lease 过期抛 ContractError（无 code）→ executor 外层包装为 PAGE_CHECKPOINT_FAILED → 预检计一次失败，live 按默认分支 RECHARGE_FAILED。
- 证据：`browser-mvp/src/session-bootstrap.js:145, 172`；`browser-mvp/src/executor.js:153, 227-231, 447-449`；`browser-mvp/src/shared-runtime-integration.js:97-102`。`[代码显示]`
- 影响条件：注入后 `goto`（超时 120s）加探测稳定等待（15s）超过 60 秒，且窗口常驻会话属于他人。09-09 真单第一次替换在 60 秒内完成（WAL `session-replaced` 成功）。
- 反证或不确定性：未在生产触发。
- 参考验证办法：夹具让 goto 延迟 70 秒。
- 建议：open 时 `ttlMs` 取 `executionTimeoutMs + 30_000`。
- 置信度：高

### F-30 卡材料租约 5 分钟从打开到进入付款处理器之间不续租；过期后走 PAYMENT_EXECUTION_FAILED 终态（F-4 的一个实例）
- 板块 / 严重度：D / P2 功能错误
- 观察：executor 在结账导航前打开租约 ttl 5 分钟；进入 `withMaterial(cardMaterialLease, paymentHandler)` 时 `assertActive` 检查过期；导航最长 120 秒、安全字段等待 45 秒、探测 15 秒，累计接近上限；过期抛 ContractError → PAYMENT_EXECUTION_FAILED → RECHARGE_FAILED 终态、CDK 退回。
- 证据：`browser-mvp/src/executor.js:280-286, 407-421`；`browser-mvp/src/durable-card-material-lease.js:41-49, 65-70`；`browser-mvp/src/shared-runtime-integration.js:97-102`。`[代码显示]`
- 影响条件：慢页面；09-07 样本从领取到停在点击前约 5 分钟（含一次重试）。
- 建议：结账导航完成后续租一次，或把该 ContractError 映射为 CARD_NOT_READY 回队列。
- 置信度：中

### F-31 核实 lane 第一步 bootstrap 在窗口无 session cookie 时会注入付款前旧 token（与 F-18 同源，发生在阶梯之前）
- 板块 / 严重度：D / P2
- 观察：`verify()` 先 `bootstrap(sessionLease, context)` 不带 replaceExisting；窗口已有 session 则保留，没有则注入 `SharedPostPaymentSessionSource` 给的付款前 token。
- 证据：`browser-mvp/src/live-post-payment-recovery.js:57-60`；`browser-mvp/src/session-bootstrap.js:181-194`；`browser-mvp/src/shared-encrypted-materials.js:197-220`。`[代码显示]`
- 影响条件：核实态 run 的窗口登录态已被清（executor 只在 COMPLETED 清；UNKNOWN 不清；人工清才触发）。B5 删 `reinjectSession` 不覆盖此处。
- 建议：B5 一并处理：核实 lane 不注入，只用窗口现有登录态；没有则直接 UNKNOWN。
- 置信度：高（低概率触发）

### F-32 D-140 修复对单块 token 只有单元覆盖，真实页面上"网站轮换是否原地覆盖单块同名 cookie"未验证；09-09 真单客户 token 恰是单块
- 板块 / 严重度：D / P2 引入新的未验证假设
- 观察：token ≤3936 字节注入单个 `__Secure-next-auth.session-token`；回归测试用 4100 字节分块 token；对照实验用 4592 字节分块 token；09-09 真单 WAL `session-replaced cookieCount=1`。
- 证据：`browser-mvp/src/session-bootstrap.js:34-42`；`browser-mvp/test/session-bootstrap.test.js:66-80`；`docs/HANDOFF_LOG.md` 09-09 对照实验节；`pool/lane-4.wal` 任务 135。`[代码显示]`
- 建议：与 F-27 合并处理：真单前不改，真单结果作为验证。
- 置信度：高（事实），影响未知

### F-33 真单前 A1 演练验不到预检 900 秒租约
- 板块 / 严重度：D / P3 与 HANDOFF_NOW 计划偏差
- 观察：`run-browser-preflight.sh` 写死 `BROWSER_WORKER_LEASE_SECONDS=120`；`run-live-rehearsal.sh` 不设该变量，live 配置 fallback 60，但 live 路径有 watchdog 每秒续租（`browser-worker-service.js:111-129`），租约长短不影响单步；900 秒只配置在 `run-live-pool.sh`，而预检的续租只在步骤间（`browser-order-preflight.js:252-261, 423`），没有 watchdog。
- 证据：`browser-mvp/scripts/run-browser-preflight.sh`（末段 export）；`browser-mvp/scripts/run-live-rehearsal.sh`；`browser-mvp/scripts/run-live-pool.sh`；`browser-mvp/src/production-readonly-config.js:206`；`browser-mvp/src/production-live-config.js:138`。`[代码显示]`
- 建议：A1 目标改为只验 D-140 域放置与 Rejoin Plus 入口；预检 900 秒明确写成"真单首次验"。
- 置信度：高

#### 板块 A｜客户下单链

### F-34 打回后客户按提示"重新提供 Session"再提交同一 CDK，新 Session 被丢弃、返回原单；叠加 F-5，客户没有任何自助路径
- 板块 / 严重度：A / P1 客户影响
- 观察：建单入口对"同码且同账号、原单进行中"直接返回原单，不写 `session_ciphertext`，不重置任务；客户页表单因 `remaining:null` 永不显示（F-5，线上 release 同一行已核）。客户唯一能做的"重新提交"也不会更新 Session。
- 结论：违反基线"客户可无限次、无限期重贴 Session"（PRODUCT_SIMPLIFICATION 基线、D-120）。
- 证据：`v1/src/db/repositories/order-intake-repository.js:110-123`；`v1/public/assets/customer.js:259`（本地）与 `/opt/pojia/current/v1/public/assets/customer.js:259`（线上，ssh 只读核对同一行）；`v1/src/services/order-status-service.js:111`。`[现场已证]`
- 影响条件：任何 WAITING_FOR_SESSION 订单。
- 参考验证办法：测试库建单 → 置 WAITING_FOR_SESSION → 同码同账号再提交 → 比对 `session_ciphertext` 是否变化。
- 建议：同码同账号且原单 WAITING_FOR_SESSION 时走 `session-replacement-service` 的逻辑；F-5 修复后仍应保留此路径。
- 置信度：高

### F-35 客户页文案让客户"更换一个免费账号的 Session"，但换账号提交同一 CDK 会被 409 拒绝
- 板块 / 严重度：A / P1 客户影响
- 观察：`ACCOUNT_ALREADY_PLUS` 的客户提示是"请更换一个免费账号的 Session"；建单入口对"同码、不同账号、原单进行中"不返回原单，落到 CDK 非 AVAILABLE 的判断，返回 409 `CDK_UNAVAILABLE`。
- 证据：`v1/src/services/order-status-service.js:33-41`；`v1/src/db/repositories/order-intake-repository.js:114-130`。`[代码显示]`
- 影响条件：预检判 ACCOUNT_ALREADY_PLUS 打回的单。
- 建议：与 F-34 同一处修：原单 WAITING_FOR_SESSION 时允许换账号重贴（`session-replacement-service` 本就记录 accountChanged）。
- 置信度：高

#### 板块 B｜供给链

### F-36 B6 的前提：RECHARGE_FAILED 单的 CDK 已退回 AVAILABLE 并可能已绑定新单，收口脚本扩展到该状态必须先重新绑定 CDK
- 板块 / 严重度：B / P2（实施约束，不是缺陷）
- 观察：付款前中止到 RECHARGE_FAILED 时 `returnCdkForOrderInTransaction` 把 `cdks.order_id` 置 NULL、status AVAILABLE；建单绑定条件是 `status='AVAILABLE'`；`close-manually-fulfilled-order.mjs` 目前 CLOSABLE 不含 RECHARGE_FAILED，且不处理 CDK。
- 证据：`v1/src/db/repositories/cdk-return-repository.js:36-45`；`v1/src/db/repositories/order-intake-repository.js:185-196`；`v1/scripts/close-manually-fulfilled-order.mjs:22`。`[代码显示]`
- 建议：B6 实施时对 RECHARGE_FAILED 分支增加"CDK 仍 AVAILABLE 且 `order_id IS NULL` 才重绑为 REDEEMED，否则拒绝并提示码已被另一单使用"。
- 置信度：高

### F-37 `ready-check.sh` 与 `state-check.sh` 的可分配卡 SQL 比正式资格 SQL 少了六个条件，可能高估
- 板块 / 严重度：B / P3
- 观察：两脚本的资格查询缺 `source_present`、`intake_status`、`status`、补款进行中、退款案例、`PRODUCT_ONLY` 覆盖项。
- 证据：`browser-mvp/scripts/ready-check.sh` ELIG 查询；`browser-mvp/scripts/state-check.sh` ELIG 查询；`v1/src/services/card-inventory-eligibility.js:1-40`。`[代码显示]`
- 影响条件：当前只有 7402 一张手动卡，不触发。
- 置信度：高

#### 板块 F｜运维脚本

### F-38 `go-live.sh` 与 `stop-live.sh` 用 `prod-query.sh` 直接写生产库，违反 CLAUDE.md"写库只走正式路径"与 RUNBOOK §4"只用于读"
- 板块 / 严重度：F / P2 与纪律偏差
- 观察：两脚本各三条 `bash "$Q" "UPDATE ... / INSERT INTO admin_setting_events ..."`，绕过后台 `POST /api/v1/admin/operations/browser-payment` 的服务层，三条写不在一个事务。
- 证据：`browser-mvp/scripts/go-live.sh` 第 2 段；`browser-mvp/scripts/stop-live.sh`；`CLAUDE.md`「开发纪律·写库只走正式路径」；`docs/RUNBOOK.md` §4。`[代码显示]`
- 影响条件：每次来单启动与收工。
- 建议：改走后台接口或服务层脚本；或在 CLAUDE.md 明文豁免这两处并说明理由。由用户定。
- 置信度：高

### F-39 HANDOFF_NOW 与 HANDOFF_LOG 09-10 章节的 UTC 时间标注与提交时间戳不符
- 板块 / 严重度：F / P3 事实源偏差
- 观察：HANDOFF_NOW 写"上次收尾 2026-09-10 19:05 UTC"，本批开始时 `date -u` 为 2026-09-10 01:03 UTC；`docs/reviews/REVIEW_SCOPE_2026-09-10.md` 的 mtime 为本地 09-10 08:12（+08:00，即 00:12 UTC）。HANDOFF_LOG 09-10 两轮审计标 16:30 到 18:40 UTC，而 FULL_CHAIN_AUDIT 的 mtime 为本地 09-10 00:56。
- 证据：`git log --format=%ci`：`250489c`（审计第一轮）2026-09-10 00:26 +0800 即 09-09 16:26 UTC；`85dda98`（第二轮）00:56 +0800 即 09-09 16:56 UTC；`a367bcf`（收尾）08:12 +0800 即 09-10 00:12 UTC。HANDOFF_LOG 把两轮审计写成"2026-09-10 16:30–17:40 / 17:50–18:40 UTC"，HANDOFF_NOW 把收尾写成"2026-09-10 19:05 UTC"，都是把 +08:00 的日期配上了 UTC 的时刻或把本地时刻当成了 UTC。
- 建议：以提交时间戳为准改正；CLAUDE.md 要求时间一律带时区，这里是"带了时区但值错了"。
- 置信度：高

### 三、对照 `FULL_CHAIN_AUDIT_2026-09-10.md` 的 F 编号

本批独立复核了以下编号，结论一致：F-1（`browser-order-preflight.js:297-378` 无告警、无退还、DEAD 无重开；生产任务 135 DEAD 5/5）、F-4（`classifySafeAbort` 默认终态）、F-5（线上同一行）、F-6（`markPaymentConfirmed:1138-1143`）、F-7（`order-cancellation-service.js:167-180`）、F-10（`session-validation.js` 只查格式）、F-13（adapter 点击后只等 confirmPlus）、F-14（生产 `browser_run_events` 对任务 135 只 7 行，本机 WAL 31 条）、F-18（`live-post-payment-recovery.js:77-84`）、F-19（`listPaymentVerificationsDue` 不按 profile 过滤，verify 用本 lane 窗口）、F-20（`durable-card-material-lease.js:36`）。
F-3 补充证据：生产 `browser_operations` 按类型统计无 `CANCELLATION_CONFIRMED`、`PLUS_ACTIVATED`、`PAYMENT_CONFIRMED`、`PAYMENT_VERIFICATION_ESCALATED`、`POST_PAYMENT_VERIFICATION_SCHEDULED`，即自动确认 Plus、自动取消续费、核实到期升级人工三条路径在生产各 0 次；核实 lane 只在 PAYMENT_CONFIRMED 路径跑过 6 次（全部 UNKNOWN），在 PAYMENT_UNKNOWN 路径 0 次（三张拒付单 `verification_check_count=0`）。

漏判（本批新增）：F-24、F-25、F-26、F-28、F-29、F-30、F-31、F-34、F-35。其中 F-24、F-26、F-34 达到 P1。
误判：未发现审计结论错误。需要下调的表述一处：审计 §二 6 与 D-140 把 403 根因写为已定位，见 F-27，应降为候选。
审计 §四 修复顺序建议的调整：F-5 之前或同时应处理 F-34（否则修好表单后客户"重新提交"路径仍丢 Session）；F-16 之前应先处理 F-24（否则核实 lane 一跑就把 lane 弄坏）。

### 四、未能核实的事项

- `browser-admin-service.js` 的 run 控制面（F-16 里"MARK_PAYMENT_UNKNOWN 不写核实排程"、F-23）本批未打开，沿用审计第二轮结论。
- `shared-dry-run-composition.js` 未读；`run-browser-preflight.sh once` 在预检队列空时会否领走正式派发做 dry-run（G07）本批未复核，A1 流程若重复执行该脚本存在此风险，记为疑问。
- 09-08 并存成功样本与 09-09 真单失败之间，ChatGPT 服务端是否改过行为，无法核实。
- BitBrowser `/browser/open` 对已打开窗口是否计入每日打开额度，未核实；若计入，F-24 的每 tick 一次 open 会很快耗尽额度。

### 五、与事实源冲突但无法判断谁对

- D-140 与 CURRENT_STATE「已知未修①」写"根因已定位并修复"；本机 WAL 显示并存并不必然 403（F-27）。两者都是观察，冲突在因果解释，本批不裁决。
- HANDOFF_NOW 里"仍 0 次：自动点付款"与生产 `browser_operations` 里 4 次 `PAYMENT_SUBMIT`（09-08）冲突；按"完整闭环 0 次"的口径成立，按"点击 0 次"不成立。建议统一口径为"从点击到 RECHARGE_SUCCESS 的自动闭环 0 次"。

### 六、本次未覆盖范围

- REVIEW_SCOPE 第三节（后台五页、`order-stage.js`、接口删减）、第四节（迁移 049 到 051 只读了 SQL 文本，未核对生产 schema）、第五节（文档一致性）留第二批。
- `browser-admin-service.js`、`admin-read-service.js`、`manual-cancellation-service.js`、`reconciliation-case-service.js` 未打开。
- 测试文件只看了 `session-bootstrap.test.js` 的 D-140 用例与 `live-chatgpt-payment-adapter.test.js` 用例名。
- 20X 第二阶段（`UPGRADE_DIALOG_STOP`、弹窗读取）代码已读但不在今天 Plus 真单路径，未逐条列证。
- HNSKJ 自动开卡、补余额、API 路线未审。
