#!/usr/bin/env bash
set -euo pipefail

fail() { echo "dry-run readiness: FAIL: $*" >&2; exit 2; }
pass() { echo "dry-run readiness: PASS: $*"; }

mode="${BROWSER_DRY_RUN_ENV:-}"
[[ -n "$mode" ]] || fail "BROWSER_DRY_RUN_ENV is required"
case "$mode" in
  isolated-fixture)
    command -v docker >/dev/null 2>&1 || fail "docker is required for isolated-fixture"
    docker info >/dev/null 2>&1 || fail "docker daemon is unavailable"
    pass "local isolated fixture runtime"
    ;;
  isolated|preprod)
    [[ "${TEST_DATABASE_URL:-}" == mysql://* ]] || fail "TEST_DATABASE_URL must be a mysql:// URL"
    if [[ "$mode" == preprod ]]; then
      [[ "${BROWSER_DRY_RUN_PREPROD_CONFIRM:-}" == "I-CONFIRM-NONPAYMENT-PREPROD" ]] \
        || fail "preprod confirmation is required"
    fi
    pass "$mode database URL shape"
    ;;
  *) fail "BROWSER_DRY_RUN_ENV must be isolated-fixture, isolated, or preprod" ;;
esac

for name in \
  BROWSER_PAYMENT_WRITES_ENABLED \
  PROVIDER_WRITES_ENABLED \
  PROVIDER_CARD_WRITES_ENABLED \
  PROVIDER_RECHARGE_WRITES_ENABLED \
  CARD_FUNDING_WRITES_ENABLED; do
  [[ "${!name:-}" == "false" ]] || fail "$name must be exactly false"
done
pass "all payment/provider/card write switches are false"

for name in CHATGPT_SESSION_COOKIE CHATGPT_TOKEN SESSION_JSON CARD_NUMBER CARD_EXPIRY CARD_CVC; do
  [[ -z "${!name:-}" ]] || fail "$name must be unset"
done
pass "no raw Session/PAN/CVC environment material"

chrome_path="${BROWSER_CHROME_EXECUTABLE_PATH:-${AGENT_BROWSER_EXECUTABLE_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}}"
[[ -x "$chrome_path" ]] || fail "Chrome executable is not executable: $chrome_path"
pass "Chrome executable is available"

if [[ "$mode" == isolated-fixture ]]; then
  worker_id="${BROWSER_WORKER_ID:-local-dry-run-worker}"
  profile_id="${BROWSER_EXECUTOR_PROFILE_ID:-local-dry-run-profile}"
else
  [[ -n "${BROWSER_WORKER_ID:-}" ]] || fail "BROWSER_WORKER_ID is required"
  [[ -n "${BROWSER_EXECUTOR_PROFILE_ID:-}" ]] || fail "BROWSER_EXECUTOR_PROFILE_ID is required"
  worker_id="$BROWSER_WORKER_ID"
  profile_id="$BROWSER_EXECUTOR_PROFILE_ID"
fi
pass "worker parameters present (worker=${worker_id}, profile=${profile_id})"
