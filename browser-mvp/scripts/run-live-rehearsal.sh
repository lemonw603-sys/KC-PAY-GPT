#!/usr/bin/env bash
# One-order LIVE rehearsal on this machine: the exact production Browser path
# (Session → identity → pricing modal → Checkout → card/address/email →
# zero-tax requote → final recheck) that STOPS BEFORE the payment click.
#
#   browser-mvp/scripts/run-live-rehearsal.sh check
#   browser-mvp/scripts/run-live-rehearsal.sh once <orderId>
#
# Secrets are read from the production host over SSH into this process's
# environment only; nothing is written to disk. Requires the SSH tunnel
# 127.0.0.1:13306 → production MySQL and the BitBrowser Local API.
set -euo pipefail

mode=${1:-}; order=${2:-}
case "$mode" in
  check) ;;
  once) [ -n "$order" ] || { echo "usage: $0 once <orderId>" >&2; exit 2; } ;;
  *) echo "usage: $0 check | once <orderId>" >&2; exit 2 ;;
esac

HOST=root@144.34.180.184
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROFILE_ID=${BITBROWSER_PROFILE_ID:-8f126430af0c4be4b2cfc576de82d214}   # Plus Browser PH Lane 3
CHROME=${BROWSER_CHROME_EXECUTABLE_PATH:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
STATE_DIR="$HOME/Library/Application Support/pojia-browser-live"
mkdir -p "$STATE_DIR"; chmod 700 "$STATE_DIR"

nc -z 127.0.0.1 13306 || { echo "SSH tunnel 127.0.0.1:13306 is not up" >&2; exit 1; }
curl -sf -X POST http://127.0.0.1:54345/health -H 'Content-Type: application/json' -d '{}' >/dev/null || { echo "BitBrowser Local API is not up" >&2; exit 1; }

# Pull only the named variables; values never echo.
remote_env="$(ssh -o BatchMode=yes "$HOST" 'cat /etc/pojia/runtime.env /etc/pojia/browser-readonly.env' | sed 's/^export //')"
getv() { printf '%s\n' "$remote_env" | grep -m1 "^$1=" | cut -d= -f2- | tr -d '\r'; }
prod_db="$(getv DATABASE_URL)"
[ -n "$prod_db" ] || { echo "DATABASE_URL missing on host" >&2; exit 1; }
tunnel_db="$(python3 - "$prod_db" <<'PY'
import sys, urllib.parse
u = urllib.parse.urlsplit(sys.argv[1]); auth = u.netloc.rpartition('@')[0]
print(urllib.parse.urlunsplit((u.scheme, f"{auth}@127.0.0.1:13306" if auth else "127.0.0.1:13306", u.path, u.query, u.fragment)))
PY
)"

export BROWSER_WORKER_MODE=PRODUCTION_LIVE
export BROWSER_PAYMENT_EXECUTOR_MODE=LIVE
export BROWSER_PAYMENT_WRITES_ENABLED=false BROWSER_PAYMENT_EXECUTOR_ENABLED=false
export PROVIDER_WRITES_ENABLED=false PROVIDER_CARD_WRITES_ENABLED=false PROVIDER_RECHARGE_WRITES_ENABLED=false CARD_FUNDING_WRITES_ENABLED=false
export PROVIDER_READS_ENABLED=false
export DATABASE_URL="$tunnel_db" DATABASE_TLS=false
export SESSION_ENCRYPTION_KEY_BASE64="$(getv SESSION_ENCRYPTION_KEY_BASE64)"
export BROWSER_RUNTIME_HMAC_KEY_BASE64="$(getv BROWSER_RUNTIME_HMAC_KEY_BASE64)"
export BROWSER_ARTIFACT_KEY_BASE64="$(getv BROWSER_ARTIFACT_KEY_BASE64)"
export BROWSER_RESOURCE_HMAC_KEY_BASE64="$(getv BROWSER_RESOURCE_HMAC_KEY_BASE64)"
export BROWSER_WORKER_ID="${BROWSER_WORKER_ID:-$(getv BROWSER_WORKER_ID)}"
export BROWSER_EXECUTOR_PROFILE_ID="${BROWSER_EXECUTOR_PROFILE_ID:-$(getv BROWSER_EXECUTOR_PROFILE_ID)}"
export BITBROWSER_API_BASE_URL=http://127.0.0.1:54345 BITBROWSER_PROFILE_ID="$PROFILE_ID"
export BROWSER_CHROME_EXECUTABLE_PATH="$CHROME"
export BROWSER_BILLING_ADDRESS_STATE="${BROWSER_BILLING_ADDRESS_STATE:-DE}"
export BROWSER_BILLING_ADDRESS_NAME="${BROWSER_BILLING_ADDRESS_NAME:-Browser Billing}"
export BROWSER_WAL_PATH="$STATE_DIR/live.wal" BROWSER_CARD_LEASE_PATH="$STATE_DIR/card-leases.json"
export BROWSER_EXECUTION_TIMEOUT_MS="${BROWSER_EXECUTION_TIMEOUT_MS:-120000}"
export BROWSER_LIVE_DIAGNOSTIC=true
unset remote_env prod_db tunnel_db

cd "$ROOT/browser-mvp"
if [ "$mode" = check ]; then
  exec node src/production-live-worker.js --check
fi
export BROWSER_LIVE_STOP_BEFORE=SUBMIT
export BROWSER_LIVE_ORDER_ID="$order"
export BROWSER_LIVE_OPERATION_CONFIRMATION="I-CONFIRM-ONE-LIVE-BROWSER-REHEARSAL:$order"
export BROWSER_POST_PLUS_ACTION=CANCEL_RENEWAL
exec node src/production-live-worker.js --once
