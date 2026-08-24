# Browser 阶段 1 稳定性批次对抗式审查（2026-08-22）

## 已通过

1. 90 秒正常 Node：4590/4590 claim、0 missing、0 duplicate、4590 heartbeat、残留 0。
2. 60 秒显式 GC 对照：2970/2970 claim、0 missing、0 duplicate、2970 heartbeat、残留 0。
3. 连接数、claim/heartbeat 延迟均在有限范围内，无数据库错误输出。

## 未关闭项

### P1：正常 Node 的 RSS 峰值仍高

90 秒正常 Node RSS 峰值约 208MB；显式 GC 对照峰值约 80MB。两者差异说明回收时机影响显著，但生产 Worker 不应依赖强制 GC，仍需在正常启动参数下做 5–15 分钟趋势观察。

### P1：未做数据库网络抖动与持久 Worker 重连组合

已有单连接/多连接 KILL 重建，但尚未把连接错误、退避、重新 claim 放入持续 soak。

### P1：未做长动作、浏览器进程崩溃与队列积压组合

Playwright 中断已在本地 slow page 通过，但尚未与持续队列和 Worker 崩溃同时运行。

## 判定

阶段 1 的数据库控制面批次通过；资源趋势、网络抖动组合和长时间 soak 仍是最终闸门。不得外推生产吞吐或 24 小时稳定性。
