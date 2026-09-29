#!/usr/bin/env bash
# 本机后台「演示精简版」（RUNBOOK §2.8）：一条命令起真后台（当前 v1 代码）+ 按线上形状造的假数据。
# 用途：改后台界面时先在真后台上给 Lemon 看定稿；接手的人做界面回归。只在本机，不碰生产。
#
#   scripts/local-admin.sh up             建（重建）自己的库 → 迁移 → 生成临时密钥与后台口令（首次）→ 造数 → 比对形状
#   scripts/local-admin.sh serve          用那份 env 前台起 node src/server.js（.claude/launch.json 的 local-admin 调它）
#   scripts/local-admin.sh down           停服务，只删自己的库（密钥与口令文件留着，下次 up 复用）
#   scripts/local-admin.sh status         库 / 服务 / 数据快照日期
#   scripts/local-admin.sh verify         只跑形状比对（造出来的数和快照是否一致）
#   scripts/local-admin.sh refresh-shape  从生产只读取聚合，写回 v1/scripts/local-admin/shape.json（要 13306 隧道）
#
# 边界：只动 pojia_local_admin*（库名写死前缀、DROP 前先校验）；复用 pojia-stage1-mysql 容器，端口每次现查；
# 密钥与口令放 ~/Library/Application Support/pojia-local-admin/（目录 700、文件 600、不进 git、不打印口令）。
# 可调：LOCAL_ADMIN_DB（须以 pojia_local_admin 开头）、LOCAL_ADMIN_HOME、LOCAL_ADMIN_PORT、MYSQL_TEST_PORT（测试用）。
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
V1="$ROOT/v1"
TOOLS="$V1/scripts/local-admin"
STATE_DIR="${LOCAL_ADMIN_HOME:-$HOME/Library/Application Support/pojia-local-admin}"
ENV_FILE="$STATE_DIR/local-admin.env"
PASSWORD_FILE="$STATE_DIR/admin-password.txt"
PID_FILE="$STATE_DIR/serve.pid"
DB="${LOCAL_ADMIN_DB:-pojia_local_admin}"
HTTP_PORT="${LOCAL_ADMIN_PORT:-8810}"
CONTAINER=pojia-stage1-mysql

die() { echo "local-admin: $*" >&2; exit 1; }
[[ "$DB" =~ ^pojia_local_admin(_[a-z0-9]+)?$ ]] || die "库名必须是 pojia_local_admin 或 pojia_local_admin_<小写字母数字>，拒绝：$DB"
[[ "$HTTP_PORT" =~ ^[0-9]+$ ]] || die "端口不对：$HTTP_PORT"

mysql_port() {
  if [ -n "${MYSQL_TEST_PORT:-}" ]; then echo "$MYSQL_TEST_PORT"; return; fi
  local port
  port="$(docker port "$CONTAINER" 3306/tcp 2>/dev/null | head -1 | sed 's/.*://')"
  [ -n "$port" ] || die "测试数据库容器 $CONTAINER 没在跑（docker start $CONTAINER），也没给 MYSQL_TEST_PORT"
  echo "$port"
}
sql() { MYSQL_PWD=root mysql -h 127.0.0.1 -P "$(mysql_port)" -u root --default-character-set=utf8mb4 -N -e "$1"; }
db_exists() { [ -n "$(sql "SHOW DATABASES LIKE '$DB'")" ]; }
db_url() { echo "mysql://root:root@127.0.0.1:$(mysql_port)/$DB"; }

# 只删自己的库：名字在脚本开头已校验过前缀，这里再校验一遍，防止以后有人改了上面的逻辑。
drop_own_db() {
  [[ "$DB" =~ ^pojia_local_admin(_[a-z0-9]+)?$ ]] || die "拒绝删除 $DB"
  sql "DROP DATABASE IF EXISTS \`$DB\`;"
}

ensure_secrets() {
  umask 077
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  if [ -s "$ENV_FILE" ] && [ -s "$PASSWORD_FILE" ]; then
    chmod 600 "$ENV_FILE" "$PASSWORD_FILE"
    return
  fi
  # 七把各自独立的 32 字节密钥（配置校验要求互不相同）+ 后台口令（只写文件，不打印）
  local keys=() k
  while [ "${#keys[@]}" -lt 7 ]; do
    k="$(openssl rand -base64 32)"
    [[ " ${keys[*]:-} " == *" $k "* ]] || keys+=("$k")
  done
  local password hash
  password="$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-24)"
  hash="$(printf '%s' "$password" | (cd "$V1" && node "$TOOLS/cli.mjs" hash))"
  [[ "$hash" == scrypt-v1\$* ]] || die "生成口令哈希失败"
  # 值一律单引号包住：哈希形如 scrypt-v1$…$…，不包的话 source 时 $ 会被展开成空（RUNBOOK §2.8 的坑）。
  # 不设 ADMIN_HOST：设了会做 Host 校验，localhost 进不去。不设卡台 / 直充的 API Key：本机不连外网。
  cat > "$ENV_FILE" <<EOF
# scripts/local-admin.sh 生成的本机临时配置。只给本机演示后台用；不进 git、不要复制到别处。
NODE_ENV='development'
HOST='127.0.0.1'
SESSION_ENCRYPTION_KEY_BASE64='${keys[0]}'
CDK_HASH_KEY_V1_BASE64='${keys[1]}'
CDK_RECOVERY_KEY_BASE64='${keys[2]}'
CDK_DELIVERY_HMAC_KEY_BASE64='${keys[3]}'
CARD_INTAKE_PAN_HMAC_KEY_BASE64='${keys[4]}'
PAYMENT_REFERENCE_HMAC_KEY_BASE64='${keys[5]}'
ADMIN_SESSION_SECRET_BASE64='${keys[6]}'
ADMIN_PASSWORD_HASH='${hash}'
EOF
  printf '%s\n' "$password" > "$PASSWORD_FILE"
  chmod 600 "$ENV_FILE" "$PASSWORD_FILE"
  password=''
  echo "已生成本机临时密钥与后台口令（$STATE_DIR）"
}

