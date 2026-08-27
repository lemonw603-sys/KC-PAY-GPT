# Browser 可复用组件清单

用途：在实现 MVP 前决定“抽取、适配还是重写”。本清单不代表组件已接入新版控制面。

| 组件 | 路径 | 当前能力 | 付款能力 | MVP 建议 | 主要风险 |
|---|---|---|---|---|---|
| Session 解析/注入 | `/session-auth.js` | Session JSON、Cookie、cookieHeader、登录探针、Bearer 注入 | 间接 | 抽取为受控 Session adapter | 旧实现会向页面 route 注入凭据，需隔离日志和生命周期 |
| Browser 运行时选择 | `/browser-runtime.js` | standalone/pool、CDP 环境传递 | 间接 | 复用接口，接入新 lease | 旧 pool 与新版资源租约不是同一合同 |
| Browser standalone | `/browser-standalone.js` | Playwright Chromium 启动、UA 探测 | 间接 | 可作为本地 runtime 候选 | 当前是真实浏览器启动能力，不等于风控通过 |
| Browser pool | `/browser-pool.js`、`/browser-pool-client.js` | 常驻 Chromium、slot acquire/release | 间接 | 复用资源池思想 | 进程内状态，不能替代持久化租约 |
| Checkout API/UI | `/chatgpt.js`、`/pricing-checkout.js` | API 创建 Checkout、UI 定价页回退 | 是 | 先拆出只读/创建阶段 adapter | API、UI、hosted/custom 结果和副作用不同 |
| Stripe 页面动作 | `/stripe-payment.js` | iframe 输入、账单、提交、结果探测 | 是 | 最后适配，先做 mock | 选择器漂移、3DS、提交未知、敏感数据暴露 |
| 卡轮换 | `/payment-retry.js` | reserve、拒付换卡、账单记录 | 是 | 不直接搬入 MVP | 可能在 UNKNOWN 场景造成重复付款 |
| Legacy 任务调度 | `/server.js` | CDK 锁、task log、子进程、回滚 | 是 | 只抽取业务映射，不复用旧调度 | 绕过新版 attempt/permit/audit 合同 |
| Browser MVP 控制壳 | `/browser-mvp/src/*` | 本地 dispatch、lease、WAL、只读 runtime | 否 | 作为控制合同参考 | 不连接共享 MySQL/真实 Session/Checkout |
| 新版 Browser dispatch | c566 worktree `v1/src/db/repositories/browser-dispatch-repository.js` | MySQL queue、claim、lease、恢复 | 间接 | 逐文件抽取并审查差异 | 当前分支未接入，c566 worktree 还有非 Browser 未提交改动 |
| 新版 Browser execution | c566 worktree `v1/src/db/repositories/browser-execution-repository.js` | begin run、permit、checkpoint、UNKNOWN | 是（受开关控制） | 作为共享资金合同入口 | 需要与当前共享 schema/订单状态核对 |
| 新版 Worker 控制壳 | c566 `v1/src/services/browser-worker-*.js` | claim/run/heartbeat/timeout/fail-closed | 否 | 补正式 CLI 后再接 runtime | 当前只允许 `LOCAL_MOCK`，生产代码无调用者 |

## 抽取规则

- 先复制接口和测试，再逐函数抽取；不整体 cherry-pick 混合 checkpoint。
- 付款相关代码必须经过 payment permit、账号锁和 UNKNOWN 合同。
- 任何会接触 Session/Card/Checkout authority 的函数都要重新做敏感字段测试。
- 旧代码的“重试”不能默认进入新 Worker。
