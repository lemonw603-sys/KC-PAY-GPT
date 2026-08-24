# Browser 入队死锁重试验证报告（2026-08-22）

## 目标

验证 Browser durable dispatch 的数据库入队在 MySQL `ER_LOCK_DEADLOCK` / `ER_LOCK_WAIT_TIMEOUT` 后是否能安全回滚并进行有界重试；重试只重新执行数据库事务，不调用 Browser、Session、卡片或付款动作。

## 实现

`v1/src/db/repositories/browser-dispatch-repository.js` 增加 `inTransactionWithLockRetry`：

- 识别 `ER_LOCK_DEADLOCK`/1213 与 `ER_LOCK_WAIT_TIMEOUT`/1205；
- 最多 3 次事务尝试；
- 线性退避 5ms、10ms；
- 每次失败先 rollback 并释放连接；
- 其他错误原样失败；
- 重试范围只包围 `enqueue` 数据库事务。

## 证据

1. 单元测试注入第一次 deadlock：第二次事务成功，rollback=1、commit=1，插入尝试=2。
2. 隔离 MySQL 8.4，40 个不同订单同时并发 enqueue：首次无重试版本为 1 成功/39 deadlock；加入有界重试后 40/40 成功，无 rejected。
3. 之后 bounded soak 小参数重放：50/50 claim、0 missing、0 duplicate、50 heartbeat、四类残留均为 0。

## 边界

- 这是数据库入队幂等写的重试，不是付款重试；未知付款结果绝不通过该机制重放。
- 3 次仍失败时保持失败关闭，由上层订单/审计处理；不自动换卡、不换 lane、不创建第二个资金 attempt。
- 生产连接池、锁等待阈值和真实流量仍需在隔离预发布配置下复验。
