#!/usr/bin/env bash
# 现场事实 vs docs/CURRENT_STATE.md 比对：把能查出来的关键事实取一遍，逐项检查状态表对应行是否包含该值。
# 只读，不改任何东西。输出 [一致]/[漂移]/[缺行]/[取值失败]，以及 [陈旧]（脚本不查、且超过 7 天没人核的行）；漂移的行去 CURRENT_STATE.md 改。
# 「一致 ✓」只担保脚本核对的那些行；其余行靠人，结尾一行会写明各有多少。
#   browser-mvp/scripts/state-check.sh
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$DIR/../.." && pwd)"; STATE="$ROOT/docs/CURRENT_STATE.md"
Q="$DIR/prod-query.sh"; HOST=root@144.34.180.184; drift=0
say(){ printf '%s\n' "$*"; }
row(){ grep -m1 -F "| $1 |" "$STATE" 2>/dev/null; }
COVERED=(); NCHECK=0
check(){ # check <行前缀> <现场值> <说明>
  COVERED+=("$1"); NCHECK=$((NCHECK+1))
  local line; line="$(row "$1")"
  local bare; bare="$(printf '%s' "$2" | tr -d '[:space:]')"
  # 现场值必须含数字或字母才能拿去做子串匹配。只剩单位词的残缺值（例如 " 张"）是 "1 张" 的
  # 子串，会把"查不到"报成 [一致]——2026-09-13 实测把"没卡"报成"有卡"，真实是 0 张。
  if [ -z "$bare" ] || [ "$2" = "NULL" ] || ! printf '%s' "$bare" | grep -q '[0-9A-Za-z]'; then say "[取值失败] $1：现场 $3 取不到值（查询或列名有误，按漂移处理）"; drift=1; return; fi
  if [ -z "$line" ]; then say "[缺行] $1（现场：$3=$2）"; drift=1; return; fi
  # 子串匹配对数字值不可靠：现场 "1 张" 会命中表里 "11 张卡"，把漂移报成一致
  # （2026-09-13 当天被骗两次：先是 " 张"⊂"1 张"，补了守卫后又是 "1 张"⊂"11 张"）。
  # 现场值以数字开头/结尾时，要求它在表里出现的那一侧不是数字。
  if MATCH_LINE="$line" MATCH_VALUE="$2" python3 -c '
import os, re, sys
line, value = os.environ["MATCH_LINE"], os.environ["MATCH_VALUE"]
pat = re.escape(value)
if value[:1].isdigit(): pat = r"(?<!\d)" + pat
if value[-1:].isdigit(): pat = pat + r"(?!\d)"
sys.exit(0 if re.search(pat, line) else 1)
'; then say "[一致] $1 ⊇ $3=$2"; else say "[漂移] $1：现场 $3=$2；表中：$(printf '%s' "$line" | cut -c1-110)…"; drift=1; fi
}
nc -z 127.0.0.1 13306 2>/dev/null || { say "隧道 13306 未通，先跑 ready-check.sh"; exit 1; }

