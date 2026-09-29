# 日常运维手册（RUNBOOK）

> 只写"怎么做"，每步一条命令；"为什么"在 `DECISIONS.md`，"现在什么状态"在 `CURRENT_STATE.md` / `HANDOFF_NOW.md`。维护窗口、备份恢复、执行迁移见 `PRODUCTION_PREP_RUNBOOK.md`。所有命令在本机仓库根目录执行；生产主机 `root@144.34.180.184`（SSH 免密）。

## 0. 充前自检（任何动作前）

```bash
browser-mvp/scripts/ready-check.sh            # 只体检
browser-mvp/scripts/ready-check.sh rehearsal  # 演练：要求付款开关=false
browser-mvp/scripts/ready-check.sh pay        # 真付：要求付款开关=true
```
检查并自动修复：SSH 隧道 13306、mihomo（菲律宾出口 38.60.246.34）、比特浏览器（未开会自动启动）、生产服务、残留 worker、付款开关、账号槽、可分配卡数、占卡的非终态单。全绿再往下。

## 0.5 每周自检（D-352「可离开」四条之一，2026-09-24 起）

```bash
scripts/weekly-check.sh
```
一条命令、约 1 分钟、只读：事实表比对、三进程是否跑在当前 release、九个定时器、日对账结果、备份年龄、磁盘、一周 err 日志；生产数据走正式规则（「需要我处理」数、付款不明未收口、等 Session 超期未收口、24h 没动静的单、任务积压、开关、心跳、可分配卡、可分配卡的账外扣款〔D-403〕、钱包快照年龄、近 7 天订单）；本机常驻池 / supervisor / 菲律宾出口 / 比特浏览器 / Bark / 代码同步。
`[失败]` 当天处理，`[提醒]` 逐条看过。查不到一律报失败，不当通过。服务器侧探针 `v1/scripts/weekly-readonly-probe.mjs` 每次临时拷过去跑完即删。

**失败原因**（D-393）：后台「诊断」页「失败原因统计」，默认近 7 天、演练单不计入；点原因看是哪几张单和原话。原话是执行时记下的（导航失败自 09-25、付款段自 09-16）；标「订单说明」的是订单上写的说明；「只有代码」表示当时没记原话。导航失败还可按「现场」目录名在本机 `~/Library/Application Support/pojia-browser-live/evidence/` 看截图与 trace（14 天自动删）。

## 1. 来单（真实付款）

**2026-09-25 起来单全自动（D-383）**：本机常驻付款池（`~/pojia-pool/current`，LaunchAgent `com.pojia.browser-pool` 常驻）自己领单、付款、确认 Plus、取消续费。**不要运行 `go-live.sh` / `stop-live.sh`**：它们是常驻池之前的旧入口——`go-live.sh` 会从 main 工作区另起一个付款进程（与常驻池同时付款，代码可能没演练过）；`stop-live.sh` 会停掉所有付款进程，且用只读工具写库。5x / 20X 路线关着（D-245 / D-370）。

用户侧：卡准备好（Plus ≥ $16；highvcc 卡由 `pojia-highvcc-snapshot-sync.timer` 每小时同步进库，急用 `ssh root@144.34.180.184 systemctl start pojia-highvcc-snapshot-sync.service`；其他来源走后台上传 Excel）→ 客户页提交 CDK + Session → Bark 推「客户提交了充值」。

执行者（只看，不动手）：
```bash
browser-mvp/scripts/ready-check.sh pay     # 池在跑时「有残留 worker」那条就是它本身，属预期
scripts/pool-release.sh status             # 池跑哪份代码、worker 在不在
tail -f "$HOME/Library/Application Support/pojia-browser-live/supervisor.log"
```
Plus 单：付款 → 确认 Plus → 自动取消续费；若「取消续费需复核」，用户在账号里关掉后点「已在账号里取消续费」。导航失败会在本机留证据目录（`evidence/`，fail-closed 事件里的 `evidenceRef`）。

**紧急停**（替代 `stop-live.sh`）：①只对池 worker 发 SIGTERM（pid 看 `scripts/pool-release.sh status`；它在当前步骤结束后退出，supervisor 60 秒后重查开关）；②60 秒内正式路径关付款开关：
```bash
ssh root@144.34.180.184 'cd /opt/pojia/current/v1 && set -a && . /etc/pojia/runtime.env && set +a && node --input-type=module -e "import {loadRuntimeDatabaseConfig} from \"./src/config.js\"; import {createDatabasePool} from \"./src/db/pool.js\"; import {createAdminOperationsService} from \"./src/services/admin-operations-service.js\"; const pool=createDatabasePool(loadRuntimeDatabaseConfig(process.env)); try { console.log(JSON.stringify(await createAdminOperationsService({pool}).setBrowserPaymentWrites({enabled:false, actorId:\"<谁>\"}))); } finally { await pool.end(); }"'
```
恢复＝同一命令 `enabled:true`（supervisor 60 秒内拉起），然后新连接复核开关 + `pool-release.sh status` + 心跳。**点付款后 10 分钟内不许紧急停、不许 kill worker**（见下③）。等待循环的命令行别含池进程名（D-373）。

**硬规则（D-139，09-09 真单教训）**：真单自动化**失败一次**（run 失败、或**付款点击之前**任何一步卡超过 5 分钟）→ 立刻「紧急停」，把窗口交给用户手动充，**事后再查**，不在真单上边修边试。点击付款之后另有规矩，见下面③。用户手动充完后收口：
```bash
scp v1/scripts/close-manually-fulfilled-order.mjs root@144.34.180.184:/opt/pojia/current/v1/scripts/   # release 包里没有时
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/close-manually-fulfilled-order.mjs <PUBLIC_NO> --dry-run'
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/close-manually-fulfilled-order.mjs <PUBLIC_NO> [--card-used]'
```
（守卫：系统有任何付款痕迹即拒。默认视为分配的卡**没用**→释放；手动用的就是这张卡则加 `--card-used`→账本 CONSUMED、卡 DEPLETED。订单 RECHARGE_SUCCESS、CDK 保持已用、取消续费留「已在账号里取消续费」复核。）403 根因 09-09 已定位修复（D-140），真单未验。

