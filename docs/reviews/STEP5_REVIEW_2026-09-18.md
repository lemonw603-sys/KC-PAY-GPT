# V2 第⑤块审查：通知白名单与日对账

截至 **2026-09-18 09:51:49 UTC（17:51:49 UTC+8）**。本地 commit `31b56398630c9a92f37da6f39d335058ff84737f`；现场 release `20260918-step5-740bc1d`；范围为第⑤块（面四①③，审查板块 B/E/F 交界）。审查员只读业务与生产，仅写审查材料，不修改处置记录、交接、代码或部署。

## 总评

**建议暂不把第⑤块作为已验收底座交给第⑥块。不是全部推倒：白名单集中化、入队/复活/领取三处过滤、发布重启 Bark 的修复值得保留；主要问题在对账判据与告警生命周期。**

这次实现把若干“尚不知道”过早改写成业务结论：额外扣款被认作待登记、不同来源的 funded_amount 被认作累计入金、同一次数据再次读取被认作第二次对账。测试多数确认了这些既定结论，却没有验证结论的业务前提。

发现 **9 条（7 条 P1、2 条 P2）**。其中 F-47 是执行者已修本地但尚未发布的已知问题，不冒充新发现。没有证据证明已经发生重复扣款、资金损失或客户受损。

### 已核实的正面结果与范围

- 09:47:08 UTC，web / worker / bark 为 active，PID 分别 `1202546 / 1202551 / 1202626`，cwd 均为 `/opt/pojia/releases/20260918-step5-740bc1d/v1`。**Bark 跟随本次发布生效属实**；不据此追认历史“五天静音失效”的全部因果。
- 日对账 service `Result=success`，首次执行时间 `08:29:38 UTC`；心跳 `08:29:39.596Z`。现场 next timer 为 `2026-09-19 04:07:59 UTC`，不是文档中的 04:01:19（unit 有随机延迟）。
- 已发汇总：`DAILY_RECONCILIATION_SUMMARY / OPEN / info / SENT / 08:29:42.494`。新 token/fault/chargeback 类型此次查询没有样本，不能说端到端已验证。
- 本地与生产 `daily-reconciliation-service.js` SHA256 相同：`57477df2e555b781731899a4689863c57751ba4d2dae38e4818b3b65883717f9`。
- `state-check.sh` 本次11项一致；它未检查对账判据、押金修复是否发布或交接语义，因此全绿不能反证下述发现。
- 重新跑第⑤块四份针对性测试：**42/42 通过**。v1 全量：**885 项、819 通过、0 失败、66 跳过**。未跑真实数据库集成、未调用实际付款或开卡。

## 发现

### F-47 生产仍含押金重复扣减，本地修复尚未生效
- 板块 / 严重度：B/F / **P1 功能错误**（已知问题的部署复核）。
- 观察：现场 release 仍为 `740bc1d`。生产纯函数输入 `availableBalance=76, heldBalance=1061.44, amount=50, feeCents=50, floor=20`，输出 `ok=false, projected=-1035.94`；本地同输入输出 `ok=true, projected=25.50`。
- 结论：D-273 撤回 D-272②后，正确规则是余额−金额−手续费≥floor。修复 commit `31b5639` 未进入运行版本；恢复真实缺卡需求时仍可能被错误钱包预检挡住。
- 证据：`git show 740bc1d:v1/src/services/highvcc-card-service.js` 197–203 行将 `usdDeposit` 映射为 heldBalance；该版本 `card-open-adapters.js:94` 传入预检；当前 `v1/src/services/card-supply-scheduler-service.js:168-179` 已去掉扣减。09:47 SSH 现场日志统计：发布后 **76 条 reason=NO_DEMAND**。
- 影响条件：highvcc 出现开卡需求并走到旧版钱包预检。以上金额为隔离纯函数输入，不冒充本次读取的真实钱包字段。
- 反证或不确定性：所查时段未见实际执行该错误分支；不能声称已经阻塞真实订单或“永远开不了卡”。
- 参考验证办法：在生产 release 目录只 import walletPreflight，用上述输入打印；再在本地同样执行比较。不要启动供卡 runner 验证。
- 建议：把现有修复作为独立发布候选，按既有发布确认流程处理，不与后续 UI 大包捆绑。
- 置信度：高。

