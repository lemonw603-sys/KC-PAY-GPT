# 第⑥步四页联合验收与12条旧失败核查

日期：2026-09-21（UTC+8）。基线：f8a8f60。范围：本地工作台/CDK/卡片/设置基础联动、异常展示、12条MySQL失败归因。没有生产连接、外部付款或卡台调用；没有修改业务实现及正式测试断言。

## 结论

**暂不建议发布。** 基础导航、设置→工作台→卡片联动、工作台→CDK生成链通过；发现2个发布前应处理的High问题，另有1个Medium旧文案和1个Low格式问题。

原12条测试失败不等于12个生产故障。只在临时测试副本中修正已过时的夹具/预期，在全新隔离库重跑后：43 tests / 41 pass / 1 fail / 1 skipped。唯一剩余失败为通知重开，已补独立反例证明。正式仓库测试未被改绿；本结论不是生产全链路放行。

| 严重度 | 数量 |
|---|---:|
| Critical | 0 |
| High | 2 |
| Medium | 1 |
| Low | 1 |

## 问题

### J-01 High / Functional：解决后重开的告警可能不再入通知队列

- 位置：v1/src/db/repositories/alert-notification-repository.js:15–40；迁移023的唯一键(alert_id,channel)。
- 复现：创建白名单PROVIDER_TOKEN_EXPIRED告警→首次入队并标SENT（仅本地记发送状态，没有向Bark发请求）→告警RESOLVED→在通知扫描看到RESOLVED之前又OPEN→执行enqueueOpenAlerts。
- 预期：新一轮告警应重新入队；实际原通知仍SENT。
- 原因：INSERT IGNORE被唯一键挡住；复活逻辑只处理CANCELLED；若扫描错过RESOLVED阶段，就没有CANCELLED这一跳。
- 对照：在RESOLVED期间先让扫描运行一次，再OPEN，通知变PENDING。
- 精确按同一alert_id查询的原始输出：

```json
{"resolvedStateObservedByRunner":false,"firstStatus":"PENDING","afterReopenStatus":"SENT"}
{"resolvedStateObservedByRunner":true,"firstStatus":"PENDING","afterReopenStatus":"PENDING"}
```

- 影响条件：同一去重告警恢复后再次出现，通知程序在中间没扫到解决状态（快速变化、扫描停机等）。并非每次重开都漏；没有证据说明生产已漏过。
- 发布判断：应先修。它影响需要人工处理的告警是否能可靠叫人。
- 证据形态：数据库行为，无UI截图适用。中途一个使用通用claimNext的探针被其他遗留通知干扰，结果弃用；以上是按指定alert_id查同一条通知的独立对照。

### J-02 High / Functional：今日订单请求失败显示“今天还没有订单”

- URL：http://127.0.0.1:8805/admin（工作台）。
- 代码：v1/public/admin/assets/admin.js:656–678。请求catch返回orders=[]、__error=true，渲染只传todayOrders.orders，丢弃错误标记。
- 操作：在独立验收标签用CDP阻断该源/api/v1/admin/orders?*→点击工作台→读取Network.loadingFailed及表格。
- 网络实证：sequence311、requestId34876.199、blockedReason=inspector、type=Fetch。
- 实际表格仍显示“今天还没有订单”；预期应为读取失败/重试，不是空数据。
- 控制台没有JS异常，不代表请求成功；故障在页面里被吞掉了。
- 影响：运营误判没有客户单。该问题曾以__error无消费方登记为未完成，本次已真实浏览器复现。
- 发布判断：应先修。不是重做工作台，仅修失败/空态分流。
- 截图：已在本轮会话通过浏览器截图留存；文件未导出到仓库。可复查依据为上述网络事件、DOM原文和代码，不使用虚构截图路径。注入已撤销、验收标签已关闭。

### J-03 Medium / Content：设置页仍把72小时展示为Session门槛

- URL：http://127.0.0.1:8805/admin（设置）。
- 实际文案：“Session 门槛 / 客户换 Session 的时间窗（小时） / 72 小时 / 暂不可改”。截图与DOM已在本轮会话留存。
- 代码：admin.js:1789–1796的renderSettingsGlobal；对照services/session-replacement-service.js:85–89返回replacementsRemaining=null，session-replacement-repository.js不按修复期限拒绝。
- 规则：PRODUCT_SIMPLIFICATION_DISCUSSION.md接班基线明确删除3次上限及72小时修复窗口，允许无限次、无限期重贴。
- 预期：不把退休配置显示为正在执行的客户限制。不会据此推断后台实际阻止72小时后的重贴。
- 建议：纠正文案或移除这一退休展示，不扩新设置。

### J-04 Low / Content：无备注批次名带半截时间

