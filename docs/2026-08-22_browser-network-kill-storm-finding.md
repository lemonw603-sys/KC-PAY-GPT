# Browser 阶段 1：网络级连接断开风暴发现（2026-08-22）

## 目的

在隔离 MySQL 8.4 测试库中，对持续 dispatch soak 注入真实 MySQL `KILL CONNECTION`，验证 Browser 控制面在 TCP/连接级断开时是否能有界重试、继续领取并完成清理。

## 实际运行

- 数据库：`pojia_test` 隔离库，容器 `pojia-stage1-mysql`
- Harness：`v1/test-support/browser-network-kill-storm.js`
- 子 soak：15 秒、4 worker、每轮 10 job、3ms 动作间隔、120 秒租约
- 注入：约 5 秒后每 500ms 最多 KILL 2 个 `pojia_test` 连接
- 结果：10 轮注入、20 个连接被 KILL；约 40 秒 watchdog 触发，Harness 以 `HARNESS_WATCHDOG_TIMEOUT` 失败并强制终止子进程
- 付款/Checkout：0
- `browser_dispatch_jobs`：0 残留

## 判定

这是失败证据，不是稳定性通过。它至少说明“pause/unpause 容器”不能替代连接级断开测试，且当前持续 soak 的直接 `pool.query` 生产/清理路径或 mysql2 等待队列仍存在无界等待。尚不能把失败归因到 Browser repository 的 claim 事务本身，因为子 Harness 同时包含 fixture 写入、worker claim/heartbeat 和清理。

## 已做的窄修复

`browser-dispatch-repository.js` 现在：

1. 事务 acquire 超时后，若 mysql2 稍后才返回连接，会立即 `destroy()`，避免迟到连接泄漏；
2. 工厂支持内部 `transactionTimeoutMs` 测试参数；
3. heartbeat 使用独立连接、有界 query deadline，超时销毁连接后才进入既有短退避重试。

12 项 dispatch/worker 定向测试通过。该窄修复尚未在连接级 KILL 风暴下证明成功。

## 下一步

拆出“预先造数、故障期间只 claim/heartbeat、故障后用全新 pool 清理”的 repository-only Harness，分别测：连接断开、连接池耗尽、连接恢复；禁止把 fixture producer/cleanup 的无界等待混入控制面成功率。阶段 1 继续保持未关闭，阶段 2 不启动。
