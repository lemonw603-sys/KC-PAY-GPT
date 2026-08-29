# Browser 项目当前状态与接班点（2026-08-22）

> 这是 Browser 任务的最短接班入口，只描述当前有效状态，不替代需求基线、Browser 基线和决策账本。历史研究报告用于证据追溯，不能覆盖本文指向的当前合同。

## 1. 当前阶段

主规划：`docs/2026-08-23_browser-master-plan.md`。后续按大阶段推进，横向维护证据分类、偏差、恢复、资源和交接轨道。

赛马定位：BRFE 内部多 lane 实验，贯穿非 PH/PH 观察和真实履约前的路线选择；不另建订单或资金系统，正式最多一个 champion 和一个预验证 fallback。

账号安全首要原则：优先降低账号误判、误伤和异常中断风险；使用真实一致的 runtime/profile/network，不做身份或指纹伪造。详见 `docs/2026-08-22_brfe-account-safety-operating-principle.md`。

- 阶段：B1 非付款 PoC 与 B2 控制面实现并行；B2 已完成 WAL-backed 编排、崩溃/重复投递安全测试、第一轮 350 单等效容量仿真、MySQL 事务映射 v1、artifact vault/四类资源租约跨进程恢复 v1，以及后台追溯/人工控制 v1。
- 生产状态：未接生产；没有真实开卡、卡片输入、Checkout 创建或付款。
- 菲律宾状态：没有执行菲律宾真实 Session 或 sticky 出口 A/B。
- 菲律宾输入待办：当前先冻结 `NON_PH_FUNCTIONAL` 基线；用户提供菲律宾 IP/代理后，必须新增独立 `PH_GENERIC` 或 `PH_STICKY_PRODUCTION_LIKE` runtime/profile/network manifest 和新 cohort，不覆盖或混并非 PH 结果。
- 当前默认 runtime：离线使用 `MOCK_RUNTIME`；真实候选尚未冻结。

## 2. 当前有效架构

1. Browser 是未来 Plus 主链路，HNSKJ 只负责卡片来源；ZZSHU 不参与 Browser 新链路。
2. 现有订单、CDK、卡片、资金栅栏、审计和后台继续作为唯一业务核心。
3. 同一订单最多一个资金风险 attempt；付款未知禁止换卡、换 lane 或自动重付。
4. 同一 ChatGPT 账号跨订单互斥；订单锁不能替代账号锁。
5. 只读实验可同账号配对；创建 Checkout 的实验使用隔离账号 cohort。
6. 一个账号/run 只有一个活动 Checkout artifact；过期不等于确定失效。
7. hosted authority 只进加密短期 vault，普通证据只保存 opaque ref 和哈希。
8. 正式路线最多一个 champion 和一个预验证 fallback，fallback 只能在 Checkout 创建前选择。
9. 人工接管必须按 `REQUESTED→FROZEN→TRANSFERRED→RELEASED` 转移控制权。
10. 指纹浏览器仅是本地 runtime 候选；不使用云 Profile、云同步或第三方 Session 托管。

## 3. 已完成及证据

跨窗口接班入口：`docs/BRFE_HANDOFF_2026-08-22.md`。新模型处理 Browser 任务时先读该入口，再按其中顺序读取当前状态、路线和决策；它不替代 Browser baseline/contracts，而是把角色、停止点和下一批动作集中到一个可验证入口。