**失败应对（按发生阶段，2026-09-10 定，真单前必读；2026-09-26 按当前代码复核①②③末段、客户被打回、测试账号收口两条）**：
- **①预检失败**：D-158 起不再有单独的预检任务，预检并进付款 run（`order-intake-repository.js:329`，最后一条 BROWSER_PREFLIGHT 是 09-11），按②处理。
- **②付款前失败**（live run 已起、未点击）：常驻池会**自己**安全中止——卡类/租约问题回 CARD_READY 重试；其余一律 RECHARGE_FAILED + CDK 退回 + 卡释放（审计 F-4）。付款前挂住没人处理：D-390 起当场判失败 + 退卡密 + 推手机；还挂着的用后台订单抽屉「放弃并放卡」（D-394，`/abandon-pre-payment`）。用户若手动充了：后台订单抽屉「标为已手工充值」（`/manual-fulfilled`，与上面脚本共用 `manual-fulfillment-service.js`）；RECHARGE_FAILED 的单也接（重新绑回原卡密，不接受 `--card-used`，卡密已被别单占用或作废则拒）。
- **③点击付款之后**（run `payment_state` 不是 NOT_STARTED/ARMED；`browser_operations` 出现 `PAYMENT_SUBMIT`）：**任何人都不许手动重付**，并且 **10 分钟内不得紧急停、不得 kill worker**（点击后 worker 自己核实最多 5 分钟，不明后再由核实 lane 核实 5 分钟；kill 会让 run 停在 PAYMENT_SUBMITTING、没有任何自动核实，审查 F-26）。等自动核实：账号仍 free → 判拒付 → RECHARGE_FAILED 放卡；确认 Plus → 取消续费 → 成功；核实到期 → run HUMAN_REQUIRED + 对账 case，订单停 RECHARGE_PROCESSING；到账号里看清是否 Plus、卡台是否扣款后，后台「确认核实结果」（`RESOLVE_UNKNOWN_PAYMENT`，`browser-admin-service.js:559`）选 CHARGED / NOT_CHARGED，CHARGED 时可同时勾「续费已取消」，不勾则进取消续费待确认。**这一路生产上没有真单走过。**
- **客户被打回**（WAITING_FOR_SESSION）：客户页有「更换账号」表单（`customer.js:146`、`:475`，限时、限次，过期或用完提示「保留卡密联系商家」），走 `POST /api/v1/orders/session`；F-34 / F-35 09-10 已修（事实表「已知未修」⑦）。**「打回 → 客户重贴 → 再跑」没有真实客户走过**（`UNVERIFIED_LEDGER.md` 客户链）。客户页用不了时的兜底：客户把新 session JSON 交给用户，执行者在服务器本机替客户提交同一接口（body `{"publicNo":"<单号>","session":<JSON>}`，对 127.0.0.1:3100 发、Host 头用客户页域名，见 `/etc/pojia/runtime.env`）。
- **跑单纪律**：跑单期间客户不要使用该账号；不要把该账号登进任何其他比特浏览器窗口（同一账号两处登录会挤掉注入的 session，09-07 观察到）；跑单期间**不在后台首页关"浏览器真实付款"开关**（中途关开关会把正在跑的单判成 RECHARGE_FAILED 并退码放卡，审查 F-25）；常驻池不用「收工」，要停只用上面的紧急停。

**测试账号单失败后的收口（2026-09-11 核对代码与生产；测试单不手动充，收口后另一个账号重新提交新单）**：
- 订单 CARD_READY、卡已绑定、还没起 run：后台「取消」（`order-cancellation-service.js` untouchedCardReady）→ 卡回池、CDK 回 AVAILABLE（09-11 时生产未走过，之后是否走过本次未查）。付款前挂住的用「放弃并放卡」（见上②）。
- 付款前中止（live run 起、未点击）：worker 自动 RECHARGE_FAILED + CDK 退回 + 卡释放（D-131）。生产走过 2 次。
- 拒付（点击后 DECLINED）：run 停 RECONCILE_ONLY/PAYMENT_UNKNOWN → 后台「确认核实结果」选 NOT_CHARGED → 卡释放、CDK 退回、RECHARGE_FAILED。**新按钮生产未点过**（历史 3 次拒付由一次性脚本 `claude-declined-closeout` 收）。
- 换账号 = 新订单：另一个 AVAILABLE CDK + 新账号的 Session；可分配卡数看事实表「可分配卡」行（09-26 为 1 张 8718；9839 已于 09-11 注销，D-163），拒付后若要换卡需补余额 / 开卡（资金动作，先确认）。
- 跑单期间该账号不得在任何其他窗口登录（含上号器手动登录），否则挤掉注入 Session；Session 提交后尽快跑（accessToken 剩余 <5 分钟即拒）。

## 1.A API 路线来单（301：ZZSHU 直充 + 本方卡，2026-09-27 起 Plus 走这条，D-402）

不经本机常驻池（池不用动）；服务器 `pojia-worker` 按单跑（`v1/src/workers/workflow-handlers.js`）：分卡（API 行卡台，现为 highvcc）→ 提交直充（`orders/direct`，**一单只下一次**；建单结果不明 → `SUBMIT_UNKNOWN`，只查不重下）→ 轮询：`success` → 卡记已用；ZZSHU 回报已取消续费则 `RECHARGE_SUCCESS`，否则 `CANCELLATION_PENDING` 由系统复查；`failed` 隔一会儿再查一次仍 failed → `RECHARGE_FAILED` + 推「充值失败，要你处理」。

