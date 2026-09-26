#!/usr/bin/env bash
# 真数据库测试（D-394 ③）：平时 `npm test` 会跳过所有要连 MySQL 的测试（没配库地址）。
# 这个脚本在本机测试容器里给每个测试文件建一个全新的隔离库 → 跑全部迁移 → 跑这个文件 → 删库。
# 每个文件一个库：测试之间互不污染（原先共用一个库，前面留下的告警会被后面的测试数到）。
#
# 用法：v1/scripts/mysql-tests.sh [测试文件 ...]      不给文件就跑全部 *mysql-integration*.test.js
# 前置：本机 Docker 容器 pojia-stage1-mysql 在跑（RUNBOOK §2.8）；或用 MYSQL_TEST_PORT 指定端口。
# 只动自己建的 pojia_it_* 库，跑完即删；容器和其它库不碰。不连生产。
set -uo pipefail
cd "$(dirname "$0")/.."

PORT="${MYSQL_TEST_PORT:-$(docker port pojia-stage1-mysql 3306/tcp 2>/dev/null | head -1 | sed 's/.*://')}"
[ -n "$PORT" ] || { echo "找不到测试数据库：pojia-stage1-mysql 容器没在跑，也没给 MYSQL_TEST_PORT" >&2; exit 2; }
ROOT_URL="mysql://root:root@127.0.0.1:${PORT}"
mysql_exec() { mysql -h 127.0.0.1 -P "$PORT" -u root -proot -e "$1" 2>&1 | grep -v 'Using a password' ; }

if [ "$#" -gt 0 ]; then files=("$@"); else files=(test/*mysql-integration*.test.js); fi
declare -a failed=()
total_pass=0; total_fail=0; total_skip=0
cleanup_db=""
trap '[ -n "$cleanup_db" ] && mysql_exec "DROP DATABASE IF EXISTS \`$cleanup_db\`;" >/dev/null' EXIT

for file in "${files[@]}"; do
  slug="$(basename "$file" .test.js | tr -c 'a-zA-Z0-9\n' '_' | cut -c1-30)"
  db="pojia_it_${slug}_$(openssl rand -hex 3)"
  cleanup_db="$db"
  mysql_exec "CREATE DATABASE \`$db\` CHARACTER SET utf8mb4;" >/dev/null
  if ! MIGRATION_DATABASE_URL="$ROOT_URL/$db" node scripts/migrate.js >/dev/null 2>&1; then
    echo "[失败] $file：迁移没跑通"; failed+=("$file"); mysql_exec "DROP DATABASE IF EXISTS \`$db\`;" >/dev/null; cleanup_db=""; continue
  fi
  url="$ROOT_URL/$db"
  out="$(TEST_DATABASE_URL="$url" ALERT_TEST_DATABASE_URL="$url" CDK_TEST_DATABASE_URL="$url" \
    CLOSEOUT_TEST_DATABASE_URL="$url" FAILSTATS_TEST_DATABASE_URL="$url" SUPPLY_ALERT_TEST_DATABASE_URL="$url" \
    node --test --test-concurrency=1 "$file" 2>&1)"
  code=$?
  pass=$(printf '%s\n' "$out" | sed -n 's/^ℹ pass //p' | tail -1); fail=$(printf '%s\n' "$out" | sed -n 's/^ℹ fail //p' | tail -1)
  skip=$(printf '%s\n' "$out" | sed -n 's/^ℹ skipped //p' | tail -1)
  total_pass=$((total_pass + ${pass:-0})); total_fail=$((total_fail + ${fail:-0})); total_skip=$((total_skip + ${skip:-0}))
  if [ "$code" -eq 0 ]; then
    printf '[通过] %s  %s 项\n' "$file" "${pass:-0}"
  else
    printf '[失败] %s  通过 %s / 失败 %s\n' "$file" "${pass:-0}" "${fail:-?}"
    printf '%s\n' "$out" | sed -n '/✖ failing tests/,$p' | grep -E '^✖ |AssertionError|Error \[|^  Error|code:' | grep -v 'failing tests' | head -12 | sed 's/^/         /'
    failed+=("$file")
  fi
  mysql_exec "DROP DATABASE IF EXISTS \`$db\`;" >/dev/null
  cleanup_db=""
done

echo
echo "==> 真数据库测试：通过 $total_pass 项、失败 $total_fail 项、跳过 $total_skip 项（${#files[@]} 个文件，每个文件一个全新隔离库，跑完已删）"
[ "${#failed[@]}" -eq 0 ] || { printf '    有失败的文件：%s\n' "${failed[*]}"; exit 1; }
