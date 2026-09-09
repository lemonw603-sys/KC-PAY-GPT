#!/usr/bin/env bash
# 生产库只读/运维查询：经 13306 隧道连生产 MySQL，凭证运行时经 SSH 取入本进程、不落盘。
#   browser-mvp/scripts/prod-query.sh "SELECT ..."
set -euo pipefail
HOST=root@144.34.180.184
nc -z 127.0.0.1 13306 >/dev/null 2>&1 || { echo "tunnel 13306 down" >&2; exit 1; }
prod_db="$(ssh -o BatchMode=yes "$HOST" 'cat /etc/pojia/runtime.env' | sed 's/^export //' | grep -m1 '^DATABASE_URL=' | cut -d= -f2- | tr -d '\r' | sed 's/^"//; s/"$//')"
[ -n "$prod_db" ] || { echo "DATABASE_URL missing" >&2; exit 1; }
creds="$(python3 - "$prod_db" <<'PY'
import sys,urllib.parse
u=urllib.parse.urlsplit(sys.argv[1])
print(f"{urllib.parse.unquote(u.username or '')}\t{urllib.parse.unquote(u.password or '')}\t{(u.path or '/').lstrip('/')}")
PY
)"
USER="$(printf '%s' "$creds" | cut -f1)"; PW="$(printf '%s' "$creds" | cut -f2)"; DB="$(printf '%s' "$creds" | cut -f3)"
MYSQL_PWD="$PW" mysql --protocol=TCP -h 127.0.0.1 -P 13306 -u "$USER" "$DB" -N -e "$1"
