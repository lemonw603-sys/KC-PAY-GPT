#!/usr/bin/env bash
# 收尾自检：把"我记得落盘了"换成"机器说落盘了"。只读，不改任何东西。
#   scripts/wrapup-check.sh
# 每轮收尾、以及向 Lemon 说"做完了"之前跑一次。任何一项 [失败] 都不算做完。
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
fail=0
ok(){ printf '[通过] %s\n' "$1"; }
bad(){ printf '[失败] %s — %s\n' "$1" "$2"; fail=1; }

# 1) 代码与文档都已落盘并推送
dirty=$(git status --short | wc -l | tr -d ' ')
[ "$dirty" = "0" ] && ok "工作区干净" || bad "工作区干净" "$dirty 个文件未提交"
ahead=$(git log origin/main..HEAD --oneline 2>/dev/null | wc -l | tr -d ' ')
[ "$ahead" = "0" ] && ok "已推送远端" || bad "已推送远端" "$ahead 个提交未推送"

# 2) 生产事实表与现场一致（权威口径来自 state-check.sh 自己的查询，不另起炉灶）
if bash browser-mvp/scripts/state-check.sh 2>/dev/null | tail -1 | grep -q "一致"; then
  ok "CURRENT_STATE 与现场一致"
else
  bad "CURRENT_STATE 与现场一致" "有漂移，跑 browser-mvp/scripts/state-check.sh 看哪一行"
fi

# 3) 接班一屏没有停留在旧 release —— 本轮最容易漏的一项
live=$(ssh -o BatchMode=yes -o ConnectTimeout=10 root@144.34.180.184 'basename $(readlink /opt/pojia/current)' 2>/dev/null)
if [ -z "$live" ]; then
  bad "接班一屏指向当前 release" "取不到线上 release（ssh 不通？）"
elif grep -q "$live" docs/HANDOFF_NOW.md; then
  ok "接班一屏指向当前 release（$live）"
else
  bad "接班一屏指向当前 release" "线上是 $live，docs/HANDOFF_NOW.md 里没有它"
fi

# 4) 接班一屏的更新时间不早于最后一次提交太久
hupd=$(grep -m1 '^更新：' docs/HANDOFF_NOW.md | sed 's/^更新：//' | cut -c1-16)
[ -n "$hupd" ] && ok "接班一屏更新时间：$hupd" || bad "接班一屏更新时间" "读不到「更新：」行"

printf '\n'
[ "$fail" = "0" ] && echo "==> 可以说做完了 ✓" || echo "==> 还不能说做完 ✗"
exit "$fail"