执行者（只看，不动手）：
```bash
browser-mvp/scripts/prod-query.sh "SELECT public_no, status, failure_code, failure_reason, updated_at FROM orders WHERE public_no='<单号>'"
browser-mvp/scripts/prod-query.sh "SELECT pc.operation, pc.http_status, pc.business_code, pc.outcome, pc.started_at FROM provider_calls pc JOIN orders o ON o.id=pc.order_id WHERE o.public_no='<单号>' AND pc.provider='zzshu' ORDER BY pc.started_at"
ssh root@144.34.180.184 'journalctl -u pojia-worker -f -o cat'
```
- **失败**（含对方要人工安全验证 `verification`——本方没有这一环，对方 120 秒后记失败）：不重付、不换卡。卡先锁在对账、卡密不退，手机收到「充值失败，要你处理」，这单进后台订单页「需要我处理」。到卡台看这张卡：**没被扣钱**（「被拒」不算）→ 订单行点「放卡退卡密」（确认框里可写看到了什么）→ 卡放回、卡密退回、告警关，客户用原卡密重兑；卡台有被拒记录的，约 1 小时内 highvcc 同步也会自动放卡（告警一起关）；**系统已看到成功扣款**的单不给放（按钮变「去核实」），先查清是不是这一单扣的。（D-404，`api-failure-release-service.js`）
- **付款不明**（`SUBMIT_UNKNOWN` / `RECONCILIATION_REQUIRED`）：系统先自己查 ZZSHU；查不清转人工 → 后台订单「去核实」选 扣了 / 没扣（`unknown-submission-resolve-service.js`）。
- **点数**见 §2.75；0 点时系统自动切回 Browser。**切回 Browser**：工作台点「浏览器」（会查池心跳）。

## 1.5 攒数据：自己跑一单 + 看成功率（2026-09-11 12:39 UTC 起）

**不需要事先向任何人登记**：系统每次运行都会把时间线、点击次数、结果、原因落库。跑过就有，没跑就没有。

自己跑一单（客户提交后）：
```bash
browser-mvp/scripts/prod-query.sh "SELECT public_no,status FROM orders WHERE public_no='<单号>'"   # 等到 CARD_READY
# 2026-09-25 起常驻池自动领单付款（D-383），不再手动起 worker
tail -f "$HOME/Library/Application Support/pojia-browser-live/supervisor.log"
```
日志里出现 `需要人工验证` 说明结账页弹了人机验证，去 1 号窗口勾一下复选框，自动化会自己继续。

随时看累计数据：
```bash
browser-mvp/scripts/run-stats.sh        # 逐单明细 + 成功率 + 失败原因分布
```
口径：`OK-auto` 才算系统自动跑完（系统自己确认过 Plus 且该次运行没有任何人工操作）；`OK-manual` 是人工收口的，不计入。判断能不能上量，看「点过付款的单里系统自动跑完的比例」这一行。

## 2. 演练（停在付款前，不扣款）

前提：付款开关 = false（`ready-check.sh rehearsal` 全绿）。

**建演练单前先关「下单查执行器心跳」**（D-352 块 3 ②，2026-09-23 起）：常驻池停着时下单入口会拒单（`EXECUTOR_UNAVAILABLE`），演练单建不出来。演练完开回去，`wrapup-check` 会盯这个键。
```bash
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/set-intake-executor-check.mjs off --apply'   # 演练前
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/set-intake-executor-check.mjs on --apply'    # 演练后
```
```bash
# 单单演练（推荐，跑完自动退出，不要用常驻池反复 claim）。<orderId> 是订单内部 id（orders.id，不是 PJV1- 编号）。
# 不要先跑 run-browser-preflight.sh：2026-09-25 实测它会领走已在 RECHARGE_PROCESSING 的演练单，一出错就把单判失败（D-378）。
# 租约要与常驻池一致（脚本默认 60 秒，导航等结账页会超时，D-382）；在要验证的代码所在目录（如块 6 分支工作树）里跑
BROWSER_WORKER_LEASE_SECONDS=900 browser-mvp/scripts/run-live-rehearsal.sh once <orderId>                     # 到零税报价、停在点击前
```
演练后订单按设计回 **CARD_READY 并继续持卡**。若不打算真付这单，必须收口释放卡（否则挡住后续新单）：
```bash
scp v1/scripts/close-rehearsal-order.mjs root@144.34.180.184:/opt/pojia/current/v1/scripts/
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/close-rehearsal-order.mjs <PUBLIC_NO> --dry-run'
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/close-rehearsal-order.mjs <PUBLIC_NO>'
```
（守卫：任何付款痕迹即拒；释放账本/卡分配、订单 CLOSED、退回 CDK。）

## 2.5 供卡（第③步起，2026-09-18）

供卡由 `pojia-card-stock-runner` 一个执行器管两台：每次先按「卡台 × 产品」水位调度，再领一个开卡 job 按该台的适配器开一张（hnskj Open API / highvcc API）。**人工开卡不再 ssh 手跑 runner**。

```bash
# 看现在的水位、可用、缺口、钱包：跑一次执行器（总闸关着只刷告警不开卡）
ssh root@144.34.180.184 'systemctl start pojia-card-stock-runner.service; journalctl -u pojia-card-stock-runner -n 3 --no-pager'
# 水位 / 开卡金额 / 每日上限 / 卡段（按台按产品；第⑥步设置页做出来前只能查库改库）
browser-mvp/scripts/prod-query.sh "SELECT * FROM card_supply_policies"
# 卡台钱包底线 / 告警线 / 故障态
browser-mvp/scripts/prod-query.sh "SELECT id, open_adapter, default_card_segment, wallet_floor, wallet_alert_threshold, supply_fault_state, supply_fault_reason FROM provider_accounts WHERE purpose='CARD'"
```

