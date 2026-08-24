# Browser 阶段 1：5 分钟正常 Node Soak 报告（2026-08-22）

## 结果

| 指标 | 结果 |
|---|---:|
| 时间窗口 | 300.056 秒 |
| 合成 job | 16,360 |
| 成功 claim | 16,360 |
| 漏领 | 0 |
| 重复 claim | 0 |
| heartbeat | 16,360 |
| Worker | 4 |
| leaseSeconds | 300 |
| MySQL Threads_connected 峰值 | 7 |
| claim 延迟均值/最大 | 3.25ms / 136ms |
| heartbeat 延迟均值/最大 | 1.42ms / 93ms |
| RSS 起始/峰值/结束 | 63.8MB / 210.4MB / 174.0MB |
| heapUsed 起始/峰值/结束 | 8.4MB / 83.0MB / 74.1MB |
| external 起始/峰值/结束 | 1.99MB / 8.77MB / 7.12MB |
| 清理残留 dispatch/attempt/order/cdk | 0 / 0 / 0 / 0 |

## 阶段判断

5 分钟控制面 claim/lease/heartbeat 通过，无漏领、重复、数据库错误或残留。资源指标仍未达到最终关闭条件：正常 Node 的 heap/RSS 在窗口结束时仍高于起点。不得把它直接解释为生产泄漏，但必须继续拆分运行时分配、mysql2 缓冲和连接生命周期后再进入 15 分钟/24 小时。
