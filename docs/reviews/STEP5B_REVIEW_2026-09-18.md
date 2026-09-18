# 第⑤b块复审：收窄方向正确，仍有三个功能问题与两项遗漏

截至 **2026-09-18 11:51:26 UTC（19:51:26 UTC+8）**；审查代码 `2458f34`，实现提交 `7266ec5`；生产现场 release `20260918-step5-740bc1d`。范围：D-275/D-277确认后的⑤b，板块B/E/F衔接。不按已经撤回的“大而全”金额对账或精确推送次数要求返工。

**结论：部分修复确认有效；暂不建议将⑤b判为全部验收通过。** 不是要求重建系统：需要修的是固定日报与发送队列的衔接、手动停用与已销卡的区别，以及旧数据跨正式批次升级。另有旧日报迁移、拒付类型收窄未完成。

本次仅审查与证据落盘。未改业务、未部署、未启动worker、未写生产；没有联系执行者。以下建议由执行者独立评估，最终取舍由用户决定。

## 1. 上次九条问题的复审状态

| 原发现 | 本次结果 | 边界 |
|---|---|---|
| F-47 押金预检 | 本地修复保留，**发布未完成** | 现场仍740bc1d；HANDOFF明确等确认，不把未授权发布算作擅自拖延 |
| F-48 额外扣款统一待登记 | 按D-275新口径已修主要分类 | 新代码读生产：6张UNEXPLAINED_CHARGE、仅3336待登记；manual登记入口另有F-57 |
| F-49 不可靠期初金额 | **通过降级规避** | 30张全UNVERIFIABLE，不再宣称两张历史卡有确定资金差异；未验证未来基准入口 |
| F-50 GET误推进连续性 | **该反例已修** | 首跑后GET/跨日只读不推进；不等于同步失败后的正式timer不会升级 |
| F-51 数据新鲜度 | **未解决正式批次场景** | F-58重放仍升critical，新增测试只用persist:false避开了它 |
| F-52 空汇总开关 | **按批准的删功能路线修复** | 策略不再有DAILY_DIGEST设置分支，不要求补回日报选项 |
| F-53 负余额取绝对值 | **原反例已修** | 有符号余额，负数UNVERIFIABLE/NEGATIVE_BALANCE；未扩审全部数值边界 |
| F-54 昨日报告不关闭 | 固定key只修了一部分 | 新固定key可被关闭，但旧key没处理；同时固定key引入持续日报不再投递，见F-56/F-59 |
| F-55 精确次数漏计 | **按批准的改名路线修复** | 已改countAlertInstancesByType并注明不是发送次数；不要求新建事件账 |

以上“已修”只指本次代码/验证范围，**不表示生产已经使用新代码**。

## 2. 主要发现

### F-56 固定日报key后，第二天不会再发送；升critical也只改数据库

- 板块 / 严重度：E / **P1 功能错误**。
- 观察：`reconciliationAlertPlan`每天返回同一key `daily-reconciliation`；upsert更新原operator_alerts行。通知仓库以 `(alert_id, channel)` 唯一，INSERT IGNORE不会重建通知，只允许CANCELLED重新入队，SENT不重排。
- 结论：报告/待销连续存在时，只第一天推送；次日乃至后来新增其他异常、升critical也不会再叫人。这不符合保留的“每天一条汇总”和持续异常升级通知目标。
- 证据：`v1/src/services/daily-reconciliation-service.js:380-402`；`v1/scripts/daily-reconciliation-runner.js:33-42`；`v1/src/db/repositories/alert-notification-repository.js:15-43,55-67`；`card-supply-scheduler-service.js:33-43`。
- 最小重放：使用当前正式`upsertSupplyAlert/enqueueOpenAlerts/claimNext/markSent`，在**本机MySQL连接级临时表**执行两天，未调用Bark外部发送。输出：
  ```text
  2026-09-18 claim=true  severity=info     notification=SENT
  2026-09-19 claim=false severity=critical notification=SENT
  ```
