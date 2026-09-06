# Browser MySQL 多 Job / Lease 报告（2026-08-22）

## 场景

隔离 Docker MySQL 8.4，24 个独立 Browser dispatch job，8 个 Worker 通过真实连接池并发 claim；随后对一个已 claim job 做合法 heartbeat，并用过期时间推进模拟旧租约接管。

## 结果

- jobs：24；
- workers：8；
- claims：24；
- unique claims：24；
- duplicate claims：0；
- heartbeat：成功延长租约；
- expiry takeover：成功由新 worker 接管；
- 测试数据：全部清理；
- 页面/Session/卡片/付款：均未使用。

## 限制

这是一次 bounded MySQL 竞态验证，不是连续 24 小时 soak；尚未覆盖长时间连接泄漏、队列持续到达、数据库重启和完整独立进程压力。
