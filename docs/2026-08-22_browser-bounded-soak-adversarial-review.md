# Browser Bounded Soak 对抗式审查（2026-08-22）

## 审查对象

`v1/test-support/browser-mysql-bounded-soak.js` 与 `docs/2026-08-22_browser-mysql-bounded-soak-report.md`。

## 已整改并通过

1. harness 已固定入仓库，输入参数、输出 schema、数据库连接和清理路径可直接重放。
2. 20 轮/400 job/8 Worker 的 claim 与 heartbeat 重放通过：400/400 claim、0 missing、0 duplicate、400 heartbeat。
3. 5×10/4 Worker 小参数重放通过：50/50 claim、0 missing、0 duplicate、50 heartbeat。
4. 清理计数已落盘，dispatch/attempt/order/cdk 均为 0；残留时脚本非零退出。

## 新发现：入队生产者死锁（P1，未关闭）

首次将每轮 fixture 创建改为 `Promise.all(createJob)` 时，隔离 MySQL 8.4 真实返回 `ER_LOCK_DEADLOCK`。这不是 claim 竞态的失败，也不能被吞掉。当前报告将 producer fixture 改为串行，仅隔离测量 claim/lease/heartbeat；随后为 enqueue 数据库事务加入 3 次有界退避重试，并以 40 个并发 enqueue 在隔离 MySQL 上 40/40 通过；单独证据与边界见 `docs/2026-08-22_browser-enqueue-producer-deadlock-adversarial-finding.md`。

该发现尚不能外推为生产必然死锁，但足以要求正式入队路径在灰度前具备：固定事务边界、deadlock/lock-wait 有界重试与退避、唯一键幂等、失败后残留清理和指标告警。

### P1：lease 参数与时间窗口耦合

首次 15 秒时间运行使用 10 秒 lease 且只 heartbeat 一次，产生 760 个 job、300 个重复 claim；随后改为 60 秒 lease、每次 claim heartbeat，重放为 960/960、0 重复。该现象说明 harness 必须区分“持续吞吐”与“过期接管”，并显式记录 lease 参数；不能将自然过期后的合法 takeover 统计为重复执行缺陷。

## 尚未验证的盲区

### P1：长时间与资源指标仍不足

当前最长窗口约 15 秒，证明了短时间持续到达，不证明连接池长期稳定、内存增长、连接泄漏、队列持续到达或 24 小时租约行为。

**整改**：补 5–15 分钟 bounded time soak，再补连续 24 小时 soak；记录连接、延迟、积压、错误和租约状态。

### P1：故障注入不完整

本轮没有同时注入 Worker 进程崩溃、数据库重启、网络短暂不可用、旧 owner 续租失败与过期接管竞争。

**整改**：把上述故障作为独立可重放场景，确认未知状态只锁账/对账，不重付。

### P2：生产环境拓扑未验证

隔离 MySQL 端口和生产连接池/索引配置不同；当前结果只能作为控制面门槛证据。

## 结论

短窗口 MySQL claim/lease/heartbeat 结论通过；生产者死锁的有界重试已在隔离 MySQL 通过，但生产拓扑下的参数与长期稳定性、故障恢复、数据库重启和连续 soak 仍未验证。不得把本轮结果外推为生产吞吐、每日数百单或封控率。