REL=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" 'readlink -f /opt/pojia/current | sed "s#.*/##"' 2>/dev/null)
check "生产 release" "$REL" "release"
SVC=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" 'systemctl is-active pojia-web' 2>/dev/null); check "pojia-web" "$SVC" "状态"
SVC=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" 'systemctl is-active pojia-worker' 2>/dev/null); check "pojia-worker（v1 任务 Worker）" "$SVC" "状态"
# worker 进程实际跑的 release：deploy-release.sh switch 只重启 web，worker 的 cwd 停在它启动时解析到的那个
# release 目录（2026-09-14 发现：current 是 09-13，worker 进程 cwd 仍是 09-11）。取不到值按漂移处理。
WREL=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" 'pid=$(systemctl show pojia-worker -p MainPID --value); [ -n "$pid" ] && [ "$pid" != 0 ] && d=$(readlink -f /proc/$pid/cwd); d=${d#/opt/pojia/releases/}; echo ${d%/v1}' 2>/dev/null); check "pojia-worker（v1 任务 Worker）" "$WREL" "进程实际 release"
PAY=$(bash "$Q" "SELECT setting_value FROM app_settings WHERE setting_key='browser_payment_writes_enabled'" 2>/dev/null | tr -d '[:space:]'); check "browser_payment_writes_enabled" "$PAY" "开关"
ACC=$(bash "$Q" "SELECT setting_value FROM app_settings WHERE setting_key='accept_new_orders'" 2>/dev/null | tr -d '[:space:]'); check "accept_new_orders" "$ACC" "开关"
P20=$(bash "$Q" "SELECT CAST(setting_value AS DECIMAL(10,0)) FROM app_settings WHERE setting_key='minimum_required_card_balance:pro_20x'" 2>/dev/null | tr -d '[:space:]'); check "最低所需卡余额" "pro_20x $P20" "20X门槛"
MIG=$(bash "$Q" "SELECT * FROM schema_migrations ORDER BY 1 DESC LIMIT 1" 2>/dev/null | cut -f1 | tr -d '[:space:]'); check "数据库迁移" "$MIG" "最新迁移"
# 资格口径与门槛都取自生产唯一来源，本脚本不抄第二份：2026-09-13 发现抄来的那份少了
# 「每张卡成功次数上限」等四个条件，会把已经用满的卡数成可分配（卡 3118 用量 3/3，
# 补钱也不再合格，而旧口径仍算它一张）。改成调 v1 的 eligibleInventoryCardSql 生成 SQL。
MINBAL=$(bash "$Q" "SELECT setting_value FROM app_settings WHERE setting_key='default_minimum_required_card_balance'" 2>/dev/null | tr -d '[:space:]')
case "$MINBAL" in ''|*[!0-9.]*) say "[取值失败] 可分配卡：门槛 default_minimum_required_card_balance 取不到数字（现场 '${MINBAL}'）"; drift=1; MINBAL=""; ;; esac
if [ -n "$MINBAL" ]; then
  # 规则必须取「生产 release 正在跑的那份」，不能用工作区那份：2026-09-14 工作区已含 D-217
  # 账本推算而生产未发布，两份口径对同一张卡给出相反判定（卡 1652：生产算可分配、工作区算不可
  # 分配）。本脚本自称现场比对，用工作区那份等于拿未发布代码冒充现场。取不到就报错，绝不回退本地。
  ELIG_SRC="$(mktemp -t statecheck-elig)".mjs
  ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" 'cat /opt/pojia/current/v1/src/services/card-inventory-eligibility.js' > "$ELIG_SRC" 2>/dev/null
  if [ ! -s "$ELIG_SRC" ]; then
    say "[取值失败] 可分配卡：取不到生产 release 的资格规则（ssh $HOST:/opt/pojia/current/v1/src/services/card-inventory-eligibility.js）"; drift=1; ELIG_SQL=""
  else
    ELIG_SQL=$(node -e 'import(require("node:url").pathToFileURL(process.argv[2]).href).then(m=>process.stdout.write(m.eligibleInventoryCardSql("c",process.argv[1])))' "$MINBAL" "$ELIG_SRC" 2>/dev/null)
  fi
  rm -f "$ELIG_SRC"
  if [ -z "$ELIG_SQL" ]; then say "[取值失败] 可分配卡：生成资格 SQL 失败（生产 release 的 card-inventory-eligibility.js 是否可加载）"; drift=1; else
  N=$(bash "$Q" "SELECT COUNT(*) FROM cards c WHERE $ELIG_SQL" 2>/dev/null | tr -d '[:space:]')
  check "可分配卡（正式资格 SQL）" "${N:-} 张" "可分配卡数（Plus 门槛 ${MINBAL}）"
  fi
fi
# 供卡策略与卡台故障：2026-09-24 后台把 hnskj Plus 水位 1→0，事实表仍写「两台水位 2」，而本脚本当时
# 报全部一致——它根本没查这一行。水位决定调度器开不开卡、会不会反复重试故障卡台并推送。
for ACC in legacy-primary backup-a; do
  TGT=$(bash "$Q" "SELECT p.target_available FROM card_supply_policies p JOIN provider_accounts a ON a.id=p.provider_account_id WHERE a.account_code='$ACC' AND a.provider_code<>'zzshu' AND p.product_code='plus'" 2>/dev/null | tr -d '[:space:]')
  NAME=$([ "$ACC" = legacy-primary ] && echo hnskj || echo highvcc)
  # 前缀自带字母，查询失败时 "hnskj plus 水位 " 会绕过 check 的取值守卫并命中表里的 "水位 0"，所以先单独验值。
  case "$TGT" in ''|*[!0-9]*) say "[取值失败] $NAME Plus 水位取不到整数（现场 '${TGT}'）"; drift=1 ;;
    *) check "pojia-card-stock-runner.timer" "$NAME plus 水位 $TGT" "$NAME Plus 水位" ;; esac