| 交付 | 证据 | 状态 |
| --- | --- | --- |
| Session Loader v2 与三模式非付款 PoC | `browser-poc/session-loader.js`、`session-ab-poc.js` | 离线/公开对照已完成；菲律宾真实输入未验证 |
| hosted/internal/incomplete 链接分类与过期恢复约束 | `browser-poc/checkout-link-core.js` | 过期默认 `CHECKOUT_REVIEW_REQUIRED` |
| 多赛道实验合同与对抗式审查 | `contracts/2026-08-22_browser-multi-lane-experiment-contract.md`、对抗审查报告 | 已落盘 |
| 离线实验编排器 | `browser-poc/experiment-core.js` | 账号/Checkout 租约、cohort 隔离、工件加密、接管所有权、预路由已实现 |
| 最小 mock gateway | `browser-poc/mock-gateway.js` | decline、unknown、success、3DS、cancellation pending 已实现 |
| 可重复离线演示 | `npm run poc:browser-experiment:offline` | 不访问外部网络，不使用真实 Session/付款 |
| 本地追加式 WAL 与重启恢复 | `browser-poc/experiment-wal.js`、`npm run poc:browser-experiment:wal` | `0600` JSONL、序列/哈希链、单写者锁、敏感字段拒绝、截断/篡改失败关闭；`PAYMENT_UNKNOWN` 重启后仅可对账 |
| 本地 Browser/Checkout/payment iframe 仿真 | `browser-poc/mock-browser-server.js` | 仅监听 `127.0.0.1`；Playwright 已验证 Context 隔离、断连未知、同一授权 3DS 和独立取消 |
| WAL-backed 编排器 | `browser-poc/wal-backed-experiment.js` | 所有可变操作先写 intent、应用内存状态、再写完成事件；付款外部动作前持久化 `PAYMENT_SUBMITTING` |
| 崩溃与页面变化验证 | 性质测试、真实子进程退出、popup/页面漂移 Playwright | 重复投递最多一次提交；接管中断双边停手；漂移时零提交 |
| 350 单/24 小时等效容量仿真 | `npm run poc:browser-experiment:capacity` | 350 完成、350 submit、0 重复、3710 WAL events、约 1.99 MB、38.14 秒（9.18 单/秒） |
| Browser PoC 测试 | `npm run test:browser-poc` | 11 files / 77 tests 通过 |
| MySQL 订单/route/资金 attempt 事务映射 v1 | `027_browser_execution_control_plane.sql`、`browser-execution-repository.js`、MySQL 合同/实施报告 | 定向 11/11；Docker MySQL 8.4 DDL 重放与 Repository 集成通过；生产 profile/派发/付款开关保持关闭 |
| artifact vault/资源租约跨进程恢复 v1 | `028_browser_artifact_vault_recovery.sql`、`browser-recovery-repository.js`、恢复合同/实施报告 | AES-256-GCM 密文分表、账号/订单/卡片/artifact 租约、心跳、过期接管、同 artifact 恢复、过期 review 和确定性销毁已通过真实 MySQL；生产保持关闭 |
| 后台追溯与人工控制 v1 | `browser-admin-service.js`、admin Browser 视图、后台合同/实施报告 | run/attempt/checkpoint/lease/artifact/intervention/case 脱敏追溯；REQUEST/FREEZE/TRANSFER/安全释放/未知锁账通过 step-up、确认词、幂等 operation 和真实 MySQL 验证 |
| 控制面第二轮对抗式审查 | `docs/2026-08-22_browser-control-plane-adversarial-review-report.md` | 方向判定通过；Worker/soak 前置闸门暂不通过，发现 4 个 P0、9 个 P1，未接生产 |
| Browser attempt 与付款后终态 v1 | `031_browser_post_payment_lifecycle.sql`、`recharge-attempt-repository.js`、`browser-execution-repository.js`、`contracts/2026-08-22_browser-attempt-post-payment-contract.md` | Browser route 复用唯一资金 attempt 且不写 Provider call；付款确认→Plus 激活→取消确认→最终成功状态链已实现并通过定向测试，真实页面观察尚未接入 |
| Browser durable dispatch/lease v1 | `032_browser_dispatch_queue.sql`、`browser-dispatch-repository.js`、`workflow-handlers.js` | Browser `SUBMIT_RECHARGE` 只入队引用并结束 Provider 分支；job 幂等、SKIP LOCKED claim、短租约 heartbeat 已通过定向测试，真实 Browser worker 尚未启动 |
| 2026-08-26 Browser 上游 P0 收口 | `contracts/2026-08-26_browser-upstream-runtime-contract.md`、`browser-execution-repository.js`、`recharge-attempt-repository.js` | 共享核心已统一 `RECHARGE_PROCESSING`，实现 permit 权威复核/snapshot 再校验和付款前原子 safe-abort；定向 48/48、隔离 MySQL 3/3 通过。Browser 独立 adapter、非付款联调和生产部署未完成 |
| Isolated Worker control shell v1 | `browser-worker-service.js`、`browser-worker-service.test.js` | claim→beginRun→每动作前 heartbeat/recovery guard 已实现；租约丢失或 RECONCILE_ONLY 时在 runtime 调用前停手，真实浏览器进程尚未启动 |
| Isolated Worker iteration loop v1 | `browser-worker-loop.js`、`browser-worker-loop.test.js` | idle/claim/execute/fail-stop 循环已实现并通过 mock 测试；尚未接主 worker 进程，也不启动真实 Browser runtime |
| Worker process wrapper 阶段审查 | `docs/2026-08-22_browser-worker-process-adversarial-review-report.md` | 控制壳方向通过；长动作 lease watchdog、identity/profile/network digest、SIGTERM/崩溃重启 mock smoke 已补；可申请进入用户确认的真实但不付款 BrowserContext 观察，真实付款仍禁止 |
| 方向偏移阶段审查 | `docs/2026-08-22_browser-direction-drift-adversarial-review-report.md` | 未发现路线偏移；确认仍复用订单/资金链、不伪造 Provider、不提前选 champion；真实但不付款观察范围可按用户确认进入，观察后仍需 cohort 级审查 |
| NON_PH_FUNCTIONAL 基线 manifest | `browser-poc/manifests/non-ph-functional-baseline-2026-08-22.json` | Playwright 本地 Chromium、临时 Context、SESSION_ONLY、无代理、AUTH_READ_ONLY；明确禁止 Checkout/付款/菲律宾晋级 |
| Session 本地接入对抗审查 | `docs/2026-08-22_session-intake-adversarial-review.md` | 采用仓库外 `0600` 文件 + 一次性本地校验；当前测试附件缺少显式 `sessionCookieName`，尚未加载或启动 BrowserContext |
| 通用 secure-inbox MVP | `tools/secure-inbox.js`、`tools/SECURE_INBOX.md` | 已实现本地 AES-256-GCM 密文、Keychain 密钥和四个最小命令；尚未连接 Browser Session 适配器 |
| Session 适配器范围 | `docs/DECISIONS.md` D-078 | 当前明确暂不接入；等 Browser 订单履约联调前再补内存适配器，不影响通用 secure-inbox 独立使用 |
| secure-inbox 单入口 | `tools/secure-inbox-drop.command` | 已支持拖拽文件自动加密并显示编号；复杂命令仅供内部调试 |
| secure-inbox 粘贴入口 | `~/Desktop/安全收件箱.command` | 已支持双击弹窗直接粘贴并显示编号；不接 Browser Session 适配器 |
| secure-inbox 菜单栏入口 | `~/Desktop/安全收件箱.app`、`tools/SecureInboxMenuBar.swift` | 已构建 macOS 菜单栏原生多行输入框；点击顶部 `🔐` 后粘贴并保存，桌面命令入口保留备用 |
| Session Cookie 家族 A/B | `__Secure-next-auth.session-token` | 已通过同一 Session 的只读 A/B 确认；next-auth `/api/auth/session` 返回身份，authjs 不返回身份；页面仍受当前网络 403/挑战影响 |
| Session A/B 证据 | `docs/2026-08-22_session-cookie-family-ab-evidence.md` | 结论已落盘；当前只推进非付款身份/页面观察，不把 403 外推为 PH 或付款结论 |
| NON_PH_FUNCTIONAL 正式观察 | `artifacts/browser-poc/nonph-functional-2026-08-22T09-23-48-422Z.json` | `SESSION_SERVER_IDENTITY_CONFIRMED`；前后 auth HTTP 200；页面 HTTP 403；0 付款变更；未创建 Checkout |
| NON_PH 观察对抗审查 | `docs/2026-08-22_nonph-observation-adversarial-review.md` | 服务器身份窄目标通过；页面登录/Checkout 目标被 403 挑战阻塞；禁止据此晋级付款、champion 或容量结论 |
| Worker 并发 Harness | `docs/2026-08-22_browser-worker-concurrency-harness-report.md`、`v1/test/browser-worker-concurrency.test.js` | 8 Worker/240 合成 job/0 重复执行；仅离线内存验证，不替代 MySQL 多连接或 24 小时 soak |
| Browser MySQL/恢复目标测试 | `docs/2026-08-22_browser-mysql-concurrency-stage-report.md` | 隔离 MySQL Browser 相关 9 项通过；全量数据库测试有 1 个既有补卡日限额异常，未归因 Browser；多连接压力和 24h soak 仍未完成 |
| Browser MySQL claim race | `docs/2026-08-22_browser-mysql-claim-race-report.md` | 8 独立连接同时 claim 同一 job，仅 1 成功、0 重复；多 job、续租、接管和 soak 仍待完成 |
| Browser MySQL 多 Job/Lease | `docs/2026-08-22_browser-mysql-multijob-lease-report.md` | 24 job/8 worker/0 duplicate；heartbeat 和过期接管通过；连续 24h soak、重启和长连接压力仍待完成 |
| Browser MySQL bounded soak | `docs/2026-08-22_browser-mysql-bounded-soak-report.md`、`v1/test-support/browser-mysql-bounded-soak.js` | 固定 harness：20 轮/400 job/8 worker/0 missing/0 duplicate/400 heartbeat；15.029 秒时间模式 960/960 claim、0 duplicate、960 heartbeat、四类残留 0；lease 参数盲区已修正；5–15 分钟/24h、资源指标和生产拓扑仍待完成 |
| Bounded soak 对抗审查 | `docs/2026-08-22_browser-bounded-soak-adversarial-review.md` | harness/清理计数已整改并通过；发现并发 fixture producer 的 `ER_LOCK_DEADLOCK` P1；时间 soak、故障注入和生产拓扑仍未验证 |
| Worker 崩溃/数据库重启恢复 | `v1/test-support/browser-worker-mysql-crash-recovery.js`、`docs/2026-08-22_browser-worker-crash-db-restart-report.md` | 子进程 SIGKILL 后同 job 过期接管；旧 token heartbeat 被拒；MySQL restart 后连接与 20-job bounded claim 通过；连接池自动重建、页面动作中断和长 soak仍待完成 |
| 连接重建/动作中断 | `v1/test-support/browser-pool-reconnect.js`、`docs/2026-08-22_browser-connection-rebuild-action-interrupt-report.md` | 单连接 KILL 后同一 pool 查询重建成功；LOCAL_MOCK watchdog 动作中断测试 12/12 通过；多连接/长 soak、真实 Playwright 中断和资金未知恢复仍待完成 |
| 多连接/Playwright 中断 | `v1/test-support/browser-pool-multi-reconnect.js`、`docs/2026-08-22_browser-multi-reconnect-playwright-interrupt-report.md` | 4 连接同时 KILL 后 4/4 重建；本地 Playwright slow navigation 在失租约时中断，submitEvents=0；长 soak、真实网络/浏览器故障和资金未知恢复仍待完成 |
| Browser 60 秒时间 soak | `docs/2026-08-22_browser-60s-soak-report.md`、`v1/test-support/browser-mysql-bounded-soak.js` | 每轮清理后的 60.004s/2930 job/4 worker/0 missing/0 duplicate/2930 heartbeat/Threads_connected 峰值 4/残留 0；RSS 约 65MB→187MB 峰值/182MB 结束，需拆分运行时内存指标后才能进入更长 soak |
| 阶段 1 稳定性批次 | `docs/2026-08-22_browser-stage1-soak-batch-report.md`、`v1/test-support/browser-mysql-bounded-soak.js` | 90s 正常 Node 4590/4590、0 duplicate、4590 heartbeat、残留 0；60s `--expose-gc` 对照 2970/2970、0 duplicate、2970 heartbeat、残留 0；GC 仅作诊断，正常 Node 5–15m/网络抖动/崩溃组合仍待完成 |
| 阶段 1 5 分钟正常 Node | `docs/2026-08-22_browser-stage1-5m-soak-report.md`、`docs/2026-08-22_browser-stage1-5m-soak-adversarial-review.md` | 300.056s/16,360 job/4 worker/0 missing/0 duplicate/16,360 heartbeat/残留 0；控制面功能性通过，RSS/heap 结束值偏高，资源稳定性和网络抖动组合未关闭，阶段 2 暂不启动 |
| 阶段 1 资源诊断 | `docs/2026-08-22_browser-stage1-memory-diagnostic-report.md` | `--trace-gc` 与 `--max-old-space-size=64` 对照支持 V8 回收/容量保留假设；64MB 对照 30s 功能性通过、RSS 峰值约 105MB；未冻结生产参数，独立 Worker/网络抖动/长 soak仍待完成 |
| 阶段 1 数据库不可用组合 | `v1/test-support/browser-db-outage-soak.js`、`docs/2026-08-22_browser-db-outage-soak-report.md` | 30s soak 第 5 秒 pause MySQL 2 秒后恢复：1430/1430 claim、0 duplicate、1430 heartbeat、残留 0；仅窄容器阻塞证据，网络分区/积压/主从切换仍待完成 |
| 瞬时数据库错误重试 | `v1/src/db/repositories/browser-dispatch-repository.js`、`docs/2026-08-22_browser-dispatch-transient-retry-report.md` | enqueue/claim/heartbeat 最多 3 次短退避；单元 6/6；pause/unpause 1210/1210 claim、0 duplicate、最大 claim 延迟 2093ms；长期网络故障和生产拓扑仍待完成 |
| 阶段 1 组合故障批次 | `docs/2026-08-22_browser-stage1-combined-fault-batch-report.md` | Worker SIGKILL 接管与 MySQL pause/unpause 持续队列连续通过；旧 token 被拒、1290/1290 claim、0 duplicate、1290 heartbeat、残留 0；同刻并发故障、网络级长 soak和资源闸门仍未关闭 |
| 同刻 crash+DB pause 发现 | `docs/2026-08-22_browser-concurrent-crash-db-pause-finding.md`、`docs/2026-08-22_browser-stage1-combined-fault-batch-adversarial-review.md` | 首次无界等待已定位并修复旧 pool/exit listener 竞态；重跑 13.266s 成功接管同一 job、旧 token 被拒；更长组合 soak和网络级故障仍待完成 |
| Soak 队列隔离 | `docs/2026-08-22_browser-soak-queue-isolation-finding.md`、`v1/test-support/browser-mysql-bounded-soak.js` | 10m 结果因 3 个历史残留 job 污染作废；增加空队列前置检查后 120s 6250/6250 claim、0 duplicate、6250 heartbeat、残留 0；长 soak需重新从空队列开始 |
| 阶段 1 有效 10 分钟 soak | `docs/2026-08-22_browser-stage1-10m-valid-soak-report.md`、`docs/2026-08-22_browser-stage1-10m-valid-soak-adversarial-review.md` | 空队列前置后 600.007s/30,850 job/0 missing/0 duplicate/30,850 heartbeat；脚本和独立残留查询均 0；RSS仍偏高，网络级故障/24h仍待完成 |
| 阶段 1 网络级连接断开风暴 | `docs/2026-08-22_browser-network-kill-storm-finding.md`、`docs/2026-08-22_browser-network-kill-storm-adversarial-review.md` | MySQL `KILL CONNECTION` 注入 10 轮/20 连接后，持续 soak Harness 触发 40 秒 watchdog 失败；不能归因成 repository 已通过，阶段 1 保持未关闭 |
| repository-only 网络故障验证 | `docs/2026-08-22_browser-repository-network-fault-report.md`、`docs/2026-08-22_browser-repository-network-fault-adversarial-review.md` | 80 job/4 worker、56 次连接 KILL 后 80 claim/80 heartbeat/0 error/0 残留；显式非排队测试池耗尽快速失败并恢复；共享池配置和主从切换仍未关闭 |
| 2026-08-23 共享池/组合恢复复验 | `docs/2026-08-23_browser-stage1-shared-recovery-rerun-report.md`、`docs/2026-08-23_browser-stage1-shared-recovery-adversarial-review.md` | 共享池 100ms deadline 耗尽返回 DB_QUERY_TIMEOUT；跨进程崩溃+MySQL pause 同 job 接管、旧 token 拒绝、付款 0；默认等待预算、主从切换、积压和 24h 仍待完成 |
| 2026-08-23 队列积压 soak | `docs/2026-08-23_browser-queue-backlog-soak-report.md`、`docs/2026-08-23_browser-queue-backlog-adversarial-review.md` | 240 job/6 worker/15ms 间隔，240 claim、0 missing、0 duplicate、240 heartbeat、峰值积压 236、残留 0；仅窄窗口，24h/故障转移仍待完成 |
| 2026-08-23 队列积压 + MySQL 重启 | `docs/2026-08-23_browser-queue-db-restart-report.md`、`docs/2026-08-23_browser-queue-db-restart-adversarial-review.md` | 预先 120 job，重启后动态端口和 ready 检查，恢复 Worker 120/120 claim、120 heartbeat、0 error、0 残留；主从/网络分区/24h仍待完成 |
| 2026-08-23 阶段 1 15 分钟 soak | `docs/2026-08-23_browser-stage1-15m-soak-report.md`、`docs/2026-08-23_browser-stage1-15m-soak-adversarial-review.md` | 900107ms/46,370 job/0 missing/0 duplicate/46,370 heartbeat；RSS 峰值 211.2MB、结束 162.6MB；heap 回落；独立残留 0；主从/故障转移/24h仍待完成 |
| 2026-08-23 数据库拓扑审查 | `docs/2026-08-23_browser-stage1-topology-review.md` | 当前只有单个 MySQL 8.4 容器；主从/故障转移为 `NOT_AVAILABLE_IN_TEST_TOPOLOGY`，不能用单实例结果外推高可用 |
| 2026-08-23 阶段 1 30 分钟 soak | `docs/2026-08-23_browser-stage1-30m-soak-report.md`、`docs/2026-08-23_browser-stage1-30m-soak-adversarial-review.md` | 1800045ms/94,790 job/0 missing/0 duplicate/94,790 heartbeat；RSS 峰值 210.6MB、结束 131.2MB；heap/external 回落；独立残留 0；主从/故障转移/24h仍待完成 |
| 2026-08-23 阶段 1 24 小时 soak | `docs/2026-08-23_browser-stage1-24h-soak-run.md`、`docs/2026-08-24_browser-stage1-24h-soak-completion-report.md` | detached 隔离窗口已完成：360/360 claim、0 missing、0 duplicate、360 heartbeat、四类残留 0；A1 其他网络级故障轴和 A2 高可用拓扑仍未关闭 |
| 2026-08-23 24 小时 soak 中断修订 | `docs/2026-08-23_browser-stage1-24h-interrupted-run.md` | 首轮交互终端承载的 24h 运行无效并清理；detached runner 已以约 360 合成 job/日重新启动，流程主线不等待当前窗口 |
| 2026-08-23 阶段 2 本地 mock 回归 | `docs/2026-08-23_browser-stage2-local-mock-gate-report.md`、`docs/2026-08-23_browser-stage2-local-mock-gate-adversarial-review.md` | 11 files/77 tests 全通过；本地 Context/页面/WAL/恢复覆盖；真实 Session、外部页面、付款仍禁止 |
| 2026-08-23 Worker→本地 BrowserContext 接线 | `v1/test/browser-worker-local-mock-integration.test.js` | 4/4 通过：导航→complete、页面漂移 fail-closed、动作中租约丢失 abort、多页面 popup + 人工冻结拦截；mock gateway submitCalls=0；真实外部 BrowserContext仍禁止 |
| 2026-08-23 NON_PH 只读观察前置 | `docs/2026-08-23_nonph-readonly-observation-preflight.md`、`test/browser-nonph-manifest.test.js` | manifest 约束 1/1、与本地 Worker 集成合计 5/5；真实 Session 观察尚未启动，需仓库外 0600 输入 |
| 2026-08-23 US VPN cohort 边界 | `docs/2026-08-23_nonph-us-vs-ph-cohort-boundary.md` | 历史材料：用户已确认不再推进 US cohort；既有 manifest/结果不删除、不作为主线或 PH 结论 |
| 2026-08-23 路线补充 | `docs/2026-08-23_browser-plan-amendment-nonph-us.md`、`browser-poc/manifests/non-ph-us-readonly-2026-08-23.json` | 历史材料：`NON_PH_US` 不再推进；当前 C 只采用 NON_PH_FUNCTIONAL，PH 到位后直接新建 PH manifest/cohort |
| 2026-08-23 US VPN 依赖边界冻结 | `DECISIONS.md` D-125、D-133 | 历史边界已被 D-133 收敛：US 仅保留历史材料，不进入当前主线；PH 需新 manifest/cohort |
| 提链/扫码/菲律宾自助充值市场盘点 | `2026-08-22_browser-marketplace-tool-assessment-report.md` | 只读完成；尚未采购。第三方 UPI API 要求外传 Access Token；菲律宾 CDK 默认归入现有 CDK-API/Provider 路线，不另建路线，其上游是否同源仍待证据确认 |

