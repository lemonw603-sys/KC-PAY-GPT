# 当前状态快照（2026-08-30）

> 本文件只保留当前有效状态。历史过程查 `docs/HANDOFF_LOG.md`；本阶段封账证据查 `docs/PRE_INVENTORY_CONVERGENCE_SEAL_2026-08-28.md`。

## 代码与发布

- 当前生产代码提交：`4dadf79`（运行代码包含 `f95e6bb` 的 Browser/API 路由硬断链、专用心跳、原子 attempt+job 和全局默认充值方式修复）。
- 生产 release：`/opt/pojia/releases/20260830-browser-routing-4dadf79`；上一版本回滚点：`/opt/pojia/releases/20260829-order-demand-sync-bba4105`。
- 本地 `main` 已新增订单驱动自动开卡触发和 60 秒兜底定时器改动，尚未部署到生产。
- 可靠回滚点：`/opt/pojia/releases/20260828-fea0ffd-rollback`。
- 服务：Web、API Worker、卡片读同步、卡目录同步、Bark、备份均正常；Browser Worker 保持 `inactive/disabled`。
- Browser Worker 的候选 release 启动/停止/回滚演练已经通过；生产 `current` 仍是 `bba4105`，未包含主线最新 Browser Session/Checkout harness 和派发修复。
- 付费补卡 runner 已确认为 `inactive/disabled`，避免重启后每 10 秒唤醒并带入卡台写权限。
- 最新迁移：`041_browser_worker_heartbeat`。

## 运行门禁与体检

- 生产服务器已独立复核：`acceptNewOrders=true`、`dispatchNewRecharges=true`、派发模式 `AUTOMATIC`；这是用户此前手动开启并决定继续保留的当前运营状态。
- 2026-08-30 已部署主线 `4dadf79` 对应 release `/opt/pojia/releases/20260830-browser-routing-4dadf79`；迁移 041 已应用，Web/ API Worker active，Browser Worker 保持 inactive/disabled。部署后公网 live/ready 均 HTTP 200；当前 Browser dispatch gate=false、专用心跳为空，API 路线仍是新订单默认路线。
- `card_auto_replenishment_enabled=true`；无可分配 Plus 卡时自动开 1 张 `$16` 卡，每日上限 `5`；`card_stock_low_threshold=0`，仍有 1 张可分配卡时不提前开卡。
- `PROVIDER_WRITES_ENABLED=false`、`PROVIDER_CARD_WRITES_ENABLED=false`、`PROVIDER_RECHARGE_WRITES_ENABLED=false`。
- Browser systemd 单元强制 `BROWSER_PAYMENT_WRITES_ENABLED=false`，且服务未启动。
- 2026-08-29 09:07 CST 重跑生产 readiness：`ok=true`；活动任务、过期租约、UNKNOWN Provider 调用、资金风险、活动授权、开放对账案件均为 `0`，`blockers=[]`。
- 公网 ops/plus 的 live/ready 四个端点均 HTTP 200。
- 当前卡台只读目录共 20 张卡；目录同步与卡片详情读取通过。

## 卡片与库存事实

- `1477 / 6807`：不设运营覆盖；当前原始/有效状态均为 `ASSIGNED`，仍受订单绑定、余额、交易与消费账本限制。
- `1065 / 4744`：`PRODUCT_ONLY(claude)`，不分配 Plus。
- 当前其余 17 张旧批次卡：全部 `RETIRED`；未来新卡不继承这个结论。
- `1628 / 6185`：已分配给第二单真实 API 订单并完成 Plus 充值；不得再作为未使用库存自动分配。卡台 PURCHASE 最终结算状态仍待只读同步补证。
- Plus 实际可直接分配卡为 `0`，但有 `1` 张可补余额卡；`catalog.unresolvedActive=0`、`providerOnlyActiveCount=0`。
- 默认开卡卡段只决定未来开卡偏好，不再排除卡台当前公布的其他合法卡段；订单分配也不再要求卡片卡段等于订单创建时的默认开卡卡段。
- 原始 Provider/本地状态可以与运营覆盖不同；后台主视图已显示有效运营状态，不再把旧卡误展示为可分配。

## 订单与资金状态

