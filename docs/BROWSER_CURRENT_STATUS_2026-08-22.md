# Browser 项目当前状态与接班点（2026-08-22）

> 这是 Browser 任务的最短接班入口，只描述当前有效状态，不替代需求基线、Browser 基线和决策账本。历史研究报告用于证据追溯，不能覆盖本文指向的当前合同。

## 1. 当前阶段

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
| 提链/扫码/菲律宾自助充值市场盘点 | `2026-08-22_browser-marketplace-tool-assessment-report.md` | 只读完成；尚未采购。第三方 UPI API 要求外传 Access Token；菲律宾 CDK 默认归入现有 CDK-API/Provider 路线，不另建路线，其上游是否同源仍待证据确认 |

## 4. 历史材料如何判读

- D-051 的“同 Session 顺序创建 Checkout”已被 D-054 修订。
- D-052 的“完整 Profile”和“唯一胜出 adapter”已被 D-056/D-057 修订。
- 旧报告中的 `FULL_PROFILE_STATE` 统一理解为当前的 `CHATGPT_SITE_STATE_CLONE`，不是整个人浏览器 Profile。
- 旧报告中“非 PH 失败即可淘汰”必须按当前合同收窄：地区相关失败记为 `DEFERRED_PH_REQUIRED`。
- 外部指南、GitHub README 和第三方检测网站评分只是研究输入，不是 OpenAI 风控事实。

## 5. 下一可执行项

### 主工程关键路径（按顺序）

1. 用户确认后，冻结候选 runtime/profile/network manifest，进入真实但不付款的 BrowserContext/Session/Checkout 观察；开始前再次核对 identity resolver 和数据边界。
2. 真实观察结束后做 cohort 级对抗式审查，未通过不得进入任何真实付款动作。
3. 增加并发 worker、队列积压、长时间租约续期和 WAL 分段/归档仿真，最后完成连续 24 小时 soak；当前 350 单结果是串行、合成网关的 24 小时等效负载，不能外推吞吐。
4. 人工同 Context 远程操作通道尚未实现；当前完成的是确定性控制权与审计接口，不把另开浏览器视为接管。

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
