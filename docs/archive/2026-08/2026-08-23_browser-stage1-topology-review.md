# Browser 阶段 1：数据库拓扑审查（2026-08-23）

当前隔离环境只有单个 `pojia-stage1-mysql`（`mysql:8.4`）容器，没有可配置的 primary/replica、故障转移代理或复制状态。已有容器 pause、KILL CONNECTION、restart 只能验证单实例连接/重启恢复，不能证明主从切换、复制延迟、VIP/DNS 漂移或 failover fencing。

## 结论

- 主从/故障转移闸门当前标记为 `NOT_AVAILABLE_IN_TEST_TOPOLOGY`，不是通过也不是失败归因。
- 不新增临时“伪主从”脚本冒充生产拓扑；若需要真实验证，下一阶段需提供隔离的双节点 MySQL/代理拓扑。
- 在拓扑输入到位前，继续做单实例长 soak 和本地 Browser 阶段的非付款控制验证，不把单实例结果外推到生产高可用。