- 已完成真实 API 订单 `PJV1-FqFnMiSKBtLGN14GyP7W`，使用 `1477/6807`，并完成取消续费。
- 已完成第二单真实 API 订单 `PJV1-uVsqgepiEHu3tfpQKQq-`，使用 `1628/6185`；外部直充单 `7025`，平台金额 `982.140000 PHP`，最终 `RECHARGE_SUCCESS` 且 `subscription_cancelled=1`。attempt 为 `SUCCESS/SETTLED`，无活动资金风险或开放对账案件。
- 验证用的遗留订单 `PJV1-4cK-yDhExDQbnpr8403G`已按“不充值”结论安全取消；它从未分配卡、未调用 Provider、未建立充值 attempt。
- 当前活动任务为 `0`，不存在该遗留任务反复调度/API 调用风险。
- 消费账本已部署；当前查询为空。历史真实订单发生于账本上线前，没有可靠主键证据时不自动回填。

## 验证结果

- v1：467 tests / 429 pass / 0 fail / 38 environment-skipped。新增“过期安全候选卡按订单需求只排入一个只读同步任务”的真实 MySQL 集成测试；全新临时 MySQL 8.4、migration 001–040 下，`mysql-integration.test.js` 34/34 通过。
- Browser：只读 ChatGPT 账号/Checkout harness 合入后为 99 tests / 95 pass / 0 fail / 4 environment-skipped；隔离 MySQL 8.4 + 正式 production-readonly CLI/Chrome smoke 3/3 通过，配置/systemd 检查 10/10 通过。
- 当前已核验的最新部署前加密备份 `/var/backups/pojia/pojia-20260829T060414Z.sql.gz.enc` 已通过解密与 gzip 完整性校验。

## 当前未完成

### 2026-08-30｜手动开卡

- 已按用户明确指令，通过正式手动库存任务开通 1 张 `$16` 卡；任务 `986d345d-e4b6-4ad6-b770-ef447c3b6f74` 已完成。
- 新卡 Provider id `1839`、尾号 `1013`，余额 `$16.00 USD`，已自动同步为 `AVAILABLE / ACCEPTED`，未绑定订单。
- 当次仅临时进程开启卡台开卡写权限；常驻配置未改变，自动补卡仍关闭，Browser/充值/其他 Provider 写入仍关闭。
- 详细记录：`docs/2026-08-30_manual-card-opening-result.md`。

### 2026-08-30｜自动补卡已启用

- 用户明确要求“没卡就自动补卡”，已启用生产自动补卡定时器。
- `pojia-card-stock-runner.timer` 已 `active/enabled`，每 10 秒检查；当前可分配 Plus 卡为 `1`，日志显示 `STOCK_SUFFICIENT`，未额外开卡。
- 每次任务仍先读取最新 Provider 规则、余额和目录；其他充值/付款写入保持关闭。

### 2026-08-30｜Browser 生产形态非付款安全窗口

- 测试 CDK 已通过正常客户入口创建 Browser 路线订单 `PJV1-TZmbNEpYNd0Gs_YgRKF_`；订单创建时路线正确冻结为 Browser。
- Browser Worker 使用生产 EXTERNAL_READONLY/ChatGPT harness 配置通过检查并 READY/IDLE；专用心跳和全局默认充值方式门禁实际生效。
- 正常派发在 `ASSIGN_CARD` 停止：生产没有余额达到 `$16` 的可分配 Plus 卡，订单进入 `WAITING_FOR_CARD / CARD_STOCK_EMPTY`；未建立 attempt、Browser job/run 或资金预留，未访问 ChatGPT。
- 此结果纠正此前测试计划：余额不足卡不能绕过真实资金/分卡门禁继续到 Checkout；强行改库或降低最低余额不构成真实链路验收。
- 测试订单已正式取消为 `CLOSED / CANCELLED_PRE_SUBMISSION`，测试 CDK 已兑换不得复用；默认 API、接单/派发原状态、Browser gate/Worker/env 均已恢复。
- 清理后活动 task、attempt、Browser job/run/lease 均为 0，ops/plus 四个 live/ready 公网端点均为 HTTP 200。
- 详细证据：`docs/2026-08-30_browser-production-nonpayment-window-result.md`。

### 2026-08-29｜ChatGPT 只读观察复验（当前停止点）

