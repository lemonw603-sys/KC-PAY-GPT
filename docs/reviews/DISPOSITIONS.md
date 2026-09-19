# 审查处置（DISPOSITIONS）· 执行者维护

> REVIEW_PROTOCOL §4：审查记录由审查员写（`STEP<n>_REVIEW_*.md`），处置由执行者写这里，靠发现编号交叉引用、互不编辑对方文件。P1 逐条 `接受｜拒绝｜待验证` + 理由 + 关联提交，沉默不算处置。
> 背景（第⑥块）：工作台 `8cd6d7e` 发布后当天回滚，生产已回 `20260918-step5b-b0a36d4`（`state-check.sh` 现场核实一致），Lemon 判定做偏、停止扩展、换窗口重做。以下缺陷**当前不在生产运行**；处置基调＝「接受、待第⑥块重做时闭合并隔离验收」。在途重做 `7c1a5c0` 已动外壳但营业条方向仍错、未验收。

## STEP6_REVIEW_2026-09-19（F-61~F-65，全 P1）

### F-61 「解决资金核对」只关案例、不收口订单/账本/卡占用 — 接受，待验证
- **接受**：属实。`data-resolve-wb-case` 复用 `resolveReconciliationCase`，只 UPDATE `reconciliation_cases`，不等于 `RESOLVE_UNKNOWN_PAYMENT` 的订单/attempt/卡占用/账本收口；我把「关闭记录」当成「资金问题已处理」，与任务书"按钮真处理、写账本"及我的交接声称不符。
- **依据**：审查证据 `admin.js:383-389,577-587`、`reconciliation-case-service.js:238-262`（只写 case）。
- **重做怎么闭合**：按 case 类型带到已有正式收口入口，或明确改名「关闭记录」不赋资金含义；隔离库造付款不明单→点击→核对订单/attempt/账本/卡占用/case 全部权威状态，不只查 case 关闭。
- **关联**：缺陷 `8cd6d7e`（已回滚）；`7c1a5c0` 未修此项。

### F-62 字段接错，「无法核对」应 30 却显示 0 — 接受，待验证
- **接受**：属实，是我又一次没做「外部字段先验真」。`renderWbRecon` 读 `daily.unverifiableCount`，服务实际输出 `unverifiableAmountCount`（`daily-reconciliation-service.js:353`）；`?? 0` 把未知/遗漏默认成 0，产生与后台相反的数字。
- **依据**：审查 Playwright 注入 `unverifiableAmountCount:30` → 页面显示「0 无法核对」；字段名源码独立核实。
- **重做怎么闭合**：对真实响应逐字段核对再接；未知值与真实 0 分开（未知/加载失败 ≠ 0）。
- **关联**：`8cd6d7e`（已回滚）；`7c1a5c0` 同字段仍错、未修。

### F-63 待办接口失败被吞成空、页面宣称「没有要处理的」 — 接受，待验证
- **接受**：属实。`loadOverview` 把 alerts/cases/orders 失败 catch 成空数组、daily 失败 catch null，`renderWbQueue` 缺数据时输出「今天清爽 ✓」，无法区分「查过确认无待办」与「读取失败」。
- **依据**：审查对空值调用正式渲染得「没有要处理的，今天清爽 ✓」；catch 转空路径源码核实。
- **重做怎么闭合**：保留各板块加载/失败态；部分失败显示「读取失败/重试」，与空结果分开。
- **关联**：`8cd6d7e`（已回滚）；`7c1a5c0` 未修。

### F-64 队列来源与「看逐张」目标不闭环 — 接受，待验证
- **接受**：属实。`renderWbQueue` 没消费 `daily.retirementDueCount`、没读 `card-retirement/candidates`；无主扣款「看逐张」只 `data-view-jump=diagnostics`，而 diagnostics 加载旧 cases/runs、不展示 daily 逐卡报告——跳转无真实落点；待销到期不该因「完整动作在卡片页」就从工作台消失。
- **依据**：审查 `admin.js:377-407` + switchView diagnostics 分支；`retirementDueCount=4` 且其他空时不产生任何待销项。
- **重做怎么闭合**：只聚合可解释、可定位的业务对象；完整动作可在专页，但跳转须带定位信息、有真实落点；待销到期在工作台保留提醒。
- **关联**：`8cd6d7e`（已回滚）；`7c1a5c0` 未修。

### F-65 旧供给开关复用会同时打开已弃用的补余额 — 接受，待验证
- **接受**：属实，正是我没懂「补余额线已弃删（D-218）」。第⑥版营业条保留「能不能开卡补钱」调 supply-automation，`admin-operations-service.js:158-166` 一起写 `card_auto_replenishment` 和 `card_balance_recharge` 两键（生产实际 replenishment=true / balance_recharge=false，刻意拆开）；点开启会把已放弃的补余额一并打开。
- **依据**：审查 `8cd6d7e` renderDecisions/data-supply-toggle + `admin-operations-service.js:158-175` + 只读 SQL。
- **重做怎么闭合**：按当前业务决定（补钱已删）选实际开关、不按旧函数名复用；供给放工作台/设置页时用正确单键语义。**后端 `setSupplyAutomation` 仍写两键这一既有风险登记 PROJECT_MAP §5，重做时一并核。**
- **关联**：`8cd6d7e`（已回滚，营业条含该控件）；`7c1a5c0` 已把营业条该控件移走（迁移语义仍待按 face-2 重定）。