### F-48 所有额外扣款都降为“待登记”，重复扣款也不会成为差异
- 板块 / 严重度：B/E / **P1 功能错误**。
- 观察：`providerCharges > ledgerConsumed + ledgerReconciliation` 无条件返回 `PENDING_MANUAL_REGISTRATION`；isRealDiscrepancy 不含该值。没有人工登记证据、已知手动交易清单或订单对应关系参与判定。汇总文案直接写“多半是手动用卡”。
- 结论：D-272③允许**运营手动用卡**暂列待登记，不等于确认所有多出来的交易都是手动。代码把“需要解释的扣款”整体排除，损害对账发现额外扣款的能力，也违反“不猜原因”。
- 证据：`v1/src/services/daily-reconciliation-service.js:104-109,55-60,284-285`。纯函数复现：入金50、余额20、两笔15的 COMPLETE、账本 CONSUMED=1 → `count=PENDING_MANUAL_REGISTRATION, amount=MATCHED, flagged=false`。生产只读报告当前列7张待登记；账本 `docs/V2.0_EXECUTION.md` 第⑤步 E.8 自己注明0237/8590原因未知。
- 影响条件：多扣一笔且余额正常减少；金额公式会对得上，次数告警又被消音，连续多少次报告都不会升级这类差异。
- 反证或不确定性：已知3336人工20X确实应待登记；本次不认定生产7张中任何一笔是重复扣款。它们仍在报告显示，并非数据库数据被删除。
- 参考验证办法：附录最小复现A；将同样交易标识经人工确认后再做对照，验证仅已确认手动交易被豁免。
- 建议：区分“已确认手动、待补登记”与“无主扣款待核实”；后者保留差异属性。新增更宽豁免若是业务意图，需明确讨论而非用分类代码代替决定。
- 置信度：高。

### F-49 金额公式缺少可靠起点，把首次导入余额与全历史消费混算
- 板块 / 严重度：B/E / **P1 功能错误**。
- 观察：导入新卡时 funded_amount/current_balance 两列同时写 `item.balance`，也就是当时的快照余额；日对账读取全部历史交易，却直接计算 funded_amount−全部扣款。若结果负数就标 `FUNDING_SOURCE_INCOMPLETE` 并排除差异，非负则继续输出 MATCHED/AMOUNT_DIFF。
- 结论：该字段不能跨所有卡源直接充当“累计实际入金”。“余额+历史扣款”只是恒等式倒推，不是独立的开卡入金凭证；D-274据此称1657/3159“不是资金问题”的结论证据不足。
- 证据：`v1/src/services/manual-card-import-service.js:212-220`；`v1/src/services/daily-reconciliation-service.js:111-131,187-191`。09:47:33 UTC原始SQL：1657=`funded50 / balance1.80 / purchase47.20`，3159=`50 / 1.05 / 47.25`。09:48:36 dry-run仍报 `-1.00/-1.70`。
- 影响条件：卡在发生消费后导入、历史有充值/返还、或起始金额并非卡内实际入账金额。若 funded 尚大于历史支出，也不会触发“不完整”保护，仍可生成假差异。
- 反证或不确定性：新开卡且已证明初始入账及流水覆盖完整时，简式可成立。1657/3159具体差额原因仍未证实，不能凭公式排除真实费用、漏记现金流或其他原因。
- 参考验证办法：取“首次导入余额40、导入前已消费10、之后无变化”的夹具；当前算法会再扣那10。以真实导入批次时间、开卡凭证核对交易覆盖起点。
- 建议：金额对账先要求可验证的期初余额/时点，只对之后的卡内现金流；缺期初的卡显示“无法核对”，不要报已匹配或资金异常。逐卡修复基准须有独立证据，不能用差额反向凑平。
- 置信度：高（公式前提缺失）；两张真实卡差额根因未知。

### F-50 只读报告第一次刷新就变成“连续两次”，第⑥块会提前拉入处理队列
- 板块 / 严重度：E / **P1 功能错误**。
- 观察：persist=false只阻止写入；persistent仍用“当前指纹是否出现在最后一次报告”计算，不检查两个正式批次。后台 GET 正是 run({persist:false})。
- 结论：一次正式对账后，任何只读查看就把该次差异当成再次出现。第⑥块任务书明确消费 `discrepancies[].persistent`，因此这不是纯文案瑕疵。
- 证据：`v1/src/services/daily-reconciliation-service.js:221-239,264-268`；`v1/src/server.js:260`；`v1/src/app/create-app.js:617-621`；`docs/tasks/2026-09-18-impl-step6-workbench-and-settings.md:18,65`。**生产实证**：保存的唯一批次时间08:29:39；09:48:36的只读dry-run返回 `persistentCount=2`，1657/3159均true，距离首跑仅79分钟，第二日timer尚未运行。相同时间的内存复现也得到0→1。
- 影响条件：首个正式批次有差异，随后GET/dry-run读取；或同日人工重跑。
- 反证或不确定性：本次只读命令未改变数据库、未产生critical手机推送；原有08:29通知仍info。当前第⑥块UI尚未接，不声称已误显示给客户。
- 参考验证办法：附录A；生产只运行 runner --dry-run，比较心跳、保存批次与返回的persistent，不启动timer。
- 建议：正式批次负责推进连续性，GET只读该批次已有结论；批次要有幂等周期标识。“连续两次”不能由多调用两次函数实现。
- 置信度：高，生产只读已复现。

