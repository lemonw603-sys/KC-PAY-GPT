#!/usr/bin/env bash
set -euo pipefail

backup_dir='/var/backups/pojia'
backup_key='/etc/pojia/backup-key'
backup_service='pojia-backup.service'
backup_timer='pojia-backup.timer'
mysql_image='mysql:8.4.11'

die() {
  printf 'error=%s\n' "$*" >&2
  exit 1
}

require_root() {
  [[ ${EUID} -eq 0 ]] || die 'run_as_root'
}

latest_backup() {
  find "${backup_dir}" -maxdepth 1 -type f -name 'pojia-*.sql.gz.enc' \
    -printf '%T@ %p\n' 2>/dev/null \
    | sort -nr \
    | head -n 1 \
    | cut -d' ' -f2-
}

resolve_backup() {
  local candidate=${1:-}
  if [[ -z ${candidate} ]]; then
    candidate=$(latest_backup)
  fi
  [[ -n ${candidate} && -f ${candidate} ]] || die 'backup_not_found'
  [[ -f ${candidate}.sha256 ]] || die 'checksum_not_found'
  printf '%s\n' "${candidate}"
}

verify_backup() {
  local backup
  backup=$(resolve_backup "${1:-}")
  [[ -r ${backup_key} ]] || die 'backup_key_not_readable'

  sha256sum --check "${backup}.sha256"
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
    -pass "file:${backup_key}" -in "${backup}" \
    | gzip --test
  printf 'backup_integrity=OK\nbackup_file=%s\n' "${backup}"
}

status() {
  local backup='none'
  backup=$(latest_backup || true)
  [[ -n ${backup} ]] || backup='none'

  printf 'release=%s\n' "$(readlink -f /opt/pojia/current 2>/dev/null || printf 'missing')"
  printf 'web=%s\n' "$(systemctl is-active pojia-web.service 2>/dev/null || true)"
  printf 'worker=%s\n' "$(systemctl is-active pojia-worker.service 2>/dev/null || true)"
  printf 'mysql=%s\n' "$(docker inspect --format '{{.State.Status}}' pojia-mysql 2>/dev/null || printf 'missing')"
  printf 'backup_timer=%s\n' "$(systemctl is-active "${backup_timer}" 2>/dev/null || true)"
  printf 'latest_backup=%s\n' "${backup}"
  if [[ ${backup} != none ]]; then
    stat --printf='latest_backup_bytes=%s\nlatest_backup_time=%y\n' "${backup}"
  fi
}

create_backup() {
  systemctl start "${backup_service}"
  systemctl --quiet is-failed "${backup_service}" && die 'backup_service_failed'
  verify_backup
}

restore_test() {
  local backup container database table_count
  backup=$(resolve_backup "${1:-}")
  verify_backup "${backup}"

  container="pojia-restore-test-$$"
  database='pojia_restore_test'
  # The EXIT trap runs after this function's local variables are gone.
  # Capture the literal container name so `set -u` cannot break cleanup.
  trap 'docker rm --force "pojia-restore-test-$$" >/dev/null 2>&1 || true' EXIT

  docker run --detach --rm --name "${container}" --network none \
    --env MYSQL_ALLOW_EMPTY_PASSWORD=yes "${mysql_image}" --skip-networking \
    >/dev/null

  # The official image briefly starts a temporary initialization server before
  # stopping it and launching the final server. A plain mysqladmin ping can hit
  # that temporary server and make the restore race with its shutdown. Wait for
  # the entrypoint's initialization-complete marker before probing readiness.
  local attempt
  for attempt in $(seq 1 60); do
    if docker logs "${container}" 2>&1 \
      | grep 'MySQL init process done. Ready for start up.' >/dev/null; then
      break
    fi
    sleep 1
  done
  docker logs "${container}" 2>&1 \
    | grep 'MySQL init process done. Ready for start up.' >/dev/null \
    || die 'restore_mysql_init_timeout'

  for attempt in $(seq 1 60); do
    if docker exec "${container}" mysqladmin ping --user=root --silent >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  docker exec "${container}" mysqladmin ping --user=root --silent >/dev/null 2>&1 \
    || die 'restore_mysql_start_timeout'

  docker exec "${container}" mysql --user=root \
    --execute "CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"

  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
    -pass "file:${backup_key}" -in "${backup}" \
    | gzip --decompress --stdout \
    | docker exec --interactive "${container}" mysql --user=root "${database}"

  table_count=$(docker exec "${container}" mysql --batch --skip-column-names --user=root \
    --execute "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${database}'")
  [[ ${table_count} =~ ^[0-9]+$ && ${table_count} -gt 0 ]] || die 'restore_has_no_tables'

  printf 'restore_test=OK\nrestored_tables=%s\nbackup_file=%s\n' \
    "${table_count}" "${backup}"
}

usage() {
  cat <<'USAGE'
Usage: pojia-ops <command> [backup-file]

Commands:
  status        Show service, timer, release and latest-backup status.
  backup        Create and verify a new encrypted production backup.
  verify        Verify checksum, decryption and gzip integrity.
  restore-test  Restore into an isolated temporary MySQL container.
  check         Run status and verify the latest backup.
USAGE
}

main() {
  case "${1:-}" in
    help|-h|--help|'') usage; return ;;
  esac

  require_root
  case "${1:-}" in
    status) status ;;
    backup) create_backup ;;
    verify) verify_backup "${2:-}" ;;
    restore-test) restore_test "${2:-}" ;;
    check) status; verify_backup "${2:-}" ;;
    *) usage >&2; die 'unknown_command' ;;
  esac
}

main "$@"
