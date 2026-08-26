# Browser 运行合同对抗式审查（2026-08-26）

## 结论

本轮不以“尽量多找问题”为目标，只检查会造成重复付款、错误状态、无法恢复或两条工作线无法接通的重大问题。结论：方向正确，但在代码改造前存在 3 个必须同时解决的实现缺口；当前 Browser 生产付款未启用，因此没有证据表明这些缺口已经造成真实资金事故。

## 已确认合理的部分

- Browser 开始前原子建立唯一 `recharge_attempt` 和资金 fence，必要且合理；
- 订单、卡片、attempt、dispatch、run 和 payment permit 的唯一性/租约设计方向正确；
- `RECHARGE_PROCESSING` 表达 Browser 正在处理、`PAYMENT_SUBMITTING` 只表达真实付款提交，语义比提前使用订单 `SUBMITTING` 更准确；
- `RECONCILIATION_REQUIRED` / `PAYMENT_UNKNOWN` 禁止重付，必须保留；
- 允许 Browser 在执行时使用卡资料和 Session，不影响资金栅栏设计，也不需要为了绝对隔离另建复杂系统。

## 必须修复的重大缺口

### P0-1：付款 permit 签发时没有重新核验卡片和路线

代码事实：`browser-execution-repository.issuePaymentPermit()` 当前只检查 run/attempt/order/租约/控制权和调用方提供的 `snapshotHash`；`lockRunContext()` 没有读取卡片余额、卡片同步时间、卡资料、卡片 Provider 账户或路线的卡 Provider 账户，也没有重新计算权威 snapshot。

影响：attempt 创建时卡片可能是合格的，但 Browser 登录和打开 Checkout 期间卡状态、余额、同步时效或绑定可能变化。若 permit 只信任旧状态或调用方摘要，可能用错误/余额不足/路线不匹配的卡进入付款。

修复要求：在签发 permit 的同一数据库事务中重新锁定并核验订单、attempt、卡、冻结路线、Provider 账户、余额、卡资料和 15 分钟同步时效；由服务端根据权威字段计算 snapshot hash，不能信任调用方随意提供的摘要。

### P0-2：付款前安全退出和 Session 更换没有 Browser 原子闭环

代码事实：Browser execution repository 没有“确认尚未提交付款后安全终止”的正式方法；`markSessionReplacementRequired()` 只接受 `CARD_READY/SUBMITTING`，不会同时终止 Browser run、撤销 permit、清理/失效 Checkout artifact、释放资源、清算 attempt 和完成 dispatch。

影响：Browser 在付款前发现 Session 无效、账号已经 Plus、页面不符合条件或安全失败时，订单可能卡在 processing、attempt 继续占用资金 fence、run/dispatch 不能干净结束；若各组件分别修改，可能出现部分提交和错误恢复。

修复要求：新增单事务的 pre-payment safe-abort；仅在没有 `PAYMENT_SUBMIT` operation 且 payment state 为 `NOT_STARTED` 或可证明未消费的 `PAYMENT_ARMED` 时允许执行。它必须原子完成 run `FAILED_SAFE`、permit 撤销、attempt `CLEARED`、订单按原因进入 `WAITING_FOR_SESSION/CARD_READY/RECHARGE_FAILED`、资源/工件处理和审计事件；dispatch 随后按明确终态收口。

### P0-3：状态改名涉及完整资金闭环，不能只改入口判断

代码事实：当前 dispatch、beginRun、issue permit、commit payment、mark unknown、Plus 激活、取消确认、后台人工控制和多项 SQL 都硬编码订单 `SUBMITTING`。状态机目前也没有 `CARD_READY → RECHARGE_PROCESSING` 和 `RECHARGE_PROCESSING → WAITING_FOR_SESSION` 的完整 Browser 规则。

影响：若只把创建 attempt 或 dispatch 的一个判断改成 `RECHARGE_PROCESSING`，后续付款、UNKNOWN、取消续费或人工接管会在中途失败，形成新的卡单和资金账不一致。

修复要求：按一次完整迁移修改所有 Browser 路线判断和事件；历史 API 路线继续保留自身 `SUBMITTING` 语义。必须用端到端仓储测试覆盖正常成功、Session 修复、安全失败、付款未知、人工接管、重启恢复和取消续费。

## 两条工作线的既有差异

Browser 独立 PoC adapter 当前仍接受 `CARD_READY/RECONCILIATION_REQUIRED`、`PENDING/OBSERVING` 和 `AVAILABLE`。这不是新增第四个问题，而是已知接线差异：共享核心完成上述 P0 修复后，Browser adapter 必须按同一合同调整，不能让 `RECONCILIATION_REQUIRED` 进入新的付款执行。

## 实施顺序

1. 先修共享核心的完整 Browser 状态推进和 pre-payment safe-abort；
2. 补 permit-time 权威卡片/路线/余额快照核验；
3. 完成共享核心定向测试和隔离 MySQL 测试；
4. Browser 工作线修改 adapter；
5. 做非付款联调和故障注入；
6. 最后才申请一次真实付款确认。

## 当前安全结论

当前没有真实 Browser 付款启用或真实资金事故证据。本轮问题属于生产接线前发现的结构性缺口。真实付款开关继续关闭，直至上述三项修复及非付款联调完成。

