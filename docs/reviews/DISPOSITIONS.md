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
- 「哪张原型/哪些差异有效」需 Lemon 确认再作基准（D-283 授权 sidebar 暂留旧皮 vs 回滚说明要求换皮，冲突）— **待 Lemon 裁**（登记「尚未解决」）；重做前先冻结一份有效原型 + 允许差异，不擅自挑一份文档追责或据此动手。
- 自动完成率口径任务书写待定、HANDOFF 称已定 — 重做前先冻结口径，本窗口不擅自实现该统计。
