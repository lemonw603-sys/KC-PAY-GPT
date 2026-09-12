#!/usr/bin/env bash
# 把源码里所有 SQL 字面量拿到生产库 PREPARE 一遍：校验语法、表名、列名，**不执行**。
#
# 为什么需要：单元测试里的数据库是假的，SQL 字符串从来没被真正解析过。
# 2026-09-12 就因此漏掉一个致命错误（browser_operations.created_at 这一列不存在），
# 726 项测试全绿而九阶段整个失效。空表对应的路径（退款、补偿、对账、恢复）
# 更是从没在生产跑过，那里的 SQL 谁也没验证过。
#
#   v1/scripts/sql-probe.sh            # 全量验证
# 前置：SSH 隧道 13306 已起。只读安全：PREPARE 只解析不执行，DEALLOCATE 立即释放。
set -uo pipefail
cd "$(dirname "$0")/.."
OUT=/tmp/sql-probe.sql
node scripts/extract-sql.mjs "$OUT" || exit 1

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

# --force：一条失败继续跑下一条，才能一次拿到全部问题
raw="$(MYSQL_PWD="$PW" mysql --protocol=TCP -h 127.0.0.1 -P 13306 -u "$USER" "$DB" -N --force < "$OUT" 2>&1)"

# 每条 PREPARE 前都打印了 "#i 文件:行号"，出错时取前面最近的那个标记。
# 1243（Unknown prepared statement handler）是前一条 PREPARE 失败后 DEALLOCATE
# 的连带报错，不是独立问题，计数时排除，否则一个问题会被数成两个。
printf '%s\n' "$raw" | awk '
  /^#[0-9]+ / { where = $0; next }
  /^ERROR 1243/ { next }
  /^ERROR/    { print where; print "    " $0 }
' | sed 's/check the manual.*use near/…near/'

fails="$(printf '%s\n' "$raw" | grep -c '^ERROR' || true)"
linked="$(printf '%s\n' "$raw" | grep -c '^ERROR 1243' || true)"
real=$(( fails - linked ))
checked="$(grep -c '^PREPARE' "$OUT")"
printf '\n共验证 %s 条 SQL，真实失败 %s 条（另有 %s 条 DEALLOCATE 连带报错，不计）\n' "$checked" "$real" "$linked"
if [ "$real" -eq 0 ]; then
  echo "==> 所有 SQL 的语法、表名、列名都对得上生产 schema ✓"
else
  echo "==> 有 SQL 对不上生产 schema ✗"
fi
[ "$real" -eq 0 ]
