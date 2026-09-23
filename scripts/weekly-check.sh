#!/usr/bin/env bash
# 每周自检（D-352「可离开」四条之一）：一条命令把该看的都看一遍，只读，不改任何东西。
#   scripts/weekly-check.sh
# 每项一行 [通过]/[提醒]/[失败] 并附证据；末尾一句结论。[失败] 要当天处理，[提醒] 逐条看过。
# 查不到 ≠ 正常：任何取不到值的项都报 [失败]，不当通过。
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
HOST=root@144.34.180.184
SSH=(ssh -o BatchMode=yes -o ConnectTimeout=10 -o ControlMaster=auto -o "ControlPath=/tmp/.pojia-cm-$(id -u)-%h-%p-%r" -o ControlPersist=60 "$HOST")
fail=0; warn=0
ok(){ printf '[通过] %s\n' "$1"; }
note(){ printf '[提醒] %s — %s\n' "$1" "$2"; warn=$((warn+1)); }
bad(){ printf '[失败] %s — %s\n' "$1" "$2"; fail=$((fail+1)); }
num(){ printf '%s' "${1:-}" | grep -Eq '^-?[0-9]+$'; }

echo "== 每周自检 $(date -u +%Y-%m-%dT%H:%MZ)（UTC）=="

# 1) 生产事实表与现场一致（复用正式比对脚本）
if nc -z 127.0.0.1 13306 2>/dev/null; then
  sc=$(bash browser-mvp/scripts/state-check.sh 2>&1)
  if printf '%s' "$sc" | grep -q '一致 ✓'; then ok "CURRENT_STATE 与现场一致"; else bad "CURRENT_STATE 与现场有漂移" "$(printf '%s' "$sc" | grep -E '漂移|缺行|取值失败' | head -3 | tr '\n' ' ')"; fi
else
  bad "SSH 隧道 13306 没通" "先跑 browser-mvp/scripts/ready-check.sh"
fi

