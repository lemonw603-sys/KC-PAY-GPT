# Browser 阶段 1 组合故障批次报告（2026-08-22）

## 批次

同一隔离 MySQL 测试库连续完成两个子场景：

1. 跨进程 Worker claim 后 `SIGKILL`，租约过期接管；
2. 30 秒持续 dispatch soak 中 pause MySQL 2 秒后 unpause。

## 结果

### Worker 崩溃接管

- 原 job 与接管 job 相同：41130；
- 子进程退出：SIGKILL；
- 旧 owner heartbeat：`LEASE_NOT_OWNED`；
- 付款动作：0。

### 数据库阻塞持续队列

- 1290/1290 claim；
- 0 missing / 0 duplicate；
- 1290 heartbeat；
- claim 最大延迟：2077ms；
- MySQL Threads_connected 峰值：5；
- 清理残留 dispatch/attempt/order/cdk：0/0/0/0。

## 阶段判断

崩溃接管、旧 token 拒绝、数据库短暂阻塞、有界重试和持续队列在隔离组合批次中通过。该批次仍不是 TCP 网络分区、连接池耗尽、主从切换或生产拓扑证据；阶段 1 资源稳定性与长 soak 闸门保持未关闭。
