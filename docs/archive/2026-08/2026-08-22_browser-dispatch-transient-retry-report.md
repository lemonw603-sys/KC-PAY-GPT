# Browser Dispatch 瞬时数据库错误重试报告（2026-08-22）

## 实现

`v1/src/db/repositories/browser-dispatch-repository.js` 现在对 enqueue、claim 事务和 heartbeat 查询识别并有界重试：

- deadlock / lock wait timeout；
- `PROTOCOL_CONNECTION_LOST`、`ECONNRESET`、`ETIMEDOUT`、`EPIPE`、`ER_SERVER_GONE_ERROR`；
- 最多 3 次，5ms/10ms 退避；
- 事务失败先 rollback；
- 重试只重新执行数据库状态操作，不触发页面或付款。

## 证据

- 单元测试 6/6 通过；heartbeat 注入第一次 `PROTOCOL_CONNECTION_LOST` 后第二次成功，尝试次数 2。
- pause/unpause 隔离 MySQL 组合：30 秒持续 soak，1210/1210 claim、0 missing、0 duplicate、1210 heartbeat、残留 0；claim 最大延迟 2093ms，反映数据库短暂阻塞后恢复。

## 边界

该机制不适用于付款未知后的重付；付款未知仍固定进入 reconcile-only。网络长期不可用、连接池耗尽、主从切换和生产拓扑仍待验证。
