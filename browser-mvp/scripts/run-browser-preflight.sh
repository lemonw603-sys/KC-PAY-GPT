#!/usr/bin/env bash
# Local BROWSER_PREFLIGHT runner (readonly worker, CHATGPT_ACCOUNT_CHECKOUT harness):
# claims the order's BROWSER_PREFLIGHT task, injects the order's Session into the
# resident BitBrowser identity, verifies identity/FREE, opens the pricing modal and
# creates a cardless Checkout, then marks the task PASSED/FAILED. No card, no payment.
#   browser-mvp/scripts/run-browser-preflight.sh check | once
# Secrets are read from the production host over SSH into this process only.
set -euo pipefail
mode=${1:-}; case "$mode" in check|once) ;; *) echo "usage: $0 check | once" >&2; exit 2 ;; esac
HOST=root@144.34.180.184
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PROFILE_ID=${BITBROWSER_PROFILE_ID:-8f126430af0c4be4b2cfc576de82d214}   # Plus Browser PH Lane 3
CHROME=${BROWSER_CHROME_EXECUTABLE_PATH:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}
STATE_DIR="$HOME/Library/Application Support/pojia-browser-live"
mkdir -p "$STATE_DIR/profiles"; chmod 700 "$STATE_DIR"
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
export BROWSER_WORKER_MODE=PRODUCTION_READONLY
export BROWSER_WORKER_CONFIRMATION="RUN BROWSER PRODUCTION READONLY WORKER"
export BROWSER_PAYMENT_WRITES_ENABLED=false BROWSER_PAYMENT_EXECUTOR_ENABLED=false BROWSER_PAYMENT_EXECUTOR_MODE=MOCK
export PROVIDER_WRITES_ENABLED=false PROVIDER_CARD_WRITES_ENABLED=false PROVIDER_RECHARGE_WRITES_ENABLED=false CARD_FUNDING_WRITES_ENABLED=false
export BROWSER_SHARED_MATERIALS_MODE=SHARED_ENCRYPTED_NONPAYMENT BROWSER_READONLY_HARNESS=CHATGPT_ACCOUNT_CHECKOUT
export BROWSER_WORKER_TARGET=BITBROWSER_READONLY BITBROWSER_PROFILE_ID="$PROFILE_ID" BITBROWSER_API_BASE_URL=http://127.0.0.1:54345
export BITBROWSER_READONLY_CONFIRM=I-CONFIRM-BITBROWSER-READONLY-SHARED-MATERIALS-NO-PAYMENT
export BROWSER_OBSERVE_URL_PREFIX=https://chatgpt.com/ BROWSER_OBSERVE_TITLE=ChatGPT BROWSER_OBSERVE_REQUIRED_SELECTOR=body BROWSER_OBSERVE_MARKER_TEXT=""
export BROWSER_CHROME_EXECUTABLE_PATH="$CHROME" BROWSER_CHROME_HEADLESS=false
export BROWSER_WORKER_ID="${BROWSER_WORKER_ID:-local-readonly-lane3}" BROWSER_EXECUTOR_PROFILE_ID="$(getv BROWSER_EXECUTOR_PROFILE_ID)"
export BROWSER_PROFILES_ROOT="$STATE_DIR/profiles" BROWSER_WAL_PATH="$STATE_DIR/readonly.wal"
export DATABASE_URL="$tunnel_db" DATABASE_TLS=false
export SESSION_ENCRYPTION_KEY_BASE64="$(getv SESSION_ENCRYPTION_KEY_BASE64)"
export BROWSER_RUNTIME_HMAC_KEY_BASE64="$(getv BROWSER_RUNTIME_HMAC_KEY_BASE64)" BROWSER_ARTIFACT_KEY_BASE64="$(getv BROWSER_ARTIFACT_KEY_BASE64)" BROWSER_RESOURCE_HMAC_KEY_BASE64="$(getv BROWSER_RESOURCE_HMAC_KEY_BASE64)"
export BROWSER_EXECUTION_TIMEOUT_MS="${BROWSER_EXECUTION_TIMEOUT_MS:-120000}" BROWSER_WORKER_LEASE_SECONDS=120
unset remote_env prod_db tunnel_db
cd "$ROOT/browser-mvp"
[ "$mode" = check ] && exec node src/production-readonly-worker.js --check
exec node src/production-readonly-worker.js --once