load_env() {
  [ -s "$ENV_FILE" ] || die "还没有本机配置，先跑 scripts/local-admin.sh up"
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  export DATABASE_URL; DATABASE_URL="$(db_url)"
  export PORT="$HTTP_PORT"
  export LOCAL_ADMIN_SHAPE="$TOOLS/shape.json"
}

server_pid() {
  local pid
  [ -s "$PID_FILE" ] && pid="$(cat "$PID_FILE")" && kill -0 "$pid" 2>/dev/null \
    && ps -o command= -p "$pid" | grep -q 'src/server.js' && { echo "$pid"; return; }
  # 兜底：看端口上是不是本工具起的 node（命令行带 local-admin 的 offline-guard）
  pid="$(lsof -ti "tcp:$HTTP_PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
  [ -n "$pid" ] && ps -o command= -p "$pid" | grep -q 'local-admin/offline-guard.mjs' && echo "$pid"
  return 0
}

cmd_up() {
  command -v mysql >/dev/null || die "缺少 mysql 客户端"
  [ -d "$V1/node_modules" ] || die "v1/node_modules 不存在（先在 v1 里 npm ci）"
  ensure_secrets
  local port; port="$(mysql_port)"
  echo "==> 重建本机库 $DB（容器 $CONTAINER，端口 $port；只删这一个库）"
  drop_own_db
  sql "CREATE DATABASE \`$DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
  (cd "$V1" && MIGRATION_DATABASE_URL="$(db_url)" node scripts/migrate.js >/dev/null) || die "迁移失败"
  echo "    迁移完成：$(sql "SELECT COUNT(*) FROM \`$DB\`.schema_migrations") 个"
  echo "==> 按形状快照造数（快照见 v1/scripts/local-admin/shape.json）"
  load_env
  local code=0
  (cd "$V1" && node "$TOOLS/cli.mjs" seed) || code=$?
  echo
  echo "后台地址：http://127.0.0.1:$HTTP_PORT/admin    （先 scripts/local-admin.sh serve，或 preview_start local-admin）"
  echo "口令文件：$PASSWORD_FILE    （口令不在这里打印）"
  [ "$code" -eq 0 ] || { echo "注意：造出来的数和快照有不一致（见上），页面仍可看。" >&2; exit "$code"; }
}

cmd_serve() {
  db_exists || die "本机库 $DB 不存在，先跑 scripts/local-admin.sh up"
  load_env
  mkdir -p "$STATE_DIR"
  echo "$$" > "$PID_FILE"
  local app_dir="$V1" node_flags=()
  # 后台页面走 express 的 sendFile，它会把路径里任何以 . 开头的目录当隐藏文件、一律 404。
  # 在 .claude/worktrees/ 下的工作树里跑时，经一个不带点的软链接起服务（主仓库目录下不需要）。
  # 链的是仓库根（v1 会引用同级的 browser-mvp/src）。
  if [[ "$V1" == */.* ]]; then
    ln -sfn "$ROOT" "$STATE_DIR/repo-link"
    app_dir="$STATE_DIR/repo-link/v1"
    node_flags=(--preserve-symlinks --preserve-symlinks-main)
  fi
  cd "$V1"
  # offline-guard：挡住一切外网请求（卡台 / 直充 / 推送），highvcc 只读两个接口本机应答；按快照保持心跳新鲜度。
  # 用绝对路径起（工作目录会被系统解析成真实路径，软链接只有写在命令行上才算数）。
  exec node ${node_flags[@]+"${node_flags[@]}"} --import "$app_dir/scripts/local-admin/offline-guard.mjs" "$app_dir/src/server.js"
}

cmd_down() {
  local pid; pid="$(server_pid)"
  if [ -n "$pid" ]; then
    kill -TERM "$pid" 2>/dev/null || true
    for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done
    echo "已停服务（PID $pid）"
  else
    echo "服务没在跑"
  fi
  rm -f "$PID_FILE"
  if db_exists; then drop_own_db; echo "已删本机库 $DB（别的库一个没动）"; else echo "本机库 $DB 本来就不在"; fi
}

cmd_status() {
  echo "形状快照：$(cd "$V1" && node -e "console.log(require('./scripts/local-admin/shape.json').capturedAt + '（UTC）')")"
  if db_exists; then
    load_env
    echo "本机库：$DB 在（$(cd "$V1" && node "$TOOLS/cli.mjs" counts)）"
  else
    echo "本机库：$DB 不在（scripts/local-admin.sh up 建）"
  fi
  local pid; pid="$(server_pid)"
  if [ -n "$pid" ] && curl -fsS "http://127.0.0.1:$HTTP_PORT/health/live" >/dev/null 2>&1; then
    echo "服务：在跑（PID $pid）http://127.0.0.1:$HTTP_PORT/admin"
  else
    echo "服务：没在跑（scripts/local-admin.sh serve 或 preview_start local-admin）"
  fi
  echo "配置与口令：$STATE_DIR（$( [ -s "$PASSWORD_FILE" ] && echo 口令文件在 || echo 还没生成)）"
}

case "${1:-}" in
  up) cmd_up ;;
  serve) cmd_serve ;;
  down) cmd_down ;;
  status) cmd_status ;;
  verify) load_env; cd "$V1" && node "$TOOLS/cli.mjs" verify ;;
  refresh-shape) cd "$V1" && node "$TOOLS/refresh-shape.mjs" ;;
  *) sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
