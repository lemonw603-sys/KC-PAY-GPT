#!/usr/bin/env bash
# 生产库只读/运维查询：经 13306 隧道连生产 MySQL，凭证运行时经 SSH 取入本进程、不落盘。
#   browser-mvp/scripts/prod-query.sh "SELECT ..."
set -euo pipefail
HOST=root@144.34.180.184
nc -z 127.0.0.1 13306 >/dev/null 2>&1 || { echo "tunnel 13306 down" >&2; exit 1; }
# 复用一条 SSH 连接（D-204）。每次调用各开一条时，ready-check 一轮 5 条 + supervisor
# 查开关 1 条 = 每分钟 6 条突发，撞上 sshd 的未认证并发上限被随机拒连：实测单条成功率
# 约 75%，一轮全过只剩 ~18%，于是 supervisor 反复报「付款开关取不到，只等不跑」——
# 它每分钟自己把自己挡在门外。ControlPersist 只留 30 秒，刚够覆盖一轮查询就断开，
# 不让一条 root 连接长期驻留。socket 由 ssh 自建为 0600。
SSH_OPTS=(-o BatchMode=yes -o ControlMaster=auto -o "ControlPath=/tmp/.pojia-cm-$(id -u)-%h-%p-%r" -o ControlPersist=30)
prod_db="$(ssh "${SSH_OPTS[@]}" "$HOST" 'cat /etc/pojia/runtime.env' | sed 's/^export //' | grep -m1 '^DATABASE_URL=' | cut -d= -f2- | tr -d '\r' | sed 's/^"//; s/"$//')"
[ -n "$prod_db" ] || { echo "DATABASE_URL missing" >&2; exit 1; }
creds="$(python3 - "$prod_db" <<'PY'
import sys,urllib.parse
u=urllib.parse.urlsplit(sys.argv[1])
print(f"{urllib.parse.unquote(u.username or '')}\t{urllib.parse.unquote(u.password or '')}\t{(u.path or '/').lstrip('/')}")
PY
)"
USER="$(printf '%s' "$creds" | cut -f1)"; PW="$(printf '%s' "$creds" | cut -f2)"; DB="$(printf '%s' "$creds" | cut -f3)"
MYSQL_PWD="$PW" mysql --protocol=TCP --default-character-set=utf8mb4 -h 127.0.0.1 -P 13306 -u "$USER" "$DB" -N -e "$1"
