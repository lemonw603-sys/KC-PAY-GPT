#!/usr/bin/env bash
# Resident multi-lane Browser worker on this machine.
#   browser-mvp/scripts/run-live-pool.sh check   rehearsal|pay
#   browser-mvp/scripts/run-live-pool.sh run     rehearsal|pay
# Lanes come from BROWSER_POOL_LANES (laneId=bitbrowserProfileId,...); default is Lane 3 only.
# rehearsal: every lane stops before the payment click (database payment flag must be false).
# pay:       lanes pay for real (database payment flag + executor profile writes must be true).
# Secrets are read from the production host over SSH into this process only.
set -euo pipefail
action=${1:-}; mode=${2:-}
case "$action" in check|run) ;; *) echo "usage: $0 check|run rehearsal|pay" >&2; exit 2 ;; esac
case "$mode" in rehearsal|pay) ;; *) echo "usage: $0 check|run rehearsal|pay" >&2; exit 2 ;; esac
HOST=root@144.34.180.184
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STATE_DIR="$HOME/Library/Application Support/pojia-browser-live/pool"
mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"
nc -z 127.0.0.1 13306 || { echo "SSH tunnel 127.0.0.1:13306 is not up" >&2; exit 1; }
curl -sf -X POST http://127.0.0.1:54345/health -H 'Content-Type: application/json' -d '{}' >/dev/null || { echo "BitBrowser Local API is not up" >&2; exit 1; }
remote_env="$(ssh -o BatchMode=yes "$HOST" 'cat /etc/pojia/runtime.env /etc/pojia/browser-readonly.env' | sed 's/^export //')"
getv() { printf '%s\n' "$remote_env" | grep -m1 "^$1=" | cut -d= -f2- | tr -d '\r' | sed 's/^"//; s/"$//'; }
prod_db="$(getv DATABASE_URL)"; [ -n "$prod_db" ] || { echo "DATABASE_URL missing on host" >&2; exit 1; }
tunnel_db="$(python3 - "$prod_db" <<'PY'
import sys, urllib.parse
u = urllib.parse.urlsplit(sys.argv[1]); auth = u.netloc.rpartition('@')[0]
print(urllib.parse.urlunsplit((u.scheme, f"{auth}@127.0.0.1:13306" if auth else "127.0.0.1:13306", u.path, u.query, u.fragment)))
PY
)"
export BROWSER_WORKER_MODE=PRODUCTION_LIVE_POOL BROWSER_PAYMENT_EXECUTOR_MODE=LIVE
export PROVIDER_WRITES_ENABLED=false PROVIDER_CARD_WRITES_ENABLED=false PROVIDER_RECHARGE_WRITES_ENABLED=false CARD_FUNDING_WRITES_ENABLED=false
export PROVIDER_READS_ENABLED="${PROVIDER_READS_ENABLED:-false}"
export DATABASE_URL="$tunnel_db" DATABASE_TLS=false
export SESSION_ENCRYPTION_KEY_BASE64="$(getv SESSION_ENCRYPTION_KEY_BASE64)"
export BROWSER_RUNTIME_HMAC_KEY_BASE64="$(getv BROWSER_RUNTIME_HMAC_KEY_BASE64)" BROWSER_ARTIFACT_KEY_BASE64="$(getv BROWSER_ARTIFACT_KEY_BASE64)" BROWSER_RESOURCE_HMAC_KEY_BASE64="$(getv BROWSER_RESOURCE_HMAC_KEY_BASE64)"
export BROWSER_WORKER_ID="${BROWSER_WORKER_ID:-pool}" BROWSER_EXECUTOR_PROFILE_ID="$(getv BROWSER_EXECUTOR_PROFILE_ID)"
export BITBROWSER_API_BASE_URL=http://127.0.0.1:54345
export BROWSER_POOL_LANES="${BROWSER_POOL_LANES:-lane-3=8f126430af0c4be4b2cfc576de82d214}"
export BROWSER_POOL_STATE_DIR="$STATE_DIR"
export BROWSER_BILLING_ADDRESS_STATE="${BROWSER_BILLING_ADDRESS_STATE:-DE}" BROWSER_BILLING_ADDRESS_NAME="${BROWSER_BILLING_ADDRESS_NAME:-Browser Billing}"
# 租约 120s 在真实客户账号上不够（清旧登录态+换 session+核身份就超了，09-09 真单预检因此重来 3 次），改 900s；租约只在步骤间续，不是总时限。
export BROWSER_EXECUTION_TIMEOUT_MS="${BROWSER_EXECUTION_TIMEOUT_MS:-120000}" BROWSER_WORKER_LEASE_SECONDS="${BROWSER_WORKER_LEASE_SECONDS:-900}"
# D-154: hold a clicked checkout while a PERSON satisfies a human-verification
# challenge in the visible window. Never solved by the worker.
export BROWSER_HUMAN_VERIFICATION_WAIT_MS="${BROWSER_HUMAN_VERIFICATION_WAIT_MS:-300000}"
if [ "$mode" = rehearsal ]; then
  export BROWSER_POOL_CONFIRMATION="I-CONFIRM-RESIDENT-BROWSER-POOL:REHEARSAL" BROWSER_LIVE_STOP_BEFORE=SUBMIT
  export BROWSER_PAYMENT_WRITES_ENABLED=false BROWSER_PAYMENT_EXECUTOR_ENABLED=false
else
  export BROWSER_POOL_CONFIRMATION="I-CONFIRM-RESIDENT-BROWSER-POOL:PAY"; unset BROWSER_LIVE_STOP_BEFORE
  if [ "$action" = check ]; then export BROWSER_PAYMENT_WRITES_ENABLED=false BROWSER_PAYMENT_EXECUTOR_ENABLED=false
  else export BROWSER_PAYMENT_WRITES_ENABLED=true BROWSER_PAYMENT_EXECUTOR_ENABLED=true; fi
fi
unset remote_env prod_db tunnel_db
cd "$ROOT/browser-mvp"
[ "$action" = check ] && exec node src/production-live-pool-worker.js --check
exec node src/production-live-pool-worker.js --run