- 用户提供的 Session 已在本地一次性解析并通过 `validateChatGptSession()`；原文尾部附加文本被解析层截断，原文未写入日志、WAL、文档或 Git。
- 隔离 MySQL + Headful Chrome 实测：页面 HTTP 200、`/api/auth/session` HTTP 200、登录身份匹配、订阅状态 `FREE`；未读取真实 PAN/CVC，未填卡，`submitCalls=0`。
- 首次运行发现两个真实缺陷并已修复：Checkout 观察结果字段名 `cardNumber/cvc` 被安全对象检查误判为敏感字段；ChatGPT 官方首页标题存在 `ChatGPT: ...` 副标题变体；现已改为非敏感 presence 字段并允许官方标题后缀。
- 此前 `CHECKOUT_NAVIGATION_FAILED` 已定位并修复；最新 Headful 只读复验已完整到达 Checkout：登录/身份匹配、免费账号、Plus 入口、Checkout 摘要和安全字段均通过，`submitCalls=0`。仍未填卡、未付款、未连接生产。
- 根因已定位：ChatGPT 方案弹窗的“升级至 Plus”是弹窗内、表单外的 `type=submit` 按钮，旧安全判断将所有 `type=submit` 一律拒绝，造成假失败；已收窄为仅拒绝处于表单内的提交控件。方案弹窗打开与 Plus 按钮已在 Headful 只读诊断中确认，未点击付款。
- 临时隔离容器与运行目录已停止并清理；未连接生产、未部署本轮改动。
- Mock 付款状态机回归已完成：付款执行器关闭/错误配置、确认成功、拒绝、提交后未知、Plus 未确认、取消续费或交易对账不完整等路径均通过；本轮无外部付款调用。
- 对抗复查发现并修复：付款已确认后，Plus/取消续费/交易核验器异常不能冒泡成可重试错误；现在统一返回 `POST_PAYMENT_UNKNOWN`，保留人工对账边界，不触发重付。
- 已加入 `LiveChatGPTPaymentAdapter` 最小代码边界：默认关闭，必须同时提供精确确认词和结果观察器才会动作；本轮仅本地测试，未接入生产配置。
- 对 LIVE 适配器做了失败路径复查：提交后无论结果确认、未知或异常，都会尽力清理页面卡字段；结果观察器缺失仍强制 `PAYMENT_RESULT_UNKNOWN`。测试 2/2 通过。
- 已将 Browser 页面对象以显式参数转交给付款适配器边界，BrowserPaymentExecutor 本身不解析页面或卡字段；新增转交测试通过。
- 对 LIVE 适配器做了针对性对抗复查并修复两处边界：在任何页面/付款副作用前校验 operationId 与非空提交选择器；只读 Checkout 观察结果现在携带已审查的 submitControlSelector。全量测试通过；LIVE 仍未接生产。
- 已新增真实 Browser 付款前检查清单：`docs/2026-08-29_browser-live-payment-readiness-checklist.md`；生产付款开关仍关闭。
- HNSKJ 卡是否支持/触发 3DS：当前没有卡台字段、真实 Browser 付款或供应商文档证据，不能判断为“有”或“没有”。现行 Browser 设计仅把 3DS 作为可能的付款后续状态，未知时转人工对账，不自动重试。
- 本轮联调确认 LIVE 适配器与当前安全字段选择器（`cardNumber/expiry/cvc`）映射一致，并加入 3DS/挑战异常后的清理测试。
- 已重新区分 Browser 付款门禁：只保留防重复付款和结果可追踪等真正硬条件；3DS/验证码仅在运行时实际出现时处理，不作为正常付款的预先拦截。
- 已完成门禁收敛复查，详见 `docs/2026-08-29_browser-gate-simplification-review.md`；Browser 全量测试保持 102 通过、0 失败、4 跳过。
- 新一轮对抗审查发现并修复提交前错误误标支付未知、字段并发清理不稳定两处问题；详见 `docs/2026-08-29_browser-gate-adversarial-review.md`。
- 当前错误分类已固定：付款前可证明失败使用 `PRE_SUBMIT_FAILED`；点击付款后结果不确定使用 `PAYMENT_RESULT_UNKNOWN`，两者不可混用。
- 本轮完成 Browser 离线 soak（`npm --prefix browser-mvp run soak`）并成功退出；未连接生产、未执行付款。
- 再次核对部署模板与只读 smoke：`BROWSER_PAYMENT_EXECUTOR_ENABLED=false`、`BROWSER_PAYMENT_EXECUTOR_MODE=MOCK` 均保持关闭/模拟配置。
- 状态更正：当前仅达到“代码/隔离测试层面的付款前就绪”，尚未达到“生产真实 Browser 付款就绪”。Browser worktree 的旧报告仍列出 production Session/card adapter、真实非付款观察和生产部署演练缺口，必须完成主线对齐与合入审查后才能改变结论。
- Browser 窗口同步复查已确认：其 `7abbe51` 不能直接合入，会回退主线后续 LIVE adapter/门禁/文档；详见 `docs/2026-08-29_browser-window-sync-review.md`。
- Browser 窗口最新确认：未新增代码；生产非付款仍缺生产形态只读观察、Worker 部署/回滚演练和部署后审计闭环。已安排先备份差异，再可逆对齐到 `main@a6ba908`。
- 已在本地为旧 Browser 提交建立可逆标签 `browser-stale-7abbe51-backup`；未合入其差异，避免回退主线。
- 已将 `codex/browser` worktree 可逆对齐到主线 `9093c03`；旧内容保存在 `browser-stale-7abbe51`，对齐后 Browser 全量测试 107 项、103 通过、0 失败、4 跳过。
- 在统一基线上运行 `npm --prefix browser-mvp run smoke:worker:readonly` 成功；隔离 MySQL、只读 Worker 配置和安全门禁通过，未连接生产。
- 已生成候选归档 `/tmp/aicharge-main-46b2cc7.tar`；语法检查、全量测试和 `git diff --check` 均通过，候选包未部署。
- 已整理并执行生产只读启动/停止/回滚演练：`docs/2026-08-30_browser-production-readonly-rehearsal.md`。
- 已执行生产只读启动演练但发现部署缺口：当前 release 缺少 `playwright`，Worker 启动失败并触发重启尝试；已立即 stop/disable，当前保持 `inactive/disabled`。详见 `docs/2026-08-30_browser-production-rehearsal-result.md`。
- 补齐 Playwright 后再次启动候选 release，依赖问题已解决但暴露出生产只读 env 合同不匹配（`INVALID_BROWSER_WORKER_CONFIG`）；已回滚 current 并保持 Worker `inactive/disabled`。
- 候选 release 已成功 READY/IDLE 启动并安全停止，随后回滚旧 release，当前 Worker 仍 `inactive/disabled`。只读复核已确认：候选模板原本就有付款执行器关闭变量，失败时生产加载的是陈旧 systemd unit；重新安装 unit、执行 `daemon-reload` 并切回候选后才成功。不是 env 文件覆盖，也不是候选模板缺变量。
- 2026-08-30 端到端审查发现并修正 Browser 自然派发的 API 耦合、PREPARE 的 ZZSHU 语义泄漏，以及复审发现的 attempt→job 非原子、默认切换未验证 Browser Worker 在线、领取未按进程 executor 能力隔离。主线提交 `f95e6bb` 增加 Browser 专用 dispatch/heartbeat readiness、route-aware 领取、attempt+job 原子事务与全局默认充值方式。第一轮全量回归 v1 `471 total / 433 pass / 0 fail / 38 environment-skipped`、Browser `107 total / 103 pass / 0 fail / 4 skipped`；二次定向回归 v1 `88/88`、Browser config `9/9`。尚未部署，部署前不得兑换当前测试 CDK。
- 已建立“余额不足卡付款前停止测试”运行手册：`docs/2026-08-29_browser-pre-submit-session-test-runbook.md`；使用用户指定测试 Session，停止于付款按钮前。