- **自动开卡总闸** = `card_auto_replenishment_enabled`（只开这一个；后台「开启」按钮会连补余额一起开）。timer 启用后每 60 秒一轮，一轮最多建一张卡的 job。
- **hnskj 人工开一张**：后台「人工开卡」建 job（或 `createJob`），然后 `systemctl start pojia-card-stock-runner.service`（timer 启用后不用手动）。
- **highvcc**：时段内先贴 token，钱包要 ≥ 底线 20 + 开卡金额 + 手续费估计（无观察时按金额 10% + $1）；后台「备用卡台 A 开卡」仍可同步直开。
- **开卡失败**：job 进 `REVIEW_REQUIRED`（可能已扣款）→ 推手机 `CARD_SUPPLY_OPEN_FAILED`，人工核对前调度器不再自动开；该台标 `supply_fault_state=FAULT`，15 分钟后允许再试；Browser 需求会转另一台开一张顶上，API 需求不转。
- **归档残留**：`node scripts/archive-legacy-card-stock-jobs.mjs [--apply]`（2026-09-18 已归档 965 条）。

## 2.55 运营不在场三件（D-352 块 3，2026-09-23）

- **执行器停摆 → 客户被拒单 + 手机响**：所选路线的执行器心跳超过 120s 没更新，客户提交看到「系统维护，暂时无法接单」，CDK 不消耗；`pojia-operator-watch` 每分钟检查同一心跳，超时开 `EXECUTOR_OFFLINE`（推手机），拉起后自动解除。Browser 路线心跳来自本机常驻池（每 5s），API 路线来自 `pojia-worker`（每 15s）。
- **付款不明不再冻结整条 lane**：只有 RUNNING / RECONCILE_ONLY 且付款在途的 run 占着窗口；`HUMAN_REQUIRED` 的单靠资金栅栏与「同账号只许一个活动 run」隔离，其他客户照跑；同账号新单留在队列，3 分钟后 `BROWSER_ORDER_STALLED` 叫人。人工处理仍走后台「确认核实结果」。
- **排队/备卡超过 3 分钟**：客户页照实显示「排队比平时久，已通知运营」，后台 `BROWSER_ORDER_STALLED` 同时推手机。
- **往卡里补钱后**：下次同步把差额记进 `funded_amount`（`card_state_events` 留 `CARD_TOPUP_OBSERVED`），卡按新余额参与分配。历史上已补过钱、`funded_amount` 落后的卡用一次性脚本抬平：
  ```bash
  ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/backfill-card-funded-amount.mjs'           # 预览
  ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/backfill-card-funded-amount.mjs --apply'   # 真写
  ```

## 2.56 一卡三单、付款前补钱（D-411，2026-09-30 代码完成，未发布）

- **怎么跑**：Plus 新单分卡时先挑现成能付的卡（用过的优先）；没有时，挑一张「用过 1～2 单、卡台能补钱、钱包够补」的旧卡，订单进 `CARD_PROVISIONING`（后台「给卡补钱中」，客户页「正在准备支付卡」），往卡里补 $16（＝设置页「每单记账金额」），**卡详情读到到账才付款**。第 3 单付完进待销清单。
- **开关**：不另设开关，归「自动开卡」总闸（`card_auto_replenishment_enabled`）。关总闸＝不再补钱、旧卡不算可分配、已排队没发出的补钱也不发（订单换卡）；已发出去的照样核对到底。
- **钱包**：补钱前实时读 highvcc 钱包：余额 − 待发补钱 − $16 ≥ 押金底线（$20）才发。所以钱包 < $36 时旧卡不会被复用（页面写「钱包不够补」）。
- **补钱没成**：钱包不够 / 总闸关了 / token 失效 / 读卡台出错 → 钱没动，订单自动换卡，这张卡停 10 分钟再补；卡台拒了这张卡（回了错误码、3 分钟后流水证实钱没出去）/ 卡对不上 / 人工判「钱没到卡上」→ 这张卡停 24 小时。不叫人。token 失效期间（`PROVIDER_TOKEN_EXPIRED` 告警开着）不挑旧卡补钱。
- **不补的卡**：卡台上这张卡被扣过的次数（成功 + 授权中）比账本记的多＝有人在系统外用过（比如前一位客户），永远不往里补钱；每周只读巡检的「账外扣款」会列出它。每单最多真补一次：一单有过发出去 / 结果不明的补钱，就不再补第二张卡。
- **结果不明**（推 `CARD_TOP_UP_UNRESOLVED`）：订单已自动换卡，卡锁着。到卡台看这张卡余额、账户流水里有没有「Add Balance To Card」，然后在生产主机：
  ```bash
  cd /opt/pojia/current/v1 && set -a && . /etc/pojia/runtime.env && set +a
  node scripts/resolve-card-top-up.mjs --top-up <补钱 id>                       # 先看：读卡台实时余额，打印判断
  node scripts/resolve-card-top-up.mjs --top-up <补钱 id> --arrived --apply     # 钱到了：注资 +16，卡解锁
  node scripts/resolve-card-top-up.mjs --top-up <补钱 id> --not-arrived --apply # 钱没到卡上：卡解锁，去找卡台
  ```
  补钱 id 在告警的去重键 `card-top-up:<id>` 里。脚本读到的余额与所选判断不符时拒绝写库。停在 `PREPARED`（从没发出去、任务死了）的只能 `--not-arrived`；停在 `SENDING` 的脚本先按结果不明落定再了结。