done
FAULT=$(bash "$Q" "SELECT supply_fault_state FROM provider_accounts WHERE provider_code='hnskj'" 2>/dev/null | tr -d '[:space:]')
case "$FAULT" in OK|FAULT) check "pojia-card-stock-runner.timer" "hnskj 供卡故障 $FAULT" "hnskj 供卡故障状态" ;;
  *) say "[取值失败] hnskj 供卡故障状态不是 OK/FAULT（现场 '${FAULT}'）"; drift=1 ;; esac
RUNS=$(bash "$Q" "SELECT COUNT(*) FROM browser_runs WHERE active_account_key_hmac IS NOT NULL" 2>/dev/null | tr -d '[:space:]'); check "活动资金与运行" "active_runs $RUNS" "账号槽"
OPEN=$(bash "$Q" "SELECT COUNT(*) FROM orders WHERE status NOT IN ('RECHARGE_SUCCESS','RECHARGE_FAILED','CLOSED')" 2>/dev/null | tr -d '[:space:]'); check "可分配卡（正式资格 SQL）" "非终态订单 $OPEN" "非终态订单"
# 2026-09-25 补：本脚本报「一致 ✓」时，事实表 token 行写着「已更新并生效」而现场告警 OPEN——脚本根本没查那一行，
# 同一天还有「每卡上限未落地」「Worker PID 75228」两行过期而无人发觉。下面补的都是「表写错了会让接班的人做错事」的行。
# highvcc token：以 PROVIDER_TOKEN_EXPIRED 告警为权威信号（card-stock-service.js 工作台 token 格同口径）。
TOK=$(bash "$Q" "SELECT COUNT(*) FROM operator_alerts WHERE alert_type='PROVIDER_TOKEN_EXPIRED' AND status='OPEN' AND dedupe_key='provider-token-expired:00000000-0000-4000-8000-000000000103'" 2>/dev/null | tr -d '[:space:]')
case "$TOK" in 0) check "highvcc 备用卡台 A token" "token 告警 无" "highvcc token 告警" ;;
  [1-9]|[1-9][0-9]) check "highvcc 备用卡台 A token" "token 告警 OPEN" "highvcc token 告警" ;;
  *) say "[取值失败] highvcc token 告警数不是整数（现场 '${TOK}'）"; drift=1 ;; esac
# 每卡成功单数上限按产品（D-361）：三个键都要取到整数，拼成表里的固定写法。
CAPS=$(bash "$Q" "SELECT setting_key, setting_value FROM app_settings WHERE setting_key IN ('card_max_successful_payments','card_max_successful_payments:pro_5x','card_max_successful_payments:pro_20x')" 2>/dev/null)
CP=$(printf '%s\n' "$CAPS" | awk -F'\t' '$1=="card_max_successful_payments"{print $2}' | tr -d '[:space:]')
C5=$(printf '%s\n' "$CAPS" | awk -F'\t' '$1=="card_max_successful_payments:pro_5x"{print $2}' | tr -d '[:space:]')
C20=$(printf '%s\n' "$CAPS" | awk -F'\t' '$1=="card_max_successful_payments:pro_20x"{print $2}' | tr -d '[:space:]')
case "$CP$C5$C20" in ''|*[!0-9]*) say "[取值失败] 每卡上限三个键取不到整数（现场 plus '${CP}' / pro_5x '${C5}' / pro_20x '${C20}'）"; drift=1 ;;
  *) [ -n "$CP" ] && [ -n "$C5" ] && [ -n "$C20" ] && check "card_max_successful_payments" "上限 plus $CP / pro_5x $C5 / pro_20x $C20" "每卡上限" \
       || { say "[取值失败] 每卡上限缺键（现场 plus '${CP}' / pro_5x '${C5}' / pro_20x '${C20}'）"; drift=1; } ;; esac
