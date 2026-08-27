# Browser 充值线：当前 MVP 与后续规划（2026-08-26）

> 本文是 Browser 线当前执行口径。它不修改共享 `CURRENT_STATE.md`、`DECISIONS.md` 或 `HANDOFF_LOG.md`；跨线事实仍由统筹窗口维护。

## 一句话结论

当前 MVP 不是“点击网页脚本”，也不是先建完整运营平台，而是一条能安全验证真实付款的最小纵向链路：

```text
卡台已就绪 Visa 卡
→ 上号器或等价 Session Bootstrap
→ Google Chrome 独立 Profile
→ 账号身份核对
→ Checkout 观察
→ 付款闸门与卡片材料 lease
→ 真实付款（第一次单独确认）
→ Plus 权益 + 卡台交易/扣款 + 本地 attempt/订阅状态三方核对
→ UNKNOWN/人工接管/最小审计与清理
```

## MVP 必须交付的能力

### 已有 Browser-only 代码能力

- durable queue、claim/lease、heartbeat、幂等 enqueue、租约过期恢复；
- WAL/hash chain、重启 reconcile-only；
- Chrome 独立 persistent Profile control lane；
- Cookie Session Bootstrap、身份探针、Checkout 只读观察；
- 上号器 MV3 扩展 lane 合同（headed popup、popup-only 扩展 ID fallback）；
- card-material lease：进程重启后 `RECOVERY_REQUIRED`，并发只允许一个持有者；
- payment permit、UNKNOWN 锁定、订单/卡/全局停止、资金差异停止；
- 上游只读投影 → BrowserContext → 卡片租约释放的非付款联调；
- HNSKJ card material source 的只读响应映射（只允许 `provider.card()`，不含写方法）。
- fixture 卡材料非付款填充切片：durable card lease → Stripe 安全字段填充 → 失租约停止 → 已写字段清理；只返回计数/status，强制 `submitCalls=0`。
- 专用 Google Chrome Profile 中的实际派生上号器 `1.1.1`：popup 真实执行、长 Session Cookie 分块写入、ChatGPT 打开和 `/api/auth/session` 三项身份摘要匹配已通过。
- 真实 ChatGPT Plus Checkout 只读观察：USD 20.00/月、税费 0.00、Stripe 安全卡字段、提交控制和 Payment Page 初始化已验证，`submitCalls=0`。
- Checkout Navigation 状态机已接入 `BrowserExecutionService`；真实处理首页 hydration、Plus 价格弹窗、前/后置用途问卷、Checkout Session 创建和 Stripe 安全字段就绪，全程 `submitCalls=0`。

### 尚未完成但属于 MVP 硬验收项

- 共享 MySQL 正式表接线已替代旧 `browser_upstream_ready_projection` 设想；隔离 MySQL composition 已通过，但真实部署形态 Worker/Chrome 仍需只读 dry-run 验证；
- 真实卡台只读材料 source 接线（优先一次读取、关键阶段读取，不循环刷新）；
- HNSKJ 只读 card-material source 的真实 API/生产 adapter 接线（显式 `providerCardRef`、一次读取）以及 403/可见人机验证人工分流；捕获响应和 fixture 填充合同已完成；
- 付款 executor 与共享服务端权威 payment permit/UNKNOWN 收口强制串接；
- 付款后三方核对：Plus 权益、外部交易/扣款、订单 attempt/订阅续费状态；
- 首次真实付款前的单独确认，以及 `1 笔 → 2–3 笔` 受控连续验证。

## 明确不塞进当前 MVP

- 多 Provider fallback、多机高可用、完整运营后台、复杂 Artifact Vault；
- 自动养号、Profile 预热、CAPTCHA solver；
- 200–300 单/日真实容量承诺或真实卡批量压测；
- 退款、提现、销卡自动生命周期（只预留状态和人工入口）。

## 后续路线（已确认）

### F0：核心真实付款纵向切片

