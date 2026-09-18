# 任务书：落实第⑤b 块「第⑤块收窄」（D-275）

> 开专门落实窗口做。第一句读 `AGENTS.md` 四份顺序 + `docs/V2.0_EXECUTION.md` §3.A 面四 + 「第⑤块收窄补丁」+ `docs/reviews/STEP5_REVIEW_2026-09-18.md`（F-47～F-55）+ 本任务书。**只做本块。不碰 browser-mvp。**

## 目标（六件，各自可独立验收）

1. **发布 F-47 修复**（`31b5639` 已在 main）：`walletPreflight` 回到 `余额 − 金额 − 手续费 ≥ floor`。先在生产 release 目录只 import 纯函数复现旧输出，发布后同法复现新输出。**发布先问 Lemon。**
2. **金额对账降级**（`daily-reconciliation-service.js`）：只有能证明期初余额的卡（新开且首笔流水前无消费、或 Lemon 指定基准）才做金额核对；其余显示 `UNVERIFIABLE`，不进差异也不进 MATCHED。次数对账不动。删 `absoluteAmountCents` 对余额的滥用（F-53）：余额有符号解析，负数明确标未知。
3. **未知扣款分开**（F-48）：`PENDING_MANUAL_REGISTRATION` 只给「卡已标 RETIRED 且原因含手动用卡」的扣款；其余多出来的扣款标 `UNEXPLAINED_CHARGE`，是差异、进报告、不升级推送、不隐藏。
4. **连续两次只认正式批次**（F-50）：`run({persist:false})` 只读上次正式批次的 `persistent` 结论，不重算；同日重跑正式批次幂等（同周期不推进）。
5. **拿掉未实现/撑不住的**（F-52/F-55/F-54）：删 `DAILY_DIGEST` 设置项与策略分支；删 `countPushesByType` 或改名 `countAlertInstancesByType` 并在注释写明不是发送次数；日报 dedupe 按「当前活动异常」而非按天堆积，昨天的 OPEN 在今天无差异时 RESOLVE。
6. **手动用卡登记 = 标 RETIRED**：确认 `card_operational_overrides.set(RETIRED, reason)` 端点可用即可，不新建；把这条写进 RUNBOOK「运营手动用卡后必须做的一步」。第⑥块负责把它放进工作台。

7. **拒付类型名去猜测**（D-277）：`card-transaction-audit.js` 的 `CHARGEBACK_TYPES` 只留生产见过的 `chargeback`（及 `chargeback_fee`），删 `CHARGE_BACK` / `DISPUTE`；highvcc 侧不做，注释写「等首个真实样本」。

## 验收
- 每条 Codex 附录 A 的反例改成单测：一单两笔扣款 / 消费后导入 / 负余额 / 首跑后立即 GET / 同步失败跨日 / 异常次日恢复。
- 生产只读 dry-run：差异只剩 `UNEXPLAINED_CHARGE`（若有）与 `UNVERIFIABLE`，逐条有解释；1657/3159 应落 `UNVERIFIABLE`。
- F-47 发布后纯函数复现；`state-check` 一致；`wrapup-check` 全绿。
- 第⑥步任务书改：删「持续差异 / 叫了几次 / 汇总选项」三个依赖，加「手动用卡入口 = RETIRED 标记」。

## 边界
- 不碰 browser-mvp；不动白名单四类本身；不删表；不改付款。发布、改 timer：先开口问。范围外发现只报不改。
