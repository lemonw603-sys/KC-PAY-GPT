# Browser 阶段 1 组合故障批次对抗式审查（2026-08-22）

## 通过

- Worker 被强制终止后，新 owner 接管同一 job，旧 token 无法 heartbeat；
- 数据库 pause/unpause 期间持续 claim 无漏领/重复，恢复延迟约 2 秒且最终清理为 0；
- 付款动作始终为 0。

## 未关闭

1. 两个子场景是连续执行，不是同一时刻的 Worker 崩溃 + 数据库不可用并发故障。
2. pause/unpause 不等价 TCP 分区、连接池耗尽、DNS/路由不可达或主从切换。
3. 资源趋势在正常 Node 下仍偏高，未达到长 soak 退出条件。

### 新增 P1：同刻故障出现无界等待

在 Worker claim 后同刻 pause MySQL 并 SIGKILL Worker，第一次恢复侧超过预期窗口无输出。随后恢复路径改为丢弃 pause 期间旧 pool，并在 SIGKILL 前注册 exit listener；重跑在 13.266 秒内成功接管同一 job，旧 token 被拒。该修复仍需纳入更长组合 soak。

## 判定

阶段 1 的同刻 crash+DB pause 窄场景已通过；最终稳定性闸门仍需网络级故障、长时间资源趋势和更长组合 soak。