- 库存后台收敛已部署生产（2026-08-28），并已通过发布后公网健康、服务状态、备份完整性和未认证路由验收；后台浏览器交叉验收仍待使用管理员会话执行。
- 已实现卡段人工刷新（`POST /api/v1/admin/card-stock/provider-refresh`）与默认卡段持久保存（`POST /api/v1/admin/card-stock/default-card-type`）；刷新仅调用 Provider 只读接口，不恢复高频自动读取。
- “开始营业”入口代码已在主线但暂不部署；生产继续使用现有分离开关。该入口的部分成功回滚优化延期。
- 已新增低复杂度“开始营业”入口：通过只读就绪检查后才同时开放接单与自动派发；库存不足会明确提示，不会误报卡台故障。
- 自动跨订单复用卡片尚未开启。
- Browser 真实付款尚未验证；仍按独立 Browser 工作线推进非付款联调，真实付款必须另行确认。
- Browser 独立线提交 `1d02c78` 已由统筹审查并以主线提交 `d6f9bf3` 安全合入：attempt 与 run 的 executor profile 现在必须一致，漂移时以 `EXECUTOR_PROFILE_CONFLICT` fail-closed；该 profile 同时进入权威付款 snapshot。合入后语法检查与相关 adapter/runtime/repository 测试 **46/46** 通过；未部署 Browser Worker、未连接生产、未执行付款。
- Browser 首次灰度前只读就绪补强已由统筹审查并以 `1516c67` 合入：readiness 强制 migration 039/040，CLI 同样强制 payment executor=false/MOCK，并补齐 Browser 专属停止/回滚入口。主线复验 90 tests / 86 pass / 0 fail / 4 skipped；仍未部署生产 Browser Worker。
- Browser 共享 Session/卡资料 production adapter 已由独立线提交 `ddad4f1`，经统筹复验后以主线提交 `58c0d4e` 合入：只通过当前 `browser_run` 读取 v1 现有密文和当前 attempt 的 `RESERVED` 消费预留；不建立第二套存储、不调用卡台、不填卡、不付款。正式 production-readonly smoke 9/9 配置检查与 3/3 隔离 MySQL/Chrome 流程通过；未部署生产、未读取真实材料。
- Browser 只读 ChatGPT 账号/Checkout harness 已由独立线提交 `7abbe51`，经统筹审查后以主线提交 `7065b60` 合入：身份摘要逐项匹配，订阅状态区分免费/Plus/其他付费/未知；真实观察阶段只读取 Session，不解密 PAN/CVC；页面入口和 Checkout 仅做只读识别。主线 Browser 99 tests / 95 pass / 0 fail / 4 skipped，production-readonly smoke 10/10 + 隔离 MySQL/Chrome 3/3；未部署生产、未访问真实 ChatGPT、未付款。
- 第二单 API 灰度已完成；临时充值写权限已关闭，单笔 Permit 已撤销。卡台已读到 `PURCHASE 15.76 USD`，余额由 `$16.00` 降为 `$0.24`，资金扣减与消费金额一致；2026-08-29 07:16 UTC 再次单卡低频只读同步后，交易仍为 `PROCESSING / UNSETTLED`。同步任务已正常完成，绝不因未结算而重付。
- 本单暴露出“分配要求 15 分钟新鲜、定时同步默认 60 分钟”的窗口错配。按订单需求只同步 1 张过期候选卡的低调用量修复已通过安全分支 `bba4105` 部署；生产健康和 readiness 正常。
- 2026-08-29 13:21 CST 公网复核：ops/plus 的 live/ready 四个端点均 HTTP 200。
- Browser 下一步不是直接付款：需要一次性提供专用非客户测试账号的隔离订单/Session、身份摘要、批准网络出口和 Chrome 主机，运行 `CHATGPT_ACCOUNT_CHECKOUT` 非付款观察，冻结当次真实页面合同；通过前不部署、不读取真实客户材料、不填卡、不付款。
- Browser profile 绑定合入后的 v1 全量回归：465 total / 428 pass / 0 fail / 37 environment-skipped。
- 卡余额充值目前仅有后台记录/核对视图，指定卡发起充值的管理入口暂缓开发；生产 Provider 写入继续关闭。

