# 找「查不到被编成业务答案」：变量取自吞掉错误的命令替换、没判空、却直接参与数值判断。
# 三个条件缺一不可——只查其中一两个都会满屏假阳性（2026-09-13 试过两版，分别报出
# 7 处和 5 处，全是噪音）。判断工具的假阳性比报错危险：人会学会略过它。
#
# 自测（改这个文件后必须重跑，三条都要对）：
#   ① ELIG=$(q 2>/dev/null); [ "${ELIG:-0}" -ge 1 ]        → 必须抓到
#   ② 同上但前面有 case "$ELIG" in ""|*[!0-9]*)            → 必须放过
#   ③ warn=0; warn=$((warn+1)); [ $warn -eq 0 ]            → 必须放过（本地计数器）
#
# 用法：python3 scripts/lib/find-swallowed-empties.py <shell 文件...>
import re, sys, pathlib
danger = []
for path in sys.argv[1:]:
    p = pathlib.Path(path)
    if not p.is_file(): continue
    text = p.read_text(encoding='utf-8', errors='replace')
    lines = text.splitlines()
    # 条件 1：变量值来自吞掉错误的命令替换
    swallowed = set(re.findall(r'^\s*([A-Za-z_]\w*)=\$\([^)]*2>/dev/null', text, re.M))
    if not swallowed: continue
    for name in sorted(swallowed):
        # 条件 3：排除已经判空的（case ''/-z/-n 三种写法）
        guarded = re.search(
            rf'(case\s+"?\$\{{?{name}\}}?"?\s+in|-z\s+"?\$\{{?{name}\}}?|-n\s+"?\$\{{?{name}\}}?)', text)
        if guarded: continue
        # 条件 2：该变量参与数值判断
        for i, line in enumerate(lines, 1):
            if re.search(rf'\$\{{{name}:-\d+\}}\s*"?\s*-(ge|gt|le|lt|eq|ne)', line) or \
               re.search(rf'\[\[?\s+"?\$\{{?{name}\}}?"?\s+-(ge|gt|le|lt|eq|ne)', line):
                danger.append(f"{path}:{i}  ${name} 来自吞错误的查询，没判空，却直接参与数值判断")
                break
for d in danger: print(d)
