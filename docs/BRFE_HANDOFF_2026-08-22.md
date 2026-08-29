# BRFE 接班入口（Browser 充值履约执行器）

## 子项目身份

BRFE = Browser Recharge Fulfillment Executor，中文名“Browser 充值履约执行器”。它是 AI 充值业务中的 Browser 自动化履约子项目，不是新的订单系统、CDK 系统、卡池系统、Provider 系统或资金账系统。

接班主规划：`docs/2026-08-23_browser-master-plan.md`。后续按大阶段推进；证据分类、偏差处理、恢复、资源和交接是横向必查轨道。

当前工作区的 Browser 文件归属、未提交边界和安全提交顺序见 `docs/2026-08-24_browser-worktree-inventory.md`。不得用 `git clean`、`git reset` 或覆盖式 checkout 清理其中未确认的实现和证据。

赛马不是可选的遗忘项：它是 BRFE 内部多 lane 实验机制，按 cohort 隔离比较执行路线；共享订单、资金、审计和对账底座，Checkout 创建后不得自动切 lane，最终只接入 champion 和最多一个预验证 fallback。

优先级原则：履约闭环真实跑通是首要交付目标；账号安全与降低误判风险是并列放行闸门。详见 `docs/2026-08-22_brfe-account-safety-operating-principle.md`。后续吞吐、网络、runtime/profile 和赛马决策都必须同时证明流程可执行、可恢复，且不会引入跨账号运行态复用、异常网络切换或未知结果重付。

## 新模型必须先知道的结论

1. Browser 复用现有订单、CDK、卡片、`recharge_attempts`、资金栅栏、审计、对账和后台。
2. Browser route 不要求 Provider account，不写伪造的 `provider_calls.create_direct`。
3. Browser dispatch 只保存订单/attempt/profile 引用，不保存 Session、卡号、Checkout authority 或明文密钥。
4. 付款未知时禁止重付、换卡、换 Worker 或换 lane；必须锁账并进入 reconcile-only。
5. 赛马是 BRFE 内部的多 lane 实验机制，共享同一套订单/资金/审计底座；不是多个业务系统。
6. 当前只允许隔离测试、LOCAL_MOCK、非付款观察；未接生产、未真实开卡、未真实付款。

## 当前阶段（以 2026-08-23 主规划为准）

当前采用 `docs/2026-08-23_browser-master-plan.md` 的 BRFE 子项目阶段；方向审查见 `docs/2026-08-23_browser-master-plan-adversarial-review.md`：

- 阶段 A1 控制面稳定性：detached 24 小时隔离 soak 已完成并完成独立残留核验（360/360 claim、0 duplicate、360 heartbeat、四类残留 0）；A1 仍不整体关闭，网络级 KILL 风暴等故障轴尚未全部通过。A2 高可用拓扑因单实例 MySQL 标记 `NOT_AVAILABLE_IN_TEST_TOPOLOGY`，不能证明主从/故障转移。
- 阶段 B 本地 Browser 执行：本地 mock 子闸门已通过；这不表示阶段 A 最终关闭，也不表示外部页面或真实付款可用。
- 下一主线：A 保留未关闭的网络/故障轴记录，同时进入阶段 C 的 `NON_PH_FUNCTIONAL` manifest/只读观察前置；真实 Session、菲律宾出口、Checkout 和付款仍未执行。

已验证：

- MySQL dispatch claim/lease/heartbeat 并发与 bounded soak；
- deadlock 有界重试；
- Worker 崩溃后的过期租约接管；
- MySQL 连接池单连接/四连接重建；
- 本地 Playwright slow navigation 失租约中断，提交事件为 0；
- 90 秒正常 Node 和 60 秒显式 GC 对照的控制面无漏领/重复/残留。

未关闭：

- 正常 Node 5–15 分钟资源趋势；
- 数据库网络抖动与持久 Worker 重连组合；
- 浏览器进程崩溃与队列积压组合；
- `PAYMENT_UNKNOWN` reconcile-only 恢复演练；
- 真实非 PH Session 页面 403 后的只读观察收束；
- PH manifest/cohort（需要菲律宾出口）；
- 真实付款和生产 Worker（需要用户当次确认）。

## 本窗口最后完成