- **兜底**：每分钟巡检发现一笔补钱 15 分钟还没了结、又没叫过人（核对任务丢了），就推同一条 `CARD_TOP_UP_UNRESOLVED`，文案会写客户是不是还在等。
- **发布**：迁移 063（新表 `card_top_ups` + highvcc 补钱能力位）要在 customer-sql-probe **之前**跑（探针里有读这张表的 SQL）：prepare → migrate → probe → switch。worker 不需要新环境变量；迁移没跑时新 worker 拒绝启动（服务不 active，发布核对过不去）。
- **回滚前**（退回没有 D-411 的版本）：旧代码不认补钱任务、旧快照导入会把在途补钱再记一遍注资。先在设置页关「自动开卡」总闸（不再有新补钱），等下面这条查询为 0 再回滚；不为 0 就先用上面的脚本了结：
  ```bash
  browser-mvp/scripts/prod-query.sh "SELECT COUNT(*) FROM card_top_ups WHERE status IN ('PREPARED','SENDING','SUBMITTED','UNKNOWN')"
  ```

## 2.6 待销清单与付款不明收口（第④步起，2026-09-18）

**待销清单**（面二⑩，派生查询，不建表）：口径 = 用满 / 服务过 Pro 单 / DEPLETED 或 FAILED / 已标 RETIRED / 取消续费未确认，且开卡时间 + 最短存活期（`card_min_retire_age_hours`，默认 6，可调）已到。V2 只做手动销卡（D-232）：Lemon 去卡台删，回来登记。

```bash
# 看清单：due = 该去删的；notYetDue = 口径成立但存活期没到；recentlyConfirmed = 最近登记过的
curl -s -b <admin-cookie> https://<admin>/api/v1/admin/card-retirement/candidates | jq '.due, .notYetDue | map({last4, providerCode, reasonLabels, dueAt, sourcePresent})'
# 删完登记（确认词 已销卡 <last4>）：写 cards.inventory_status=RETIRED + override RETIRED + card_state_events CARD_RETIRED_CONFIRMED（带 ageHours）
curl -s -b <admin-cookie> -X POST https://<admin>/api/v1/admin/card-retirement/confirm -H 'content-type: application/json' \
  -d '{"last4":"3241","providerAccountId":"00000000-0000-4000-8000-000000000103","externalCardId":"HG…","confirmation":"已销卡 3241","note":"已在 highvcc 删除"}'
# 改存活期（小时）：
browser-mvp/scripts/prod-query.sh "SELECT setting_value FROM app_settings WHERE setting_key='card_min_retire_age_hours'"   # 改用正式路径（后台设置页第⑥块；之前用 sql 脚本走连接池，先问）
# 两批旧卡标终态（dry-run 默认；--apply 先问 Lemon）：
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/retire-legacy-cards.mjs --batch hnskj-voided'
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/retire-legacy-cards.mjs --batch highvcc-cancelled --last4 a,b,c'
```

- 事后同步确认：highvcc 卡看 `sourcePresent=false`（快照里消失）；hnskj 卡目录快照只给汇总数，看卡详情同步的 `status`。已 RETIRED 的卡快照缺席不会再改回 HELD_FOR_REVIEW。
- 每次登记的 `ageHours` 攒在 `card_state_events`，用来校准卡台真实的可销时间（D-228 补充二）。

**API 付款不明收口**（面三③ 表二，`docs/contracts/2026-09-18_payment-unknown-reconciliation-contract.md`）：`markAttemptUnknown` 后系统自己用两路证据收口 30 分钟；定不了 → 订单 `RECONCILIATION_REQUIRED` + `ORDER_PAYMENT_UNKNOWN_REVIEW`（带两路证据）。人工收口：

```bash
browser-mvp/scripts/prod-query.sh "SELECT public_no, status FROM orders WHERE status IN ('SUBMIT_UNKNOWN','RECONCILIATION_REQUIRED')"
browser-mvp/scripts/prod-query.sh "SELECT dedupe_key, evidence_json FROM reconciliation_cases WHERE case_type='API_PAYMENT_UNKNOWN' AND status='OPEN'"
# 核实后（确认词 已核实 <单号> CHARGED|NOT_CHARGED）：
curl -s -b <admin-cookie> -X POST https://<admin>/api/v1/admin/orders/<PUBLIC_NO>/resolve-unknown-submission -H 'content-type: application/json' \
  -d '{"outcome":"CHARGED","confirmation":"已核实 <PUBLIC_NO> CHARGED","note":"账号已是 Plus；卡台 15.71 已扣"}'
```

**分卡当场同步**（面二⑨，D-266）：候选卡流水超过 15 分钟没同步 → worker 分卡前当场同步这一张（卡详情 1 + 流水 ≥1 页，`provider_calls` 里 `request_key` 前缀 `order-demand-sync:`）；失败 60s 后再试，连续 5 次失败的卡候选查询跳过。定时同步 AVAILABLE 卡降到每卡 3 小时（`scheduled-card-sync`），只排有只读 API 的卡。

## 2.7 推送与日对账（第⑤步起，2026-09-18）

**谁会响手机**：只有白名单里的类型（`v1/src/domain/alert-push-policy.js`），四类——叫人 / 供给 / 资金 / 客户动态。
不在白名单的只进后台，理由逐条写在同一文件的 `NON_PUSH_REASONS` 里。加新告警类型时，**要么进白名单、要么进理由表**。

> **改了推送要生效，必须重启 bark 服务**（D-271）。`pojia-bark-notifications` 是常驻进程，
> `WorkingDirectory=/opt/pojia/current/v1` 在启动那一刻就解析成实目录，之后切 release 它不跟。
> D-176 的静音就是这么「写进 release 五天没生效」的。`deploy-release.sh switch` 现在会一起重启它，
> 并打印 `bark cwd=`；**发布后核对这一行指向新 release**，别只看 web/worker。

