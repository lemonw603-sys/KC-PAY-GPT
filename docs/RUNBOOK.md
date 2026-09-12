# 日常运维手册（RUNBOOK）

> 只写"怎么做"，每步一条命令；"为什么"在 `DECISIONS.md`，"现在什么状态"在 `CURRENT_STATE.md` / `HANDOFF_NOW.md`。维护窗口、备份恢复、执行迁移见 `PRODUCTION_PREP_RUNBOOK.md`。所有命令在本机仓库根目录执行；生产主机 `root@144.34.180.184`（SSH 免密）。

## 0. 充前自检（任何动作前）

```bash
browser-mvp/scripts/ready-check.sh            # 只体检
browser-mvp/scripts/ready-check.sh rehearsal  # 演练：要求付款开关=false
browser-mvp/scripts/ready-check.sh pay        # 真付：要求付款开关=true
```
检查并自动修复：SSH 隧道 13306、mihomo（菲律宾出口 38.60.246.34）、比特浏览器（未开会自动启动）、生产服务、残留 worker、付款开关、账号槽、可分配卡数、占卡的非终态单。全绿再往下。

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
```bash
# 单单演练（推荐，跑完自动退出，不要用常驻池反复 claim）
BITBROWSER_PROFILE_ID=51e915e3298b4a02bbd7468b39749c9e browser-mvp/scripts/run-browser-preflight.sh once   # 本机 BROWSER_PREFLIGHT
browser-mvp/scripts/run-live-rehearsal.sh once <orderId>                                                      # 到零税报价、停在点击前
```
演练后订单按设计回 **CARD_READY 并继续持卡**。若不打算真付这单，必须收口释放卡（否则挡住后续新单）：
```bash
scp v1/scripts/close-rehearsal-order.mjs root@144.34.180.184:/opt/pojia/current/v1/scripts/
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/close-rehearsal-order.mjs <PUBLIC_NO> --dry-run'
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/close-rehearsal-order.mjs <PUBLIC_NO>'
```
（守卫：任何付款痕迹即拒；释放账本/卡分配、订单 CLOSED、退回 CDK。）

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

**发布前必跑**（客户链路的 SQL 对着生产只读实跑；2026-09-12 曾因列名写错导致九阶段
整个失效而测试全绿，见 D-184）：
```bash
v1/scripts/customer-sql-probe.sh
```

```bash
scripts/deploy-release.sh prepare <commit> <YYYYMMDD-tag-shortsha>   # 构建/上传/备份/校验，不切换
scripts/deploy-release.sh migrate <name>                             # 仅当仓库 v1/migrations 有新文件
scripts/deploy-release.sh switch  <name>                             # 切换+重启 web+健康检查，打印 ROLLBACK 命令
```
发布后复验（服务器本机 3100 + `ADMIN_HOST`）：登录页 200、新资源版本号、关键接口未登录 401。回滚：
```bash
ssh root@144.34.180.184 'ln -sfn /opt/pojia/releases/<prev> /opt/pojia/current && systemctl restart pojia-web.service'
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
