# Browser Worker 并发 Harness 报告（2026-08-22）

## 范围

离线、无 Browser、无 Session、无资金动作的 Worker 控制壳并发验证。使用 8 个异步 Worker、240 个合成 dispatch job，共享一个原子 claim 队列；每个执行动作加入短暂交错延迟。

## 结果

| 指标 | 结果 |
|---|---:|
| 合成 dispatch job | 240 |
| Worker | 8 |
| 实际执行 | 240 |
| 重复执行 | 0 |
| 未领取 job | 0 |
| 意外 stop | 0 |
| v1 全量测试 | 363 pass / 34 skipped / 0 fail |

测试入口：`v1/test/browser-worker-concurrency.test.js`。

## 限制

这是内存 Harness，不是 MySQL 多连接锁竞争、真实独立进程、长租约续期或连续 24 小时 soak。它只能证明当前 Worker iteration 控制壳在交错 claim 下不重复消费，不能外推吞吐、页面稳定性或生产容量。

## 下一项

补充独立连接/进程的 dispatch lease 竞争、heartbeat/过期接管和 bounded soak；完成后再进行连续 24 小时等效或真实时间 soak。
