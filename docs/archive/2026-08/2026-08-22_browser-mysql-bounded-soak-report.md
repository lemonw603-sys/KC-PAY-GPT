# Browser MySQL Bounded Soak 报告（2026-08-22）

## 场景

使用仓库内固定 harness `v1/test-support/browser-mysql-bounded-soak.js`，在隔离 Docker MySQL 8.4 上串行注入合成 Browser dispatch job，8 个并发 Worker 反复 claim；每个 job 的部分 claim 路径执行 heartbeat，并在短暂处理延迟后继续消费。无页面、Session、卡片或付款动作。

> Fixture 生产刻意串行：首次并发 fixture 写入暴露了真实 `ER_LOCK_DEADLOCK`，已单列在 `docs/archive/2026-08/2026-08-22_browser-enqueue-producer-deadlock-adversarial-finding.md`，不与 claim/lease 主指标混淆。

## 可重放命令

```bash
TEST_DATABASE_URL='mysql://root:root@127.0.0.1:63168/pojia_test' \
  node v1/test-support/browser-mysql-bounded-soak.js \
  --rounds=20 --jobs=20 --workers=8 --delay-ms=5
```

## 结果

| 指标 | 结果 |
|---|---:|
| 运行窗口 | 7.314 秒 |
| 到达轮数 | 20 |
| 合成 job | 400 |
| 成功 claim | 400 |
| 漏 claim | 0 |
| 重复 claim | 0 |
| 成功 heartbeat | 400 |
| leaseSeconds | 60 |
| Worker | 8 |
| 清理残留 dispatch/attempt/order/cdk | 0 / 0 / 0 / 0 |
| 测试数据 | 已清理 |

另以较小参数 `5×10 job、4 Worker、2ms` 重放：50/50 claim、0 漏领、0 重复、50 heartbeat，四类残留均为 0。

时间模式 `durationMs=15000、10 job/轮、4 Worker、3ms、leaseSeconds=60` 重放：960/960 claim、0 漏领、0 重复、960 heartbeat，四类残留均为 0，运行 15.029 秒。

## 结论

在该 bounded 窗口和合成负载下，MySQL dispatch claim、heartbeat 与清理没有产生漏领或重复领用。时间模式必须使用覆盖整个窗口的 lease 参数；若用 10 秒 lease 跑超过 10 秒且不模拟完成，会自然出现过期接管，不能误报为重复执行缺陷。该结果仍不是连续 24 小时 soak，不能推导真实页面吞吐、菲律宾网络容量或付款成功率；入队生产者并发死锁仍是单独未关闭的工程闸门。

## 下一步

补充独立 Worker 进程崩溃/重启、数据库重启、长时间 bounded soak，以及单独的入队 producer deadlock/退避/幂等测试；任何付款仍保持关闭。
