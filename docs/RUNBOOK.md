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
一条命令、约 1 分钟、只读：事实表比对、三进程是否跑在当前 release、九个定时器、日对账结果、备份年龄、磁盘、一周 err 日志；生产数据走正式规则（「需要我处理」数、付款不明未收口、等 Session 超期未收口、24h 没动静的单、任务积压、开关、心跳、可分配卡、钱包快照年龄、近 7 天订单）；本机常驻池 / supervisor / 菲律宾出口 / 比特浏览器 / Bark / 代码同步。
`[失败]` 当天处理，`[提醒]` 逐条看过。查不到一律报失败，不当通过。服务器侧探针 `v1/scripts/weekly-readonly-probe.mjs` 每次临时拷过去跑完即删。

## 1. 来单（真实付款）

用户侧：①20X 单先把卡充到 ≥150（Plus $16 即可）→ ②备用卡台 A（highvcc）的卡**不用再传 Excel**：服务器 `pojia-highvcc-snapshot-sync.timer` 每 10 分钟自动把卡台余额同步进库（最坏滞后 10 分钟；急用时执行者 `ssh root@144.34.180.184 systemctl start pojia-highvcc-snapshot-sync.service` 立刻刷）；其他来源的卡仍走后台上传 Excel（**上传即写库、即生效**）→ ③客户页提交 CDK + session → ④把单号发给执行者。顺序反了（先提交、卡还没到位）订单会停在"等卡"，卡到位后由执行者推一下。

执行者：
```bash
# D-158 起不再跑独立预检：订单到 CARD_READY 后服务器自动排派工，直接 go-live
browser-mvp/scripts/ready-check.sh pay          # 会因开关=false 报阻断，属预期
browser-mvp/scripts/go-live.sh --arm            # 自检→开付款开关(同步 executor profile+审计)→独立核实→拉 pay worker(Lane4)
tail -f "$HOME/Library/Application Support/pojia-browser-live/go-live-*.log"
```
流程：本机 preflight → stage1 自动付 Plus → 页内每 5s 轮询 accounts/check 最多 5 分钟（不刷新不跳页）→ 20X 单自动开「Confirm plan changes」小窗**停下**（用已绑卡，不填卡）。

用户在小窗**核对卡尾号 = 本单分配的卡**后手动 Pay now → 后台订单抽屉点「确认 20X 已升级」。Plus 单：自动取消续费；若"取消续费需复核"，用户在账号里关掉后点「已在账号里取消续费」。

收工（看到终态、**等 worker 自行收尾后**）：
```bash
browser-mvp/scripts/stop-live.sh                # 停 worker → 关付款开关(审计) → 核实
```

**硬规则（D-139，09-09 真单教训）**：真单自动化**失败一次**（预检 DEAD、run 失败、或**付款点击之前**任何一步卡超过 5 分钟）→ 立刻 `stop-live.sh`，把窗口交给用户手动充，**事后再查**，不在真单上边修边试。点击付款之后另有规矩，见下面③。用户手动充完后收口：
```bash
scp v1/scripts/close-manually-fulfilled-order.mjs root@144.34.180.184:/opt/pojia/current/v1/scripts/   # release 包里没有时
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/close-manually-fulfilled-order.mjs <PUBLIC_NO> --dry-run'
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/close-manually-fulfilled-order.mjs <PUBLIC_NO> [--card-used]'
```
（守卫：系统有任何付款痕迹即拒。默认视为分配的卡**没用**→释放；手动用的就是这张卡则加 `--card-used`→账本 CONSUMED、卡 DEPLETED。订单 RECHARGE_SUCCESS、CDK 保持已用、取消续费留「已在账号里取消续费」复核。）403 根因 09-09 已定位修复（D-140），真单未验。

**失败应对（按发生阶段，2026-09-10 定，真单前必读）**：
- **①预检失败**（订单仍 CARD_READY，没有 run；预检 5 次即 DEAD，无自动重开）：`stop-live.sh` → 用户手动充 → `close-manually-fulfilled-order.mjs <单号>`。09-09 走过。
- **②付款前失败**（live run 已起、未点击）：常驻池会**自己**安全中止——卡类/租约问题回 CARD_READY 重试；其余一律 RECHARGE_FAILED + CDK 退回 + 卡释放（审计 F-4）。用户若手动充了：订单 CARD_READY 用上面脚本；订单已 RECHARGE_FAILED 的**脚本目前不接**（待扩，审计 B6），先记单号事后收。
- **③点击付款之后**（run `payment_state` 不是 NOT_STARTED/ARMED；`browser_operations` 出现 `PAYMENT_SUBMIT`）：**任何人都不许手动重付**，并且 **10 分钟内不得 `stop-live.sh`、不得 kill worker**（点击后 worker 自己核实最多 5 分钟，不明后再由核实 lane 核实 5 分钟；kill 会让 run 停在 PAYMENT_SUBMITTING、没有任何自动核实，审查 F-26）。等自动核实：账号仍 free → 判拒付 → RECHARGE_FAILED 放卡；确认 Plus → 取消续费 → 成功；核实到期 → run HUMAN_REQUIRED + 对账 case，订单停 RECHARGE_PROCESSING（审计 F-16：目前只能走 run 控制面 REQUEST→FREEZE→TRANSFER→COMPLETE_20X 收成功，续费要人工到账号里关；或等 F-16 做完）。
- **客户被打回**（WAITING_FOR_SESSION）：客户页的重贴表单目前不显示（审计 F-5 未修）；客户自己"重新提交同一 CDK"也**不会**更新 Session（同码同账号返回原单，审查 F-34），换账号提交会被 409 拒（F-35）。唯一兜底：客户把新 session JSON 交给用户，执行者在服务器本机用公开接口替客户提交（`POST /api/v1/orders/session`，body `{"publicNo":"<单号>","session":<JSON>}`，对 127.0.0.1:3100 发、Host 头用客户页域名，见 `/etc/pojia/runtime.env`）。**未演练**。
- **跑单纪律**：跑单期间客户不要使用该账号；不要把该账号登进任何其他比特浏览器窗口（同一账号两处登录会挤掉注入的 session，09-07 观察到）；跑单期间**不在后台首页关"浏览器真实付款"开关**，收工只用 `stop-live.sh`（中途关开关会把正在跑的单判成 RECHARGE_FAILED 并退码放卡，审查 F-25）。

