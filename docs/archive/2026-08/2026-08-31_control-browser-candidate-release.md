# 2026-08-31｜运营控制面与 Browser 兼容候选版本

## 候选内容

- 运营后台统一只读就绪摘要接口与首页状态卡；稳定 `checkId/status/actionId` 和卡台/库存/Browser 跳转。
- Browser 适配一卡跨订单复用：优先按 `orders.assigned_card_id` 绑定，旧订单回退 `cards.order_id`，消费账本与 attempt 绑定不变。
- 本版本不改变 Provider 写权限、Browser 付款门禁、订单状态机或资金账本。

## 候选与验证

- 候选 HEAD：`0a6e651`
- 本地归档：`/tmp/aicharge-admin-browser-20260831T090155.tar.gz`
- SHA-256：`2b5e65864d1947e00f7f8a6205de8d0157625cc572c91bf9057f14ae90a28c71`
- 服务器候选：`/opt/pojia/releases/20260831-control-browser-0a6e651`
- Legacy：87/87；v1：446 passed、0 failed、40 skipped；Browser：105 passed、0 failed、4 skipped。
- 候选依赖安装、npm audit、Node 语法检查通过。
- 使用候选代码执行生产只读 readiness：`ok=true`，migration 043，活动任务/未知调用/资金风险/开放对账案件均为 0。
- 当前生产仍为 `/opt/pojia/releases/20260831-card-reuse-068c070`；Web/Worker 正常，Browser Worker 与 card funding timer 关闭。

## 部署边界

候选尚未切换生产。生产切换前需要一次明确确认；切换本身不启用 Browser Worker、卡资金 timer 或任何 Provider 写权限。

## 对抗复查后的替代候选

原 `0a6e651` 候选已因部署前对抗式审查发现的问题作废，不得部署。修正后的正式候选如下：

- 候选 HEAD：`973cb72`
- 本地归档：`/tmp/aicharge-control-browser-973cb72.tar.gz`
- SHA-256：`4dfc7d61772bed83e74ff9167a9c29505ab19ffaad32c9b4e9370103bae37864`
- 服务器候选：`/opt/pojia/releases/20260831-control-browser-973cb72`
- 候选依赖、语法和只读 readiness 均通过；`latestMigrationNumber=43`，`blockers=[]`。
- 当前生产仍为 `/opt/pojia/releases/20260831-card-reuse-068c070`。
