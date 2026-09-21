# D-335受控收口：2个案例＋10条告警已完成

2026-09-21 UTC+8。**仅批准的历史状态收口完成，不代表B全部完成或A界面已发布。** 其他账本、CDK、续费核查和23:20登录复测保持原计划；本轮没有访问highvcc标签/发卡台请求。

## 已完成及证据

- 用户对B报告精确12条范围回复“同意”，记录D-335。
- 维护脚本：`v1/scripts/reconcile-historical-payment-notices.mjs`，固定提交cc10b30；SHA256 `54a4cfecca6cd389af7ca9cf5910800cf01a9f589f5db198f1c5ec563dac7a3d`，本机/服务器一致。名单只允许2case/10alert/10订单，无公开后台入口。
- 13:03:30 UTC通过正式createDatabasePool、一笔SERIALIZABLE事务完成；`production-apply.json`输出changedCases2/changedAlerts10/auditEvents10/protectedUnchanged=true。
- 原记录未删除。新增order_events647～656，from_status=to_status，只记维护审计，不伪造交付或再次判款。
- 12目标记录原值备份：`/opt/pojia/maintenance/20260921-D335-cc10b30/targets-before.json`，9999字节，权限0600，父目录0700；仅保留服务器，未复制原始记录到公开日志/仓库。备份成功才进入更新；不是整库备份或灾备验收。

## 停止与隔离保护

脚本固定名单、默认dry-run；校验现有终态、无活动/未知资金、无待定账本/活动分配、已判未扣款审计或成功+取消续费证据、原事件轮次/时间、CDK归属和状态。额外OPEN付款案例/未知提醒、预览摘要变化均拒绝整批。

先锁相关订单、CDK、attempt/run/操作/账本/分配/卡及目标case/alert；apply必须匹配dry-run的planDigest：`d3f276e87ba6cbd9831425e2541e8307c64ebf4ad8ea6e5186d593a3b730e82d`。更新完在事务内校验业务完整行哈希和范围外case/alert不变，然后commit。异常回滚，不留半批。重复执行由同批审计识别为no-op；重新OPEN的记录拒绝，不清新事故。

只新增同状态维护审计，不放开reconciliation-case通用409，不调用原判款接口。维护目录独立于release，src/node_modules链接固定9b9f181依赖；未覆盖正在运行的源码或重启web/worker/bark/Browser池。

## 独立复核及通知服务的正常连带变化

新连接对比生产预览的完整行哈希：

| 保护对象 | 关联行数 | 结果 |
|---|---:|---|
| orders | 10 | 全字段不变 |
| cdks | 10 | 全字段不变 |
| recharge_attempts | 21 | 全字段不变 |
| browser_runs | 21 | 全字段不变 |
| browser_operations | 85 | 全字段不变 |
| card_consumption_ledger | 10 | 全字段不变 |
| card_assignment_history | 10 | 全字段不变 |
| cards | 4 | 全字段不变 |

**发现并核实的差异**：首次独立校验要求连通知记录也完全不变，结果false。8类业务表全部一致，只有alert_notifications10行不同。既有`alert-notification-repository.js:enqueueOpenAlerts`约36～42行会在alert不再OPEN后，把PENDING/RETRY/SENDING/SENT/DEAD通知置CANCELLED。此次10行均在13:03:31.481 UTC由现有服务取消，attempt_count=1、incident_version=1，sent_at仍为09-11～09-16旧时间，没有维护后的发送时间。

没有重做apply、回滚业务或修改通知服务。补真实MySQL场景运行既有enqueueOpenAlerts，证明它只取消投递、保留原发送时间/次数。事务内通知行确实未被维护脚本改；提交后通知服务自然更新，不能声称“所有表绝对不变”。初版独立检查stdout因子进程非零而未落文件，重新只读采样得到`independent-check-detail.json`（保留notifications unchanged=false），最终`independent-verification.json`同时要求8类业务不变及通知取消语义正确，没有忽略资金差异。

13:08:41.776 UTC最终新连接输出：

```text
orders CLOSED21 / RECHARGE_FAILED37 / RECHARGE_SUCCESS20
open_cases 0
open_alerts 113
retained_ledger 2
cancellation_review 7
audit 10
notifications: 10 CANCELLED / attempt_count1 / incident_version1 / sent_at全在本次维护前
```

13:05 UTC独立SSH：current仍20260921-step6-9b9f181；web234748/worker234751/bark234754，均active，与维护前相同。没有停止接单或修改付款/路线。

## 测试与执行资料

- 默认suite：1062 tests / 993 pass / 0 fail / 69 skipped；跳过不计通过（full-tests.txt）。
- 生产前真实隔离MySQL13项通过：dry-run无写、未知资金/待定账本/无取消证据/无人工裁定拒绝、摘要漂移拒绝、缺备份/备份失败拒绝、中途失败整批回滚、精确数量+审计+保护表、非目标不变、重放无副作用、新轮次拒绝。临时库清理（mysql-tests.txt）。
- 通知服务补验后14项通过，保留第一轮13项日志，不把后补场景说成生产前已覆盖（mysql-tests-with-notification-worker.txt）。
- SQL写入只在正式连接池脚本；prod-query仅新连接只读复核。production-preview.txt、production-apply.json、independent-check-detail.json、independent-verification.json、final-queries.tsv为证据。

## 回退边界与未完成

若事务内任何验证失败会回滚；本次已commit，不进行自动逆操作。若未来要求恢复提醒，须根据备份和当前事故轮次另行审批，不能直接OPEN导致重推，更不能倒库覆盖新订单。

本轮只闭合B的这个12条批次。2待对账账本、7续费待核（其中1缺CONSUMED）、16旧CDK归属、纯事件展示/历史统计仍待裁定。A新UI没有随本次维护发布。下一步继续确认历史默认展示/统计范围，或先处理用户愿意核实的旧权益与续费证据；不自动清其余113条提醒。
