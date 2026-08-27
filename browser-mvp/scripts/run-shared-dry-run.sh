#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

die() {
  echo "shared Browser dry-run refused: $*" >&2
  exit 2
}

required_env() {
  local name="$1"
  [[ -n "${!name:-}" ]] || die "$name is required"
}

required_env BROWSER_DRY_RUN_ENV
case "$BROWSER_DRY_RUN_ENV" in
  isolated)
    required_env TEST_DATABASE_URL
    [[ "$TEST_DATABASE_URL" == mysql://* ]] || die "TEST_DATABASE_URL must use mysql://"
    ;;
  isolated-fixture)
    command -v docker >/dev/null 2>&1 || die "docker is required for isolated-fixture"
    ;;
  preprod)
    [[ "${BROWSER_DRY_RUN_PREPROD_CONFIRM:-}" == "I-CONFIRM-NONPAYMENT-PREPROD" ]] \
      || die "preprod requires BROWSER_DRY_RUN_PREPROD_CONFIRM=I-CONFIRM-NONPAYMENT-PREPROD"
    required_env TEST_DATABASE_URL
    [[ "$TEST_DATABASE_URL" == mysql://* ]] || die "TEST_DATABASE_URL must use mysql://"
    ;;
  *) die "BROWSER_DRY_RUN_ENV must be isolated, isolated-fixture, or preprod" ;;
esac

for name in \
  BROWSER_PAYMENT_WRITES_ENABLED \
  PROVIDER_WRITES_ENABLED \
  PROVIDER_CARD_WRITES_ENABLED \
  PROVIDER_RECHARGE_WRITES_ENABLED \
  CARD_FUNDING_WRITES_ENABLED; do
  [[ "${!name:-}" == "false" ]] || die "$name must be exactly false"
done

for name in CHATGPT_SESSION_COOKIE CHATGPT_TOKEN SESSION_JSON CARD_NUMBER CARD_EXPIRY CARD_CVC; do
  [[ -z "${!name:-}" ]] || die "$name must be unset for a non-payment dry-run"
done

run_checks() {
  echo "running shared Browser non-payment checks (writes disabled)"
  npm --prefix "$repo_root/browser-mvp" run check
  TEST_DATABASE_URL="$TEST_DATABASE_URL" \
    node --test "$repo_root/browser-mvp/test/shared-dry-run-mysql-integration.test.js"
}

if [[ "$BROWSER_DRY_RUN_ENV" != isolated-fixture ]]; then
  run_checks
  exit 0
fi

container_name="codex-browser-dry-run-$PPID-$(date +%s)"
cleanup_fixture() { docker rm -f "$container_name" >/dev/null 2>&1 || true; }
trap cleanup_fixture EXIT
docker run --rm -d --name "$container_name" \
  -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=pojia_test \
  -p 127.0.0.1::3306 mysql:8.4 >/dev/null

stable=0
for i in $(seq 1 120); do
  if docker exec "$container_name" mysql -uroot -proot -Nse "SELECT 1" >/dev/null 2>&1; then
    stable=$((stable + 1))
    [[ "$stable" -ge 3 ]] && break
  else
    stable=0
  fi
  [[ "$i" -eq 120 ]] && die "isolated MySQL fixture did not become ready"
  sleep 1
done

fixture_port="$(docker port "$container_name" 3306/tcp | awk -F: 'NR==1 {print $NF}')"
TEST_DATABASE_URL="mysql://root:root@127.0.0.1:${fixture_port}/pojia_test"
MIGRATION_DATABASE_URL="$TEST_DATABASE_URL" MIGRATION_DATABASE_TLS=false npm --prefix "$repo_root/v1" run migrate >/tmp/browser-shared-dry-run-migrate.log
run_checks
