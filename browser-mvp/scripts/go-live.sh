#!/usr/bin/env bash
# 来单一键启动：就绪自检 → 开付款开关(同步 executor profile + 审计) → 独立核实 → 拉 pay worker(Lane4)
#   browser-mvp/scripts/go-live.sh --arm
# 必须带 --arm（这是真实付款权限动作）。停用见 stop-live.sh。
set -euo pipefail
[ "${1:-}" = "--arm" ] || { echo "用法: $0 --arm   （开付款开关并拉 pay worker）" >&2; exit 2; }
DIR="$(cd "$(dirname "$0")" && pwd)"; Q="$DIR/prod-query.sh"
LANE="${BROWSER_POOL_LANES:-lane-4=51e915e3298b4a02bbd7468b39749c9e}"
LOG="${GO_LIVE_LOG:-$HOME/Library/Application Support/pojia-browser-live/go-live-$(date +%Y%m%d-%H%M%S).log}"
mkdir -p "$(dirname "$LOG")"
echo "== 1/4 基础就绪自检 =="
bash "$DIR/ready-check.sh" | tee /tmp/go-live-check.txt
if grep -qE '^\[(失败|警告|需操作)\]' /tmp/go-live-check.txt; then echo "!! 有阻断项，先处理再 --arm" >&2; exit 1; fi
echo "== 2/4 开付款开关（app_settings + executor profile，落审计）=="
OLD=$(bash "$Q" "SELECT setting_value FROM app_settings WHERE setting_key='browser_payment_writes_enabled'" | tr -d '[:space:]')
bash "$Q" "UPDATE app_settings SET setting_value='true', updated_at=NOW(3) WHERE setting_key='browser_payment_writes_enabled'"
bash "$Q" "UPDATE executor_profiles SET config_public_json=JSON_SET(config_public_json,'\$.productionWritesEnabled',CAST(TRUE AS JSON)) WHERE profile_code='CHATGPT_PLUS_BROWSER_V1'"
bash "$Q" "INSERT INTO admin_setting_events (setting_key, old_value, new_value, actor_id, reason, created_at) VALUES ('browser_payment_writes_enabled','${OLD:-?}','true','go-live.sh','来单启动：开付款开关拉 pay worker', NOW(3))"
echo "== 3/4 独立核实 =="
SW=$(bash "$Q" "SELECT setting_value FROM app_settings WHERE setting_key='browser_payment_writes_enabled'" | tr -d '[:space:]')
PF=$(bash "$Q" "SELECT JSON_EXTRACT(config_public_json,'\$.productionWritesEnabled') FROM executor_profiles WHERE profile_code='CHATGPT_PLUS_BROWSER_V1'" | tr -d '[:space:]')
echo "  付款开关=$SW  executorProfile=$PF"
[ "$SW" = "true" ] && [ "$PF" = "true" ] || { echo "!! 开关未生效，停止" >&2; exit 1; }
bash "$DIR/ready-check.sh" pay | tail -1 | grep -q "全部就绪" || { echo "!! pay 模式自检未全绿" >&2; exit 1; }
echo "== 4/4 拉 pay worker ($LANE) =="
( cd "$DIR/.." && BROWSER_POOL_LANES="$LANE" BROWSER_WORKER_ID=pool nohup ./scripts/run-live-pool.sh run pay >>"$LOG" 2>&1 & echo "  worker pid=$!" )
echo "  日志: $LOG"
echo "==> 已上线。看到终态后等 worker 自行收尾，再用 stop-live.sh 停。"
