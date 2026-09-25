#!/usr/bin/env bash
# 本机常驻付款池的「固定版本目录」（2026-09-25 Lemon 同意方向，D-376）。
# 以前常驻池直接跑 main 工作区代码：谁在 main 里改了 browser-mvp，池子下次重启就等于上线了付款路径。
# 这里照搬服务器 release 的做法：从单一提交打包 → 解到 $POOL_HOME/releases/<name> → 校验 → 装依赖 →
# 自检依赖都解析在 release 目录内 → 原子切换 $POOL_HOME/current。
#
#   scripts/pool-release.sh prepare <commit> [name]   只建目录、不碰在跑的池
#   scripts/pool-release.sh switch <name>             只换 current 软链；不停、不启池（重启照旧先问 Lemon，D-254）
#   scripts/pool-release.sh verify <name>             重跑依赖自检（switch 前也会自动跑）
#   scripts/pool-release.sh status                    current 指向哪、在跑的 worker 实际跑哪份代码
#
# 状态（WAL、卡租约、supervisor.log）本来就在 ~/Library/Application Support/pojia-browser-live，
# 与代码位置无关；release 目录里不放任何状态。池要从这里跑，launchd plist 须指向
# $POOL_HOME/current/browser-mvp/scripts/live-pool-supervisor.sh（deploy/local/com.pojia.browser-pool.plist）。
set -euo pipefail
POOL_HOME=${POOL_HOME:-"$HOME/pojia-pool"}
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
die(){ printf '%s\n' "$*" >&2; exit 1; }
decode(){ python3 -c 'import sys; s=sys.argv[1]; print(s.encode("latin-1","backslashreplace").decode("unicode_escape").encode("latin-1").decode("utf-8"))' "$1"; }

