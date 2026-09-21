# 第⑥步三项隔离验收

核对时间：2026-09-21 03:56～03:57 UTC（11:56～11:57 UTC+8）。**验收已执行；发现两处需要收口的问题，尚未修改业务实现或发布。合成备份恢复不等于生产灾备验收。**

## 依据与范围

- 用户确认补验：付款开关真实范围、付款不明的页面到数据收口、备份恢复后的业务可用性。D-322记录本次授权边界。
- 决策D-283/284：工作台 `docs/design/prototypes/step6-workbench-compare.html` C版；营业条 `step6-opsbar-v5.html` 乙-3。独立开关不擅自合并。D-291延期项不重开；D-245退休的两阶段Pro不作为本次交付目标。
- 当前运行代码与候选2d41192一致（`git diff --name-only 2d41192 -- v1 browser-mvp deploy`空）；脚本只新增在scripts，无生产实现改动。
- 生产只读前次依据：`SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN ('browser_payment_writes_enabled','dispatch_new_recharges') ORDER BY setting_key` → `browser_payment_writes_enabled true / dispatch_new_recharges true`。本轮state-check再核对⑤b、054、web/worker active、Browser付款true、账号槽0、非终态0；不是新版本生产验收。
- 执行：`node scripts/step6-safety-acceptance.mjs`。随机专用本机数据库，真实MySQL迁移、真实应用路由/服务、真实Chrome页面。只注册本次所需后台读/收口/开关端点；无provider/worker、无真实账号卡片。恢复用全新MySQL容器 `--network none`，通过docker exec标准输入输出连接其内部loopback，无网络出口/对外映射。
- 机器证据：[evidence.json](evidence.json)；回归原始输出：[mysql-tests.txt](mysql-tests.txt)。页面截图来自同一次最终通过运行。

## 承诺与结果

| 承诺 | 实际证据 | 结论/边界 |
|---|---|---|
| 确认付款开关范围 | 点击营业条关闭付款，真实DB读回Browser=false、dispatch=true；Browser新permit及新提交intent均拒绝BROWSER_PAYMENT_WRITES_DISABLED；实际runtime规则仍允许API SUBMIT_RECHARGE | 已验证“非全局停付”。没有真实向外提交，也不是对已发送付款的撤销保证 |
| 关闭派单不影响追踪 | 点击关闭派单，runtime allowedTasks排除SUBMIT_RECHARGE，保留POLL_RECHARGE/SYNC_CARD_TRANSACTIONS | 已验证新提交调度边界；已在执行中的动作不能承诺被瞬间撤销 |
| 两路线已扣/未扣款收口 | 4条路径均从工作台“去核实收口”→订单详情→确认框→正式处理服务；新连接读订单/attempt/资金/账本/卡占用/告警/case | 四条均通过，详见下表；不是生产真实资金验收 |
| 未知时不退码、不复用卡、不重付 | 收口前客户重提拒绝，正式eligibleInventoryCardSql该卡计数0；收口本身不新增attempt/tasks；已扣款后客户重提仍拒绝 | 通过本次合成场景；已有单测覆盖许可重放与未知资金保护 |
| 未扣款后能继续用原码 | 两路线实际调用客户建单服务成功，重复提交返回同一新单；正式卡资格SQL该卡计数1 | 通过。API的CDK在客户重提时正式退回再绑定，不能误报为收口按钮立即把CDK改AVAILABLE |
| 恢复后能用 | 同生产mysqldump范围/加密参数，gzip→加密→解密→新MySQL导入63表；Session/CDK原密钥可解密、错Session密钥拒绝，真实getOverview能读 | 合成灾备机制通过；未取用生产备份/密钥，真实异地副本和分离密钥可获取性仍未核实 |
| 057触发器可恢复 | 导入后缺DEFINER的负例真实报1449；恢复相同账号和库级ALL后告警RESOLVED→OPEN轮次1→2 | 缺口已证实；没有给恢复账号全局SUPER。正式恢复脚本尚未增强 |

### 四条收口原始结果摘要

| 路线/结论 | 订单 | attempt / funds | 账本 / assignment | CDK客户验码 | 特别说明 |
|---|---|---|---|---|---|
| API已扣款 | RECHARGE_SUCCESS | SUCCESS / SETTLED | CONSUMED / RELEASED | BOUND_TO_ORDER | 保留取消续费未确认提醒 |
| API未扣款 | RECHARGE_FAILED | CLEARED / CLEARED | RELEASED / RELEASED | VALID | 原CDK先保持REDEEMED，客户重提时正式退回再绑定；卡inventory虽仍ASSIGNED，正式资格SQL已可用 |
| Browser已扣款、续费已关 | RECHARGE_SUCCESS | SUCCESS / SETTLED | CONSUMED / RELEASED | BOUND_TO_ORDER | 取消续费确认事实落库 |
| Browser未扣款 | CLOSED | FAILED / CLEARED | RELEASED / RELEASED | VALID | CDK立即AVAILABLE，卡AVAILABLE |

四条都关闭各自付款不明case及告警，工作台对应“去核实收口”入口消失。case/告警用真实产生路径建立（API escalateUnknownSubmission；Browser REQUEST→FREEZE→MARK_PAYMENT_UNKNOWN及真实告警产生器），不是手拼key自证。

我看到：API确认框明确要求同时核对账号与卡台交易，并有必填证据说明；Browser未扣款收口后工作台付款不明项消失，详情显示资金CLEARED、账本“已释放”。旧页面残留的Pro两阶段提示属于已退休文字，不在此次Plus收口四例覆盖范围，不据此宣称Pro可用。

截图：[API未扣款确认](api-not-charged-confirmation.png)、[Browser未扣款结果](browser-not-charged-closed.png)、[关闭付款](payment-off.png)。

## 两个需讨论的最小收口项

1. **名称范围不明确**：`v1/public/admin/assets/admin.js:581`只写“付款”，对应 `admin-operations-service.js:130` Browser付款门；`worker-runtime.js:15` API不受该键控制。建议仅明确“浏览器付款”及停付边界，不新建总开关、不改变已批准的独立控制。尚未实施。
2. **恢复成功判据不足**：`deploy/server/pojia-ops.sh:123`只验表数；`pojia-backup.sh`只备应用库，不包含mysql账号。新057的DEFINER不随应用库备份创建。建议将准确DEFINER身份/最小所需权限的恢复和一次业务验证列为恢复必经步骤；缺失时必须报失败，不能仅有表就报OK。尚未改脚本/生产权限。

## 测试与清理

- 最终隔离脚本12项检查，failures=[]；它包含成功场景和“缺DEFINER必须失败”的负例，不代表发现的问题已修复。
- 既有Browser付款不明MySQL测试12/12，无跳过（含历史Pro分支回归，仅作为既有兼容检查，不作为新Pro验收）。
- 定向单测37/37，无跳过（[原始输出](unit-tests.txt)）：`node --test v1/test/admin-operations-service.test.js v1/test/worker-runtime.test.js v1/test/unknown-submission-resolve-service.test.js v1/test/browser-execution-repository.test.js`。
- 验收脚本准备期间修正了夹具字段名/触发器名/必填设置及释放后查询连接方式，未因此改生产实现。最终证据来自完整重跑，不拼中间结果。
- 专用数据库/账号查询剩余0/0；临时恢复容器、Chrome和本次应用服务器关闭。未启动worker，8804用户演示保留；既有常驻服务未动。
- 整个默认套件本轮未重跑，不能将37+12说成全项目通过。未推送、未迁移生产、未发布、未操作真实资金。
