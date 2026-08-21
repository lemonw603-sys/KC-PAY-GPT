# 阶段二：Session 恢复与正确终态验收（2026-08-21）

## 1. 结论

阶段二代码、增量迁移、隔离 MySQL 和独立对抗式审查已完成；未发现剩余 P0/P1 阻断项。

本结论只覆盖本地代码和隔离 MySQL，不代表生产已经部署，也不代表正式成功充值链路已经真实验收。本阶段没有调用开卡、卡充值、直充、退款、余额提取或 Browser 付款接口。

## 2. 已实现行为

- 新增 `WAITING_FOR_SESSION`：账号已是 Plus 或本地 Session 无效时，原订单等待客户修复；
- 客户可凭订单查询码或原 CDK 在原订单更换 Session，不创建新订单、不重新消耗 CDK；
- 最多更换 3 次；72 小时从第一次明确的客户可修复错误开始；
- 更换历史只保存邮箱、ChatGPT 账号 ID、原因、序号和时间，不保存旧 Session；
- 客户只看到 `ACCOUNT_ALREADY_PLUS`、`SESSION_INVALID` 两种可行动原因，不看到库存、卡台或 Provider 内部问题；
- 新增 `CANCELLATION_PENDING` 和 `CANCELLATION_REVIEW_REQUIRED`；
- Provider 付款成功但取消续费未确认时，客户状态为 `FINALIZING`；只有 `is_subscription_cancelled=1` 才进入最终成功；
- 取消续费查询连续异常或次数耗尽时进入人工复核，不永久停在处理中；
- 每次充值提交都先建立唯一 `recharge_attempt` 和 Provider 调用意图；历史 legacy Permit 已不能绕过资金账本；
- 40030 明确拒绝会清除本次资金风险、进入 Session 修复，并允许重新授权后创建新的合法 attempt；
- 其他明确且无资金影响的提交拒绝会在同一事务内清账并进入 `RECHARGE_FAILED`，不会形成 `CARD_READY + DEAD` 僵尸订单；
- 不明确提交结果继续进入 `SUBMIT_UNKNOWN`，禁止自动重付。

## 3. 关键资金与恢复约束

1. `ACTIVE | UNKNOWN | SETTLED` 资金栅栏存在时，禁止更换 Session 或创建第二次资金尝试。
2. 幂等键绑定单次、不可变的 authorization item；同一授权重放保持同键，清账后新授权获得新键。
3. 授权在任务领取与消费之间到期/撤销时，任务安全回到 `PENDING`；只有明确的 `RECHARGE_AUTHORIZATION_REQUIRED`、无资金栅栏且无 legacy Provider 创建调用时，后台才能重新授权并归零调度次数。
4. 40030 清账不提前清除当前 Worker lease；任务完成失败记录后，由 Session 更换服务统一恢复任务。
5. Provider 成功/失败提交必须恰好更新一条 `recharge_attempt`；缺失账本不能写订单资金终态。

## 4. 验证证据

- Migration `001` 至 `025` 在干净 MySQL 8.4 数据库执行成功；
- Migration `025_session_recovery_and_finalization.sql` 在已有隔离数据库重放成功；
- 全量测试：`313 passed / 0 failed / 0 skipped`；
- 真实 MySQL 回归覆盖：第一次 attempt 被 40030 明确清账 → 原订单等待 Session → 客户更换 Session → 新授权 → 第二次 attempt 成功建立；两个 attempt 的幂等键不同，第一条为 `CLEARED`，第二条为 `ACTIVE`；
- 静态与服务测试覆盖：客户状态隔离、3 次/72 小时、取消续费最终态、legacy Permit 禁入、连续查询异常、确定拒绝原子终态、敏感字段不外泄；
- `git diff --check` 通过。

## 5. 独立对抗式审查修正

审查曾确认并已修复：

- Foundation v2 授权与 legacy task claim 互斥，导致任务无法领取；
- 取消续费查询连续异常会让订单永久停在 `CANCELLATION_PENDING`；
- legacy Permit 可在没有 `recharge_attempts` 时写订单终态；
- 同一订单更换 Session 后固定幂等键会撞唯一键；
- 授权 claim/consume 竞态会形成不可重新授权的 DEAD；
- handler 提前重置 task lease 会触发 lease-lost；
- 非 40030 明确拒绝会形成 `CARD_READY + DEAD` 僵尸订单；
- 取消人工复核标志、领域状态迁移和旧 `markAttemptSettled` 绕过项。

最终独立终审结论：未发现剩余 Stage 2 P0/P1 阻断项。

## 6. 尚未验收与下一阶段

- 尚未发布到生产；生产部署必须保持所有资金写门禁关闭；
- 尚未用目标账号为免费账号的正式订单验证最终成功和取消续费；
- 阶段三仍需取消正常订单逐单人工授权，统一全局门禁、任务恢复和唯一资金 attempt 自动建立；
- Browser 主执行链路继续按独立基线做非付款 PoC、仿真和控制面，不因本阶段完成而获得真实付款权限。