### F-51 对账没有输入新鲜度与同一快照保障，旧数据可以重复“确认”异常
- 板块 / 严重度：B/E / **P1 功能错误**。
- 观察：服务仅并行读取本地cards、transactions及上次指纹；不读交易同步成功状态/覆盖区间，last_synced_at只输出不参与判定。余额与交易也不是在同一数据库一致性快照读取。即使两轮没有任何新卡台数据，仍可升级persistent。
- 结论：两次程序运行不能证明两次有效核验。token过期、同步局部失败时尤其可能把同一份不完整数据反复升级，而不是说明无法核对。
- 证据：`v1/src/services/daily-reconciliation-service.js:174-198,221-239`；`v1/scripts/sync-highvcc-snapshot.mjs:58-83`将snapshot/wallet/transactions分别try/catch；`highvcc-snapshot-sync-service.js:292-320`交易同步不更新卡余额。附录A使用2026-01-01的余额快照，照样给persistent。
- 影响条件：同步失败/停滞、两路更新相错，或日对账恰逢交易与余额更新过程。
- 反证或不确定性：不同时间戳本身不证明数据已错；highvcc无余额变化时可跳过快照写入。不能只用“旧last_synced_at”粗暴判过期，需真正的成功同步水位。生产本次的两条差异不据此定因。
- 参考验证办法：保持交易和余额不更新，跨两个正式周期运行；再只让余额成功更新、交易失败，验证不得输出已核验资金异常。
- 建议：定义可核对的输入条件（成功同步水位、覆盖完整性、可比较时点）；数据不足返回待核实，不推进异常连续次数。
- 置信度：高（控制缺失）；实际误报频率未测。

### F-52 “每日汇总模式”只实现静音，没有余额变化汇总
- 板块 / 严重度：E / **P1 功能错误**。
- 观察：DAILY_DIGEST唯一行为是从推送白名单移除PROVIDER_BALANCE_CHANGED。日对账服务无余额变化告警/钱包快照聚合查询，summaryMessage只输出差异、待登记、入金缺失、待销。没有余额变化汇总发送者。
- 结论：D-249“每笔推、可设每日汇总”只实现了关掉前半条，尚无替代通知；不能把该选项称为完整功能。
- 证据：`v1/src/domain/alert-push-policy.js:69-82`；`v1/src/services/daily-reconciliation-service.js:249-261,280-291`；`v1/scripts/daily-reconciliation-runner.js:35-44`。检索 `provider_balance_change_push_mode|DAILY_DIGEST|countPushesByType`，除策略/入队与测试外无汇总消费逻辑。
- 影响条件：设置值为DAILY_DIGEST。没有其他差异、待登记、待销时，连普通汇总也不会产生。
- 反证或不确定性：09:47生产设置查询无该键，当前默认EACH，不声称已漏推生产余额变化。成功数“进入每日汇总”的代码注释也未实现，但用户是否要求成功日报需另核，不作为独立缺陷。
- 参考验证办法：只造余额变化、设DAILY_DIGEST、无其他异常的隔离场景，应有一条汇总且无即时推送；当前只有后者。
- 建议：补齐每日聚合发送与日期去重后再开放该选项；此前不要把静音包装成汇总。
- 置信度：高。

### F-53 金额对账把负余额取绝对值，能把真实20美元差额算成一致
- 板块 / 严重度：B/E / **P1 功能错误**。
- 观察：funded_amount和current_balance与消费金额共用absoluteAmountCents。入金50、消费40、实际余额-10时返回 `balance=10.00, expected=10.00, delta=0.00, MATCHED`。
- 结论：流水消费符号归一规则不能推广到余额；负债/透支变成正余额，观察与判断均被改写。
- 证据：`v1/src/services/daily-reconciliation-service.js:111-112,129-131`；`v1/src/domain/card-transaction-audit.js:50-55`。附录A原函数可复现。
- 影响条件：输入有负余额或负起始额。
- 反证或不确定性：本次未证明生产存在负余额卡；不影响当前1657/3159正余额计算。
- 参考验证办法：50−40应剩10，对余额-10应差-20；附录A打印当前错误返回值。
- 建议：区分消费方向归一与有符号余额解析，使用十进制定点/整数分；不接受的负输入也应明确标未知，不能abs后算成功。
- 置信度：高，离线复现。

