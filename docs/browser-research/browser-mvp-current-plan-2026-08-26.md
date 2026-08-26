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

### 尚未完成但属于 MVP 硬验收项

- headed Chrome 中实际运行上号器 popup，并拿到真实账号身份响应；
- 真实 MySQL `browser_upstream_ready_projection` 视图及 `provider_card_ref` 口径冻结；
- 真实卡台只读材料 source 接线（优先一次读取、关键阶段读取，不循环刷新）；
- Checkout 页面真实观察与页面漂移/403/人机验证分流；
- 付款 executor 与 durable payment gate 强制串接；
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
- 当前没有真实 Checkout/付款副作用证据；
- 卡台 API 写开关、真实付款写开关保持关闭；
- 未跟踪 `.playwright-cli/`、`artifacts/` 不属于本次修改。

