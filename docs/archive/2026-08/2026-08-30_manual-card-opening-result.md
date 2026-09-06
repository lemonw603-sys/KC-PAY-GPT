# 手动开卡结果（2026-08-30）

- 用户明确要求自动开 1 张、金额 `$16` 的卡。
- 使用正式卡库存任务服务创建 1 张手动开卡任务，卡段 `16`，预计总扣款 `$16.58`（本金、开卡费及费率按当时快照计算）。
- Provider 只读规则快照显示：卡段 16 可用、开卡允许、卡台账户余额 `$36.30`、剩余开卡额度 `292`；未启用自动补卡，只执行本次人工任务。
- 一次性库存 runner 在临时进程环境中开启 `PROVIDER_CARD_WRITES_ENABLED=true`、保持其他 Provider 写入关闭后执行；没有修改常驻服务开关。
- 任务 `986d345d-e4b6-4ad6-b770-ef447c3b6f74` 已 `COMPLETED`，`opened_count=1`，无错误。
- 新卡已自动同步并接管：Provider card id `1839`，尾号 `1013`，余额 `$16.00 USD`，`AVAILABLE`、`ACCEPTED`、未绑定订单。
- 生产持久化配置仍为 `card_auto_replenishment_enabled=false`、Browser gate=false；接单和 API 自动派发保持原状态。
- 本次未创建订单、未读取 Session、未执行充值或付款。
