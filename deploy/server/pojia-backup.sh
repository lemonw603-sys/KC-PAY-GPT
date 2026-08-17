#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "pojia-backup.sh must run as root" >&2
  exit 1
fi

backup_dir='/var/backups/pojia'
work_dir=$(mktemp -d "${backup_dir}/.work.XXXXXX")
trap 'find "${work_dir}" -type f -delete; rmdir "${work_dir}" 2>/dev/null || true' EXIT

install -d -m 0700 -o root -g root "${backup_dir}"
backup_password=$(tr -d '\n' </etc/pojia/mysql-backup-password)

docker exec -e MYSQL_PWD="${backup_password}" pojia-mysql \
  mysqldump -u pojia_backup \
    --single-transaction --routines --events --triggers --hex-blob --no-tablespaces pojia \
  | gzip -9 \
  | openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 \
      -pass file:/etc/pojia/backup-key \
      -out "${work_dir}/pojia.sql.gz.enc"

stamp=$(date -u +%Y%m%dT%H%M%SZ)
output="${backup_dir}/pojia-${stamp}.sql.gz.enc"
mv "${work_dir}/pojia.sql.gz.enc" "${output}"
sha256sum "${output}" >"${output}.sha256"
chmod 0600 "${output}" "${output}.sha256"

find "${backup_dir}" -maxdepth 1 -type f -name 'pojia-*.sql.gz.enc' -mtime +14 -delete
find "${backup_dir}" -maxdepth 1 -type f -name 'pojia-*.sql.gz.enc.sha256' -mtime +14 -delete

printf 'backup_created=%s\n' "${output}"