### F-54 日报恢复时关的是今天的key，昨天的告警不会消失
- 板块 / 严重度：E / **P2 与预期生命周期偏差**。
- 观察：每天用新日期dedupe_key；正常时resolveSupplyAlert却仍传今天的key。注释称“把昨天那条收掉”，实际没有匹配昨天。
- 结论：异常已消失，旧日报仍OPEN；持续异常则每天累积一条OPEN。既有后台/未来队列若按OPEN聚合，会显示过期状态。
- 证据：`v1/scripts/daily-reconciliation-runner.js:33-48`。读取原runner、仅注入内存依赖执行：09-18差异1 → `daily-reconciliation:2026-09-18 OPEN`；09-19差异0 → 同一行仍OPEN。
- 影响条件：跨天日报。无需真实付款。
- 反证或不确定性：当前只正式跑了一天，还未现场观察多天堆积；是否进入第⑥块队列取决于实现。历史日报应可保留，但历史记录不等于活动异常。
- 参考验证办法：两天隔离运行，第二天无差异，查询前一天的status。
- 建议：分开日报留档与当前待处理状态，明确关闭被替代/已恢复的日报，不删除历史发送记录。
- 置信度：高。

### F-55 新增“今天叫了几次”统计用可覆盖的通知行，重复发送会漏计
- 板块 / 严重度：E / **P2 看板数据源偏差**。
- 观察：同一alert通知复活时sent_at被清NULL，再发时覆写；新countPushesByType按现存通知行COUNT。一次失效恢复后当天再次失效推送，同一行只留下最后一次时间。
- 结论：返回的是“目前保留的最后发送记录数”，不是承诺的发送次数。恢复/再失效会改写过去日期的数字；函数名与注释承诺大于数据模型能力。
- 证据：`v1/src/db/repositories/alert-notification-repository.js:30-45,100-106,124-142`。状态顺序 `SENT(t1)→CANCELLED→PENDING(sent_at=NULL)→SENT(t2)`；两次发送、仅一行可COUNT。
- 影响条件：重复使用dedupe_key的token/供给/故障告警恢复后再出现；不影响每单独立key只发一次的统计。
- 反证或不确定性：复活机制是旧机制，缺陷是第⑤块新增计数把它误当事件日志；未统计生产实际少算次数。
- 参考验证办法：隔离库同一key完整跑两个失效期并markSent两次，countPushesByType应为2；再跨日期测试历史数字不应消失。
- 建议：按不可覆盖的成功投递事件统计；若暂不增加事件存储，则明确改名为“告警种类/实例数”，不要对外承诺发送次数。
- 置信度：高。

## 修改建议：先纠正业务判据，再补UI，不建议整体重写

1. **独立处置已知生产缺陷**：F-47已有本地修复；是否发布由用户当次确认，不由审查员执行。
2. **先定三条最小契约**：什么证据允许认作手动消费；什么证据允许做金额核对；什么才算第二次有效日对账。F-48/49/50/51落实后，第⑥块才能可靠消费该接口。
3. **再补通知闭环**：F-52余额汇总、F-54跨天恢复、F-55发送历史，外加F-53金额有符号解析。
4. **验收换成反例链路**：一单两笔扣款、消费后导入、负余额、首跑后立即GET、同步失败跨日、正常日只有余额变化、异常次日恢复、同key一天推两次。不用“总测试数更多”替代这些场景。

上述是审查建议，未获用户确认的实施设计不写入项目决策或后续任务。

## 附录A：不接数据库的最小重放

从 `/Users/lemon/code/AI充值业务` 执行以下命令。仅import纯函数、用内存query替身验证服务控制流；不是数据库集成证据。