## 2026-08-29 卡片库存只读同步复验

- 已登录生产后台执行“卡片库存 → 只读同步全部”，页面提示加入 7 张卡同步队列；等待后刷新完成。全程未执行开卡、卡充值、付款、退款、提现或任何写开关操作。
- 卡 1477（卡号末四位 6807）详情：卡台账户 `00000000-0000-4000-8000-000000000101`、卡段 1、状态 `invalidating`、已分配、余额 `0.07 USD`、资料/交易同步时间 `08/29 09:50`。
- 交易证据：`CARD_RECHARGE 16.000000 USD SUCCESS` 与 `PURCHASE 15.930000 USD SUCCESS` 均已显示并持久化；chargeback 监控记录仍保留。
- 订单 `PJV1-FqFnMiSKBtLGN14GyP7W` 现显示“充值成功 / 三方一致 / 卡片核对 15 分钟内已更新”，平台金额 `982.140000 PHP`，直充订单号 `6294`。
- 库存总览：可分配 0、使用中 1、暂不可用 1、永久停用 17；卡台余额 `$47.36`、默认卡段 VISA-40024200、剩余开卡额度 292；自动补卡关闭。
- Console 唯一错误为 CSP 阻止 inline style，未发现业务请求失败；只读 GET 接口均 HTTP 200。
- 详细报告：`docs/2026-08-29_card-inventory-readonly-sync-verification.md`。