## 4. 历史材料如何判读

- D-051 的“同 Session 顺序创建 Checkout”已被 D-054 修订。
- D-052 的“完整 Profile”和“唯一胜出 adapter”已被 D-056/D-057 修订。
- 旧报告中的 `FULL_PROFILE_STATE` 统一理解为当前的 `CHATGPT_SITE_STATE_CLONE`，不是整个人浏览器 Profile。
- 旧报告中“非 PH 失败即可淘汰”必须按当前合同收窄：地区相关失败记为 `DEFERRED_PH_REQUIRED`。
- 外部指南、GitHub README 和第三方检测网站评分只是研究输入，不是 OpenAI 风控事实。

## 5. 下一可执行项

### 主工程关键路径（按顺序）

1. Browser 独立 worktree adapter 按 `docs/contracts/2026-08-26_browser-upstream-runtime-contract.md` 接线，只使用共享核心状态和权威证据。
2. 保持付款写关闭，做端到端非付款联调：dispatch→run→permit 前页面步骤→Session 错误 safe-abort→原订单更换 Session。
3. 注入卡余额/状态/时效/route 变化、租约丢失、崩溃和重放，确认零外部付款且无资金 fence 残留。
4. 联调完成后再做一次生产前对抗式审查；只有通过后才能另行申请受控真实付款。