**日对账**（面四③）：每天 UTC 04:00 由 `pojia-daily-reconciliation.timer` 跑一次，次数与金额分开。
```bash
ssh root@144.34.180.184 'systemctl list-timers pojia-daily-reconciliation.timer'          # 下次什么时候跑
browser-mvp/scripts/prod-query.sh "SELECT setting_value FROM app_settings WHERE setting_key='daily_reconciliation_heartbeat_at'"   # 上次真跑了没
ssh root@144.34.180.184 'journalctl -u pojia-daily-reconciliation -n 50 --no-pager'        # 上次的报告
```
本机只读跑一次（什么都不写，用来核对）：
```bash
DATABASE_URL=<隧道 13306 的连接串> node v1/scripts/daily-reconciliation-runner.js --dry-run
```
**怎么读报告**（⑤b 收窄后，D-275）：`discrepancies` 才是要看的差异，只有两类——
`UNEXPLAINED_CHARGE`（卡台扣了、账本没记、也没登记手动用卡 = 无主扣款，进报告待核），
以及有可验证期初基准时的次数/金额真差异（`LEDGER_AHEAD` / `UNKNOWN_STATUS` / `AMOUNT_DIFF`）。
下面这些**不是**差异，只列出来：
`pendingRegistration`（已登记手动用卡的卡台扣款，等第⑥块入口回填账本）、
金额 `UNVERIFIABLE`（没有可信的期初入卡金额，本轮金额只对次数——D-274：`funded_amount` 是下单额不是入卡额）、
`AWAITING_RESOLUTION`（账本 RECONCILIATION 占位，等收口）。
**连续两个正式批次都还在**的「够格升级」差异才 `persistent:true` 并把汇总升 critical——
只读 GET / dry-run 不推进连续性（D-275 ③）；无主扣款进报告但不升级（D-275 ②）。

推手机的只有一条汇总（`DAILY_RECONCILIATION_SUMMARY`，固定 dedupe_key `daily-reconciliation`，不按天堆积），
**待销到期数并在里面**，不单推（D-272）。

**运营手动用卡后必须做的一步**（D-275 ②⑦，端点见 F-57 修正）：Lemon 手动拿某张卡给客户付款
（没走 Browser / API）后，要**立刻把这张卡标 RETIRED override**——让系统不再分配它，但它**仍留在
待销清单**（还得去卡台真销卡）。用**运营覆盖端点**（set RETIRED），**别用**「已销卡确认」端点
（`/card-retirement/confirm` 会把 `inventory_status` 也写成 RETIRED、把卡移出待销、误记「已在卡台销掉」，F-57）：
```bash
curl -s -b <admin-cookie> -X POST https://<admin>/api/v1/admin/card-operational-overrides -H 'content-type: application/json' \
  -d '{"providerAccountId":"…103","externalCardId":"HG…","allocationPolicy":"RETIRED","reason":"manual-used: 手动付 20X"}'
```
标完：分配资格 SQL 排除有 RETIRED override 的卡（不再分配）；`inventory_status` 不动，卡仍在待销清单
提醒去卡台真销；日对账按 `manual-used` 把那笔扣款归 `pendingRegistration` 而非无主扣款。真去卡台销掉之后，
再走 `/card-retirement/confirm`（确认词「已销卡 <last4>」）登记外部销卡完成。`reason` 必须带 `manual-used`
英文标识——判据只认它、不认中文「手动」（2026-09-18 只读实查：全部 RETIRED override 里只命中 3336）。
第⑥块把这个入口搬进工作台「卡片」区（不新建表、不收客户/套餐/金额字段）。

## 2.75 直充平台（ZZSHU）点数与 Key（D-400 / D-401，2026-09-27 起）

API 路线 301 = ZZSHU 直充 + 本方自带卡（任何有 API 直充能力的卡台）。ZZSHU 按其发放的 API Key 计点：**开通成功才扣（默认每单 1 点），失败不扣**。

- **看点数**：工作台路线按钮「API 充值 · N 点」（worker 每 5 分钟只读一次；> 999 显示 999+；从没读到就不显示）。现场只读核对（不打印 Key）：
  ```bash
  ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; . /etc/pojia/provider.env; set +a; curl -s -m 20 -H "X-API-Key: $ZZSHU_API_KEY" "$ZZSHU_API_BASE_URL/third-party/user"'
  ```
- **充点（Lemon 手动）**：在 ZZSHU 网站 `/query` 页把买来的点卡充进**同一把** API Key（不要换 Key：换了以后旧 Key 名下的订单查不到）。充完 5 分钟内后台点数更新。
- **推送怎么处理**：
  - `充值成功`（D-409，两条路线都有）：「邮箱 · 产品 · 用时」，每单结束只推这一条，不用处理。巡检每分钟捡一次，最多晚一分钟；推完自动收掉。**来单不再推**（后台照记）；卡住有 3 分钟后的提醒兜着。
  - `highvcc 登录失效`：「HH:MM 起失效，新卡开不出」——到后台「卡片」页贴新 token；保存时当场向卡台验证，通过就关掉它（连同已恢复的「卡台故障」）。一段失效期只推一次；开卡时撞上 token 失效不再另推「卡台故障」。
  - `highvcc 钱包不够开下一张卡`：文案里写着「钱包 $X，开一张要 $Y，还差 $Z」——给 highvcc 钱包充到至少 $Y。被进行中订单占着的卡算水位时当它还在，所以「有卡却催充钱」不会再出现；有客户在等卡时文案会多一句「有客户在等这张卡」。
  - `直充平台点数快用完了`（≤5）：去充点。
  - `直充平台点数用完了`（0）：若 Plus 正走 API，系统已用正式切路线服务切到 Browser（审计 `system:zzshu-points`）；切不过去（Browser 不在线 / 没卡）时 API 新单被拒（客户看到暂停接单）——充点，或把 Browser 拉起来。
  - `直充平台点数已恢复`：只在「自动切过 Browser」之后出现；系统**不自动切回**，要切回在工作台点「API 充值」（切换会校验点数不为 0）。
  - `直充平台不认这把 Key`：Key 被拒（401 / 40107 / 40306），API 路线下不了单；到平台核对，或换 Key（下一条）。
  - `充值失败，要你处理`（API 路线提交后失败）：卡先锁着、卡密没退；按 §1.A「失败」处理（后台订单「需要我处理」→「放卡退卡密」）。
