# 接班一屏（HANDOFF_NOW）

更新：2026-09-18 21:1x UTC+8（13:1x UTC，⑤b 收窄 + Codex 复审补修 + F-47 **已发布上生产**：release `20260918-step5b-b0a36d4`，13:07 UTC 切换，三服务独立核实、F-47 复现 ok=true、日对账新代码只读复验达标）。按 CLAUDE.md 约定维护，接手者从 main 继续。

## 现在是什么

- **V2 落实 8 步：①②③④⑤已上生产，⑤b 收窄 + Codex 复审补修已上生产**（release `20260918-step5b-b0a36d4`，13:07 UTC 切换，**无迁移**）。
- **⑤b 六件（D-275）**：F-47 押金重复扣减修复 / 金额对账降级 `UNVERIFIABLE` + 余额有符号 / 未知扣款分 `UNEXPLAINED_CHARGE`vs`PENDING_MANUAL_REGISTRATION` / 连续两次只认正式批次 / 删 DAILY_DIGEST 空开关 + countPushesByType 改名 + 日报按天 key / 手动用卡=标 RETIRED override。
- **Codex 复审补修五条（F-56~F-60）**：F-56 日报改回按天 key + 前缀收历史（固定 key 会让升 critical 不重推）/ F-57 手动用卡改用 `card-operational-overrides` 端点（confirmRetired 会误把卡移出待销）/ F-58·F-51 加 `inputVerified`（同步失败 / highvcc 无成功水位的卡不自动升级）/ F-59 随 F-56 收旧 key / F-60 删猜测拒付类型 CHARGE_BACK·DISPUTE。
- **发布后复验（新 SSH 独立核实）**：web 1376393 / worker 1376398 / **bark 1376490** 三者 cwd 都在新 release、active、NRestarts=0（switch 打印 `bark cwd=/` 仍是打印时机假值，独立核实兜住）；F-47 新 release `walletPreflight`=`ok=true/25.50`；`/health` 200。**日对账新代码只读 dry-run**：30 卡 / 差异 6（全 `UNEXPLAINED_CHARGE`）/ persistent 0 / 待登记 1（3336）/ 无法核对 30 / 1657·3159 落 UNVERIFIABLE 不进差异。
- **测试**：v1 全量 **901/835/0/66**；六条反例各成单测；`git diff -- browser-mvp/` 为空。
- 生产开关/卡/订单具体值只看下面各行与本表其余行；本窗口只改了对账/通知逻辑 + 钱包预检，未碰付款/开卡/browser-mvp。

## 证据从哪里看

1. `docs/V2.0_EXECUTION.md` §6「第⑤b 步」+「⑤b 复审补修」两节：六件 + 五条逐条改动/证据、附录 A 改前后复现、生产只读 dry-run、F-47 发布前后复现。
2. `docs/DECISIONS.md` D-275（收窄八条）；D-271~D-274（⑤原始 + 押金撤回 + 1657/3159 根因）；D-277（拒付类型收窄）。
3. `docs/reviews/STEP5_REVIEW_2026-09-18.md`（F-47~F-55）+ `STEP5B_REVIEW_2026-09-18.md`（F-56~F-60，复审）。
4. `docs/RUNBOOK.md` §2.7：收窄后怎么读日对账 + 「运营手动用卡后必须做的一步」（用 `card-operational-overrides` 端点）。

## 接下来做什么（顺序）

1. **明早 09-19 04:0x UTC 看一眼日对账第二跑**（第一次跑新代码的正式批次 persist:true）：预期 persistent 0、汇总 info、旧 `daily-reconciliation:2026-09-18` key 被前缀收掉、写新格式 last_report——**1657/3159 不会再误升 critical**（这正是⑤b 修的）。若与预期不符，读 journal + 只读查 operator_alerts。
2. **开第⑥步**：任务书 `docs/tasks/2026-09-18-impl-step6-workbench-and-settings.md`（工作台 + 设置页 + CDK 板块 D-279 + 卡片页 D-280），已按 D-275 改自洽。手动用卡登记入口进卡片区（用 override 端点、不新建表）。
3. 真单来时顺手看：分卡当场同步 `order-demand-sync:` 两条读；付款后备用卡台真证据被 worker 自动调用（都还没样本）。

## 已定不做 / 别再重开的

- **金额对账当前对所有卡都是「无法核对」**：不是 bug，是收窄——没有卡有可验证期初金额（`funded_amount` 被 D-274 否定）。Lemon 为某卡指定基准（`verifiableBaselineCents`）才做核对，入口留给第⑥块/手动。
- **无主扣款不升级、输入存疑（highvcc 无水位 / hnskj 连续失败）不升级**：都进报告不隐藏，但不自动升 critical（D-275 ② / F-51）。
- **手动用卡登记只标 override（`card-operational-overrides` set RETIRED），不用 `/card-retirement/confirm`**（后者移出待销、误记已销，F-57）。判据只认英文 `manual-used`。
- 白名单四类不动、不删表、不改付款、不碰 browser-mvp（D-254）。

## 未验证边界（别说成已完成）

- **04:01 第二跑还没实际观察**：新代码在生产、只读 dry-run 复验过，但正式 timer（persist:true）第一次跑新代码是明早 04:0x——预期正常，等它真跑完再确认。
- **F-51 highvcc 一律不自动升级是保守取舍**：备用卡台、量小，差异仍进报告；若将来 highvcc 有真实持续 LEDGER_AHEAD 需人工从报告里看，不会自动 critical。
- **F-47 发布后无真实开卡样本**：highvcc 水位满、NO_DEMAND，预检当前走不到，要等真开卡需求。
- **拒付告警 highvcc 侧无真实样本**：F-60 只删了猜测类型，真实类型等首个样本再加。

## 分支、运行与禁止事项

- main 是接手入口；⑤b + 复审补修 + 发布事实源已提交、已 push（`origin/main` = `b0a36d4`）。隧道 13306 保留。
- 常驻 Browser 池 **PID 67131** 不要当残留杀掉。
- 开卡/补余额/充值/付款/退款/切路线/发布/apply/改开关/装 timer/重启 worker 或推送进程 **先开口问**；范围外发现只报不改（D-254）。
- **每次发布后核对三服务 cwd**（尤其 bark——switch 打印的 `bark cwd=/` 是假值，要用新连接独立核实真实 cwd，D-271/账本发现 13）。

## 暂停/恢复记录

- **本窗口发布了 ⑤b + 复审补修 + F-47**（Lemon 明确「切」后执行）：push → prepare（候选包 SHA256 与本机逐字节一致、F-47 在包）→ 停下复核给 Lemon → Lemon 确认 → switch → 独立核实三服务 + F-47 复现 + 日对账 dry-run。全程 switch 前停下等确认，未擅自切生产。
- **一次瞬时传输失败**：prepare 第一次 `scp: Connection closed`（传输层，不是内容问题）；测 SSH 通、无半截目录后重试即过。
- **判据「原因含手动用卡」动手前只读实查** 23 张 RETIRED override，确认英文 `manual-used` 只命中 3336、不误伤乱码的「手动测试卡」（0237/0601）——外部字段先验真。
- **Codex 复审戳中我 ⑤b 三处真缺口**（选错端点 F-57 / 固定 key 回归 F-56 / 测试名不副实 F-58 + 漏第 7 条 F-60），本窗口全修完、单测 + 生产只读复验 + 已发布。