# bark 进程实际跑的 release：D-220 修过 worker、漏了 bark，bark 在旧 release 跑了五天没人知道（D-271）。
BREL=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" 'pid=$(systemctl show pojia-bark-notifications -p MainPID --value); [ -n "$pid" ] && [ "$pid" != 0 ] && d=$(readlink -f /proc/$pid/cwd); d=${d#/opt/pojia/releases/}; echo ${d%/v1}' 2>/dev/null); check "**pojia-bark-notifications**" "$BREL" "进程实际 release"
# worker 的四个 PROVIDER_*_ENABLED：只在服务器上 grep 这四个键，环境里的其他秘密不出服务器。
WENV=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" 'pid=$(systemctl show pojia-worker -p MainPID --value); [ -n "$pid" ] && [ "$pid" != 0 ] && tr "\0" "\n" < /proc/$pid/environ | grep -E "^PROVIDER_(READS|WRITES|CARD_WRITES|RECHARGE_WRITES)_ENABLED="' 2>/dev/null)
WFLAGS=""; for k in READS WRITES CARD_WRITES RECHARGE_WRITES; do
  v=$(printf '%s\n' "$WENV" | sed -n "s/^PROVIDER_${k}_ENABLED=//p" | head -1)
  case "$v" in true|false) ;; *) WFLAGS=""; say "[取值失败] worker 环境 PROVIDER_${k}_ENABLED 不是 true/false（现场 '${v}'）"; drift=1; break ;; esac
  if [ "$k" = READS ]; then WFLAGS="PROVIDER_READS_ENABLED=$v"; else WFLAGS="$WFLAGS / $k=$v"; fi
done
[ -n "$WFLAGS" ] && check "Worker 进程写权限" "$WFLAGS" "worker 写开关"
# 本机常驻付款池：它真的在付钱，表里「本机」行的 PID 与工作目录必须是现场的。
PPIDS=$(pgrep -f 'src/production-live-pool-worker.js --run' 2>/dev/null | tr '\n' ' ' | sed 's/ *$//')
case "$PPIDS" in
  '') check "本机" "worker 0 个" "本机常驻池" ;;   # 值里要有字母/数字才过 check 的取值守卫（纯中文会被当取值失败）
  *' '*) say "[漂移] 本机：同时有多个常驻池 worker（PID ${PPIDS}），表里只该有一个"; drift=1 ;;
  *) check "本机" "PID $PPIDS" "本机常驻池 PID"
     PCWD=$(lsof -a -p "$PPIDS" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)
     PCWD=$(python3 -c 'import sys; s=sys.argv[1]; print(s.encode("latin-1","backslashreplace").decode("unicode_escape").encode("latin-1").decode("utf-8"))' "$PCWD" 2>/dev/null)
     case "$PCWD" in /*) check "本机" "cwd \`$PCWD\`" "本机常驻池工作目录" ;; *) say "[取值失败] 本机常驻池工作目录取不到（lsof）"; drift=1 ;; esac ;;
esac
# 脚本不查的行只能靠人：列出核对时间超过 7 天的（提醒，不算漂移、不改退出码）。
MANUAL=$(printf '%s\n' "${COVERED[@]}" | python3 -c '
import re, sys, datetime
covered = set(l.rstrip("\n") for l in sys.stdin if l.strip())
today = datetime.datetime.now(datetime.timezone.utc).date()
n = 0; out = []
for line in open(sys.argv[1], encoding="utf-8"):
    if not line.startswith("| "): continue
    cells = [c.strip() for c in re.split(r"(?<!\\)\|", line.rstrip("\n"))]
    if len(cells) < 6 or cells[1] == "项目": continue
    if cells[1] in covered: continue
    n += 1
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", cells[3])
    if not m: out.append("[陈旧] %s：读不到核对时间" % cells[1]); continue
    age = (today - datetime.date(*map(int, m.groups()))).days
    if age > 7: out.append("[陈旧] %s：最后核对 %s（%d 天前），脚本不查这一行，要手工复核" % (cells[1], m.group(0), age))
print(n)
print("\n".join(out))
' "$STATE" 2>/dev/null)
NMANUAL=$(printf '%s\n' "$MANUAL" | head -1)
case "$NMANUAL" in ''|*[!0-9]*) say "[取值失败] 手工核对行统计失败（python3 解析 CURRENT_STATE.md）"; drift=1; NMANUAL="?"; NSTALE="?" ;;
  *) NSTALE=$(printf '%s\n' "$MANUAL" | tail -n +2 | grep -c '^\[陈旧\]'); printf '%s\n' "$MANUAL" | tail -n +2 | grep '^\[陈旧\]' ;; esac
NCOVROWS=$(printf '%s\n' "${COVERED[@]}" | sort -u | wc -l | tr -d ' ')
say ""; [ "$drift" -eq 0 ] && say "==> 脚本核对的 ${NCHECK} 项（${NCOVROWS} 行）与现场一致 ✓；另 ${NMANUAL} 行靠手工核对，其中 ${NSTALE} 行超过 7 天" || say "==> 有漂移/缺行：改 docs/CURRENT_STATE.md 对应行（带核对时间与证据）"
exit $drift
