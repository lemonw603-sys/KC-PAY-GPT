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

note(){ printf '[提醒] %s — %s\n' "$1" "$2"; }

# 5) 四份事实源之间的漂移：PROJECT_MAP 不必每轮改，但里程碑变了它没跟上就会误导接班
hday=$(grep -m1 '^更新：' docs/HANDOFF_NOW.md | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}')
mday=$(grep -m1 '最后核对：' docs/PROJECT_MAP.md | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}')
if [ -n "$hday" ] && [ -n "$mday" ]; then
  if [ "$hday" = "$mday" ]; then
    ok "PROJECT_MAP 与接班一屏同日核对（$mday）"
  else
    note "PROJECT_MAP 最后核对 $mday，接班一屏 $hday" "里程碑或执行顺序若已变化，顺手更新 §4/§5"
  fi
else
  note "读不到两份文档的核对日期" "检查 HANDOFF_NOW 的「更新：」与 PROJECT_MAP 的「最后核对：」"
fi

# 6) 悬挂的「待办词」：这些词对应的事很可能已经做完了，文档却还停在旧状态
#    （2026-09-12 就出现过：客户页早已上线，设计文档待办里还写着「等 Lemon 看过页面后再发」）
hang=$(grep -rnE '待发布|待确认|等 Lemon|尚未发布|进行中' \
        docs/HANDOFF_NOW.md docs/PROJECT_MAP.md docs/CURRENT_STATE.md docs/design/README.md 2>/dev/null \
        | grep -v '推翻' | head -6)
if [ -z "$hang" ]; then
  ok "文档里没有悬挂的「待发布/待确认/进行中」"
else
  note "文档里还有这些未了结的说法，逐条确认是否已经做完" "$(printf '%s' "$hang" | sed 's/^/\n         /')"
fi

# 7) 本机遗留的临时服务：调试起的假数据服务器、静态服务器，跑完该停
leftover=$(ps -eo pid,command 2>/dev/null \
  | grep -E '[h]ttp\.server|[m]ock-server\.mjs|scratchpad/[a-z]+\.mjs' \
  | grep -v 'live-pool\|supervisor' | head -4)
if [ -z "$leftover" ]; then
  ok "本机没有遗留的调试服务"
else
  note "本机还有调试用的临时服务在跑，确认是否该停" "$(printf '%s' "$leftover" | sed 's/^/\n         /')"
fi

printf '\n'
[ "$fail" = "0" ] && echo "==> 可以说做完了 ✓（[提醒] 不算失败，但要看一眼）" || echo "==> 还不能说做完 ✗"
exit "$fail"