完成上面 MVP 硬验收项；Google Chrome 是第一条 control lane；指纹浏览器只并行做兼容性 Spike，不阻塞第一笔 Chrome 验证。真实付款按 `1 笔 → 2–3 笔` 闸门放行。

### F1：受控多次充值

顺序/低并发多次执行、卡片/订单互斥、稳定幂等键、UNKNOWN 隔离、最小人工队列和失败诊断；不立即做多机调度。

### F2：可替换 Browser Runtime

接入一个本地指纹浏览器适配器，与 Chrome 共用订单/资金/审计合同，但不共享可变 Profile；完成 Profile、代理、locale/timezone 和 Session 恢复对照验证。

### F3：200–300 单/日基础能力

无状态 Worker、扩展队列/租约、并发/速率/背压、任务年龄和失败指标、Profile 池与回收、回放数据压测。此阶段是扩展准备，不是当前 MVP 验收。

### F4：生产运营和资金闭环

运营后台任务列表/详情、订单-attempt-browser run-卡台交易-资金账本关联、预计/实际扣款和余额、人工对账结案、审计与 artifact 保留；退款/提现/销卡单独审批和设计。

### F5：多 Provider / 多路由

单一路线稳定后再做配置化 route、健康度、能力矩阵和受控 fallback；UNKNOWN 状态禁止盲目换 Provider。

## 当前事实边界

- 测试是隔离合同和本地仿真，不代表生产接线；
- 当前已有真实 Session Bootstrap、身份匹配和真实 Checkout **只读观察**证据，但没有真实填卡或付款成功证据；
- 最新共享 Worker composition 只在全新隔离 MySQL + 本地 Playwright fixture 验证，付款副作用为 0；不能外推为生产 Worker 已通过；
- 卡台 API 写开关、真实付款写开关保持关闭；
- 未跟踪 `artifacts/browser-checkout-observe/` 不属于本次修改。

## 2026-08-27 实施进度：共享合同 adapter 与非付款联调已完成

MVP 的 Browser 执行入口已不再依赖旧 `browser_upstream_ready_projection` 或 PoC 状态。当前入口是：共享核心完成资金 attempt → Browser dispatch claim → `browser_run` → Browser 非付款页面动作 → `abortBeforePayment()` 安全收口。未来付款 permit 方法已接入边界，但仍由服务端锁定事实并计算 snapshot，付款写开关保持关闭。

本轮已经验证：正式状态拒绝、卡/route/Provider 绑定、Session/账号状态分流、租约前后丢失、崩溃、重复投递、卡余额/状态/同步时效变化、零外部付款和零资金 fence 残留。

## 2026-08-27 实施进度：正式非付款 Worker composition 已完成

代码提交 `8c17412` 新增 `createSharedNonPaymentDryRun()`，把共享 MySQL dispatch/execution/recovery repositories、共享 Worker service、Browser executor 和 `abortBeforePayment()` 组成一个可调用入口。它要求：

- 精确人工确认词；
- `browser_payment_writes_enabled=false`；
- `manifest.allowWrites=false`；
- 不存在 payment submitter；
- 调用方提供跨订单稳定的账号 opaque key resolver，不得用订单 ID 代替账号隔离键。

验证结果：Browser 静态检查通过；Browser 全量 71 tests / 70 passed / 1 skipped / 0 failed；全新临时 MySQL 8.4 执行完整 migrations 后的端到端测试 1/1 passed。最终活动 permit、`PAYMENT_SUBMIT` operation、资金 fence 和资源租约残留均为 0，外部付款调用为 0。

这只完成了“生产形状 composition + 隔离数据库/本地页面”的验收，不是生产接线。下一步唯一动作是让统筹窗口提供隔离或预生产 Worker 配置与非敏感测试订单，在真实 Worker + Google Chrome 上运行同合同只读 dry-run；仍不读取真实卡、不填卡、不 submit。首次真实付款必须单独确认。
