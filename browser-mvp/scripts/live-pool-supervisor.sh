#!/usr/bin/env bash
# 常驻监督：把"运营手动拉起 worker"换成"客户什么时候来都有人接"（D-167 第 2 项）。
#
# 为什么要这层而不是让 launchd 直接跑 worker：worker 对启动条件是严格断言——付款开关
# 不是 true、隧道不通、比特浏览器没开，它都直接退出。KeepAlive 会把这些正常的"条件
# 还没齐"变成秒级崩溃循环。这里先等条件齐，再把 worker 拉到前台；worker 退出就回到
# 等待，条件不齐只是安静地等。
#
# 付款开关仍然是人的总闸：关掉它，本脚本就只等不跑，不会自作主张打开。
#
#   browser-mvp/scripts/live-pool-supervisor.sh          # 前台跑，Ctrl-C 停
#   （常驻由 deploy/local/com.pojia.browser-pool.plist 装成 LaunchAgent）
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LANE="${BROWSER_POOL_LANES:-lane-1=10f0dc7b534844c083165796447d5893}"
WAIT_SECONDS="${SUPERVISOR_WAIT_SECONDS:-60}"
STATE_DIR="$HOME/Library/Application Support/pojia-browser-live"
mkdir -p "$STATE_DIR"

log() { printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"; }

last_reason=""
while true; do
  # 付款开关必须自己查：ready-check 把它归为 [信息] 而不是阻断项，光靠它的严重级别
  # 会让本脚本以为条件已齐、每轮拉起 worker 又被 worker 自己拒掉（实测 15 秒一次空转）。
  pay="$(bash "$DIR/prod-query.sh" "SELECT setting_value FROM app_settings WHERE setting_key='browser_payment_writes_enabled'" 2>/dev/null | tr -d '[:space:]')"
  if [ "$pay" != "true" ]; then
    if [ "$last_reason" != "PAY_OFF" ]; then log "付款开关为 ${pay:-取不到}，只等不跑（这是人的总闸，本脚本不会自己打开）"; last_reason="PAY_OFF"; fi
    sleep "$WAIT_SECONDS"
    continue
  fi

  # 其余条件沿用既有的唯一就绪口径，不另起炉灶。
  out="$(bash "$DIR/ready-check.sh" pay 2>&1)"
  if printf '%s' "$out" | grep -qE '^\[(失败|警告|需操作)\]'; then
    reason="$(printf '%s' "$out" | grep -E '^\[(失败|警告|需操作)\]' | head -3 | tr '\n' '；')"
    # 同一个原因只说一次，免得日志被刷屏；原因变了才再打一行。
    if [ "$reason" != "$last_reason" ]; then log "等待条件就绪：$reason"; last_reason="$reason"; fi
    sleep "$WAIT_SECONDS"
    continue
  fi

  last_reason=""
  log "条件就绪，拉起常驻池（lane=$LANE）"
  # 前台执行：worker 自己是长循环，正常情况不会返回；返回即说明它退出了。
  BROWSER_POOL_LANES="$LANE" BROWSER_WORKER_ID=pool bash "$DIR/run-live-pool.sh" run pay
  code=$?
  log "常驻池退出（code=$code），$WAIT_SECONDS 秒后重新检查条件"
  sleep "$WAIT_SECONDS"
done
