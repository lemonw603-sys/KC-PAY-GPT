# Browser 数据库短暂不可用对抗式审查（2026-08-22）

## 通过

30 秒持续 soak 中 pause MySQL 2 秒后 unpause，Worker 进程正常退出，1430/1430 claim、0 漏领、0 重复、1430 heartbeat、残留 0。

## 未关闭

### P1：不是网络分区

容器 pause 只证明短暂调度阻塞后的窄场景，未证明 TCP 连接断开、DNS/路由不可达、连接池耗尽或数据库主从切换时的退避重建。

已为 enqueue、claim 和 heartbeat 增加 3 次瞬时数据库错误重试；单元注入 `PROTOCOL_CONNECTION_LOST` 通过，pause/unpause 组合的最大 claim 延迟 2093ms。该修复仍不等价生产网络分区。

### P1：未区分恢复期间的队列积压

本轮结果只给最终计数，未记录 pause 前后队列深度、恢复延迟和重连次数。

## 判定

短暂容器阻塞组合通过；完整网络故障恢复和资源/积压指标仍未关闭，阶段 1 继续保持未最终通过。