# 2) 服务器：三进程 + 定时器 + 日对账 + 备份 + 磁盘 + 一周错误日志
srv=$("${SSH[@]}" '
cur=$(readlink -f /opt/pojia/current)
for s in pojia-web pojia-worker pojia-bark-notifications; do pid=$(systemctl show -p MainPID --value $s.service); echo "proc $s $(systemctl is-active $s.service) $( [ -n "$pid" ] && [ "$pid" != 0 ] && readlink -f /proc/$pid/cwd | grep -q "^$cur/" && echo cwd-ok || echo cwd-DRIFT)"; done
for t in $(systemctl list-units --type=timer --no-pager --plain | awk "/^pojia-/{print \$1}"); do echo "timer $t $(systemctl is-active $t)"; done
echo "recon $(systemctl show pojia-daily-reconciliation.service -p Result --value) $(systemctl show pojia-daily-reconciliation.service -p ExecMainExitTimestamp --value | sed "s/ /_/g")"
b=$(ls -t /var/backups/pojia/*.enc 2>/dev/null | head -1); [ -n "$b" ] && echo "backup $(( ( $(date +%s) - $(stat -c %Y "$b") ) / 3600 ))h $(basename "$b")" || echo "backup none"
echo "disk $(df -P / | awk "NR==2{print \$5}" | tr -d %)"
echo "weberr $(journalctl -u pojia-web --since "-7 days" -p err --no-pager -q 2>/dev/null | wc -l)"
echo "workererr $(journalctl -u pojia-worker --since "-7 days" -p err --no-pager -q 2>/dev/null | wc -l)"
' 2>/dev/null)
if [ -z "$srv" ]; then bad "服务器状态查不到（SSH 未返回）" "查不到不等于挂了，先看连接"; else
  while read -r kind a b c; do
    case "$kind" in
      proc) if [ "$b" = active ] && [ "$c" = cwd-ok ]; then ok "$a active，跑的是当前 release"; else bad "$a" "状态=$b，$c（进程没在 current 上跑就是老代码）"; fi ;;
      timer) [ "$b" = active ] && ok "定时器 $a" || bad "定时器 $a" "状态=$b" ;;
      recon) [ "$a" = success ] && ok "日对账最近一次 success（$b）" || bad "日对账最近一次 $a" "$b" ;;
      backup) if [ "$a" = none ]; then bad "数据库备份" "找不到 .enc"; elif [ "${a%h}" -le 48 ] 2>/dev/null; then ok "数据库备份 ${a} 前（$b）"; else note "数据库备份已 ${a} 没更新（$b）" "pojia-backup.timer 每天 03:17 UTC，看它的日志"; fi ;;
      disk) if num "$a" && [ "$a" -lt 80 ]; then ok "磁盘使用 ${a}%"; else bad "磁盘使用 ${a:-?}%" "≥80% 要清"; fi ;;
      weberr) if num "$a" && [ "$a" -eq 0 ]; then ok "pojia-web 近 7 天无 err 级日志"; else note "pojia-web 近 7 天 err 级日志 ${a:-?} 条" "journalctl -u pojia-web --since '-7 days' -p err"; fi ;;
      workererr) if num "$a" && [ "$a" -eq 0 ]; then ok "pojia-worker 近 7 天无 err 级日志"; else note "pojia-worker 近 7 天 err 级日志 ${a:-?} 条" "journalctl -u pojia-worker --since '-7 days' -p err"; fi ;;
    esac
  done <<< "$srv"
fi

# 3) 生产数据（正式连接池 + 正式规则，服务器侧只读探针）
probe=$( scp -q -o BatchMode=yes v1/scripts/weekly-readonly-probe.mjs "$HOST":/tmp/weekly-readonly-probe.mjs 2>/dev/null \
  && "${SSH[@]}" 'cd /opt/pojia/current/v1 && cp /tmp/weekly-readonly-probe.mjs scripts/.weekly-readonly-probe.tmp.mjs && node scripts/.weekly-readonly-probe.tmp.mjs; rc=$?; rm -f scripts/.weekly-readonly-probe.tmp.mjs /tmp/weekly-readonly-probe.mjs; exit $rc' 2>/dev/null )
if ! printf '%s' "$probe" | grep -q '"ok":true'; then bad "生产只读探针没跑成" "$(printf '%s' "$probe" | tail -c 200)"; else
  j(){ printf '%s' "$probe" | python3 -c "import json,sys; d=json.load(sys.stdin); v=d$1; print('' if v is None else v)" 2>/dev/null; }
  act=$(j "['buckets']['action']"); if num "$act" && [ "$act" -eq 0 ]; then ok "「需要我处理」为 0"; elif num "$act"; then note "「需要我处理」有 ${act} 单" "打开后台订单页→需要我处理"; else bad "「需要我处理」取不到" "探针 buckets 缺失"; fi
  pu=$(j "['paymentUnknownOpen']"); if num "$pu" && [ "$pu" -eq 0 ]; then ok "付款不明未收口 0 单"; else bad "付款不明未收口 ${pu:-?} 单" "先核实卡台流水再收口（RUNBOOK §2.6）"; fi
  ar=$(j "['activeRuns']"); if num "$ar" && [ "$ar" -eq 0 ]; then ok "账号槽空闲（active_runs=0）"; else note "active_runs=${ar:-?}" "有单在跑或卡在 RUN_NOT_ACTIONABLE"; fi
  so=$(j "['sessionWaitOverdue']"); if num "$so" && [ "$so" -eq 0 ]; then ok "等 Session 单没有超期未收口的"; else bad "等 Session 超期 30 分钟仍未收口 ${so:-?} 单" "到期收口服务没跑（session-repair-expiry）"; fi
  st=$(j "['staleNonTerminal']"); if num "$st" && [ "$st" -eq 0 ]; then ok "没有 24 小时没动静的非终态单"; else note "24 小时没动静的非终态单 ${st:-?}" "订单页→处理中，逐单看"; fi
  tp=$(j "['tasks']['pendingOver1h']"); tr_=$(j "['tasks']['runningLeaseExpired']")
  if num "$tp" && num "$tr_" && [ "$tp" -eq 0 ] && [ "$tr_" -eq 0 ]; then ok "任务队列没有积压（非终态单 PENDING>1h=0，租约过期=0）"; else note "任务队列 非终态单 PENDING>1h=${tp:-?}，RUNNING 租约过期=${tr_:-?}" "worker 是否在跑"; fi
  lo=$(j "['tasks']['leftoverOnTerminal']"); if num "$lo" && [ "$lo" -eq 0 ]; then ok "终态订单上没有残留任务"; else note "终态订单上残留 PENDING/RUNNING 任务 ${lo:-?} 个" "不堵队列，是脏数据；RUNBOOK §3 清理"; fi
  pay=$(j "['switches']['browser_payment_writes_enabled']"); acc=$(j "['switches']['accept_new_orders']"); hb=$(j "['switches']['intake_executor_heartbeat_check']")
  [ -n "$pay$acc" ] && ok "开关：付款=${pay:-?} 接单=${acc:-?} 下单查心跳=${hb:-?}（看是否符合当前意图）" || bad "开关取不到" "探针 switches 缺失"
  [ "$hb" = "false" ] && bad "下单查执行器心跳关着" "演练完没开回去：node v1/scripts/set-intake-executor-check.mjs on --apply"
  bw=$(j "['heartbeats']['browserWorkerAgeMin']"); if num "$bw" && [ "$bw" -le 5 ]; then ok "常驻池心跳 ${bw} 分钟前"; else note "常驻池心跳 ${bw:-无} 分钟前" "本机 supervisor/worker 是否在跑；停着时客户会被拒单"; fi
  dr=$(j "['heartbeats']['dailyReconciliationAgeMin']"); if num "$dr" && [ "$dr" -le $((26*60)) ]; then ok "日对账心跳 ${dr} 分钟前"; else bad "日对账心跳 ${dr:-无} 分钟前" "超过 26 小时"; fi
  el=$(j "['cards']['eligible']"); mb=$(j "['cards']['plusMinBalance']"); if num "$el" && [ "$el" -ge 1 ]; then ok "可分配卡 ${el} 张（Plus 门槛 ${mb}，正式资格 SQL）"; elif num "$el"; then note "可分配卡 0 张" "新单会卡在等卡；看供卡调度器与钱包"; else bad "可分配卡取不到" "资格 SQL 未生成"; fi
  ws=$(printf '%s' "$probe" | python3 -c "import json,sys; d=json.load(sys.stdin)['walletSnapshotAgeMin']; print(' '.join(f'{k}={v}min' for k,v in d.items()))" 2>/dev/null)
  old=$(printf '%s' "$probe" | python3 -c "import json,sys; d=json.load(sys.stdin)['walletSnapshotAgeMin']; print(' '.join(k for k,v in d.items() if v is None or v>26*60))" 2>/dev/null)
  [ -z "$old" ] && ok "卡台钱包快照都在 26 小时内（$ws）" || note "卡台钱包快照过旧：$old（$ws）" "同步定时器或 token 有问题（highvcc token 过期会先在这里露头）"
  wk=$(printf '%s' "$probe" | python3 -c "import json,sys; d=json.load(sys.stdin)['last7d']; print(f\"总 {d['total']} · 成功 {d['success']} · 失败/关闭 {d['failed']} · 付款不明 {d['unknown']}\")" 2>/dev/null)
  ok "近 7 天订单：${wk}"
fi

# 4) 本机：常驻池、菲律宾出口、比特浏览器、Bark、代码同步
pgrep -f production-live-pool-worker >/dev/null && ok "本机常驻 Browser 池在跑" || note "本机常驻 Browser 池没在跑" "来单会被拒（下单查心跳）；要接单先 go-live"
pgrep -f live-pool-supervisor.sh >/dev/null && ok "supervisor 在跑" || note "supervisor 没在跑" "worker 挂了没人拉"
ip=$(curl -s -m 12 --proxy http://127.0.0.1:17897 https://api.ipify.org 2>/dev/null); [ "$ip" = "38.60.246.34" ] && ok "菲律宾出口 $ip" || note "菲律宾出口异常（$ip）" "launchctl kickstart -k gui/$(id -u)/com.pojia.mihomo-ph"
curl -sf -m 6 -X POST http://127.0.0.1:54345/health -H 'Content-Type: application/json' -d '{}' >/dev/null 2>&1 && ok "比特浏览器本地 API 在线" || note "比特浏览器本地 API 不在线" "打开比特浏览器"
[ -s "$HOME/.claude/bark-notify-url" ] && ok "Bark 推送地址文件存在" || bad "Bark 推送地址文件缺失" "~/.claude/bark-notify-url"
if [ -z "$(git status --porcelain)" ]; then ok "工作区干净"; else note "工作区有未提交改动" "git status"; fi
git fetch -q origin 2>/dev/null; [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main 2>/dev/null)" ] && ok "本地 main 与远端一致" || note "本地 main 与远端不一致" "git status -sb"

echo
if [ "$fail" -gt 0 ]; then echo "==> 有 ${fail} 项 [失败]、${warn} 项 [提醒]：失败当天处理"; exit 1
elif [ "$warn" -gt 0 ]; then echo "==> 没有失败，${warn} 项 [提醒] 逐条看过就行"; exit 0
else echo "==> 本周全部正常 ✓"; exit 0; fi
