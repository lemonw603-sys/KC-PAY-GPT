# Browser Worker 连接重建与动作中断报告（2026-08-22）

## 连接池重建

固定脚本：`v1/test-support/browser-pool-reconnect.js`。

流程：子进程从 mysql2 pool 取得连接并报告 connection id；父进程使用隔离数据库连接执行 `KILL CONNECTION`；子进程释放坏连接并通过同一个 pool 发起下一次查询。

结果：

```json
{"scenario":"existing-pool-connection-reconnect","connectionKilled":true,"ok":true}
```

说明已有 pool 在连接断开后能够淘汰坏连接，并建立新连接完成下一次查询。没有页面、Session、卡片或付款动作。

## 页面动作中断

已有 `v1/test/worker-runtime.test.js` / `v1/test/browser-worker-service.test.js` 的 watchdog 场景验证：长动作运行期间 lease 丢失时，AbortSignal 被触发，动作以 `LEASE_LOST_DURING_ACTION` 中断；后续动作和付款调用均不执行。

本轮定向执行 Worker service/process/loop 测试：12/12 通过；其中 watchdog 中断测试通过。

## 结论

连接池坏连接淘汰/重建和 LOCAL_MOCK 动作中途失租约中断均通过；真实 Browser runtime、真实网络断连和生产拓扑仍未验证。