- URL：http://127.0.0.1:8805/admin（CDK）。
- 实际下拉：“09/20 15:2 那批 · 2 张”。
- 代码：assets/cdks.js:104及renderRows的formatTime(...).slice(0,10)；共享formatTime只返回月日小时分钟，截10字符不是日期。
- 预期：完整日期或完整时间，如“09/20 那批 · 2 张”。
- 操作不受影响；这是本轮CDK实现新引入的小格式错误，不归咎演示数据。

## 原12条失败的逐项归因

原始输出：/tmp/cdk-mysql-test.log，修改前对照/tmp/cdk-baseline-mysql.log；两份12条名单一致。
本轮诊断只修改临时副本，补丁在[fixture-only.patch](fixture-only.patch)。没有放松产品代码保护。

| 原测试位置（mysql-integration.test.js） | 初始失败 | 验证结论 |
|---|---|---|
| 178 Bark | BARK_TEST不在推送白名单，首次领取0条 | 改为真实白名单类型后发现J-01，属于“旧夹具遮住真实缺陷” |
| 671 非默认卡段并发分卡 | Order route cannot assign a card | createOrder夹具漏frozen_card_provider_account_id；补与卡相同的冻结来源后通过 |
| 726 顺序复用容量 | 同上；之后第二次分不到卡 | 冻结来源缺失＋原入卡16却要求两次各16消费；改为50初始余额、第一次后34快照，容量断言通过 |
| 899 注册卡后分配 | 冻结来源缺失；之后分配为空 | 夹具未传fundedAmount，余额保守规则不认没有入卡本金的卡；补真实fixture本金16后通过 |
| 1241 订单驱动补余额 | 冻结来源缺失 | 补夹具字段后通过；不代表重新启用已退休补余额业务 |
| 1331 补余额重试 | 冻结来源缺失 | 同上，通过 |
| 1471 活动/未知补余额禁止分卡 | 冻结来源缺失 | 同上，通过，资金风险保护保留 |
| 1636 工作流事务 | 期待已退休VERIFY_CARD任务 | 删除旧预期、保留其他任务和事务断言后通过；测试自身1650行已注明开卡旧线退休 |
| 2314 授权/资金屏障 | CARD_SOURCE_MISMATCH | 冻结来源夹具缺失，补后通过 |
| 2433 自动执行并发 | 期待一个成功，实际0 | 同一来源校验提前挡住两次，补夹具后并发唯一性断言通过 |
| 2530 换Session后重新授权 | CARD_SOURCE_MISMATCH；之后ORDER_NOT_ELIGIBLE | 冻结来源与assigned_card_id夹具缺失；卡存在却未填订单绑定，补完整绑定后通过 |
| 2992 Session替换 | 仍期待剩余2次；无卡却期待CARD_READY | 对齐无限次与无卡WAITING_FOR_CARD状态后通过；该测试不证明无卡恢复后的最终分卡排程，见未覆盖 |

最终全新库重放原始摘要：

```text
tests 43
pass 41
fail 1
skipped 1
failing: Bark notification claims are concurrency-safe and reopen after resolution
assert.ok(reopened): actual null
```

一次复用已有失败数据的中间重跑被遗留队列/卡污染，已作废，最终使用新建step6_joint_qa3从001～056迁移后运行。不能用中间污染结果推导新缺陷。

## 四页联动已验证

- 独立8805服务、step6_joint_ui克隆本地旧演示库后应用056；源码为当前版本，外部Provider读写开关全false、无worker。没有改变8804用户试用环境。
- 工作台、设置、卡片、CDK导航均实际点击；本轮各页正常加载后未观察到JS控制台error。
- 设置HNSKJ Plus水位2→0，页面保存成功；工作台该产品“自动补”→“需人工开”；卡片页显示可分配/水位2/0。另一台仍2/2。
- 独立SQL：card_supply_policies legacy-primary/plus=0，backup-a/plus=2；admin_setting_events旧值2、新值0，setting_key=supply_policy:legacy-primary:plus:target_available。
- 工作台实际生成1张，CDK页显示新码；独立SQL证实issuance_kind=NORMAL，TIMESTAMPDIFF(DAY,created_at,expires_at)=30。没有重复建立发码逻辑。
- 卡片台账可分配4张与工作台合计一致（库存口径），不将当前可立即分配数与库存数混用。
- CDK旧演示库孤立REDEEMED行缺订单、缺明文等现象属于已知夹具差异，本轮不作为生产异常。

## 未覆盖与发布边界

