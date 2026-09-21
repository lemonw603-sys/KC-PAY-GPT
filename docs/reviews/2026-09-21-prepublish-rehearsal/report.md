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

## D-321修复与复验（2026-09-21，UTC+8）

以上保留原始失败证据。用户同意最小修复后，已完成两项本地修复；修后原始结果见[fixed-evidence.json](fixed-evidence.json)，status为`recovery checks passed`。

### 迁移

- v1/scripts/migrate.js在任何DDL前读取版本、检查整批055～057的结构与直接权限，并通过数据库级GET_LOCK防止并发迁移。权限不足报MIGRATION_TRIGGER_PRIVILEGE_REQUIRED；不修改权限或全局变量。
- v1/src/db/step6-migration-guard.js仅负责055～057恢复适配，不泛化为新迁移平台。原SQL文件未改；SHA256将适配合同绑定到已审SQL，未来改文件而不更新合同会被拒绝。
- 对每列核对类型、NULL、默认值、额外/生成属性、文本排序规则；对索引核对列顺序/唯一性/前缀/表达式/可见性；对触发器核对表/时机/事件/正文。相同则跳过，缺失才创建；冲突立即停，不覆盖。
- 已记账迁移若结构缺失也拒绝，不伪装already applied。只有整份结构完成才写版本号，断点后重跑可继续。
- 本轮28个迁移场景符合预期：受限账户提前拒绝且schema快照零变化；完整迁移/重复执行通过；原7个DDL断点+实际15个逐项断点（含DDL完成未记账）全部续做成功；错列/错索引/错触发器零写入拒绝；并发锁拒绝第二个执行者。
- 权限预检目前以直接授权为准；只通过角色获得权限会保守拒绝，需单独审查，不猜有效权限。该适配不承诺001～054及未来迁移也有逐项恢复能力。

### Session恢复

- session-replacement-repository保留原ACTIVE/UNKNOWN/SETTLED资金屏障，并锁定该订单相关任务。有效RUNNING租约或重复分卡任务拒绝、返回409，不抢任务。
- 无卡：已有分卡任务按原ID恢复，缺失才创建唯一ASSIGN_CARD；准备/提交暂以现有DEAD状态和SESSION_REPLACEMENT_WAITING_FOR_CARD标记暂停，不另增任务状态。
- workflow-repository实际分卡成功后，在同一事务中恢复该标记下的规范去重键PREPARE/SUBMIT；不复活其他无关DEAD任务。已绑卡继续原恢复路径。
- 六类真实MySQL场景：缺任务、已完成任务、过期租约均可领取分卡、真实分配到卡并回CARD_READY，之后准备任务可领取；有效租约、UNKNOWN资金分别拒绝且订单/任务不变；已绑卡对照仍CARD_READY。
- 重复提交不会增加分卡任务；单测同时覆盖同CDK重提的既有入口、有效准备/提交租约拒绝、多个分卡任务冲突与无限次Session规则。
- 证据里`preparation: ORDER_STATE_MISMATCH`是故意在分卡前直调准备处理器验证守卫仍生效，不是修复失败。真正放行证据在`afterAssignment: CARD_READY / preparationTaskClaimed:true`；实际队列在分卡前不允许领取准备任务。

### 验证与边界

```sh
# v1目录
node --test test/step6-migration-guard.test.js test/session-replacement-service.test.js test/order-intake-repository.test.js
# 19 pass / 0 fail / 0 skipped
npm test
# 1027 tests / 958 pass / 0 fail / 69 skipped

# 仓库根，实际本机MySQL，包含28迁移场景与6类恢复场景
EXPECT_RECOVERY_FIXED=1 REHEARSAL_MYSQL_URL='<本机隔离管理员连接串>' node scripts/step6-prepublish-rehearsal.mjs
# recovery checks passed
```

语法与diff检查通过。测试库/一次性账户已清理，独立查询剩余0/0，log_bin1/trust_creators0未变。没有Browser代码/界面布局改动，8804仍运行，未重启其他服务。

本轮没有再连接生产。**057的生产创建权限仍没有授予或绕过**：代码现在会安全提前拒绝，实际部署仍需单独确认具备权限的受控DDL连接、触发器DEFINER存续、备份与维护窗口。没有推送/迁移生产/发布/真实付款。其余旧MySQL夹具与业务未验证项没有被本轮默认套件绿灯豁免。

交付核对：迁移断点恢复本地修复与复验完成；无卡队列恢复本地修复与复验完成；生产执行未做、真实充值未做。下一步为确定生产一次性DDL执行方式及最终发布清单，而非继续改CDK业务方案。