- 固化五阶段大闸门路线；
- 90 秒正常 Node：4590/4590 claim、0 duplicate、4590 heartbeat、残留 0；
- 5 分钟正常 Node：16,360/16,360 claim、0 duplicate、16,360 heartbeat、残留 0；控制面功能性通过，但 RSS/heap 结束值仍高于起点；
- 资源诊断：`--trace-gc` 与 `--max-old-space-size=64` 对照支持 V8 old-space 保留/回收时机假设；64MB 对照 30 秒功能性通过、RSS 峰值约 105MB；未冻结生产内存参数；
- 数据库短暂不可用组合：30 秒 soak 中 pause MySQL 2 秒后恢复，1430/1430 claim、0 duplicate、1430 heartbeat、残留 0；仅为隔离容器窄证据；
- dispatch repository 已加入 enqueue/claim/heartbeat 瞬时数据库错误 3 次短退避重试；单元连接丢失和 pause/unpause soak 已通过；不适用于付款未知重付；
- 阶段 1 组合批次：Worker SIGKILL 接管与数据库 pause/unpause 队列连续通过；两个故障尚未同刻并发；资源/网络级长 soak仍未关闭；
- 同刻 crash+DB pause 首次无界等待已定位：恢复时丢弃旧 pool、提前注册 exit listener 后，13.266 秒成功接管同一 job；仍需更长组合 soak和网络级故障；
- 10 分钟 soak 曾因 3 个上次中止残留 job 被误领而作废；harness 已增加空队列前置检查，120 秒复验 6250/6250、0 duplicate、残留 0；
- 空队列前置后的有效 10 分钟 soak：30,850/30,850 claim、0 duplicate、30,850 heartbeat、脚本和独立残留查询均为 0；阶段 1 仍待网络级故障、连接池耗尽、主从切换和 24h；
- 网络级 `KILL CONNECTION` 风暴：10 轮/20 连接注入后，持续 soak Harness 触发 40 秒 watchdog 失败；该失败已落盘，不能把网络重连写成已验证；阶段 1 保持未关闭。
- repository-only 网络故障复验：80 job/4 worker，56 次连接 KILL 后 80 claim、80 heartbeat、0 error、0 残留；显式非排队测试池耗尽快速失败并恢复；共享池配置和主从切换仍未关闭。
- 2026-08-23 共享池/组合复验：共享池在 100ms deadline 下耗尽返回 `DB_QUERY_TIMEOUT`；跨进程崩溃+MySQL pause 接管同一 job、旧 token 被拒、付款动作 0；默认等待预算、主从切换、积压和 24h 仍待完成。
- 2026-08-23 队列积压 soak：240 job/6 worker/15ms 间隔，240 claim、0 missing、0 duplicate、240 heartbeat、残留 0；仅窄窗口，24h 与故障转移仍待完成。
- 2026-08-23 队列积压 + MySQL 重启：预先 120 job，重启后动态端口/ready 检查，恢复 Worker 120/120 claim、120 heartbeat、0 error、0 残留；第一次旧端口失败已记录为 Harness 拓扑发现，主从/网络分区/24h仍待完成。
- 2026-08-23 15 分钟正常 Node soak：46,370/46,370 claim、0 duplicate、46,370 heartbeat、RSS 峰值 211.2MB/结束 162.6MB、heap 回落、独立残留 0；主从/故障转移和 24h仍待完成。
- 2026-08-23 拓扑审查：隔离环境只有单个 MySQL 8.4 容器，没有 primary/replica 或 failover proxy；主从/故障转移标记 `NOT_AVAILABLE_IN_TEST_TOPOLOGY`，不能用单实例 pause/restart 冒充高可用。
- 2026-08-23 30 分钟正常 Node soak：94,790/94,790 claim、0 duplicate、94,790 heartbeat、RSS 峰值 210.6MB/结束 131.2MB、heap/external 回落、独立残留 0；主从/故障转移和 24h仍待完成。
- 2026-08-23 24 小时正常 Node soak 已启动，当前 `RUNNING`；先检查运行状态，结束后读取完整指标和独立残留，再决定阶段 1 是否关闭。
- 首轮 24h 由交互终端承载，窗口中断后无效并已清理 4 个夹具；detached runner 已重新启动低速 24h soak（约 360 合成 job/日），不再阻塞主线。主线下一步转阶段 2 本地 Browser mock 执行闸门。
- 阶段 2 本地 mock 回归：`npm run test:browser-poc` 11 files/77 tests 全通过；下一步接本地 mock BrowserContext Worker，仍禁止真实 Session、Checkout 和付款。
- Worker→本地 BrowserContext 接线 4/4 通过：导航→complete、页面漂移 fail-closed、动作中租约丢失 abort、多页面 popup + 人工冻结拦截，mock submitCalls=0；本地 mock 子闸门完成，仍禁止真实 Session、Checkout 和付款。
- NON_PH 只读观察前置核验通过：manifest 只允许 AUTH_READ_ONLY、临时 Context、禁止 Checkout/payment writes/PH 晋级；真实 Session 观察尚未启动，需仓库外 0600 输入。
- 美国 VPN 的 `NON_PH_US` manifest 仅保留为历史实验材料，不再作为当前主线、对照或晋级候选；当前 C 主线使用 `NON_PH_FUNCTIONAL`，菲律宾 VPN 到位后直接新建 PH manifest/cohort。
- 路线现收敛为：阶段 C `NON_PH_FUNCTIONAL` 只读前置/观察→阶段 D PH 生产相似输入→阶段 E 受控真实履约；不再推进 US cohort。
- 首次 deadline 修复已加入但同刻重跑仍超过 30 秒；连接池 acquire/清理或子进程恢复路径仍未定位，不能宣布修复；
- 60 秒 `--expose-gc` 对照：2970/2970 claim、0 duplicate、2970 heartbeat、残留 0；
- 资源指标已记录 RSS/heapUsed/external/Threads_connected/claim latency/heartbeat latency；
- 对抗式审查发现正常 Node RSS 峰值受回收时机影响，不能直接外推生产泄漏。