- 影响条件：上一天通知已SENT，日报告警持续OPEN（差异、待登记、待销任一存在）。如果中间恢复并被通知轮询标CANCELLED，重新OPEN可再推；这不能覆盖持续异常。
- 反证或不确定性：没有在生产主动制造或推送critical；生产尚未部署此变更。隔离测试用实际MySQL和仓库代码，不是自己复刻SQL状态机。
- 参考验证办法：运行附录脚本DAILY_DELIVERY段；增加“同周期只发一次、下一正式周期可发、critical更新可达手机”的组合用例，而不是只测plan.severity字符串。
- 建议：将“一个当前告警”与“每天一次发送”分别处理，用已有通知字段做最小周期幂等或其他低成本方案；不要直接把所有SENT告警每次轮询都重排。
- 置信度：高。

### F-57 把手动用卡登记接到“已销卡确认”，会让未真正销掉的卡退出待销清单

- 板块 / 严重度：B/E / **P1 功能错误**。
- 观察：新RUNBOOK §2.7要求手动付款后调用`/card-retirement/confirm`，确认词“已销卡”。实际函数同时写 `cards.inventory_status=RETIRED`、`CARD_RETIRED_CONFIRMED`事件、运营override；而待销SQL排除`inventory_status='RETIRED'`。非MANUAL_IMPORT还会归档同步并将next_sync_at延后3650天。
- 结论：D-275⑦要的是“手动用过就不再分配”，并认为仍被待销覆盖；选用的端点却表示“外部销卡已经完成”。卡停用成立，但尚待去卡台真正销卡的动作会从due中消失，审计也误记已销。
- 证据：`docs/RUNBOOK.md`新增“运营手动用卡后必须做的一步”；`v1/src/app/create-app.js:623-635`；`v1/src/services/card-retirement-service.js:76-77,186-214`。当前服务内存query适配重放结果：
  ```text
  writtenInventoryStatus=RETIRED
  writtenEventType=CARD_RETIRED_CONFIRMED
  candidateSqlExcludesRetired=true
  ```
  SQL的排除条件是实际代码，不依靠上述内存适配器模拟查询结果。生产11:49:31 UTC另见3336为RETIRED、source_present=1、已有1条销卡确认事件；**source_present=1可能滞后，本次不以此证明外部尚未销卡**。
- 影响条件：用户仅手动用卡、尚未去卡台销卡，按新runbook立即登记。
- 反证或不确定性：如果实际先在卡台完成销卡再调用，原端点是合适的。端点自身没有因⑤b变更；问题是⑤b给它新增了不相符的用途。停用卡不再分配的约束仍有效，并非会再次自动付钱。
- 参考验证办法：隔离卡source_present=1且无活动订单，按runbook登记后查override、inventory、事件与due；应能证明停用但仍待外部销卡，而不是伪造完成。
- 建议：复用现有RETIRED运营限制表达“不再分配”，保留真正销卡确认的独立语义；不要求新表或恢复完整手动消费账本。
- 置信度：高。

### F-58 “同步失败跨日”未真正覆盖：第二天正式timer照样拿旧数据升级

- 板块 / 严重度：B/E / **P1 功能错误**，F-51未闭合的复审。
- 观察：跨日期persist:true仅判断指纹重复，不看输入同步是否成功/覆盖是否有效；timer总是persist:true。新测试标题“同步失败跨日”却把次日调用设为persist:false，只证明GET不推进。
- 结论：同步服务失败但数据库可读时，第二天对账timer仍运行，原旧数据重复确认问题仍在；“六条反例全部通过”不能覆盖这一条真实运行路径。
- 证据：`v1/src/services/daily-reconciliation-service.js:289-304`；`v1/scripts/daily-reconciliation-runner.js:23`；`v1/test/daily-reconciliation.test.js:265-278`。固定相同cards/transactions、余额时间仍09-17，使用实际服务函数重放：
  ```text
  09-18 persist=true  persistentCount=0
  09-19 persist=false persistentCount=0
  09-19 persist=true  persistentCount=1
  ```