```bash
node --input-type=module <<'JS'
import {reconcileCard,createDailyReconciliationService,isRealDiscrepancy}
  from './v1/src/services/daily-reconciliation-service.js';
const card={id:'review-card',last4:'0001',funded_amount:'50',current_balance:'20',
  inventory_status:'AVAILABLE',last_synced_at:'2026-01-01',
  ledger_consumed:1,ledger_reconciliation:0};
const tx={card_id:card.id,transaction_type:'PURCHASE',status:'COMPLETE',amount:'15',currency:'USD'};
const r=reconcileCard({card,transactions:[tx,{...tx}],ledgerConsumed:1});
console.log('EXTRA_CHARGE',r.count.finding,r.amount.finding,
  isRealDiscrepancy(r.count.finding)||isRealDiscrepancy(r.amount.finding));
let previous=null;
const pool={query:async(sql,args=[])=>{
  if(sql.includes('SELECT c.id, c.last4'))return [[{...card,current_balance:'34'}]];
  if(sql.includes('SELECT card_id, provider_transaction_id'))return [[tx]];
  if(sql.includes('SELECT setting_value FROM app_settings'))
    return [[...(previous?[{setting_value:JSON.stringify(previous)}]:[])]];
  if(sql.includes('INSERT INTO app_settings')){
    previous=JSON.parse(args[1]);return [{affectedRows:1}];
  }
  if(sql.includes('SELECT c.id, c.provider_account_id')||sql.includes('FROM card_state_events'))return [[]];
  throw new Error(sql);
}};
const svc=createDailyReconciliationService({pool,clock:()=>new Date('2026-09-18T08:29:39Z')});
for(const persist of [true,false,false]){
  const x=await svc.run({persist});
  console.log('SAME_INSTANT',persist,x.persistentCount,x.cards[0].lastSyncedAt);
}
console.log('NEGATIVE_BALANCE',reconcileCard({
  card:{...card,current_balance:'-10'},transactions:[{...tx,amount:'40'}],ledgerConsumed:1
}).amount);
JS
```

本次输出：`EXTRA_CHARGE PENDING_MANUAL_REGISTRATION MATCHED false`；同一时间三次run依次`persistentCount=0/1/1`；负余额输出`MATCHED / balance10.00 / delta0.00`。

### 生产只读验证的实际命令

```bash
ssh -o BatchMode=yes root@144.34.180.184 'readlink -f /opt/pojia/current; for s in pojia-web pojia-worker pojia-bark-notifications; do systemctl show "$s" -p MainPID -p ActiveState; p=$(systemctl show "$s" -p MainPID --value); readlink -f /proc/$p/cwd; done'
browser-mvp/scripts/prod-query.sh "SELECT setting_key,setting_value FROM app_settings WHERE setting_key IN ('daily_reconciliation_last_report','daily_reconciliation_heartbeat_at','provider_balance_change_push_mode')"
ssh -o BatchMode=yes root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1; node scripts/daily-reconciliation-runner.js --dry-run'
```

最后一条09:48:36 UTC输出摘要：`dryRun=true / cardCount=30 / discrepancyCount=2 / persistentCount=2 / pendingRegistrationCount=7 / fundingIncompleteCount=3`。不带--dry-run会写报告、心跳和告警，本次未执行。

### 交付核对

| 本次承诺 | 状态 | 证据 |
|---|---|---|
| 核对第⑤块实现及既定方向 | 已做 | 9条发现及代码/决策边界 |
| 不只靠旧报告，核生产实际版本 | 已做 | SSH、SQL、dry-run、文件hash |
| 最小反例验证 | 已做 | 42针对性测试；附录反例；原runner内存重放 |
| 审核与修改建议落盘 | 已做 | 本文件及REVIEW_RECORD追加索引 |
| 修改/部署/真实付款 | 未做，非本次请求 | 仅审查材料有仓库写入 |

## 未能核实的事项

- 1657/3159真实差额根因、highvcc deposit字段含义；不接受“能倒推出差额”作为原因证明。
- 新拒付/token/fault产生点的真实故障端到端推送；卡台拒付/拒付费用实际扣卡余额还是钱包。现代码把两者全部算卡内支出，已有样本status写“已扣账户余额”，应先核外部合同，不能凭字段名定。
- token的“每日时段外不碰highvcc、突发缺卡才叫一次”与每小时snapshot失败即叫人的契约一致性，需再审上游调度；本批未列为已复现的独立发现。
- 真实数据库重放、并发竞态发生率、新版真实订单全链路。

## 与事实源冲突但无法判断谁对

- D-274宣称“不是资金问题”，但没提供独立入金/扣费证据。本次只确认公式缺可靠前提，不能判真实差额属于哪类。
- HANDOFF_NOW仍写“⑤全部完成”、押金应扣；最新D-273已撤回并记修复未发布。这里是可确认的文档过期，不是两种事实任选其一。审查员不代改事实源，由执行者更新。
- D-272“这类扣款”是否意在把所有无法解释扣款长期豁免，文档不足以支持；F-48按已确认手动消费解释，若用户确实要更宽豁免，应明确风险和边界。

## 本次未覆盖范围

第⑥块UI、Pro、客户页、删表、付款核心、Browser真实操作、全生产基础设施及所有历史缺陷；未调用新外部卡台API、未写生产、未重启服务、未启动worker。不是全项目安全审计或整套V2验收。