### 非阻塞研究旁路

- 对公开本地提链实现的固定提交做支付模块静态审查，只验证可借鉴接口和能否避免外传客户 Session；不运行真实输入，不阻塞上述 MySQL 主线。
- 菲律宾 Session、普通 PH VPN 和生产相似 sticky 输入到位后，按当前实验合同运行，不回退旧顺序 A/B。
- 菲律宾 CDK 按现有 CDK-API/Provider 路线理解和对照，不创建第二套 Provider 或业务系统；只有接口、上游或终态证据证明不同，才提交拆分决策。

## 6. 接班验证命令

```bash
npm run test:browser-poc
npm run test:legacy
npm run poc:browser-experiment:offline
npm run poc:browser-experiment:wal
npm run poc:browser-experiment:capacity
npm --prefix v1 test
git diff --check
```

## 7. 2026-08-29 首次灰度前生产化就绪检查

- `codex/browser` 已与主线 `16cec70` 对齐，无重复提交或冲突。
- production-readonly `--check` 现要求 migration 039/040、payment executor gate=false/MOCK；旧 037 readiness 口径已纠正。
- 本地 production-shaped smoke：config/systemd 8/8、MySQL mock/readonly CLI + Google Chrome 3/3；共享隔离 dry-run 1/1；均为非付款。
- Browser 专属 stop/disable/previous-release 回滚入口已补入 `deploy/README.md`，但未在服务器执行。
- 首单灰度仍缺 production Session/card-material adapter、真实 ChatGPT 非付款页面观察、LIVE payment/post-payment adapter、候选 release 服务器检查与回滚演练；任何真实付款仍需单独确认。
- 完整证据与准确未验证边界：`docs/browser-research/BROWSER_FIRST_GRAY_READINESS_2026-08-29.md`。
