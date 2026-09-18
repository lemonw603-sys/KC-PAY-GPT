# 接班一屏（HANDOFF_NOW）

更新：2026-09-18 22:xx UTC+8（14:xx UTC，⑤b 收窄 + Codex 复审补修 F-56~F-60 全做完、单测绿、生产只读复验达标；**F-47 押金修复等 Lemon 批发布**）。按 CLAUDE.md 约定维护，接手者从 main 继续。

## 现在是什么

- **V2 落实 8 步：①②③④⑤已上生产**（release `20260918-step5-740bc1d`）。⑤上线后 Codex 审查出 9 条（F-47~F-55），Lemon 认 → D-275「第⑤块收窄」，开小块 **⑤b 做减法**。
- **⑤b 六件全部做完（代码在 main，未发布）**，证据链在账本 `docs/V2.0_EXECUTION.md` §6「第⑤b 步」那节：
  1. **F-47 押金重复扣减**（`31b5639` 已在 main）：`walletPreflight` 回到「余额−金额−手续费≥floor」。**代码没动**，只做了发布前纯函数复现：生产 `740bc1d` 仍 `ok=false projected=-1035.94`（多扣 held 押金），本地新代码 `ok=true projected=25.50`。**等 Lemon 批发布**，发布后同法复现新输出。
  2. **金额对账降级**：无可验证期初基准的卡一律 `UNVERIFIABLE`，不判异常也不判一致；余额有符号解析、负数标 `NEGATIVE_BALANCE`（不再 abs，F-53）。`funded_amount` 只作观察值（D-274：它是下单额不是入卡额）。
  3. **未知扣款分开**：已登记手动用卡（RETIRED override reason 带 `manual-used`）→ `PENDING_MANUAL_REGISTRATION`；其余多扣 → `UNEXPLAINED_CHARGE`（是差异、进报告、不隐藏、不升级）。
  4. **连续两次只认正式批次**：`persist:false`（GET/dry-run）不推进、沿用上一个正式批次结论；同日重跑幂等（F-50）。
  5. **拿掉撑不住的**：删 `DAILY_DIGEST`/`provider_balance_change_push_mode`（F-52 空开关）；`countPushesByType`→`countAlertInstancesByType`（F-55）；日报固定 dedupe_key、不按天堆积（F-54）。
  6. **手动用卡=标 RETIRED override**：用 `POST /api/v1/admin/card-operational-overrides`（set RETIRED，reason 带 `manual-used`）——**不是** `/card-retirement/confirm`（那会把卡移出待销、误记已销，F-57 已修）。只标 override：卡不再分配、仍留待销。写进 RUNBOOK §2.7；第⑥块把入口搬进工作台。
- **测试**：v1 全量 **901/835/0/66**（含 Codex 复审补修）。六条反例各成单测（「同步失败跨日」已改真实 persist:true）。`git diff -- browser-mvp/` 为空。
- **Codex 复审 F-56~F-60 全部采纳修复**（账本 §6「⑤b 复审补修」）：F-56 日报改回按天 key + 前缀收历史（固定 key 会让升 critical 不重推）；F-57 手动用卡改用 `card-operational-overrides` 端点（confirmRetired 会误把卡移出待销）；F-58/F-51 加 `inputVerified`（同步失败 / highvcc 无水位的卡不自动升级）；F-59 随 F-56 收掉旧 key；F-60 删猜测拒付类型 `CHARGE_BACK`/`DISPUTE`。
- **生产只读 dry-run（新代码经隧道，`persist:false` 不写）达标**：差异 6 张全 `UNEXPLAINED_CHARGE`、逐条有解释；1657/3159 落 `UNVERIFIABLE`；待登记只剩 3336。金额 30 张全 `UNVERIFIABLE`、无假差异。
- **生产未变**：release 仍 `740bc1d`，三个常驻服务未重启，timer 照常。本窗口对生产只做了三次**只读**（override 查询 / 新代码 dry-run / F-47 生产 release 纯函数复现）。具体生产值只看 `CURRENT_STATE`。

## 证据从哪里看

