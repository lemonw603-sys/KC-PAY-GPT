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
  ok "接班一屏指向当前 release（${live}）"
else
  bad "接班一屏指向当前 release" "线上是 ${live}，docs/HANDOFF_NOW.md 里没有它"
fi

# 4) 接班一屏的更新时间不早于最后一次提交太久
hupd=$(grep -m1 '^更新：' docs/HANDOFF_NOW.md | sed 's/^更新：//' | cut -c1-16)
[ -n "$hupd" ] && ok "接班一屏更新时间：$hupd" || bad "接班一屏更新时间" "读不到「更新：」行"

note(){ printf '[提醒] %s — %s\n' "$1" "$2"; }

# 5) 四份事实源之间的漂移：PROJECT_MAP 不必每轮改，但里程碑变了它没跟上就会误导接班
# 只取该行第一个日期：那一行里可能还引用别的带日期的文件名（如 PLAN_2026-09-14），
# 2026-09-14 实测 grep -o 吐出两行，两份同日也被报成不同日。
hday=$(grep -m1 '^更新：' docs/HANDOFF_NOW.md | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
mday=$(grep -m1 '最后核对：' docs/PROJECT_MAP.md | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}' | head -1)
if [ -n "$hday" ] && [ -n "$mday" ]; then
  if [ "$hday" = "$mday" ]; then
    ok "PROJECT_MAP 与接班一屏同日核对（${mday}）"
  else
    note "PROJECT_MAP 最后核对 ${mday}，接班一屏 $hday" "里程碑或执行顺序若已变化，顺手更新 §4/§5"
  fi
else
  note "读不到两份文档的核对日期" "检查 HANDOFF_NOW 的「更新：」与 PROJECT_MAP 的「最后核对：」"
fi

# 6) 悬挂的「待办词」：这些词对应的事很可能已经做完了，文档却还停在旧状态
#    （2026-09-12 就出现过：客户页早已上线，设计文档待办里还写着「等 Lemon 看过页面后再发」）
# 2026-09-18 补：第④步收尾时 PROJECT_MAP 与执行账本的状态标题停在「代码完成、未发布」，
# 而那一版已经上生产。旧词表只有「尚未发布」没有「未发布」，扫描范围也没有执行账本，两处都漏过去。
hang=$(grep -rnE '待发布|待确认|等 Lemon|尚未发布|未发布|待 Lemon|进行中' \
        docs/HANDOFF_NOW.md docs/PROJECT_MAP.md docs/CURRENT_STATE.md docs/design/README.md 2>/dev/null \
        | grep -v '推翻' | head -6)
# 执行账本只看每块的状态标题行（### 第N步…），正文里的历史叙述不算悬挂。
hang_ledger=$(grep -nE '^### 第.步.*(未发布|未开始|等 Lemon|待 Lemon)' docs/V2.0_EXECUTION.md 2>/dev/null | head -4)
[ -n "$hang_ledger" ] && hang="$hang
$hang_ledger"
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

# 8) 「查不到」被编成业务答案：变量取自吞掉错误的命令、没判空、却直接参与数值判断。
#    2026-09-13 真实代价：ready-check 把空值当 0，播报"可分配卡 0 张"（实为 1 张，
#    差点去开一张不需要的卡）、"生产服务异常"（实为 active active）。
#    三个条件必须同时成立才报，否则就是噪音——第一版只查"有没有判空"报出 7 处全是
#    假阳性，第二版只查"有没有数值比较"报出 5 处也全是假阳性。判断工具的假阳性比
#    报错危险：人会学会略过它。检查器自己的自测见 scripts/lib/find-swallowed-empties.py 顶部。
swallow=$(python3 scripts/lib/find-swallowed-empties.py \
  browser-mvp/scripts/*.sh scripts/*.sh v1/scripts/*.sh 2>/dev/null | head -6)
if [ -z "$swallow" ]; then
  ok "没有「查不到被编成业务答案」的地方"
else
  note "这些变量取自吞错误的查询、没判空、却直接当数字用" "$(printf '%s' "$swallow" | sed 's/^/\n         /')"
fi

# 9) 改了后台页面却没跟已确认原型对过：2026-09-20 Lemon 的原话是「你实际做出来的和
#    设计有差距，你却不知道」。当天的营业条实测差了两处（纵向对齐差 23px、段高差 5px），
#    而我看截图看不出来 —— 截图被缩到真实分辨率的 55%，视口 emulation 还会被悄悄清掉。
#    所以这一项不看截图，只比数字：scripts/visual-parity.mjs 把原型和实现放进同一视口实测。
#    需要一个跑着的后台（演示/隔离都行），所以靠环境变量开启，不强制每轮都有环境。
if ls docs/design/parity/*.json >/dev/null 2>&1; then
  touched_ui=$(git show --name-only --format= HEAD 2>/dev/null | grep -c '^v1/public/admin/')
  if [ -n "${PARITY_ADMIN_BASE:-}" ] && [ -n "${PARITY_ADMIN_PASSWORD:-}" ] && [ -n "${PARITY_PROTO_BASE:-}" ]; then
    vp=$(node scripts/visual-parity.mjs 2>&1); vpcode=$?
    if [ "$vpcode" = "0" ]; then
      ok "页面与已确认原型一致"
    elif [ "$vpcode" = "1" ]; then
      bad "页面与已确认原型一致" "$(printf '%s' "$vp" | sed 's/^/\n         /')"
    else
      # 跑不起来不等于一致，也不等于不一致 —— 单独说，不许算通过
      note "视觉比对没跑成（不等于「一致」）" "$(printf '%s' "$vp" | tail -3 | sed 's/^/\n         /')"
    fi
  elif [ "$touched_ui" != "0" ]; then
    note "这次动了后台页面，但没跑视觉比对" "起后台 + 原型服务（node scripts/proto-server.mjs）后：PARITY_ADMIN_BASE=http://localhost:PORT PARITY_ADMIN_PASSWORD=... PARITY_PROTO_BASE=http://localhost:8899 node scripts/visual-parity.mjs"
  fi
fi

# 10) CSS 往回漂：规范（docs/design/DESIGN_SYSTEM.md）不会自己执行。2026-09-20 立棘轮那天，
#     三份 CSS 有 227 处字面色、六种控件高度、.wb-cdk 在同一文件里定义两次互相打架。
#     一次性大重构风险大于收益（旧页在生产跑着），所以改成「只许降不许升」，跟着每次重做逐块吃掉。
if [ -f docs/design/css-baseline.json ]; then
  drift=$(node scripts/css-drift-check.mjs 2>&1); dcode=$?
  if [ "$dcode" = "0" ]; then
    ok "CSS 没有往回漂"
  elif [ "$dcode" = "1" ]; then
    bad "CSS 没有往回漂" "$(printf '%s' "$drift" | sed 's/^/\n         /')"
  else
    note "CSS 棘轮没跑成" "$(printf '%s' "$drift" | tail -2 | sed 's/^/\n         /')"
  fi
fi

# 11) 写给自己看的话跑到界面上：2026-09-20 实查，数字墙挂着「口径待定（D-284 ③）」，
#     设置页写着「D-221 要按产品…」，卡片页写着「能力保留，只是平时不用，收进这里（D-280 ⑧）」。
#     Lemon 两次说过「我要的是简洁，不是让你在这给我做解释」，但规矩不会自己执行。
copy=$(node scripts/ui-copy-check.mjs 2>&1); ccode=$?
if [ "$ccode" = "0" ]; then
  ok "界面文案没有内部编号和开发备忘"
elif [ "$ccode" = "1" ]; then
  bad "界面文案没有内部编号和开发备忘" "$(printf '%s' "$copy" | grep -E '^\s+[0-9]+' | head -5 | sed 's/^/\n         /')"
else
  note "界面文案检查没跑成" "$(printf '%s' "$copy" | tail -2 | sed 's/^/\n         /')"
fi

# 12) 演练窗口关掉的「下单查执行器心跳」没有开回去（D-352 块 3 ②，2026-09-23）。
#     关着 = 常驻池停了客户照样能提交、订单无限期挂起，正是块 3 要堵的洞；演练完最容易忘。
hbcheck=$(bash browser-mvp/scripts/prod-query.sh "SELECT setting_value FROM app_settings WHERE setting_key='intake_executor_heartbeat_check'" 2>/dev/null | tr -d '[:space:]')
if [ -z "$hbcheck" ] || [ "$hbcheck" = "true" ]; then
  ok "下单查执行器心跳：开着（${hbcheck:-未设置=开}）"
else
  bad "下单查执行器心跳" "生产是 ${hbcheck}，演练完没开回去：node v1/scripts/set-intake-executor-check.mjs on --apply"
fi

printf '\n'
[ "$fail" = "0" ] && echo "==> 可以说做完了 ✓（[提醒] 不算失败，但要看一眼）" || echo "==> 还不能说做完 ✗"
exit "$fail"