**测试账号单失败后的收口（2026-09-11 核对代码与生产；测试单不手动充，收口后另一个账号重新提交新单）**：
- 预检 DEAD（订单 CARD_READY、卡仍绑定、无 run/attempt/dispatch）：后台「取消」。代码放行条件 = 付款任务 PENDING 且 attempts=0、permit 未消费（`order-cancellation-service.js` untouchedCardReady）→ 卡回池、CDK 回 AVAILABLE。**生产未走过**（09-09 是手动充后 close-manually-fulfilled）。
- 付款前中止（live run 起、未点击）：worker 自动 RECHARGE_FAILED + CDK 退回 + 卡释放（D-131）。生产走过 2 次。
- 拒付（点击后 DECLINED）：run 停 RECONCILE_ONLY/PAYMENT_UNKNOWN → 后台「确认核实结果」选 NOT_CHARGED → 卡释放、CDK 退回、RECHARGE_FAILED。**新按钮生产未点过**（历史 3 次拒付由一次性脚本 `claude-declined-closeout` 收）。
- 换账号 = 新订单：另一个 AVAILABLE CDK + 新账号的 Session；合格卡当前仅 9839，拒付后若要换卡需补余额/开卡（资金动作，先确认）。
- 跑单期间该账号不得在任何其他窗口登录（含上号器手动登录），否则挤掉注入 Session；Session 提交后尽快跑（accessToken 剩余 <5 分钟即拒）。

## 1.5 攒数据：自己跑一单 + 看成功率（2026-09-11 12:39 UTC 起）

**不需要事先向任何人登记**：系统每次运行都会把时间线、点击次数、结果、原因落库。跑过就有，没跑就没有。

自己跑一单（客户提交后）：
```bash
browser-mvp/scripts/prod-query.sh "SELECT public_no,status FROM orders WHERE public_no='<单号>'"   # 等到 CARD_READY
BROWSER_POOL_LANES=lane-1=10f0dc7b534844c083165796447d5893 bash browser-mvp/scripts/go-live.sh --arm
tail -f "$HOME/Library/Application Support/pojia-browser-live/go-live-"*.log
bash browser-mvp/scripts/stop-live.sh     # 看到终态、且距离点付款已超过 10 分钟后
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

## 2.8 本地界面验收环境（第⑥步起，2026-09-19）

后台每块 UI 的**界面层验收**（真实页面 + 与原型同尺寸比对）都要用它。不碰生产、不碰 13306 只读隧道。

1. **隔离库**（复用既有测试容器，端口每次现查，`docker restart` 会换）：
   ```
   PORT=$(docker port pojia-stage1-mysql 3306/tcp | head -1 | sed 's/.*://')
   mysql -h 127.0.0.1 -P $PORT -u root -proot -e "CREATE DATABASE pojia_ui_verify CHARACTER SET utf8mb4;"
   cd v1 && MIGRATION_DATABASE_URL="mysql://root:root@127.0.0.1:$PORT/pojia_ui_verify" node scripts/migrate.js
   ```
2. **临时凭据**（写 scratchpad，**不进项目、不进 git**）：六个各自独立的 32B base64 密钥
   （`SESSION_ENCRYPTION_KEY_BASE64` / `CDK_HASH_KEY_V1_BASE64` / `CDK_RECOVERY_KEY_BASE64` /
   `CDK_DELIVERY_HMAC_KEY_BASE64` / `CARD_INTAKE_PAN_HMAC_KEY_BASE64` / `PAYMENT_REFERENCE_HMAC_KEY_BASE64`，
   校验要求互不相同）+ `ADMIN_PASSWORD_HASH`（`hashAdminPassword()` 生成）+ `ADMIN_SESSION_SECRET_BASE64`。
   **坑**：env 文件里值要用单引号包住——hash 形如 `scrypt-v1$…$…`，`source` 时 `$` 会被 shell 展开成空。
   **不要设** `ADMIN_HOST`（设了会做 Host 校验，localhost 进不去）。
3. **起服务**：写个 `source env && exec node src/server.js` 的小脚本，用 `preview_start` 起（别用 Bash 起 dev server）。
4. **造数**：直接往隔离库插。中文务必 `mysql --default-character-set=utf8mb4`，否则页面上是乱码（看着像 bug，其实是造数问题）。
5. **验完**：停服务 → **只删自己建的库** → 容器和其余历史库不动（V2.0_EXECUTION §635）。

**四态必验**：有待办 / 无待办 / 接口失败（前端 `window.fetch` 注入 500）/ 权限拒绝（注入 401）。
**只测渲染函数不算界面验收** —— F-63 那次就是只喂 `{__error:true}` 给渲染函数，漏掉了「上游根本不产生失败态」，真实页面才抓到。

## 3. 死单残留清理

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
