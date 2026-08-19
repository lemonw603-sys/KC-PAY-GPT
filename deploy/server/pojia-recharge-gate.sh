#!/usr/bin/env bash
set -euo pipefail

app_dir='/opt/pojia/current/v1'
runtime_env='/etc/pojia/runtime.env'

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

arm() {
  local public_no=${1:-} ttl=${2:-10}
  [[ -n ${public_no} ]] || die 'public_no_required'
  run_permit arm "${public_no}" --ttl-minutes "${ttl}"
}

close() {
  local public_no=${1:-}
  if [[ -n ${public_no} ]]; then run_permit revoke "${public_no}"; fi
}

status() {
  local public_no=${1:-}
  if [[ -n ${public_no} ]]; then run_permit status "${public_no}"; fi
}

usage() {
  printf '%s\n' \
    'Usage: pojia-recharge-gate <arm|close|status> [public-no] [ttl-minutes]' \
    '  arm <public-no> [ttl]  Arm exactly one untouched order.' \
    '  close [public-no]      Revoke an unused permit.' \
    '  status [public-no]     Show optional permit state.'
}

require_root
case "${1:-}" in
  arm) arm "${2:-}" "${3:-10}" ;;
  close) close "${2:-}" ;;
  status) status "${2:-}" ;;
  *) usage; exit 2 ;;
esac