- **换 Key**：Lemon 把新 Key 存本机（不进聊天）：先 `mkdir -p ~/.config/zzshu && chmod 700 ~/.config/zzshu`，复制 Key 后 `printf 'ZZSHU_API_KEY=%s\n' "$(pbpaste)" > ~/.config/zzshu/api.env && chmod 600 ~/.config/zzshu/api.env`。执行者（**先问**）改服务器 `/etc/pojia/provider.env` 的 `ZZSHU_API_KEY` 行、重启 `pojia-worker`（**先问**），再用上面的只读命令核对。
- **API 路线用哪个卡台**：工作台营业条的卡台下拉框跟着当前路线走（走 API 时切的是 API 那一行），与 Browser 行各自独立；候选只列有 API 直充能力的卡台。

## 2.8 本地界面验收环境（「演示精简版」，2026-09-29 起一条命令）

后台每块 UI 的**界面层验收**（真实页面 + 与原型同尺寸比对）、改后台界面时**先在真后台上给 Lemon 看定稿**（不另写演示网页，免得批的和上线的不一样）、接手的人做界面回归，都用它：**真后台（当前 v1 代码）+ 按线上形状造的假数据**。不碰生产（只有 `refresh-shape` 经 13306 隧道只读取聚合）。

```
scripts/local-admin.sh up             # 重建 pojia_local_admin → 迁移 → 首次生成密钥与口令 → 造数 → 打印「形状比对」
scripts/local-admin.sh serve          # 前台起后台 http://127.0.0.1:8810/admin（或 preview_start local-admin）
scripts/local-admin.sh status         # 库 / 服务 / 快照日期
scripts/local-admin.sh down           # 停服务，只删 pojia_local_admin（密钥与口令留着，下次 up 复用）
scripts/local-admin.sh refresh-shape  # 想看最新的线上形状时：只读取生产聚合，写回快照（要 13306 隧道），再 up
```

- **口令**在 `~/Library/Application Support/pojia-local-admin/admin-password.txt`（目录 700、文件 600、不进 git；脚本从不打印口令）。同目录的 `local-admin.env` 是七把临时密钥 + 口令哈希（值用单引号包，不设 `ADMIN_HOST`、不设任何卡台 / 直充 Key）。
- **快照** `v1/scripts/local-admin/shape.json` 进 git，离线也能 up。里面只有聚合：各组个数、UTC+8 日偏移、开关与门槛、钱包取整、生产资格规则算出的「剩几张 · 能充几单」等；一条 SQL、一个一致性读视图抓取（`v1/scripts/local-admin/shape-queries.mjs`）。
- **造出来的数**：个数与分布逐节等于快照（up 末尾的「形状比对」，也可 `scripts/local-admin.sh verify`）；**每一行都是假的**——邮箱 `@demo.invalid`，订单号、卡号（假卡段 51000099 / 40000099）、尾号、卡密、Session、token、直充单号全部现场生成，原因 / 提醒 / 备注是模板字。时间按「现在」往回推：哪天 up，看到的都是「快照那天的今天」（当天内的具体时刻是随机的）。
- **不连外网**：serve 挂 `offline-guard`，进程里的请求只放行 127.0.0.1；highvcc 的卡段列表与钱包本机应答（钱包取快照量级），报价 / 开卡 / 同步一律 503，贴了真 token 也发不出去。hnskj「刷新余额」会报错（本机没配 Key），属正常。
- **心跳**按快照保持（线上抓快照时 worker / 常驻池在线，本机就显示在线）。本机并没有 worker 在跑，开关随便拨也不会有东西执行。
- 服务开着时重跑 up，几秒内接口会报错，up 完刷新页面即可。复用 `pojia-stage1-mysql` 容器（端口每次现查）；容器停了先 `docker start pojia-stage1-mysql`。在 `.claude/worktrees/` 下的工作树里 serve 会自动经一个不带点的软链接起（express 的 sendFile 拒绝路径里带点目录）。
- **真库测试**：`v1/scripts/mysql-tests.sh test/local-admin-mysql-integration.test.js`（也在发布前的全量真库测试里）。
- 快照里没有的状态（例如当天没有待办、没有付款不明），要验就在页面上注入（见下）或临时往本机库补一条，验完 up 重建即可。

**四态必验**：有待办 / 无待办 / 接口失败（前端 `window.fetch` 注入 500）/ 权限拒绝（注入 401）。
**只测渲染函数不算界面验收** —— F-63 那次就是只喂 `{__error:true}` 给渲染函数，漏掉了「上游根本不产生失败态」，真实页面才抓到。

## 3. 死单残留清理

