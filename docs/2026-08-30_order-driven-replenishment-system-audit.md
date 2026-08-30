# 订单驱动补给方案：全系统与 Browser 影响审查（2026-08-30）

## 结论

用户提出的目标（下单即检查，先补余额、无卡再开卡，并快速完成）与整体架构不冲突，但当前代码只支持其中一部分，不能直接宣称已落实。

## 已核对事实

- 订单提交目前只写入 `ASSIGN_CARD` 任务，资源决策在异步 Worker 中进行，不是下单事务内即时补给。
- 自动开卡由 `pojia-card-stock-runner.timer` 触发；当前虽已开启，但仍是独立定时扫描，尚未绑定 `WAITING_FOR_CARD` 订单。
- 卡余额自动补充由独立 `card-funding` runner 负责；生产 `card_balance_recharge_enabled=false` 且 `pojia-card-funding.timer` disabled，订单不会自动补余额。
- API Worker systemd 强制 `PROVIDER_*_WRITES_ENABLED=false`，因此当前生产 API 充值提交不会进入 Provider 写入阶段；这与“API 2 分钟目标”直接冲突。
- Browser Worker 当前 inactive/disabled，`browser_dispatch_enabled=false`；Browser 默认路线无法在生产运行，符合当前付款未启用状态，但与“Browser 5 分钟目标”尚未形成可执行生产条件。
- 现有自动补卡阈值已设为 0，当前只有 1 张可分配 Plus 卡，定时器日志为 `STOCK_SUFFICIENT`，没有无需求开卡事故。

## 对 Browser 的影响

订单驱动补给不会破坏 Browser 的 attempt/job/lease 设计，反而应在创建 Browser attempt/job 前完成卡资源准备。必须保持：

1. 补卡/补余额成功后才能创建 Browser attempt；
2. attempt 与 Browser job 原子写入；
3. Browser route 不调用 ZZSHU/API Provider；
4. 付款未知仍锁定，不因超时自动换卡或换执行器；
5. Browser Worker 心跳与专用 gate 仍是生产启用前置条件。

## 重大问题（需修复后才算落实）

1. **缺少订单驱动编排器**：需要把“找合格卡 → 补余额/开卡 → 接管 → 继续该订单”串成按订单 ID 关联的 durable 流程。
2. **补余额全局扫描会过度执行**：现有 scheduler 会扫描所有低余额卡，不能直接作为订单触发逻辑；应只处理当前订单候选卡，并使用稳定幂等键。
3. **定时器仍是 10 秒**：与已确认的“低频兜底”方向不一致；应降为 60–120 秒，并且无等待卡订单时不调用 Provider。
4. **API 生产写权限关闭**：若要兑现 2 分钟目标，需要专用、可审计的 API 充值执行配置，而不是无范围地打开所有 Provider 写权限。
5. **超时状态语义尚未调整**：部分任务达到最大尝试次数会进入 `REVIEW_REQUIRED`；需改为持续处理中，只有确定无法继续或资金 UNKNOWN 才转人工。
6. **时限目前只有目标没有计时证据**：2 分钟/API、5 分钟/Browser 需用真实或生产形态非付款/低风险测试测量，不能当作已达成。

## 建议的最小实现顺序

1. 新增订单驱动的 `ensureCardReady(orderId)`，不改变既有状态表和资金栅栏。
2. 先锁定订单并查询合格候选卡：余额不足则创建订单关联补余额任务；无候选卡才创建订单关联开卡任务。
3. 任务完成后立即把原订单 `ASSIGN_CARD` 唤醒，不等待下一轮长延迟。
4. 保留 60–120 秒低频定时器作为恢复兜底，仅扫描存在 `WAITING_FOR_CARD` 的订单。
5. 先在隔离 MySQL 验证 API/Browser 两条路线，再分别开启生产执行配置；不在本轮直接开启真实 Browser 付款。

## 回归证据

本地 `npm --prefix v1 test`：`476 tests / 438 pass / 0 fail / 38 environment-skipped`。本轮未修改业务代码、未新增生产订单、未开卡、未补余额、未付款。