verify_release(){ # 依赖都解析在 release 目录内 + worker 入口能过 node --check；switch 前再跑一次
  local r; r=$(cd "$1" && pwd -P) || die "no release dir: $1"
  echo "== self-check: every dependency resolves inside the release =="
  # 主工作区的依赖在仓库根 node_modules，~/node_modules 里还有一份游离 zod；漏装时会静默解析到别处。
  local resolve='const {createRequire}=require("module"); const r=createRequire(process.argv[1]+"/"); for (const p of process.argv.slice(2)) console.log(r.resolve(p));'
  local paths; paths=$( (cd "$r/browser-mvp" && node -e "$resolve" "$r/browser-mvp" playwright) && (cd "$r/v1" && node -e "$resolve" "$r/v1" mysql2 zod fflate) ) \
    || die "dependency resolution failed in $r"
  local p bad=0
  while IFS= read -r p; do case "$p" in "$r"/*) echo "  ok ${p#"$r"/}" ;; *) echo "  OUTSIDE $p" >&2; bad=1 ;; esac; done <<< "$paths"
  [ "$bad" = 0 ] || die "a dependency resolved outside $r"
  (cd "$r/browser-mvp" && node --check src/production-live-pool-worker.js) || die "node --check failed"
}

prepare(){
  local commitish=${1:-} name=${2:-}
  [ -n "$commitish" ] || die "usage: $0 prepare <commit> [name]"
  local commit; commit=$(git -C "$REPO" rev-parse --verify "${commitish}^{commit}") || die "no such commit: $commitish"
  [ -n "$name" ] || name="$(date -u +%Y%m%d)-${commit:0:7}"
  case "$name" in *[!A-Za-z0-9._-]*|'') die "release name may only contain A-Za-z0-9._- : '$name'" ;; esac
  local b="$POOL_HOME/bundles/$name" r="$POOL_HOME/releases/$name"
  [ -e "$b" ] && die "bundle exists: $b"
  [ -e "$r" ] && die "release dir exists: $r"
  mkdir -p "$POOL_HOME/bundles" "$POOL_HOME/releases"
  echo "== bundle $commit =="
  bash "$REPO/scripts/build-production-release.sh" "$commit" "$b" >/dev/null
  echo "== extract =="
  mkdir -p "$r"; tar -xzf "$b/source.tar.gz" -C "$r"
  echo "== verify manifest (all tracked files) =="
  "$r/scripts/verify-production-release.sh" "$r" "$b/source-manifest.sha256"
  echo "== install deps (lockfiles, --omit=dev; same as server) =="
  npm --prefix "$r/v1" ci --omit=dev --no-audit --no-fund >/dev/null
  PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm --prefix "$r/browser-mvp" ci --omit=dev --no-audit --no-fund >/dev/null
  verify_release "$r"
  printf 'commit=%s\nname=%s\nprepared_at=%s\nnode=%s\n' "$commit" "$name" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(node -v)" > "$r/POOL_RELEASE"  # node = 装依赖时的版本；launchd 下跑的是 /usr/local/bin/node
  echo "== prepared: $r =="
  echo "next: $0 switch $name   (current -> $(readlink "$POOL_HOME/current" 2>/dev/null || echo none))"
}

switch(){
  local name=${1:-}; [ -n "$name" ] || die "usage: $0 switch <name>"
  local r="$POOL_HOME/releases/$name"
  [ -f "$r/POOL_RELEASE" ] || die "not a prepared release (no POOL_RELEASE): $r"
  verify_release "$r"
  local prev; prev=$(readlink "$POOL_HOME/current" 2>/dev/null || true)
  ln -sfn "releases/$name" "$POOL_HOME/current.tmp"
  mv -fh "$POOL_HOME/current.tmp" "$POOL_HOME/current"
  echo "current -> $(readlink "$POOL_HOME/current")"
  [ -n "$prev" ] && echo "ROLLBACK: $0 switch ${prev#releases/}"
  echo "在跑的 worker 不会自己换代码：按演练流程停池后，supervisor 下一次拉起时才用新版本。用 status 核对。"
}

status(){
  local cur; cur=$(readlink "$POOL_HOME/current" 2>/dev/null || true)
  if [ -n "$cur" ]; then
    echo "current -> $cur"; sed 's/^/  /' "$POOL_HOME/$cur/POOL_RELEASE" 2>/dev/null || echo "  (no POOL_RELEASE)"
  else echo "current: none ($POOL_HOME/current 不存在)"; fi
  local sup; sup=$(pgrep -f 'live-pool-supervisor.sh' 2>/dev/null | tr '\n' ' ' | sed 's/ *$//')
  echo "supervisor: ${sup:-未运行}"
  for pid in $sup; do echo "  $pid $(LC_ALL=en_US.UTF-8 ps -o command= -p "$pid" 2>/dev/null)"; done
  local w; w=$(pgrep -f 'src/production-live-pool-worker.js --run' 2>/dev/null | tr '\n' ' ' | sed 's/ *$//')
  [ -n "$w" ] || { echo "worker: 未运行"; return 0; }
  local want=""; [ -n "$cur" ] && want=$(cd "$POOL_HOME/current/browser-mvp" 2>/dev/null && pwd -P)
  for pid in $w; do
    local cwd; cwd=$(decode "$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)")
    if [ -n "$want" ] && [ "$cwd" = "$want" ]; then echo "worker $pid: 跑 current（$cwd）"
    elif case "$cwd" in "$POOL_HOME"/releases/*) true ;; *) false ;; esac; then echo "worker $pid: 跑旧的固定版本（$cwd），不是 current"
    else echo "worker $pid: 不在固定版本目录（$cwd）"; fi
  done
}

case "${1:-}" in
  prepare) shift; prepare "$@" ;;
  switch) shift; switch "$@" ;;
  verify) shift; [ -n "${1:-}" ] || die "usage: $0 verify <name>"; verify_release "$POOL_HOME/releases/$1"; echo "verify ok" ;;
  status) status ;;
  *) die "usage: $0 prepare <commit> [name] | verify <name> | switch <name> | status" ;;
esac