**付款前挂住**（Bark「客户卡住了，停在付款前没人处理」，D-390）：订单还是处理中，但没有程序在处理它，还没点付款、钱没动。
1. 先看本机付款池：`browser-mvp/scripts/ready-check.sh pay`、`scripts/pool-release.sh status`。池子停了就按 §1 拉起；拉起后租约过期的任务几秒内会被重新领走，告警在订单结束后自动收掉。
2. 池子正常、几分钟后仍没人接手：**后台打开这一单 →「此刻可做」点「放弃并放卡」**（D-394）。服务器加锁再核一遍：有任何付款痕迹、或付款池还拿着这一单（抽屉会写「到几点」）都会拒绝。放弃后订单关闭，卡放回，客户卡密退回、可以重新兑换；失败原因统计里记为「付款前停下·已放弃」。
3. 演练残单仍用 `close-rehearsal-order.mjs`；**真实客户单用第 2 步的按钮**。统计里「演练单」按运行方判定（D-395：只被演练程序跑过的单），与用哪种方式收单无关。

订单已是 RECHARGE_FAILED 但卡仍绑定（2026-09-08 前的旧行为）：
```bash
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/release-failed-order-card.js <PUBLIC_NO> --dry-run'
```
终态单（SUCCESS/FAILED/CLOSED）上还挂着 QUEUED/CLAIMED 派发任务或 ACTIVE 卡分配（后台显示"排队中/已领取"、"已分配"虚高）——只会由绕过正式路径的手工 SQL 产生：
```bash
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/close-stale-residue.mjs --dry-run'
```
（全库扫描；守卫：attempt 仍 ACTIVE/UNKNOWN 或有 open run 的单跳过；不动消费账本；去掉 `--dry-run` 才写。脚本不在 release 包内时先 `scp v1/scripts/close-stale-residue.mjs root@144.34.180.184:/opt/pojia/current/v1/scripts/`。）

## 4. 查库（只读）

```bash
browser-mvp/scripts/prod-query.sh "SELECT ..."   # 经隧道，凭证运行时经 SSH 取入进程
```
**只用于读。** 生产写操作一律走正式连接池的脚本/服务（如上 `.mjs` 脚本、后台接口），写后**必须用新连接独立核实**。

## 5. 发布与回滚

**发布前必跑**（把 SQL 拿到生产 schema 上校验；2026-09-12 曾因列名写错导致九阶段
整个失效而测试全绿，见 D-184）：
```bash
v1/scripts/customer-sql-probe.sh
```
**真数据库测试**（D-394 ③）：`deploy-release.sh prepare` 会先自动跑 `v1/scripts/mysql-tests.sh`（本机 `pojia-stage1-mysql` 容器，每个测试文件一个全新隔离库、跑完即删，约 1.5 分钟），不全绿就停止发布；工作区不是发布提交或 v1/ 有未提交改动也会停。容器没开等确有理由不跑时显式 `MYSQL_TESTS=skip`，输出留「未验证」。平时也可单独跑：
```bash
v1/scripts/mysql-tests.sh
```
动到数据库结构、或做了大范围重构时，再跑一次全量（589 条，约 8 分钟，见 D-186）：
```bash
v1/scripts/sql-probe.sh
```

```bash
scripts/deploy-release.sh prepare <commit> <YYYYMMDD-tag-shortsha>   # 构建/上传/备份/校验，不切换
scripts/deploy-release.sh migrate <name>                             # 仅当仓库 v1/migrations 有新文件
scripts/deploy-release.sh switch  <name>                             # 切换+重启 web/worker/bark+健康检查，打印 ROLLBACK 命令
```
发布后复验（服务器本机 3100 + `ADMIN_HOST`）：登录页 200、新资源版本号、关键接口未登录 401，
**外加 switch 打印的 `worker cwd=` 与 `bark cwd=` 两行都指向新 release**（D-220 / D-271：这三个常驻进程
不重启就一直跑旧代码，而测试和发布日志都看不出来）。回滚：
```bash
ssh root@144.34.180.184 'ln -sfn /opt/pojia/releases/<prev> /opt/pojia/current && systemctl restart pojia-web.service pojia-worker.service pojia-bark-notifications.service'
```

### 本机常驻池换代码（2026-09-25 起跑固定版本目录，D-383）

常驻池不再跑 main 工作区，而是 `~/pojia-pool/current`（LaunchAgent 指向它）。池子换代码与服务器发布用**同一提交**：
```bash
scripts/pool-release.sh prepare <commit> <name>      # 建目录+校验+装依赖+自检，不碰在跑的池
scripts/pool-release.sh status                       # current 指向哪、worker 实际跑哪份
```
然后：正式路径关付款开关 → 确认无在途 run → 只对池 worker 发 SIGTERM、确认退出 → `scripts/pool-release.sh switch <name>` → 开付款开关（supervisor 60 秒内从新目录拉起）→ `status` 显示「跑 current」。回滚＝`switch <上一版>` 再按同样步骤停/开。**worker 未退出前不许动 launchd**（同进程组，卸载会连带强杀）。等待循环的命令行别含池进程名（D-373）。

## 6. 本机依赖

```bash
launchctl kickstart -k gui/$(id -u)/com.pojia.mihomo-ph          # mihomo 出口
launchctl kickstart -k gui/$(id -u)/com.pojia.ssh-tunnel-13306   # 隧道
open "/Applications/比特浏览器.app"                               # 比特浏览器（GUI）
curl -s --proxy http://127.0.0.1:17897 https://api.ipify.org     # 应为 38.60.246.34
```
mihomo 配置：`~/Library/Application Support/AI充值业务/bitbrowser-proxy/config.yaml`（订阅 filter 只留菲律宾节点，select 组唯一）。所有比特浏览器窗口代理均指向 `127.0.0.1:17897`（出口由 mihomo 决定，非窗口各自固定）。

## 7. 事实源同步（每次动作后）

release/服务/开关/卡/订单终态变化 → 改 `CURRENT_STATE.md` 对应行（跑 `browser-mvp/scripts/state-check.sh` 看漂移）；方向决定 → `DECISIONS.md`；过程 → `HANDOFF_LOG.md` 追加；窗口收尾 → 重写 `HANDOFF_NOW.md`。
