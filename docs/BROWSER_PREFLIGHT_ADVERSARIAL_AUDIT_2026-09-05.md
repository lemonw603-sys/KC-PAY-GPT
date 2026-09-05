# Browser 前置闸门对抗式审查（2026-09-05）

## 结论

原 `agent-evidence-gate.sh browser-order` 只能证明 BitBrowser/代理、生产服务和部分订单投影可读，不能证明“真实 Browser 订单可执行”。它把 `RESULT=BROWSER-ORDER_EVIDENCE_READY` 输出得过于宽泛，存在把前置检查误读为全链路通过的风险。

本轮已补强闸门并现场复核；闸门仍是前置条件检查，不替代真实订单验收。

## 已现场核对

- 本地 BitBrowser Local API：READY。
- mihomo：单实例、端口归属正确、经代理出口 `38.60.246.34` 可达。
- 本地共享 Browser readonly Worker 进程：READY。
- SSH 数据库隧道 `13306`：READY。
- 生产 release：`/opt/pojia/releases/20260905-maintenance-bark-6246cc1`。
- Web/API Worker active；远程 Browser Worker inactive/disabled；生产 Browser target 仍为 `LOCAL_FIXTURE`。
- Provider reads=true；通用写、卡片写、充值写均 false。
- 生产 Browser 表存在，最高迁移 `047_browser_billing_address_assignments`。
- 生产 heartbeat 当前可读（本次值为 `2026-09-05T02:32:39.186Z`）。
- 最新生产订单仍为 API 路线 `WAITING_FOR_CARD`，无 Browser job/run；不得把它当 Browser 测试订单。

## 测试覆盖边界

- v1：529 tests，483 passed，0 failed，46 skipped（缺隔离 `TEST_DATABASE_URL` 的集成套件）。
- browser-mvp：118 tests，114 passed，0 failed，4 skipped（同样是隔离 MySQL 集成项）。
- 因此“0 failed”不等于数据库集成、真实 Session、Checkout 或付款已验证。

## 已实施的闸门修复

`agent-evidence-gate.sh browser-order` 现在额外要求：

1. 本地 readonly Worker 进程存在；
2. SSH DB 隧道存在；
3. 生产 Browser schema 存在；
4. 输出最新迁移版本和 heartbeat。

缺少前两项时以非零状态退出，避免仅凭端口/服务健康就继续真实订单。

## 尚未证明、不可越过的边界

- 未提交新的真实 Browser 订单；
- 未验证 Session 注入、账号身份、Checkout 套餐/金额/税费；
- 未验证真实订单的 dispatch/run、付款前安全退出和最终回写；
- 生产 Browser Worker 仍停用且为本地 fixture，不得切到生产真实付款；
- 46+4 个隔离数据库测试未运行。

## 下一步

在不执行付款的前提下，使用专门的真实测试订单完成：订单路线冻结 → Browser job/run → Session/账号 → Checkout 金额税费读取 → 付款前安全退出 → 状态/审计回写。每一段均保存原始证据；若任一段失败，停在最早不确定点，不重试付款、不换路线。

## 二次纠偏：避免闸门影响决策

用户指出闸门若输出含糊的“ready”，可能被错误当作业务结论。本轮将版本升级为 v2：

- 结果明确命名为 `PREFLIGHT_READY`，不再叫 `ORDER_EVIDENCE_READY`；
- 明确标注 `LATEST_ORDER_SCOPE=diagnostic_only`，旧订单仅作诊断，不参与默认路线判断；
- 直接读取并强制断言 `fulfillment_routes.accepts_new_orders` 恰好一个且为 `BROWSER`；
- 不满足时以非零状态退出。

闸门仍不是订单验收器，只负责阻止明显的环境/路线错配。
