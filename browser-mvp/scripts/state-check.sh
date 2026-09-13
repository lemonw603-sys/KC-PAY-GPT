#!/usr/bin/env bash
# 现场事实 vs docs/CURRENT_STATE.md 比对：把能查出来的关键事实取一遍，逐项检查状态表对应行是否包含该值。
# 只读，不改任何东西。输出 [一致]/[漂移]/[缺行]；漂移的行去 CURRENT_STATE.md 改。
#   browser-mvp/scripts/state-check.sh
set -uo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$DIR/../.." && pwd)"; STATE="$ROOT/docs/CURRENT_STATE.md"
Q="$DIR/prod-query.sh"; HOST=root@144.34.180.184; drift=0
say(){ printf '%s\n' "$*"; }
row(){ grep -m1 -F "| $1 |" "$STATE" 2>/dev/null; }
check(){ # check <行前缀> <现场值> <说明>
  local line; line="$(row "$1")"
  local bare; bare="$(printf '%s' "$2" | tr -d '[:space:]')"
  # 现场值必须含数字或字母才能拿去做子串匹配。只剩单位词的残缺值（例如 " 张"）是 "1 张" 的
  # 子串，会把"查不到"报成 [一致]——2026-09-13 实测把"没卡"报成"有卡"，真实是 0 张。
  if [ -z "$bare" ] || [ "$2" = "NULL" ] || ! printf '%s' "$bare" | grep -q '[0-9A-Za-z]'; then say "[取值失败] $1：现场 $3 取不到值（查询或列名有误，按漂移处理）"; drift=1; return; fi
  if [ -z "$line" ]; then say "[缺行] $1（现场：$3=$2）"; drift=1; return; fi
  if printf '%s' "$line" | grep -qF -- "$2"; then say "[一致] $1 ⊇ $3=$2"; else say "[漂移] $1：现场 $3=$2；表中：$(printf '%s' "$line" | cut -c1-110)…"; drift=1; fi
}
nc -z 127.0.0.1 13306 2>/dev/null || { say "隧道 13306 未通，先跑 ready-check.sh"; exit 1; }

REL=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" 'readlink -f /opt/pojia/current | sed "s#.*/##"' 2>/dev/null)
check "生产 release" "$REL" "release"
SVC=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" 'systemctl is-active pojia-web' 2>/dev/null); check "pojia-web" "$SVC" "状态"
SVC=$(ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" 'systemctl is-active pojia-worker' 2>/dev/null); check "pojia-worker（v1 任务 Worker）" "$SVC" "状态"
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
  ELIG_SQL=$(cd "$ROOT/v1" && node -e 'import("./src/services/card-inventory-eligibility.js").then(m=>process.stdout.write(m.eligibleInventoryCardSql("c",process.argv[1])))' "$MINBAL" 2>/dev/null)
  if [ -z "$ELIG_SQL" ]; then say "[取值失败] 可分配卡：生成资格 SQL 失败（v1/src/services/card-inventory-eligibility.js 是否可加载）"; drift=1; else
  N=$(bash "$Q" "SELECT COUNT(*) FROM cards c WHERE $ELIG_SQL" 2>/dev/null | tr -d '[:space:]')
  check "可分配卡（正式资格 SQL）" "${N:-} 张" "可分配卡数（Plus 门槛 $MINBAL）"
  fi
fi
RUNS=$(bash "$Q" "SELECT COUNT(*) FROM browser_runs WHERE active_account_key_hmac IS NOT NULL" 2>/dev/null | tr -d '[:space:]'); check "活动资金与运行" "active_runs $RUNS" "账号槽"
OPEN=$(bash "$Q" "SELECT COUNT(*) FROM orders WHERE status NOT IN ('RECHARGE_SUCCESS','RECHARGE_FAILED','CLOSED')" 2>/dev/null | tr -d '[:space:]'); check "可分配卡（正式资格 SQL）" "非终态订单 $OPEN" "非终态订单"
say ""; [ "$drift" -eq 0 ] && say "==> CURRENT_STATE 与现场一致 ✓" || say "==> 有漂移/缺行：改 docs/CURRENT_STATE.md 对应行（带核对时间与证据）"
exit $drift
