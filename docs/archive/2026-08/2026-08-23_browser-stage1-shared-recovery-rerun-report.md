# Browser 阶段 1 共享池与组合恢复复验（2026-08-23）

## 结果

1. **共享池耗尽窄测试**：模拟当前共享池 `connectionLimit=10, waitForConnections=true, queueLimit=0`，占满 10 个连接后用 100ms 控制面 deadline 调用 `claim`，321ms 内返回 `DB_QUERY_TIMEOUT`；释放连接后 `SELECT 1` 恢复。说明 repository deadline 能把无限等待变成有界失败，但默认 5 秒 deadline 的生产延迟预算尚未冻结。
2. **跨进程 Worker 崩溃 + MySQL pause 组合**：同一 job 被接管，`claimedJobId=recoveredJobId=111785`，旧 token 为 `LEASE_NOT_OWNED`，组合故障标记 `MYSQL_PAUSED_DURING_WORKER_CRASH`，`paymentActions=0`，进程 13.3 秒内退出。

## 判定

连接级恢复、组合接管和控制面未知锁定保持通过；共享池的等待预算、主从切换、长时间积压和 24 小时 soak 仍未关闭。不得将本报告外推为生产吞吐或付款成功率。
