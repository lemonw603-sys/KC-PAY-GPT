#!/usr/bin/env bash
# Production release for AI充值业务: prepare (build/upload/backup/stage) → [migrate] → switch.
# Usage: scripts/deploy-release.sh prepare <commit> <name>; [scripts/deploy-release.sh migrate <name>]; scripts/deploy-release.sh switch <name>.
# Needs SSH access to the production host (see docs/PRODUCTION_PREP_RUNBOOK.md). Never run against a dirty or unpushed commit.
#   prepare <commit> <release-name>  build bundle from one commit, upload, backup DB,
#                                    extract, verify manifest, install deps. No switch.
#   switch  <release-name>           atomically point /opt/pojia/current, restart Web,
#                                    health-check, print rollback command.
set -euo pipefail

HOST=root@144.34.180.184
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=20 ${HOST}"

phase=${1:-}; shift || true

prepare() {
  local commit=$1 name=$2
  local bundle="${REPO}/artifacts/release-candidate-${name}"
  cd "${REPO}"
  git rev-parse --verify "${commit}^{commit}" >/dev/null
  local full; full=$(git rev-parse "${commit}^{commit}")
  if [[ -f "${bundle}/release-metadata.json" ]] && grep -q "\"commit\": \"${full}\"" "${bundle}/release-metadata.json"; then
    echo "== reuse existing bundle for ${full} =="
    (cd "${bundle}" && shasum -a 256 -c source.tar.gz.sha256)
  else
    echo "== build bundle from ${commit} =="
    scripts/build-production-release.sh "${commit}" "${bundle}"
  fi
  echo "== upload bundle =="
  ${SSH} "mkdir -p /opt/pojia/release-bundles/${name}"
  scp -q -o BatchMode=yes "${bundle}/source.tar.gz" "${bundle}/source.tar.gz.sha256" \
      "${bundle}/source-manifest.sha256" "${bundle}/release-metadata.json" \
      "${HOST}:/opt/pojia/release-bundles/${name}/"
  ${SSH} bash -s "${name}" <<'REMOTE'
set -euo pipefail
name=$1
b=/opt/pojia/release-bundles/${name}
r=/opt/pojia/releases/${name}
echo "== archive hash =="
(cd "$b" && sha256sum -c source.tar.gz.sha256)
echo "== database backup =="
pojia-ops backup
pojia-ops verify
echo "== extract =="
[ -e "$r" ] && { echo "release dir exists: $r" >&2; exit 3; }
mkdir -p "$r"
tar -xzf "$b/source.tar.gz" -C "$r"
echo "== verify manifest (all tracked files) =="
"$r/scripts/verify-production-release.sh" "$r" "$b/source-manifest.sha256"
echo "== install deps (lockfiles unchanged; same as previous releases) =="
npm --prefix "$r/v1" ci --omit=dev --no-audit --no-fund >/dev/null
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm --prefix "$r/browser-mvp" ci --omit=dev --no-audit --no-fund >/dev/null
echo "== ready to switch: $r =="
echo "previous=$(readlink -f /opt/pojia/current)"
REMOTE
}

# Apply pending migrations from the staged release before switching to it.
# Runs twice on purpose: the second pass must only report "already applied".
migrate() {
  local name=$1
  echo "== migrate from /opt/pojia/releases/${name} =="
  ${SSH} "set -e; cd /opt/pojia/releases/${name}/v1 && set -a && . /etc/pojia/migration.env && set +a \
    && npm run migrate --silent && echo '-- second pass --' && npm run migrate --silent"
  ${SSH} "cd /opt/pojia/current/v1 && set -a && . /etc/pojia/runtime.env && set +a && node --input-type=module -e \"
import { loadRuntimeDatabaseConfig } from './src/config.js'; import { createDatabasePool } from './src/db/pool.js';
const pool = createDatabasePool(loadRuntimeDatabaseConfig(process.env));
const [rows] = await pool.query('SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 3');
console.log('schema_migrations latest:', rows.map((r) => r.version).join(', ')); await pool.end();\"" 2>/dev/null | grep -v Warning
}

switch() {
  local name=$1
  ${SSH} bash -s "${name}" <<'REMOTE'
set -euo pipefail
name=$1
r=/opt/pojia/releases/${name}
[ -d "$r/v1/node_modules" ] || { echo "release not prepared: $r" >&2; exit 4; }
prev=$(readlink -f /opt/pojia/current)
echo "previous=$prev"
ln -sfn "$r" /opt/pojia/current
systemctl restart pojia-web.service
sleep 2
systemctl is-active pojia-web.service
echo "current=$(readlink -f /opt/pojia/current)"
curl -s -o /dev/null -w "live=%{http_code}\n" http://127.0.0.1:3100/health/live
curl -s -w " ready=%{http_code}\n" http://127.0.0.1:3100/health/ready
h=$(grep -oE "^ADMIN_HOST=.*" /etc/pojia/runtime.env | cut -d= -f2-)
echo "index.html on disk references: $(grep -oE 'admin\.js\?v=[0-9]+' /opt/pojia/current/v1/public/admin/index.html)"
echo "served admin.js?v=23 status/new-action count: $(curl -s -H "Host: $h" -o /tmp/adm.js -w '%{http_code}' 'http://127.0.0.1:3100/admin/assets/admin.js?v=23') / $(grep -c CONFIRM_MANUAL_PAYMENT /tmp/adm.js)"; rm -f /tmp/adm.js
echo "admin login page: $(curl -s -o /dev/null -H "Host: $h" -w '%{http_code}' http://127.0.0.1:3100/admin/login)"
echo "ROLLBACK: ln -sfn $prev /opt/pojia/current && systemctl restart pojia-web.service"
REMOTE
}

case "${phase}" in
  prepare) prepare "$@" ;;
  migrate) migrate "$@" ;;
  switch) switch "$@" ;;
  *) echo "usage: $0 prepare <commit> <release-name> | migrate <release-name> | switch <release-name>" >&2; exit 2 ;;
esac
