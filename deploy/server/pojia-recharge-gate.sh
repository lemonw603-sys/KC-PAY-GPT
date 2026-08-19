#!/usr/bin/env bash
set -euo pipefail

app_dir='/opt/pojia/current/v1'
runtime_env='/etc/pojia/runtime.env'
provider_env='/etc/pojia/provider.env'
worker_service='pojia-worker.service'

die() {
  printf 'error=%s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ ${EUID} -eq 0 ]] || die 'run_as_root'
}

run_permit() {
  (
    set -a
    source "${runtime_env}"
    set +a
    cd "${app_dir}"
    node scripts/recharge-permit.js "$@"
  )
}

set_recharge_write_flag() {
  local enabled=$1 temporary
  temporary=$(mktemp /etc/pojia/provider.env.recharge-gate.XXXXXX)
  awk '!/^PROVIDER_CARD_WRITES_ENABLED=|^PROVIDER_RECHARGE_WRITES_ENABLED=/' "${provider_env}" > "${temporary}"
  printf '%s\n' 'PROVIDER_CARD_WRITES_ENABLED=false' "PROVIDER_RECHARGE_WRITES_ENABLED=${enabled}" >> "${temporary}"
  chown root:pojia "${temporary}"
  chmod 0640 "${temporary}"
  mv "${temporary}" "${provider_env}"
}

show_flags() {
  grep -E '^(PROVIDER_WRITES_ENABLED|PROVIDER_CARD_WRITES_ENABLED|PROVIDER_RECHARGE_WRITES_ENABLED)=' "${provider_env}" || true
}

arm() {
  local public_no=${1:-} ttl=${2:-10}
  [[ -n ${public_no} ]] || die 'public_no_required'
  run_permit arm "${public_no}" --ttl-minutes "${ttl}"
  set_recharge_write_flag true
  systemctl restart "${worker_service}"
  systemctl --quiet is-active "${worker_service}" || die 'worker_not_active'
  show_flags
}

close() {
  local public_no=${1:-}
  set_recharge_write_flag false
  systemctl restart "${worker_service}"
  systemctl --quiet is-active "${worker_service}" || die 'worker_not_active'
  if [[ -n ${public_no} ]]; then run_permit revoke "${public_no}"; fi
  show_flags
}

status() {
  local public_no=${1:-}
  show_flags
  systemctl is-active "${worker_service}"
  if [[ -n ${public_no} ]]; then run_permit status "${public_no}"; fi
}

usage() {
  printf '%s\n' \
    'Usage: pojia-recharge-gate <arm|close|status> [public-no] [ttl-minutes]' \
    '  arm <public-no> [ttl]  Arm exactly one untouched order, then enable recharge writes.' \
    '  close [public-no]      Disable recharge writes first, then revoke an unused permit.' \
    '  status [public-no]     Show write flags, worker state and optional permit state.'
}

require_root
case "${1:-}" in
  arm) arm "${2:-}" "${3:-10}" ;;
  close) close "${2:-}" ;;
  status) status "${2:-}" ;;
  *) usage; exit 2 ;;
esac
