# Browser Soak 队列隔离发现（2026-08-22）

## 发现

10 分钟 soak 结束时出现 `created=30690`、`claimed=30693`；检查发现 3 个上次中止的 `crash-*` job 残留，被本轮 Worker 误领。该 10 分钟结果作废，不能作为吞吐或重复结论。

## 整改

`v1/test-support/browser-mysql-bounded-soak.js` 启动前增加空队列前置检查：发现既有 dispatch job 立即失败关闭，不再混入本轮统计。已清理 3 个隔离测试残留。

## 复验

清理并启用前置检查后，120 秒重放：6250/6250 created/claimed、0 missing、0 duplicate、6250 heartbeat、四类残留 0。

## 边界

这证明测试隔离修复，不证明 10 分钟或 24 小时吞吐；正式长 soak 必须从空队列开始并保留独立前置计数。
