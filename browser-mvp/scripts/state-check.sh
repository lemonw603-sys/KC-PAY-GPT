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
  if [ -z "$2" ] || [ "$2" = "NULL" ]; then say "[取值失败] $1：现场 $3 取不到值（查询或列名有误，按漂移处理）"; drift=1; return; fi
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
ELIG=$(bash "$Q" "SELECT GROUP_CONCAT(c.last4) FROM cards c WHERE c.inventory_status IN ('AVAILABLE','ASSIGNED','DEPLETED') AND c.card_credentials_ciphertext IS NOT NULL AND c.current_balance>=16 AND (c.sync_tier='MANUAL_IMPORT' OR (c.last_transaction_synced_at IS NOT NULL AND c.last_transaction_synced_at >= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 15 MINUTE))) AND NOT EXISTS (SELECT 1 FROM card_assignment_history h WHERE h.card_id=c.id AND h.status='ACTIVE') AND NOT EXISTS (SELECT 1 FROM card_operational_overrides co WHERE co.provider_account_id=c.provider_account_id AND BINARY co.external_card_id=BINARY c.external_card_id AND co.allocation_policy='RETIRED')" 2>/dev/null | tr -d '[:space:]')
N=$(printf '%s' "$ELIG" | awk -F, '{print ($0==""?0:NF)}'); check "可分配卡（资格 SQL，Plus 门槛 16）" "${N} 张" "可分配卡数"
RUNS=$(bash "$Q" "SELECT COUNT(*) FROM browser_runs WHERE active_account_key_hmac IS NOT NULL" 2>/dev/null | tr -d '[:space:]'); check "活动资金与运行" "active_runs $RUNS" "账号槽"
OPEN=$(bash "$Q" "SELECT COUNT(*) FROM orders WHERE status NOT IN ('RECHARGE_SUCCESS','RECHARGE_FAILED','CLOSED')" 2>/dev/null | tr -d '[:space:]'); check "可分配卡（资格 SQL，Plus 门槛 16）" "非终态订单 $OPEN" "非终态订单"
say ""; [ "$drift" -eq 0 ] && say "==> CURRENT_STATE 与现场一致 ✓" || say "==> 有漂移/缺行：改 docs/CURRENT_STATE.md 对应行（带核对时间与证据）"
exit $drift
