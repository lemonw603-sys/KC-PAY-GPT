# Browser MySQL 60 秒时间 Soak 报告（2026-08-22）

## 可重放命令

```bash
TEST_DATABASE_URL='mysql://root:root@127.0.0.1:56392/pojia_test' \
  node v1/test-support/browser-mysql-bounded-soak.js \
  --duration-ms=60000 --jobs=10 --workers=4 --delay-ms=3 --lease-seconds=60
```

## 结果

| 指标 | 结果 |
|---|---:|
| 时间窗口 | 60.065 秒 |
| 合成 job | 2930 |
| 成功 claim | 2930 |
| 漏领 | 0 |
| 重复 claim | 0 |
| heartbeat | 2930 |
| Worker | 4 |
| MySQL Threads_connected 峰值 | 5 |
| RSS 起始 | 65,142,784 bytes |
| RSS 峰值 | 186,990,592 bytes |
| RSS 结束 | 182,370,304 bytes |
| 清理残留 dispatch/attempt/order/cdk | 0 / 0 / 0 / 0 |

## 解释

claim、heartbeat、清理在 60 秒窗口内无漏领或重复。harness 已改为每轮统计后清理 rows/claim 集合；本次 RSS 仍从约 65MB 增至峰值约 187MB，结束约 182MB，因此不能把增长归因于旧的全量 rows 保留，也不能直接解释为生产 Worker 泄漏。需要进一步拆分 Node/V8、mysql2 缓冲和数据库指标后才能进入更长 soak。

补充 15 秒资源拆分重放（730 job、4 Worker、lease 60）：RSS 65MB→134MB 峰值/126MB 结束；heapUsed 8.5MB→31.6MB 峰值/21.5MB 结束；external 1.99MB→4.38MB 峰值/3.38MB 结束；`Threads_connected` 峰值 5；claim 延迟均值 3.57ms、最大 104ms（含无 job 轮询），heartbeat 延迟均值 1.58ms、最大 89ms；残留仍为 0。heapUsed/external 部分回落但 RSS 未完全回落，仍需更长窗口确认趋势。

## 边界

无页面、Session、卡片或付款动作。60 秒不等于 5–15 分钟或 24 小时；生产拓扑、数据库网络抖动和真实 Browser runtime 仍未验证。
