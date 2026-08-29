#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

refuse() { echo "production-readonly smoke refused: $*" >&2; exit 2; }
for name in CHATGPT_SESSION_COOKIE CHATGPT_TOKEN SESSION_JSON CARD_NUMBER CARD_EXPIRY CARD_CVC HNSKJ_API_KEY ZZSHU_API_KEY; do
  [[ -z "${!name:-}" ]] || refuse "$name must be unset"
done
for name in BROWSER_PAYMENT_WRITES_ENABLED PROVIDER_WRITES_ENABLED PROVIDER_CARD_WRITES_ENABLED PROVIDER_RECHARGE_WRITES_ENABLED CARD_FUNDING_WRITES_ENABLED; do
  [[ -z "${!name:-}" || "${!name}" == "false" ]] || refuse "$name must not be true"
done
command -v docker >/dev/null 2>&1 || refuse "docker is required"
docker info >/dev/null 2>&1 || refuse "docker daemon is unavailable"

container_name="codex-browser-production-readonly-$PPID-$(date +%s)"
runtime_root="$(mktemp -d /tmp/browser-production-readonly.XXXXXX)"
cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
  rm -rf "$runtime_root"
}
trap cleanup EXIT

docker run --rm -d --name "$container_name" \
  -e MYSQL_ROOT_PASSWORD=root -e MYSQL_DATABASE=pojia_test \
  -p 127.0.0.1::3306 mysql:8.4 >/dev/null
stable=0
for i in $(seq 1 120); do
  if docker exec "$container_name" mysql -uroot -proot -Nse "SELECT 1" >/dev/null 2>&1; then
    stable=$((stable + 1)); [[ "$stable" -ge 3 ]] && break
  else
    stable=0
  fi
  [[ "$i" -eq 120 ]] && refuse "isolated MySQL did not become ready"
  sleep 1
done
port="$(docker port "$container_name" 3306/tcp | awk -F: 'NR==1 {print $NF}')"
database_url="mysql://root:root@127.0.0.1:${port}/pojia_test"
MIGRATION_DATABASE_URL="$database_url" MIGRATION_DATABASE_TLS=false npm --prefix "$repo_root/v1" run migrate >/tmp/browser-production-readonly-migrate.log
docker exec "$container_name" mysql -uroot -proot pojia_test -e \
  "INSERT INTO executor_profiles
     (id, profile_code, profile_version, executor_kind, runtime_id, adapter_version, status, config_public_json)
   VALUES
     ('00000000-0000-4000-8000-000000000001', 'LOCAL_PRODUCTION_READONLY_SMOKE', 1,
      'BROWSER', 'SHARED_DRY_RUN', 'SHARED_DRY_RUN', 'ACTIVE',
      JSON_OBJECT('isolatedTest', TRUE, 'productionWritesEnabled', FALSE));"
chrome_path="${AGENT_BROWSER_EXECUTABLE_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
key1="$(node -e "process.stdout.write(Buffer.alloc(32, 1).toString('base64'))")"
key2="$(node -e "process.stdout.write(Buffer.alloc(32, 2).toString('base64'))")"
key3="$(node -e "process.stdout.write(Buffer.alloc(32, 3).toString('base64'))")"
env \
  NODE_ENV=test DATABASE_URL="$database_url" DATABASE_TLS=false \
  BROWSER_WORKER_MODE=PRODUCTION_READONLY \
  BROWSER_WORKER_CONFIRMATION='RUN BROWSER PRODUCTION READONLY WORKER' \
  BROWSER_WORKER_TARGET=LOCAL_FIXTURE BROWSER_WORKER_ID=systemd-equivalent-check \
  BROWSER_EXECUTOR_PROFILE_ID=00000000-0000-4000-8000-000000000001 \
  BROWSER_PROFILES_ROOT="$runtime_root/profiles" BROWSER_WAL_PATH="$runtime_root/evidence.wal.jsonl" \
  BROWSER_CHROME_EXECUTABLE_PATH="$chrome_path" \
  BROWSER_OBSERVE_URL_PREFIX='data:text/html,<title>check</title><main>ok</main>' \
  BROWSER_OBSERVE_TITLE=check BROWSER_OBSERVE_REQUIRED_SELECTOR=main BROWSER_OBSERVE_MARKER_TEXT=ok \
  BROWSER_RUNTIME_HMAC_KEY_BASE64="$key1" BROWSER_ARTIFACT_KEY_BASE64="$key2" \
  BROWSER_RESOURCE_HMAC_KEY_BASE64="$key3" \
  BROWSER_PAYMENT_EXECUTOR_ENABLED=false BROWSER_PAYMENT_EXECUTOR_MODE=MOCK \
  BROWSER_PAYMENT_WRITES_ENABLED=false PROVIDER_WRITES_ENABLED=false \
  PROVIDER_CARD_WRITES_ENABLED=false PROVIDER_RECHARGE_WRITES_ENABLED=false \
  CARD_FUNDING_WRITES_ENABLED=false \
  node "$repo_root/browser-mvp/src/production-readonly-worker.js" --check
node --test \
  "$repo_root/browser-mvp/test/production-readonly-config.test.js" \
  "$repo_root/browser-mvp/test/production-readonly-systemd.test.js"
TEST_DATABASE_URL="$database_url" node --test \
  "$repo_root/browser-mvp/test/production-readonly-worker-mysql-smoke.test.js" \
  "$repo_root/browser-mvp/test/payment-executor-mysql-integration.test.js"
