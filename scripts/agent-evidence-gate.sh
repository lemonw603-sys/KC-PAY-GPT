#!/usr/bin/env bash
set -euo pipefail

mode="${1:-local}"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

case "$mode" in
  local|production|browser-order) ;;
  *) echo "usage: $0 {local|production|browser-order}" >&2; exit 64 ;;
esac

echo "EVIDENCE_GATE_VERSION=1"
echo "MODE=$mode"
echo "REPO=$repo_root"
echo "GIT_BRANCH=$(git branch --show-current)"
echo "GIT_HEAD=$(git rev-parse HEAD)"
echo "GIT_STATUS_BEGIN"
git status --short
echo "GIT_STATUS_END"
for file in docs/PROJECT_MAP.md docs/CURRENT_STATE.md docs/PROJECT_OPERATING_MODEL.md docs/PROJECT_OPERATING_PROTOCOL.md; do
  test -r "$file" || { echo "MISSING_REQUIRED_FACT_SOURCE=$file" >&2; exit 65; }
  echo "FACT_SOURCE=$file SHA256=$(shasum -a 256 "$file" | awk '{print $1}')"
done

if [[ "$mode" == "local" ]]; then
  echo "RESULT=LOCAL_EVIDENCE_READY"
  exit 0
fi

if [[ "$mode" == "browser-order" ]]; then
  if command -v curl >/dev/null 2>&1; then
    curl -fsS -m 5 -X POST http://127.0.0.1:54345/health -H 'Content-Type: application/json' -d '{}' >/dev/null \
      || { echo "LOCAL_BITBROWSER_API=UNAVAILABLE" >&2; exit 66; }
  fi
  if ! (command -v nc >/dev/null 2>&1 && nc -z -w 2 127.0.0.1 17897 >/dev/null 2>&1); then
    echo "LOCAL_PROXY_17897=UNAVAILABLE" >&2
    exit 66
  fi
  echo "LOCAL_BITBROWSER_API=READY"
  echo "LOCAL_PROXY_17897=READY"
  if command -v pgrep >/dev/null 2>&1; then echo "LOCAL_MIHOMO_PROCESSES=$(pgrep -x mihomo | wc -l | tr -d ' ')"; fi
fi

host="${POJIA_PRODUCTION_SSH:-root@144.34.180.184}"
ssh -o BatchMode=yes -o ConnectTimeout=8 "$host" 'set -e
  echo "PRODUCTION_CURRENT=$(readlink -f /opt/pojia/current)"
  echo "PRODUCTION_WEB=$(systemctl is-active pojia-web.service || true)"
  echo "PRODUCTION_WORKER=$(systemctl is-active pojia-worker.service || true)"
  echo "PRODUCTION_BROWSER_WORKER=$(systemctl is-active pojia-browser-worker.service || true)"
  echo "PRODUCTION_BROWSER_ENABLED=$(systemctl is-enabled pojia-browser-worker.service || true)"
  echo "PRODUCTION_READY=$(curl -fsS http://127.0.0.1:3100/health/ready)"
  awk -F= '\''$1=="BROWSER_WORKER_TARGET" {print "PRODUCTION_BROWSER_TARGET="$2}'\'' /etc/pojia/browser-readonly.env
  awk -F= '\''$1=="PROVIDER_READS_ENABLED" || $1=="PROVIDER_WRITES_ENABLED" || $1=="PROVIDER_CARD_WRITES_ENABLED" || $1=="PROVIDER_RECHARGE_WRITES_ENABLED" {print "PRODUCTION_"$1"="$2}'\'' /etc/pojia/provider.env
'

if [[ "$mode" == "browser-order" ]]; then
  ssh -o BatchMode=yes -o ConnectTimeout=8 "$host" 'set -e
    set -a; . /etc/pojia/runtime.env; set +a
    cd /opt/pojia/current/v1
    node --input-type=module - <<'\''NODE'\''
import mysql from "mysql2/promise";
const pool = await mysql.createPool(process.env.DATABASE_URL);
const [orders] = await pool.query(`SELECT o.public_no, o.status,
  o.route_resolution_status, fr.route_code, fr.executor_kind,
  (SELECT COUNT(*) FROM browser_dispatch_jobs j WHERE j.order_id=o.id) AS browser_jobs,
  (SELECT COUNT(*) FROM browser_runs br JOIN recharge_attempts ra ON ra.id=br.recharge_attempt_id WHERE ra.order_id=o.id) AS browser_runs
  FROM orders o LEFT JOIN fulfillment_routes fr ON fr.id=o.fulfillment_route_id
  ORDER BY o.created_at DESC LIMIT 1`);
console.log(`LATEST_ORDER=${JSON.stringify(orders[0] || null)}`);
await pool.end();
NODE
  '
fi

mode_upper="$(printf '%s' "$mode" | tr '[:lower:]' '[:upper:]')"
echo "RESULT=${mode_upper}_EVIDENCE_READY"
