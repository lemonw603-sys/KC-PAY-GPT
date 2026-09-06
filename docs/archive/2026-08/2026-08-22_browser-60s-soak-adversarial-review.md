# Browser 60 秒 Soak 对抗式审查（2026-08-22）

## 通过项

1. 60.004 秒持续到达，2930/2930 claim，0 漏领，0 重复。
2. 2930 次 heartbeat 成功，MySQL `Threads_connected` 峰值为 4。
3. 清理后四类残留均为 0。

## 新盲区：运行时 RSS 增长（P1）

在已改为每轮清理 `rows`/claim 集合后，RSS 仍从约 65MB 增至峰值约 187MB、结束约 182MB。旧的全量集合保留已整改，但 RSS 增长仍不能直接解释为生产 Worker 泄漏，也不能继续把同一实现直接拉长到 24 小时。

**整改**：继续区分 Node/V8 heap、外部内存、mysql2 缓冲和数据库连接；记录每分钟 RSS/heapUsed/external、连接数、claim 延迟和错误计数，再运行 5–15 分钟。

15 秒拆分重放显示 heapUsed 与 external 在窗口结束时部分回落，RSS 仍高于起点；这缩小了问题范围但不能证明无泄漏。还需按分钟采样和更长窗口确认趋势。

## 仍未验证

- 数据库连接短暂不可用时的持久 Worker 自动重连；
- 浏览器进程崩溃与页面动作中断的组合；
- `PAYMENT_UNKNOWN` 的 reconcile-only 恢复；
- 生产拓扑、24 小时稳定性和实际吞吐。

## 判定

60 秒控制面 claim/lease/heartbeat 通过；harness 内存模型成为进入更长 soak 的前置整改项，不得据此宣称生产容量。