## 审查的过程判断（非编号缺陷）
- HANDOFF 顶部写回滚、下文仍称在生产/让试用/列旧 PID 自相矛盾 — **接受**：本窗口收尾已重写 HANDOFF_NOW 消除矛盾。
- 「哪张原型/哪些差异有效」需 Lemon 确认再作基准（D-283 授权 sidebar 暂留旧皮 vs 回滚说明要求换皮，冲突）— ~~待 Lemon 裁~~ → **已裁（2026-09-19，D-284 ②）**：确认 D-283 原文有效，**sidebar 四页做完再统一换候光皮**，回滚说明那条不作为本阶段返工依据；冲突了结。
- 自动完成率口径任务书写待定、HANDOFF 称已定 — ~~重做前先冻结口径~~ → **已裁（2026-09-19，D-284 ③）**：口径**暂不冻结**，数字墙该格先空着标「待接入」，在 Lemon 给出分子分母定义前不许自拟算法填数。
- （补）营业条形态与路线切换位置的三份依据打架（原型 C 3 toggle + 独立路线块 / 任务书 A 项与 D-280 ⑦ 要路线在工作台 / 在途 `7c1a5c0` 把路线挪去设置页 / HANDOFF 主张营业条含第五决定）— **已裁（2026-09-19，D-284 ①）**：走**方向 A**＝3 toggle（接单/派单/付款）+ **路线切换块留工作台**（带四项校验与拒切逐项原因），供给参数归设置页。

## 2026-09-19 本轮（付款不明一条链）闭合更新 · 执行者（新窗口）

> 范围＝Lemon 裁定三点后的「先闭付款不明一条链」（营业条方向 A；sidebar 四页做完统一换；自动完成率先空着标待接入）。改动：`v1/src/services/browser-admin-service.js`、`v1/public/admin/assets/admin.js`、`v1/test/browser-resolve-unknown-payment-mysql-integration.test.js`。**未部署**（生产仍 `20260918-step5b-b0a36d4`）。

- **F-61 → 已闭合（本轮）**：工作台付款不明 case（`API_PAYMENT_UNKNOWN`/`BROWSER_PAYMENT_UNKNOWN`）的「解决」改为「去核实收口」，带 `publicNo` 跳订单详情做**正式收口**，不再内联 `resolveReconciliationCase` 只关 case（`admin.js` `renderWbQueue` + 新常量 `PAYMENT_UNKNOWN_CASE_TYPES`）；非付款不明 case 才保留「关闭记录」纯记录动作并改名。**更正审查与我早前的判断「API 前端零 UI」**：API 收口 UI 一直都在（`data-order-resolve-unknown` → `/orders/:publicNo/resolve-unknown-submission`，确认串 `已核实 {publicNo} {outcome}`），当时 grep 词只搜了端点名、漏了按钮 data 属性，故原计划的 F-1b 不需要做。
  - **新发现并修（B1）**：全库能关 `reconciliation_cases` 的只有 4 处，其中**只有 API 侧收口关 case**（`unknown-submission-resolve-service.js:158`）；Browser 的 `RESOLVE_UNKNOWN_PAYMENT` **不关**自己的 `browser-payment-unknown:{attempt}` case 与 `browser-browser_payment_unknown:{order}` 告警 —— 订单/attempt/卡/账本都已收口，工作台那条 case 与告警仍挂着，运营只能改点「关闭记录」把它擦掉（而那按钮不动资金）。这是 F-61 病根更深一层、审查未及。已在 `browser-admin-service.js` 收口成功、CHARGED/NOT_CHARGED 两路汇合处、公共 checkpoint 之前补关 case+告警，与 API 侧对称。
  - **验证**：node vm 加载**真实** `admin.js` 调真实 `renderWbQueue` 四态断言（付款不明→「去核实收口」+ 带单号跳订单详情 + 无 `data-resolve-wb-case`）；`browser-admin-service` 单测 8/8；集成测试加三例断言（收口后 `recon_case_status`/`payment_unknown_alert_status` 应 RESOLVED）—— **本地无 `TEST_DATABASE_URL` → skip，见 UNVERIFIED_LEDGER**。
- **F-62 → 已闭合（本轮）**：`renderWbRecon` 字段名 `unverifiableCount`→`unverifiableAmountCount`；缺字段显「—」而非 0（未知≠真实 0）。验证：node 隔离断言显真实 30、缺失显「—」。
- **F-63 → 已闭合（本轮）**：`loadOverview` 六来源失败标 `__error`；`renderWbQueue` 空态与 `renderWbRecon` 把「接口失败」与「真无待办/暂无数据」分开。验证：node 隔离断言接口失败不再显「今天清爽」、日对账失败显「读取失败」。
- **F-64 → 部分闭合（本轮）**：付款不明 case 的「真实落点」随 F-61 解决（跳订单详情，不再空跳 diagnostics）。**未做（本轮范围外，属卡片页 D-280）**：`retirementDueCount` 待销到期在工作台的提醒、无主扣款逐卡报告落点 —— 登记留待卡片页那块做。
- **F-65 → 本轮未做**：属供给控件（营业条/设置页），不在付款不明链。后端 `setSupplyAutomation` 双写两键的既有风险不变，仍登记 PROJECT_MAP §5，供给控件重做时闭合。
