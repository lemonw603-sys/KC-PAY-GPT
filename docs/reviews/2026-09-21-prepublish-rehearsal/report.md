# 发布前两项隔离演练

时间：2026-09-21 02:17:55～02:18:16 UTC（10:17～10:18 UTC+8）。业务代码基线8b88577，演练时业务源码无未提交改动。用户批准：迁移权限/完整/重复/中断演练；无卡订单重贴Session后的恢复验证。未修改业务实现，未连接或修改生产。

## 结论

**两项演练已完成，但放行条件未通过。** 发现两个须修的缺口：迁移中断不能直接续跑；无卡重贴Session不恢复分卡队列。正常迁移后重复执行通过，不等于半迁移能够恢复；客户响应PROCESSING也不等于真正有可领取的分卡任务。

完整机读结果：[evidence.json](evidence.json)。脚本：scripts/step6-prepublish-rehearsal.mjs。脚本退出0只表示诊断完成，不表示所有场景通过；具体看各scenario的exitCode/error及队列证据。

## 一、迁移演练

使用现有本机隔离MySQL容器，8.4.11 / log_bin=1 / log_bin_trust_function_creators=0，与上轮生产读取值一致。创建一次性测试账户，仅授予测试库ALL，不授全局SUPER，不改任何全局设置。用真实001～054建立基线，之后调用正式v1/scripts/migrate.js执行055～057。

| 场景 | 结果 |
|---|---|
| 生产同类库级权限，首次迁移 | 055/056记账成功；057两列已加，CREATE TRIGGER失败ER_BINLOG_CREATE_ROUTINE_NEED_SUPER（1419） |
| 同权限直接重跑 | ER_DUP_FIELDNAME（1060），不再能到达建触发器那一步 |
| 改用本机管理员直接重跑同一半迁移库 | 仍ER_DUP_FIELDNAME；权限补足本身不能修复半迁移 |
| 全新库，管理员完整执行 | 成功，版本到057 |
| 完整成功后再执行 | 成功，仅already applied |
| 七个DDL断点分别重建新库演练 | 7/7续跑报ER_DUP_FIELDNAME |

断点为055加列后/加索引后、056批次列后/码列与索引后、057第一列后/第二列后/触发器后；最后一种覆盖“DDL全部执行完，但schema_migrations未记账就中断”。每个场景独立新库，不靠污染库重试推结论。

原因：MySQL DDL已提交，而migrate.js仅在整份SQL执行成功后记schema_migrations；未记账就从文件第一条DDL重跑。SQL没有已完成步骤的结构核对/续做机制。

存量保护对照：迁移前AVAILABLE哨兵码，完整迁移后仍AVAILABLE，issued_at=NULL、expires_at=NULL、issuance_kind=LEGACY。没有以迁移名义改旧码状态/期限。

最小修复范围（尚未实施）：

1. 任何DDL之前先检查本次待执行迁移的权限条件，权限不足就提前停，不留半迁移。
2. 对055～057已有列/索引/触发器核对定义，只有一致才跳过并继续；缺失则补做，不因“名字存在”就盲跳，更不删已有结构或数据。
3. 通过所有断点重放后再明确生产一次性DDL执行方式；生产改权限/变量仍需另行确认，不永久扩大应用账号权限。

## 二、无卡Session恢复

调用真实createSessionReplacementService，使用真实Session校验、事务、正式任务领取函数claimNextTask与PREPARE_RECHARGE处理器。全部是本地合成账号Session，未请求外部服务、未运行充值worker。

库里有1张通过正式eligibleInventoryCardSql的合格卡，故失败不是简单的库存不足。

| 场景 | 返回/订单状态 | 分卡任务 | 实际准备动作 |
|---|---|---|---|
| 无已分配卡，原无ASSIGN_CARD任务 | PROCESSING / WAITING_FOR_CARD | 未创建，领取返回null | ORDER_STATE_MISMATCH |
| 无已分配卡，旧ASSIGN_CARD已COMPLETED | PROCESSING / WAITING_FOR_CARD | 仍COMPLETED，领取返回null | ORDER_STATE_MISMATCH |
| 已有已分配卡（对照） | PROCESSING / CARD_READY | 不需要重新分卡 | 未执行付款准备或付款；原PREPARE/SUBMIT被恢复PENDING |

前两种情况下，PREPARE_RECHARGE与SUBMIT_RECHARGE反而已恢复PENDING。源码session-replacement-repository.js:43把无卡订单改成WAITING_FOR_CARD，但:67起只复位BROWSER_PREFLIGHT/PREPARE_RECHARGE/SUBMIT_RECHARGE，没有恢复ASSIGN_CARD。准备处理器要求CARD_READY，实调用报ORDER_STATE_MISMATCH。

影响边界：确认无卡形态一旦进入该恢复路径就无法靠现有分卡队列继续；没有生产实证说明当前已有客户卡在这里，不从合成场景推断故障发生率。

最小修复范围（尚未实施）：在现有资金安全检查后、同一事务中恢复或补建唯一分卡任务；已绑卡仍走原路径。无卡时不能让准备/提交任务先于分卡抢跑；应补测重复提交、已有任务/有效租约、资金未知拒绝、分卡完成后下游恢复。不是新增业务状态或自动换卡付款。

## 覆盖与收尾

- 两项检查完成；迁移中断恢复与无卡自动续办仍未通过，不是发布许可。
- 本轮只新增复跑脚本与报告，不改业务代码、迁移文件或生产权限。
- 10份专用本机测试库与一次性测试账户已清理。独立查询剩余step6_gate_*库0、账户0；全局log_bin=1/trust_creators=0未变。证据与脚本保留，测试数据可重造。
- 8803/8804原演示和常驻worker未操作；未推送、未发布，未重新连接生产跑state-check/wrapup。
- 中断后的进程核对未见迁移/演练残留；context-handoff与delivery-commitment-check用于保存边界、区分“检查完成”与“功能通过”。

复跑（仅本机容器映射端口，脚本拒绝生产隧道13306，并核对docker映射）：

```sh
REHEARSAL_MYSQL_URL='<本机pojia-stage1-mysql管理员连接串>' node scripts/step6-prepublish-rehearsal.mjs
```
