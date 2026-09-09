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

用户侧：①20X 单先把卡充到 ≥150（Plus $16 即可）→ ②后台上传 Excel（**上传即写库、即生效**，不需同步）→ ③客户页提交 CDK + session → ④把单号发给执行者。顺序反了（先提交后传卡）订单会停在"等卡"，传完卡后由执行者推一下。

执行者：
```bash
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

## 3. 付款前失败的死单释放卡

订单已是 RECHARGE_FAILED 但卡仍绑定（2026-09-08 前的旧行为）：
```bash
ssh root@144.34.180.184 'set -a; . /etc/pojia/runtime.env; set +a; cd /opt/pojia/current/v1 && node scripts/release-failed-order-card.js <PUBLIC_NO> --dry-run'
```

## 4. 查库（只读）

```bash
browser-mvp/scripts/prod-query.sh "SELECT ..."   # 经隧道，凭证运行时经 SSH 取入进程
```
**只用于读。** 生产写操作一律走正式连接池的脚本/服务（如上 `.mjs` 脚本、后台接口），写后**必须用新连接独立核实**。

## 5. 发布与回滚

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