1. `docs/V2.0_EXECUTION.md` **§6「第⑤b 步」那节**：六件逐条改动 + 证据表、附录 A 改前/改后复现、只读 dry-run 原始数字、F-47 发布前复现。
2. `docs/DECISIONS.md` **D-275**（收窄八条）；D-271/D-272（⑤原始）、D-273（撤回押金二次扣减）、D-274（1657/3159 根因）。
3. `docs/reviews/STEP5_REVIEW_2026-09-18.md`（F-47~F-55，附录 A 反例）。
4. `docs/RUNBOOK.md` **§2.7**：收窄后怎么读日对账报告 + 「运营手动用卡后必须做的一步」。

## 接下来做什么（顺序）

1. **等 Lemon 批 F-47 发布**（D-275 ⑥，单独一版）。批准后：从**不含收窄改动的 commit**（如 `791a4d8`，F-47 已在、收窄未在）构建发一版；发布后在新 release 目录只 import `walletPreflight` 复现新输出（`ok=true`）贴给 Lemon；更新 `CURRENT_STATE` release 行。**发布先问，别自己发。**
2. **收窄代码（金额降级/未知扣款/连续两次/删 DAILY_DIGEST）何时发**：任务书没要求本窗口发，Lemon 定——可与第⑥块一起发。发之前生产日对账仍跑旧判据（见下未验证边界）。
3. **⑤b 过后开第⑥步**：任务书 `docs/tasks/2026-09-18-impl-step6-workbench-and-settings.md` 已按 D-275 改自洽（删「叫了几次/汇总选项/待登记栏」三依赖，加「手动用卡入口=RETIRED」）。

## 已定不做 / 别再重开的

- **金额对账当前对所有卡都是「无法核对」**：不是 bug，是收窄——没有任何卡有 Lemon 核实过的期初入卡金额（`funded_amount` 被 D-274 否定）。将来 Lemon 为某卡指定基准（`verifiableBaselineCents`）才做金额核对，入口留给第⑥块/手动。
- **无主扣款（`UNEXPLAINED_CHARGE`）先不升级推送**：进报告、进汇总、不隐藏，但连续两天也不升 critical（D-275 ②）；怎么处理留第⑥块队列。
- **判据只认英文 `manual-used` 标识**，不认中文「手动」（会漏 3336、误伤"手动测试卡"）。
- 白名单四类不动、不删表、不改付款、不碰 browser-mvp（D-254）。

## 未验证边界（别说成已完成）

- **收窄代码未上生产**：生产日对账仍跑旧判据。⑤b 的验收是「本地单测 + 新代码经隧道只读 dry-run」，不是生产在跑新代码。
- **09-19 04:01 UTC 生产日对账第二跑仍是旧代码**：1657/3159 会变 `persistent` 把汇总升 critical——那是旧判据的既知问题（正是⑤b 要修的），收窄发布后消失。若 Lemon 想避免这条误报 critical，需在 04:01 前发收窄代码（要问）。
- **F-47 发布后无真实开卡样本**：要等 highvcc 有真开卡需求才走到 `walletPreflight`。
- 单测的内存 pool 不等于真库；只读 dry-run 不等于生产在跑新代码。

## 分支、运行与禁止事项

- main 是接手入口；⑤b 改动已提交。隧道 13306 保留。
- 常驻 Browser 池 **PID 67131** 不要当残留杀掉。
- 开卡/补余额/充值/付款/退款/切路线/**发布**/apply/改开关/装 timer/重启 worker 或推送进程 **先开口问**；范围外发现只报不改（D-254）。
- **每次发布后核对 switch 打印的 `worker cwd=` 与 `bark cwd=` 两行**指向新 release（D-220/D-271 同一个洞）。

## 暂停/恢复记录

- **本窗口对生产只做只读**：override reason 查询、新代码经隧道 dry-run（`persist:false`）、F-47 生产 release 纯函数复现——三者都不写生产、不启动 runner/worker。
- **发布 F-47 是本窗口唯一待做的生产写动作，已停在「先问」**：发布前复现证据已备好，等 Lemon 当次确认。
- 判据「原因含手动用卡」动手前先只读实查了 23 张 RETIRED override 的 reason，确认英文 `manual-used` 判据只命中 3336、不误伤乱码的"手动测试卡"（0237/0601）——外部字段先验真，没凭"手动"二字拍脑袋。
