#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
read -r -s -p 'New admin password (12-256 chars): ' PASSWORD
printf '\n'
read -r -s -p 'Confirm new admin password: ' CONFIRM
printf '\n'
if [[ "$PASSWORD" != "$CONFIRM" ]]; then
  echo 'passwords_do_not_match' >&2
  exit 1
fi
if (( ${#PASSWORD} < 12 || ${#PASSWORD} > 256 )); then
  echo 'password_length_must_be_12_to_256' >&2
  exit 1
fi

HASH=$(cd "$ROOT_DIR" && ADMIN_PASSWORD="$PASSWORD" node v1/scripts/hash-admin-password.js)
unset PASSWORD CONFIRM

printf '%s\n' "$HASH" | ssh -o BatchMode=yes root@144.34.180.184 '\
  read -r HASH; \
  tmp=$(mktemp /etc/pojia/.admin.env.XXXXXX); \
  awk -v h="$HASH" '\''BEGIN{done=0} /^ADMIN_PASSWORD_HASH=/{print "ADMIN_PASSWORD_HASH=" h; done=1; next} {print} END{if(!done) print "ADMIN_PASSWORD_HASH=" h}'\'' /etc/pojia/admin.env > "$tmp"; \
  chown root:root "$tmp"; chmod 600 "$tmp"; mv "$tmp" /etc/pojia/admin.env; \
  PW=$(cat /etc/pojia/mysql-root-password); \
  docker exec -e MYSQL_PWD="$PW" pojia-mysql mysql -uroot -NBe \
    "UPDATE pojia.app_settings SET setting_value=CAST(CAST(setting_value AS UNSIGNED)+1 AS CHAR) WHERE setting_key=\\"admin_session_version\\""; \
  systemctl restart pojia-web.service; \
  sleep 3; \
  systemctl is-active --quiet pojia-web.service; \
  echo admin_password_rotation=complete'

unset HASH
echo 'Password rotated. Do not store it in shell history or send it in chat.'
