# Browser dispatch ambiguous claim 审查与修正（2026-08-24）

## 发现

原待提交 diff 对 `enqueue`、`claim`、`complete` 统一启用数据库瞬时错误重试。`enqueue` 有 `jobKey`/`recharge_attempt_id` 幂等恢复，`complete` 有终态和 operation 语义；但 `claim` 没有调用方幂等键。

如果 `claim` 的事务已经提交，只是响应在 `DB_QUERY_TIMEOUT` 或连接断开时丢失，自动重试可能再领取另一条 job，造成第一个 lease 对调用方不可见、队列顺序改变和恢复延迟。它不是付款重复，但属于控制面状态不确定，不能按普通瞬时错误处理。

## 修正

- `claim()` 使用 `retryAmbiguous: false`。
- 仍允许 MySQL 明确回滚的 `ER_LOCK_DEADLOCK`/`ER_LOCK_WAIT_TIMEOUT` 走有界重试。
- `enqueue()` 和 `complete()` 保留幂等恢复所需的瞬时错误重试。
- `heartbeat()` 保留同一 `UPDATE` 的安全重试；它不会创建新 job 或资金动作。

## 验证

```bash
node --test v1/test/browser-dispatch-repository.test.js
```

结果：7 tests / 7 pass / 0 fail。

新增回归断言：claim 事务 acquire 超时只销毁迟到连接一次，不再次执行可能产生隐藏 lease 的 claim。

## 边界

- 该修正只影响 Browser dispatch 控制面，不改变订单、资金 attempt、付款 UNKNOWN、换卡或生产开关。
- 未执行真实 Browser、Checkout、付款或生产 Worker。
