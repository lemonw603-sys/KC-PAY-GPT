#!/usr/bin/env bash
set -euo pipefail

# Read-only preflight for the local BitBrowser proxy.  A listening TCP port is
# not sufficient: mihomo must be the single managed instance and the upstream
# must successfully carry an HTTPS request.
PROXY_DIR="${BITBROWSER_PROXY_DIR:-$HOME/Library/Application Support/AI充值业务/bitbrowser-proxy}"
PROXY_PORT="${BITBROWSER_PROXY_PORT:-17897}"
PROXY_URL="${BITBROWSER_PROXY_URL:-http://127.0.0.1:${PROXY_PORT}}"
IP_CHECK_URL="${BITBROWSER_PROXY_IP_CHECK_URL:-https://api.ipify.org?format=json}"

fail() { echo "BITBROWSER_PROXY_STATUS=FAIL"; echo "BITBROWSER_PROXY_REASON=$1" >&2; exit 1; }

pids="$(pgrep -x mihomo || true)"
count=0
pid=""
while IFS= read -r candidate; do
  [[ -n "$candidate" ]] || continue
  count=$((count + 1))
  pid="$candidate"
done <<EOF
$pids
EOF
(( count == 1 )) || fail "expected_one_mihomo_process_found_${count}"
command_line="$(ps -o command= -p "$pid" | tr -s ' ')"
[[ "$command_line" == *"$PROXY_DIR"* ]] || fail "mihomo_process_not_using_expected_directory"

listener="$(lsof -nP -a -p "$pid" -iTCP:"$PROXY_PORT" -sTCP:LISTEN 2>/dev/null || true)"
[[ "$listener" == *":${PROXY_PORT} (LISTEN)"* ]] || fail "expected_process_not_listening_on_${PROXY_PORT}"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
curl -fsS --max-time 15 -x "$PROXY_URL" -o "$tmp" -w '%{http_code}' "$IP_CHECK_URL" \
  | grep -Eq '^[23][0-9][0-9]$' || fail "upstream_proxy_request_failed"
ip="$(cat "$tmp")"
[[ -n "$ip" ]] || fail "proxy_ip_response_empty"

echo "BITBROWSER_PROXY_STATUS=READY"
echo "BITBROWSER_PROXY_PID=$pid"
echo "BITBROWSER_PROXY_PORT=$PROXY_PORT"
echo "BITBROWSER_PROXY_EGRESS=$ip"