- 没有验证任何生产release、迁移、订单、卡台真实响应；也没有真实开卡、付款、退款、提现。
- 不是四页所有按钮的穷举验收：外部资金动作未点，未重跑全量视觉契约，移动端沿用此前证据而非本轮新结论。
- 无卡Session恢复到WAITING_FOR_CARD后，分卡任务是否完整恢复尚需专门核对；不能只凭“修正状态预期后测试绿”证明客户全链路可用。
- 工作台成功率使用全历史分母、同块标题为“今天生意怎么样”，本轮观察到今日0、历史成功率75%。尚未裁定是否改口径/文案，不作为本报告新增缺陷计数。
- 既有日对账逐卡明细入口欠账、卡状态文案等仍在原账本，不在此次诊断里擅自改业务方向。
- 建议先修J-01/J-02并补反例测试；J-03/J-04可同批小修。得到明确修复授权后再改业务代码；现在没有发布放行结论。

## 交付核对

四页基础联动检查已完成；12条失败逐项归因完成（1项仍有真实缺陷，11项按现行规则修正夹具后通过）。发现报告已落盘；修复与生产放行未完成。仅保留本地证据及交接，本轮不推送、不迁移生产、不部署。

## 后续修复记录（D-320，2026-09-21 UTC+8）

上文为原始审查，保留不改。用户明确同意修复J-01～04后，四项均已本地修复：

| 项目 | 实现 | 新证据 |
|---|---|---|
| J-01 | 057迁移添加告警/通知incident_version；数据库触发器只在非OPEN→OPEN时递增；outbox按轮次入队、领取、确认 | alert-reopen-mysql-integration实际MySQL；无中间扫描重开、并发扫描/领取、内容更新不重推、RETRY/DEAD不无限复活、白名单、迟到成功/失败回调不覆盖新轮次、INSERT ON DUPLICATE KEY路径通过 |
| J-02 | loadOverview保留今日订单失败标记，renderWbOrders区分失败和空；失败态给局部“重试” | 先红后绿的fetch500单测；浏览器Network.loadingFailed inspector请求42183.41后实际显示“今日订单读取失败。重试”；撤销阻断点重试显示“今天还没有订单” |
| J-03 | 删除renderSettingsGlobal退休的72小时门槛展示；账单地址入口保留 | 单测及真实设置页DOM核对，无Session门槛/72小时；不改变Session业务规则 |
| J-04 | cdkBatchDate使用Asia/Shanghai日历日期；下拉与行内共用，不截取时间字符串 | 单测跨UTC日界线/null/非法日期；浏览器实见“2026/09/20 那批 · 2 张” |

默认测试1023 / 954 pass / 0 fail / 69 skipped。专项真实MySQL与原Bark测试：2 pass / 0 fail / 0 skipped。原Bark夹具改用实际白名单PROVIDER_TOKEN_EXPIRED并传递领取轮次；其余11条旧失败的正式夹具未在本轮改动，不宣称整个MySQL大套件已全绿。

命令（v1目录、仅本机step6_jfix库）：

```sh
ALERT_TEST_DATABASE_URL='<本机step6_jfix连接串>' \
TEST_DATABASE_URL='<同库连接串>' \
node --test --test-concurrency=1 --test-name-pattern='incident-aware|Bark notification claims' \
  test/alert-reopen-mysql-integration.test.js test/mysql-integration.test.js
npm test
```

另外三份现有1440几何契约（卡片A/CDK A/工作台营业条乙-3）全部通过；CSS棘轮、文案检查、git diff --check通过。没有新CSS或重新设计页面。临时8805实例仅连接本地克隆库step6_jfix_ui，Provider读写关、无worker；8804用户演示未重启。

### 发布前新增注意事项

- 生产需单独确认055、056及**新增057**，不能只按旧计划应用两份迁移。057是两列+一个数据库触发器；需核实迁移账户TRIGGER权限、备份触发器和数据库迁移中断恢复方式。禁止在未知权限下试写生产。
- 先应用迁移再切匹配的新应用，尤其bark通知进程必须换到新代码；旧版本不按轮次处理，回滚旧版本会重新失去本修复保证。
- incident_version默认为1，不为历史已解决重开事件补造轮次；迁移前已经漏掉的历史通知不保证自动补发。发布时应只读核对当前OPEN告警及对应通知，有疑点交用户决定，不批量重推。
- 同一轮投递仍是现有有界重试/租约语义，不承诺跨网络故障“绝对只发一次”；本次防止的是“新轮次完全漏发”和“旧轮次覆盖新轮次”。
- 无卡Session恢复后分卡排程、真实卡网/付款、生产release与服务现场等原未覆盖项仍保留。修复这四项不等于生产全面放行。

技能使用范围：impeccable/UX指导仅用于明确错误状态、保留恢复操作和局部文案；context-handoff更新交接；delivery-commitment-check逐项对照四项证据，没有将未跑的69项算通过。
