#!/usr/bin/env bash
# 收工：停 pay worker（先等其收尾）→ 关付款开关(同步 profile + 审计) → 独立核实
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"; Q="$DIR/prod-query.sh"
echo "== 停 worker =="
for p in $(pgrep -f production-live-pool-worker || true); do kill "$p" 2>/dev/null && echo "  killed $p"; done
sleep 2; pgrep -f production-live-pool-worker >/dev/null && echo "  仍有 worker" || echo "  worker 已停"
echo "== 关付款开关 =="
bash "$Q" "UPDATE app_settings SET setting_value='false', updated_at=NOW(3) WHERE setting_key='browser_payment_writes_enabled'"
bash "$Q" "UPDATE executor_profiles SET config_public_json=JSON_SET(config_public_json,'\$.productionWritesEnabled',CAST(FALSE AS JSON)) WHERE profile_code='CHATGPT_PLUS_BROWSER_V1'"
bash "$Q" "INSERT INTO admin_setting_events (setting_key, old_value, new_value, actor_id, reason, created_at) VALUES ('browser_payment_writes_enabled','true','false','stop-live.sh','收工：关付款开关', NOW(3))"
echo "  付款开关=$(bash "$Q" "SELECT setting_value FROM app_settings WHERE setting_key='browser_payment_writes_enabled'" | tr -d '[:space:]')"
echo "  账号槽 active_runs=$(bash "$Q" "SELECT COUNT(*) FROM browser_runs WHERE active_account_key_hmac IS NOT NULL" | tr -d '[:space:]')"