- 影响条件：LEDGER_AHEAD或UNKNOWN_STATUS等仍有资格升级的次数差异；同步失败后数据未补齐，对账timer仍可正常读库。
- 反证或不确定性：D-275让金额全部降级、无主扣款不升级，已缩小影响面；本次生产6条都是UNEXPLAINED_CHARGE，不能说马上会因此critical。未模拟外部网络失败，只固定旧输入证明控制缺口。
- 参考验证办法：测试中让同步失败但次日正式对账仍启动，而不是把它变成GET；验证不足的输入不得成为又一次有效确认。
- 建议：最小补有效同步依据；若现有字段无法可靠证明，就暂不自动升级这类证据不足记录并明确标注，而非引入复杂批次系统或假定日期变化等于新证据。
- 置信度：高。

### F-59 新key无法关闭已在生产存在的旧日期日报

- 板块 / 严重度：E/F / **P2 升级衔接遗漏**。
- 观察：新runner只操作`daily-reconciliation`；旧生产OPEN的key是`daily-reconciliation:2026-09-18`，没有迁移/结清路径。
- 结论：新代码上线后，即使以后全部正常，旧日报仍OPEN；F-54不能只验证全新数据库下新key的恢复。
- 证据：生产11:49:31 UTC：`daily-reconciliation:2026-09-18 OPEN info SENT 08:29:42.494`；上述runner和plan代码。MySQL临时表重放“旧日期key+新key→新代码resolve”：
  ```text
  daily-reconciliation            RESOLVED
  daily-reconciliation:2026-09-17 OPEN
  ```
- 影响条件：从已经运行过第⑤版的环境升级，不是全新安装；当前生产满足此前提。
- 反证或不确定性：原记录已SENT，本身不会马上多发；主要为活动告警不收敛。执行者若已有未记录的发布结清计划可提供反证。
- 参考验证办法：隔离库先放旧版日期key，再执行新版的正常报告分支。
- 建议：发布前给出限定范围、可审计的一次性旧汇总结清办法，保留发送历史，不广泛清理其他OPEN告警。
- 置信度：高。

### F-60 D-277要求删除的猜测拒付类型，两处仍原样保留

- 板块 / 严重度：B/E / **P2 明确任务遗漏**。
- 观察：D-277和⑤b任务书第7条要求去掉CHARGE_BACK/DISPUTE；当前domain和真正告警产生点均仍是 `['CHARGEBACK','CHARGE_BACK','DISPUTE']`，实现commit未修改它们。
- 结论：该项尚未执行。不能用“六件全部做完”覆盖后来已纳入任务书的第七项。
- 证据：`v1/src/domain/card-transaction-audit.js:78`；`v1/src/db/repositories/card-transaction-repository.js:80`；`git show --stat 7266ec5`。
- 影响条件：外部返回猜测类型值时将按拒付处理；当前没有真实样本证明触发，不提高为资金事故。
- 反证或不确定性：D-277明确highvcc等真实样本，这一部分不算未完成。仅指出已批准的删除动作漏做。
- 参考验证办法：全项目查询上述两个字符串并核对活动产生点，保留真实chargeback/chargeback_fee回归用例。
- 建议：按D-277统一实际分类与告警产生点，不只删一个文件的常量。
- 置信度：高。

## 3. 本轮独立验证

### 生产只读

11:48:57 UTC：release仍740bc1d；web/worker/bark PID为1202546/1202551/1202626，cwd均为该release/v1。timer下次为09-19 04:07:59 UTC（含随机延迟，HANDOFF中的04:01不是当前精确值）。因此不把新版单测通过说成生产生效。

11:50:49 UTC：本地当前新代码经13306隧道读取生产，包装query为仅允许SELECT，`persist:false`：

```text
cards=30 discrepancies=6 persistent=0 unverifiable=30 pending=[3336]
UNEXPLAINED_CHARGE: 8590/0237/0601/5371/5501/7402
retirementDueCount=4
```

这与执行者本次核心分类结果相符；只能证明这个生产快照在新分类下的输出，不能证明跨日投递、停用到销卡的完整链路。

### 本地验证

