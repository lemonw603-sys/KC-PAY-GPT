#!/bin/bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
env_file="${BROWSER_LOCAL_ENV_FILE:-$HOME/Library/Application Support/VibeBridge/browser-readonly.env}"
worker_pid=""
tunnel_pid=""

fail() { echo "macOS Browser Worker refused: $*" >&2; exit 2; }
stop_children() {
  [[ -z "$worker_pid" ]] || kill -TERM "$worker_pid" 2>/dev/null || true
  [[ -z "$tunnel_pid" ]] || kill -TERM "$tunnel_pid" 2>/dev/null || true
  [[ -z "$worker_pid" ]] || wait "$worker_pid" 2>/dev/null || true
  [[ -z "$tunnel_pid" ]] || wait "$tunnel_pid" 2>/dev/null || true
}
trap stop_children EXIT INT TERM HUP

[[ "$(uname -s)" == "Darwin" ]] || fail "this launcher requires macOS"
[[ -f "$env_file" ]] || fail "environment file is missing: $env_file"
perm="$(stat -f '%Lp' "$env_file")"
[[ "$perm" == "600" ]] || fail "environment file must have mode 0600"
set -a
# The env file is operator-owned configuration and must never contain shell commands.
# shellcheck disable=SC1090
source "$env_file"
set +a

for name in \
  BROWSER_PAYMENT_WRITES_ENABLED PROVIDER_WRITES_ENABLED PROVIDER_CARD_WRITES_ENABLED \
  PROVIDER_RECHARGE_WRITES_ENABLED CARD_FUNDING_WRITES_ENABLED; do
  [[ "${!name:-}" == "false" ]] || fail "$name must be exactly false"
done
[[ "${BROWSER_PAYMENT_EXECUTOR_ENABLED:-}" == "false" ]] || fail "BROWSER_PAYMENT_EXECUTOR_ENABLED must be false"
[[ "${BROWSER_PAYMENT_EXECUTOR_MODE:-}" == "MOCK" ]] || fail "BROWSER_PAYMENT_EXECUTOR_MODE must be MOCK"
[[ "${BROWSER_CHROME_HEADLESS:-}" == "false" ]] || fail "BROWSER_CHROME_HEADLESS must be false"
for name in CHATGPT_SESSION_COOKIE CHATGPT_TOKEN SESSION_JSON CARD_NUMBER CARD_EXPIRY CARD_CVC HNSKJ_API_KEY ZZSHU_API_KEY; do
  [[ -z "${!name:-}" ]] || fail "$name must be absent"
done

runtime_provider="${BROWSER_RUNTIME_PROVIDER:-GOOGLE_CHROME}"
case "$runtime_provider" in
  GOOGLE_CHROME)
    chrome="${BROWSER_CHROME_EXECUTABLE_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
    [[ -x "$chrome" ]] || fail "headed Google Chrome is not executable: $chrome"
    [[ -n "${BROWSER_PROFILES_ROOT:-}" ]] || fail "BROWSER_PROFILES_ROOT is required for Google Chrome"
    ;;
  BITBROWSER)
    [[ "${BROWSER_BITBROWSER_ENABLED:-}" == "true" ]] || fail "BROWSER_BITBROWSER_ENABLED must be true"
    [[ "${BROWSER_BITBROWSER_API_URL:-}" == http://127.0.0.1:* ]] \
      || fail "BROWSER_BITBROWSER_API_URL must use 127.0.0.1"
    [[ -n "${BROWSER_BITBROWSER_PROFILE_ID:-}" ]] || fail "BROWSER_BITBROWSER_PROFILE_ID is required"
    ;;
  *) fail "BROWSER_RUNTIME_PROVIDER must be GOOGLE_CHROME or BITBROWSER" ;;
esac
[[ -n "${BROWSER_DB_TUNNEL_SSH_TARGET:-}" ]] || fail "BROWSER_DB_TUNNEL_SSH_TARGET is required"
[[ -n "${BROWSER_DB_TUNNEL_IDENTITY_FILE:-}" ]] || fail "BROWSER_DB_TUNNEL_IDENTITY_FILE is required"
[[ -f "$BROWSER_DB_TUNNEL_IDENTITY_FILE" ]] || fail "SSH identity file is missing"
identity_perm="$(stat -f '%Lp' "$BROWSER_DB_TUNNEL_IDENTITY_FILE")"
[[ "$identity_perm" == "600" || "$identity_perm" == "400" ]] || fail "SSH identity file must have mode 0400 or 0600"
local_port="${BROWSER_DB_TUNNEL_LOCAL_PORT:-13306}"
remote_host="${BROWSER_DB_TUNNEL_REMOTE_HOST:-127.0.0.1}"
remote_port="${BROWSER_DB_TUNNEL_REMOTE_PORT:-3306}"
[[ "$local_port" =~ ^[0-9]+$ && "$local_port" -ge 1024 && "$local_port" -le 65535 ]] || fail "invalid local tunnel port"
[[ "$remote_host" == "127.0.0.1" || "$remote_host" == "localhost" ]] || fail "remote MySQL tunnel target must be loopback"
[[ "$remote_port" =~ ^[0-9]+$ && "$remote_port" -ge 1 && "$remote_port" -le 65535 ]] || fail "invalid remote tunnel port"

node -e '
  const u = new URL(process.env.DATABASE_URL || "");
  const expected = String(process.env.BROWSER_DB_TUNNEL_LOCAL_PORT || "13306");
  if (u.protocol !== "mysql:" || !["127.0.0.1", "localhost"].includes(u.hostname) || (u.port || "3306") !== expected) process.exit(2);
' || fail "DATABASE_URL must use the configured local loopback tunnel port"

if [[ "$runtime_provider" == "GOOGLE_CHROME" ]]; then
  mkdir -p "$BROWSER_PROFILES_ROOT"
  chmod 700 "$BROWSER_PROFILES_ROOT"
fi
mkdir -p "$(dirname "$BROWSER_WAL_PATH")"
chmod 700 "$(dirname "$BROWSER_WAL_PATH")"

ssh -N -T \
  -i "$BROWSER_DB_TUNNEL_IDENTITY_FILE" \
  -o BatchMode=yes -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=15 -o ServerAliveCountMax=2 \
  -L "127.0.0.1:${local_port}:${remote_host}:${remote_port}" \
  "$BROWSER_DB_TUNNEL_SSH_TARGET" &
tunnel_pid=$!

ready=0
for _ in $(seq 1 30); do
  kill -0 "$tunnel_pid" 2>/dev/null || fail "SSH tunnel exited before readiness"
  if nc -z 127.0.0.1 "$local_port" >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == "1" ]] || fail "SSH tunnel did not become ready"

node "$repo_root/browser-mvp/src/production-readonly-worker.js" --check

# caffeinate prevents idle/system sleep while the headed GUI Worker owns a lease.
caffeinate -dimsu node "$repo_root/browser-mvp/src/production-readonly-worker.js" --once &
worker_pid=$!

# Either side dying closes the other. A lost tunnel therefore sends SIGTERM to
# the Worker, whose AbortController closes the Browser runtime and stops actions.
while kill -0 "$worker_pid" 2>/dev/null && kill -0 "$tunnel_pid" 2>/dev/null; do sleep 2; done
if ! kill -0 "$tunnel_pid" 2>/dev/null; then
  echo "macOS Browser Worker stopping because the database tunnel was lost" >&2
  kill -TERM "$worker_pid" 2>/dev/null || true
  wait "$worker_pid" 2>/dev/null || true
  exit 3
fi
wait "$worker_pid"