## 下一批可直接执行

1. 检查 detached 24 小时 soak 的独立日志、残留查询和资源指标，决定 A 是否关闭；
2. 在不接外部付款的前提下完成 C 的 `NON_PH_FUNCTIONAL` 只读观察器前置；菲律宾 VPN 到位后直接建立 PH cohort，不再推进 US cohort；
3. 并行补 Worker 崩溃、队列积压、本地 Playwright 中断的组合证据和后台时间线；
4. 菲律宾出口到位后新建 PH manifest/cohort，不能覆盖 US/无代理结果；
5. 只有 A-D 的证据闸门通过且用户当次确认，才讨论真实 Checkout/付款。

## 必读顺序

`CLAUDE.md` → `docs/AI_AGENT_ROLE_AND_READING_GUIDE_2026-08-21.md` → 本文件 → `docs/2026-08-23_browser-master-plan.md` → `docs/2026-08-23_browser-master-plan-completeness-audit.md` → `docs/2026-08-23_browser-agent-self-review-and-operating-rules.md` → `docs/BROWSER_CURRENT_STATUS_2026-08-22.md` → `docs/DECISIONS.md` → 需要时再读 Browser baseline/contracts。旧 `docs/2026-08-22_browser-execution-roadmap.md` 仅作历史阶段对照，不覆盖新主规划。

## 验证入口

```bash
node --test v1/test/browser-worker-service.test.js v1/test/browser-worker-process-smoke.test.js
TEST_DATABASE_URL='mysql://root:root@127.0.0.1:56392/pojia_test' node v1/test-support/browser-mysql-bounded-soak.js --duration-ms=15000 --jobs=10 --workers=4 --delay-ms=3 --lease-seconds=60
git diff --check
```

## 绝对停止条件

没有当次明确确认，不接生产、不填写真实卡片、不点击真实付款、不提取余额、不把页面 403 或单一交易信号写成成功。

## 2026-08-29 当前接班覆盖

本文件前述“下一批”是历史阶段记录；当前准确停止点已推进到首次灰度前生产化就绪检查。接班时先读：

- `docs/BROWSER_CURRENT_STATUS_2026-08-22.md` 第 7 节；
- `docs/browser-research/BROWSER_FIRST_GRAY_READINESS_2026-08-29.md`；
- `docs/BRFE_HANDOFF_2026-08-25.md` 的 2026-08-29 交接。

当前 production-readonly Worker 的本地非付款闭环已通过，但仍缺 production Session/card-material adapter、真实 ChatGPT 非付款观察、LIVE payment/post-payment adapter 和服务器部署/回滚演练。未单独确认前仍禁止真实付款。