- `cd v1 && npm test`：899项，833通过、0失败、66跳过，重跑与执行者报告一致。
- `browser-mvp/scripts/state-check.sh`本次11项一致；该检查未覆盖上述跨日发送与手动停用场景，不能以全绿替代行为验收。
- F-56/F-59：实际MySQL+仓库函数，使用既有`pojia-stage1-mysql`中的**连接级TEMPORARY TABLE**；没有建永久库/表，没有修改既有测试表。关闭连接临时表自动消失，未启动或停止容器。
- F-57/F-58：实际服务函数+内存query适配器，分别证明写入意图及批次控制流；SQL排除条件另外直接读代码，不能当作真库完整收口验收。
- `git diff ada8dc8..2458f34 -- browser-mvp/`为空；业务差异限定日对账、推送策略/仓库与相关测试，无新增表、无付款代码修改。

重放脚本：[evidence/step5b-repro-20260918.mjs](evidence/step5b-repro-20260918.mjs)。运行：

```bash
node /Users/lemon/code/AI充值业务/docs/reviews/evidence/step5b-repro-20260918.mjs
```

依赖本机既有测试MySQL容器、端口54186与v1的mysql2。脚本仅在进程内读取该测试容器配置，不打印凭据、不连接生产，不发实际Bark请求；没有该测试环境时不要改为生产库运行。

## 4. D-276八项跑偏检查

| 项 | 本轮结果 |
|---|---|
| 范围外修改 | 未发现⑤b触及Browser/付款/建新表；后续CDK任务书更新是另一个文档提交，未混为⑤b实现 |
| 无证据完成结论 | 核心分类dry-run可独立复现；“六反例全覆盖”对F-58不成立，第7项漏做 |
| 给观察补原因 | 金额降级、未知扣款分离有改善；文档仍笼统把funded_amount解释为下单额，不据此恢复金额判断 |
| 外部字段验真 | 无新增卡台调用；D-277要求删的猜测类型仍在 |
| 未核输入语义 | F-57把“已销卡”端点当“停止分配”使用，语义核实不足 |
| 测试只证明自己 | plan固定key单测未覆盖真实outbox；同步失败测试用只读绕开timer路径 |
| 未确认生产动作 | 未见本批release切换，执行者说明未发布与现场一致；无法从当前快照证明历史所有写操作都不存在 |
| 文档与现场 | release/PID一致；地图仍⑤完成且无⑤b行，HANDOFF已明确未发布；下次timer精确值过期，不作为核心缺陷 |

过程补充：`DISPOSITIONS.md`本次检索仍没有F-47～F-55的逐项接受/拒绝/待验证记录；主要方向已在D-275确认，不因此否定代码修复，但执行者应按协议补自己的处置记录，审查员不代写。

## 5. 建议的最小收口范围

1. 保留已经做对的降级、分类、GET幂等和删空选项，不重新扩大目标。
2. 修日报与outbox的周期衔接，顺带明确旧key结清；不重建通知平台。
3. 分开“手动用过、禁止再分配”和“已在外部销卡”；沿用既有override/待销机制，不恢复新消费总账项目。
4. 用真正的次日正式批次测试覆盖同步失败；证据不足时宁可不自动升级。
5. 完成D-277类型收窄；F-47发布仍单独等待用户确认，不由审查触发。

## 未能核实的事项

新版实际生产投递、真实手动卡的外部销卡状态、所有正式同步水位的可靠含义、未来可验证基准入口、全部历史生产写操作的批准记录。没有从生产数量推断新损失、重扣款或客户影响已经发生。

## 与事实源冲突但无法判断谁对

D-275说RETIRED已被待销覆盖：**运营override RETIRED**可以成为候选理由，但当前确认端点把**inventory_status也写成RETIRED**，被SQL先行排除。若用户意图是“手动用后已经同步完成外部销卡”，需明确；现有runbook写的是付款后立刻登记，不具此前提。

D-274仍把历史差额归因于基准口径，缺独立资金凭证，本轮不重新定因；新版金额降级已避免依赖这项争议作异常判断。

## 本次未覆盖范围

⑥CDK新需求与整页实施、⑦Pro演练/付款核心、⑧删表、全项目安全复审。未改代码、未写生产、未调用外部支付/卡台接口、未重启或部署。报告不是生产放行授权。
