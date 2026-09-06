# Browser MySQL Claim Race 报告（2026-08-22）

## 场景

使用隔离 Docker MySQL 8.4、真实连接池（connectionLimit 12）和同一个 `browser_dispatch_jobs` 记录，8 个独立 Repository 调用通过 `Promise.all` 同时执行 `claim`。

## 结果

- 并发 Worker：8；
- 可领取 job：1；
- 成功 claim：1；
- 唯一 job：1；
- 重复 claim：0；
- 测试数据：事务后清理；
- 无 Browser 页面、Session、卡片或付款动作。

结论：当前 MySQL `FOR UPDATE SKIP LOCKED` claim 路径在该竞态场景下只授予一个 worker 控制权。

## 限制

本次只覆盖单 job claim race；尚未覆盖多 job 高并发队列、heartbeat 续租、过期接管、独立进程崩溃恢复和连续 soak。
