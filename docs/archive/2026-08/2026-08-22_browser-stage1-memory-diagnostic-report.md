# Browser 阶段 1 资源来源诊断报告（2026-08-22）

## GC 轨迹

30 秒正常 Node `--trace-gc`：GC 多次执行 Mark-Compact/Scavenge，old-space 回收后 heap 可降至约 10MB，但 V8 保留更大的 heap capacity；最终业务结果为 1530/1530 claim、0 duplicate、1530 heartbeat、残留 0。

## Old-space 限制对照

30 秒 `node --max-old-space-size=64`：

- 1020/1020 claim；0 missing；0 duplicate；1020 heartbeat；残留 0；
- RSS 64.9MB→104.9MB 峰值→74.2MB 结束；
- heapUsed 8.5MB→23.7MB 峰值→9.2MB 结束；
- external 1.99MB→3.48MB 峰值→2.00MB 结束；
- Threads_connected 峰值 4；claim 延迟均值 5.10ms、最大 19ms；heartbeat 延迟均值 2.16ms、最大 14ms。

## 判断

在当前合成负载下，正常 Node 的高 RSS/heap 更像 V8 old-space 保留和回收时机，而不是 rows/claimed 集合持续增长；限制 old-space 后资源明显下降且功能性仍通过。该参数不能直接作为生产配置，仍需在独立 Worker 进程和接近生产负载下重新基准。
