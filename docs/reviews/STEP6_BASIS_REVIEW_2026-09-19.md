# 第⑥块 业务理解与有效设计基准 审查

- 批次头：截至 2026-09-19 UTC｜审查对象 commit `51da3a0`（第⑥块换窗口交接提交）｜生产 release `20260918-step5b-b0a36d4`（step6 已回滚）｜板块 E（运营后台 · 业务理解/设计基准维度）
- 审查员：Claude 窗口，Codex 额度耗尽后按 `REVIEW_PROTOCOL.md` §7 次选顶替。**局限**：本窗口带上下文、读过 `STEP6_REVIEW_2026-09-19.md`，非"不带历史的干净窗口"；对冲＝每条附可复跑证据、标注「独立得出/受前份报告影响」。（Lemon 定走 A，见 D-284）
- 范围：Lemon 圈定的「第⑥块新窗口的业务理解与有效设计基准」。不追在途（`7c1a5c0` 在途重做代码不作审查对象），不审明确未完成页（CDK/卡片/设置）。

## 先肯定（不为找问题而找问题）

1. HANDOFF_NOW 内部叙述矛盾（旧版顶部称回滚、下文又称在生产让 Lemon 试用）**已修好**：新版明确「生产=⑤b、step6 已回滚、已提交实现均未业务验收」。独立复核：全文无「工作台在生产」残留。
2. 业务理解章节对症且有账本依据：点明本窗口教训「没读账本就做 UI、把业务决策当 UI 元素」，校正「营业条=五决定、砍成三 toggle 是错的」（引 face-1/2、D-218、D-254）。这个业务理解是对的。

## F-66 有效设计基准未冻结即进入开工序列，会重蹈「无确定靶子做 UI」覆辙

- 板块/严重度：E / **P1**（会导致新窗口错判该做什么 → 返工；D-276 P1＝会导致错判）
- 观察（原始，不含结论）：交接文档在多处把「重做地基」标为未决、待裁，同时又把重做列入「接下来做什么」的开工序列：
  - `docs/HANDOFF_NOW.md:27`「重做前先冻结基准：与 Lemon 确认一份有效原型 + 允许差异（D-283 授权 sidebar 暂留旧皮 与 回滚要求换皮 冲突，需裁）+ 自动完成率口径。」
  - `docs/HANDOFF_NOW.md:38`「有效原型 / 允许差异未冻结（D-283 sidebar 暂留旧皮 vs 回滚要求换皮 冲突）— 待 Lemon 裁。」
  - `docs/HANDOFF_NOW.md:24`「自动完成率口径任务书仍写待定，重做前先冻结。」
  - `docs/HANDOFF_NOW.md:23`数字墙三个「待接入」数在途被换成可分配卡/告警数「待与 Lemon 再对齐」。
  - 任务书 `docs/tasks/2026-09-18-impl-step6-workbench-and-settings.md:8`「自动完成率口径待 Lemon 定」。
- 结论（依据）：上一版做偏的元凶正是「基准未定下动手做 UI」（`HANDOFF_NOW.md:3` 自述教训）。同样三个基准点现在仍未冻结，却已进入「接下来做什么」的开工序列（`HANDOFF_NOW.md:26-28`）。基准无效则重做无有效靶子。
- 影响条件：Lemon 未先裁定三点，新窗口即按 `HANDOFF_NOW.md:26` 开工重做工作台。
- 反证/不确定性：任务书 `:35` 有兜底「前置核查发现冲突就停下摆给 Lemon 选」，理论上新窗口会停而非乱做；但这依赖新窗口自觉，且「停下等裁」本身就说明现在不该急着让它重做。
- 参考验证办法（非任务）：Lemon 对三点各给一个确定答案，基准即冻结；在此之前第⑥块重做应视为 blocked。
- 建议：把下列三件当第⑥块重做的前置闸，裁定后再让新窗口动手：① 有效原型 + 允许差异（sidebar 到底换不换候光皮）；② 自动完成率口径（什么算「没靠人收口」）；③ 数字墙放哪些数。
- 置信度：高。（独立得出：三处证据我逐条读交接文档定位。其中 sidebar 皮、自动完成率两点 `STEP6_REVIEW_2026-09-19.md` 亦提过，我复核确认仍存于交接文档，非单纯转述。）

## F-67 营业条「决定数」两处表述不一致，自动开卡开关归属不明

- 板块/严重度：E / **P2**（语义偏差；但营业条正是上一版做偏处，值得冻结时一并澄清）
- 观察：
  - 任务书目标 A `docs/tasks/2026-09-18-impl-step6-workbench-and-settings.md:50`：营业条＝「三开关（接单/派单/付款）+ 两个卡台选择 + CDK 生成」。
  - HANDOFF §业务理解 `docs/HANDOFF_NOW.md:17`：营业条＝「接近旧后台五决定（接不接单/走哪条路/用哪个卡台/能不能付钱/能不能自动开卡）」。
- 结论：两处对「营业条包含几个决定」表述不一致；「能不能自动开卡」在 HANDOFF 属营业条决定之一，在任务书目标 A 的营业条清单里缺席（任务书把自动开卡的**参数**放设置页 `:56`）。新窗口以哪份为准做营业条不明。
- 影响条件：新窗口做营业条时按任务书目标 A → 少一个「自动开卡」决定；按 HANDOFF → 五决定。
- 反证：可能是同一模型的粗细两种表述（3 开关 + 卡台选择 + 自动开卡 ≈ 5），非实质冲突。
- 参考验证办法：Lemon 冻结基准时明确营业条到底几个决定、「能不能自动开卡」开关放营业条还是设置页。
- 置信度：中。（我未逐字比对 `STEP6_REVIEW_2026-09-19.md` 全文；若与其某条重复，以其为先。）

## 未能核实的事项

- 未读原型文件 `docs/design/prototypes/step6-workbench-compare.html` 逐版内容，无法判断「回滚要求换皮」具体指哪张原型；sidebar 皮冲突以交接文档表述为准。
- 未审在途 `7c1a5c0` 代码是否已修正营业条（明确不追在途）。

## 与事实源冲突但无法判断谁对

- D-283 授权 sidebar 暂留旧皮 ↔ 回滚说明列为「没换皮 = 做偏」：交接文档自己也标为「待 Lemon 裁」，审查员不代裁。

## 本次未覆盖范围

- CDK/卡片/设置页需求（明确未完成）、工作台重做后的代码行为（在途）、Pro/付款执行器、安全审计。未改任何被审文件、未碰生产。

---

# 批次2：`88037c4` 付款不明链闭合 + D-284 裁定一致性

- 批次头：截至 2026-09-19 UTC｜审查对象 commit `88037c4`（+`48524ec`/`911c5ce`/`7b2ec2b` 落盘）｜生产 `20260918-step5b-b0a36d4`（本轮未部署、未推远端）｜板块 E｜可审点＝工作区已干净、提交在本地。

## 整体判断（先肯定）

质量较上一版显著提升：范围克制（只闭付款不明一条链，未整屏重做）；采纳 D-284 三点裁定与本报告 F-66/F-67；`browser-admin-service.js` 的 B1 是执行窗口自查出的真闭环缺口（Browser 正式收口不关自己的 case/告警），补关逻辑与 API 侧对称、引了行号；F-61/62/63 前端改法方向逐条对；未验证项诚实登记 UNVERIFIED，未犯「测试绿＝验收」。

## F-68 `PAYMENT_UNKNOWN_CASE_TYPES` 未定义 → 队列有付款不明 case 时崩（本轮交付的核心 UI）

- 板块/严重度：E / **P1**（近 P0：付款不明单是资金链，队列崩＝运营在工作台看不到该处理的资金项）
- 观察：`v1/public/admin/assets/admin.js:394` `const isPaymentUnknown = PAYMENT_UNKNOWN_CASE_TYPES.has(c.caseType);`。`grep -rn PAYMENT_UNKNOWN_CASE_TYPES v1/public/admin/` 全目录**仅此一处使用、无任何定义**；admin.js 无 import；`index.html:12` 仅引 `admin.js?v=53` 一个 script、无内联 script；`API_PAYMENT_UNKNOWN`/`BROWSER_PAYMENT_UNKNOWN` 字面量前端零出现。
- 结论：该标识符未声明。`renderWbQueue` 的 `cases.forEach` 执行到 :394 抛 `ReferenceError: PAYMENT_UNKNOWN_CASE_TYPES is not defined`，队列渲染中断。`node --check` 是语法检查，抓不到未定义引用（运行时错），故「node --check OK」不能证明其存在。
- 影响条件：`reconCases.cases` 非空（有任一资金核对 case，即付款不明单出现时）。无 case 时不触发——可能因此在空数据下"看着正常"。
- 与完成声明冲突：执行窗口称「node vm 加载真实 admin.js 调真实 renderWbQueue 四态隔离断言全过」。若测试让 cases 带一条真实 caseType 的 case，:394 必抛。**未读其测试代码，不断言原因**；可能解释：四态未覆盖「队列含付款不明 case」这一态，或 vm 注入了该常量（真实浏览器无）——若属前者，即 STEP6_REVIEW 已点的「测试只证明自己」（跑偏#6）重演。
- 反证/不确定：若运行时实际不崩，则常量以三重 grep 未覆盖的方式存在（可能性已很低）。
- 最小验证：真实浏览器开工作台、队列含一条付款不明 case → 看是否 ReferenceError；或复核其 node vm 测试是否真让 `cases` 进入 :394 分支。最简自验：真实页面 Console 敲 `typeof PAYMENT_UNKNOWN_CASE_TYPES` → `"undefined"`。**复现陷阱**：若用 Proxy/万能 mock 兜底全局，`get` 兜底会把未定义的 `PAYMENT_UNKNOWN_CASE_TYPES` 也返回成 mock 对象、`.has()` 不崩（假阴性，本审查员首次复现即中招）；复现时该常量必须不被兜底。源码执行路径（admin.js:384 `if(!box)return` + :386 `cases` + :393 forEach + :394）+ 全 v1 零声明已足以定论，运行时复现只作加固。
- 建议：定义 `PAYMENT_UNKNOWN_CASE_TYPES`（成员须对齐服务端 reconciliation case type 的真实取值，先验真再写）；补一个「队列含付款不明 case」的渲染用例堵测试盲区。
- 置信度：高（静态证据确凿）；「测试为何没抓到」为中（未读测试代码）。**独立得出**（本轮 88037c4 新引入代码，非转述 STEP6_REVIEW）。

## F-69 D-284 编号撞车

- 板块/严重度：E / **P2**（治理/事实源）
- 观察：`DECISIONS.md` D-284＝执行窗口「第⑥块三点基准裁定」（`7b2ec2b`）；本报告上轮给 Lemon 的 D-284 草稿＝「设立 Claude 审查员角色」，尚未落盘。
- 结论：两条抢同一号。审查员角色那条应改 **D-285** 再落。第三次 D 号撞车（D-282 先例；D-280 有「新建区先查占用表」纪律）。
- 置信度：高。

## F-70 `51da3a0` 覆盖掉的 9 条历史处置仍未恢复（上轮 P1，仍开）

- 板块/严重度：E / **P1**（审计留痕完整性）
- 观察：本轮 DISPOSITIONS 是**追加**（新增「2026-09-19 本轮闭合更新」节，未再覆盖，此点已纠正）；但 `git show 51da3a0^:docs/reviews/DISPOSITIONS.md` 里的 9 条历史处置（含 FULL_CHAIN_AUDIT 的 P0/P1、9-11 `B1 处置 release 20260911-…`）当前文件仍缺失。
- 结论：覆盖事故尚未修复，当前 DISPOSITIONS 事实源残缺（git 可找回）。
- 建议：执行窗口从 `51da3a0^` 取回 9 条历史、追加复位（不覆盖现有 F-61~F-65 与本轮节）。
- 置信度：高。

## F-71 「六来源失败」覆盖不全

- 板块/严重度：E / **P3**
- 观察：`88037c4` 注释与 HANDOFF 称 `loadOverview` 六来源失败标 `__error`；但 `renderWbQueue` 的 `sourceFailed` 只检查 3 个来源（`reconCases`/`daily`/`alertData`，admin.js:418 附近）。
- 结论：数字不符（六 vs 三）；其余来源失败是否也让空态显「失败」而非「清爽」不明。
- 建议：确认六来源失败都进 `sourceFailed`，或说明其余来源不进队列空态判断。
- 置信度：中。

## 上轮发现的消解确认（如实报，非问题）

- F-66（基准未冻结即开工）→ Lemon D-284 三点裁定 + 当前 HANDOFF 已按裁定重写，**消解**。
- F-67（营业条模型不一致）→ 裁定统一「3 toggle + 路线切换块留工作台 + 供给参数归设置页」，当前 `HANDOFF_NOW.md:12/:33` 一致，**消解**。**更正**：上轮我基于 `51da3a0` 旧版 HANDOFF（「营业条=五决定、砍三 toggle 是错的」）担心「裁定与交接文档打架」；当前 HANDOFF 已删该段、改为方向 A，故不成立——以当前版本为准。

## 完成声明边界

- F-61/62/63 前端改法方向对（读 `88037c4` diff 确认）；F-62 服务端字段 `unverifiableAmountCount` 已核实存在（`daily-reconciliation-service.js:353`）；B1 补关 case/告警对称有据。**但 F-61 的实际可用性被 F-68 否掉**（跳转改对了、却引入未定义常量崩队列）。
- DB 端到端未跑（集成测试因本机无 `TEST_DATABASE_URL`、11 例全 skip）；执行窗口诚实标注、未虚报，D-284/HANDOFF 均写「发布前必须补隔离库那一跑」。

## 未能核实

- 执行窗口单测是否真全绿（本审查员**未独立复跑**；测试在 `v1/test/`：`browser-admin-service.test.js` / `admin-read-service.test.js` / `browser-resolve-unknown-payment-mysql-integration.test.js` 等）。
- F-68「测试为何没抓到」的确切原因（未读测试代码）。

## 本次未覆盖

- CDK/卡片/设置页（未做）、营业条方向 A 的实际落地（未做）、F-64/F-65（未做，留后续）、Pro/付款、安全审计。未改任何被审文件、未碰生产。

---

# 批次3：`27ce902`+`6642171` 数字墙/队列按原型C恢复 + F-63 真实验收补漏

- 批次头：截至 2026-09-19 UTC｜审查对象 `27ce902`/`6642171`（本地领先 origin/main 2、未推、未部署）｜生产 ⑤b 未动｜板块 E｜可审点＝工作区干净（仅审查员报告未跟踪）。

## 整体判断（先肯定，均独立验证）

这轮有实质突破：执行窗口**首次做成真实浏览器界面验收**（RUNBOOK §2.8：本地 v1 + 隔离库 pojia_step6_ui + 真实浏览器 1280×900，四态全验），抓到 node 渲染测试与本审查员静态审查都漏掉的真缺陷。独立验：
- **自动完成率守住 D-284 裁定**：renderWbWall 五格里自动完成率/今日花费/异常支出标「待接入」+ disabled，注释引 D-284 ③、明确不自拟算法；单测「不得用告警数/案例数顶替未接入格子」锁住。
- **F-64 闭合合理不越界**：待销到期（`daily.retirementDueCount`）+ token 失效（`PROVIDER_TOKEN_EXPIRED` 告警）放回队列，只提醒 + 跳 stock、完整动作留卡片页；原型 C 确画了这两类。
- **token 观察/结论分开**：仅有 `PROVIDER_TOKEN_EXPIRED` 告警时报「已失效」，无告警不写「有效」（configured=true 推不出有效）；单测锁住。
- `admin-workbench-queue.test.js` **13/13 绿**（本审查员独立复跑）。

## F-72 更正批次2 的 F-71：根因是 loadOverview 从未落 `__error`（P1，非 P3）

- 板块/严重度：E / **P1**（更正：批次2 误定为 P3）
- 观察：批次2 我只就 renderWbQueue 的 `sourceFailed` 只查 3 来源提了 F-71（P3）。真正的根子在 `loadOverview`：自 88037c4 起，6 个来源的 `.catch(() => ({...}))` **都没有 `__error` 标记**（我当时只读了 renderWbQueue、未读 loadOverview 的 catch 实现）。
- 结论：无 `__error` → `sourceFailed` 恒为假 → 任一待办接口挂掉，队列照样显示「今天清爽」、付款不明单被漏。F-63 在 88037c4 的「修复」实为形同虚设。这是 P1（客户资金可见性），不是 P3。
- 证据：`27ce902` 把 6 个来源 catch 全部改为带 `__error: true`；执行窗口经真实页面验收（500 注入）抓到，node 渲染测试抓不到；本轮新增「待办接口 500 时 loadOverview 必须让队列说接口失败」用例（13/13 绿）覆盖。
- 处置：`27ce902` 已修，本审查员确认。
- **更正说明（协议 §4.5 追加不改历史）**：批次2 F-71 定性偏轻，因我只读渲染函数、未读数据获取层 loadOverview。教训：审前端渲染问题不能只读渲染函数，要连数据获取/错误处理层一起读。真实界面验收 > 只读部分 diff 的静态审查。
- 置信度：高。

## F-73 case 标题英文枚举（P2，已修）

- 观察：`RECONCILIATION_TYPE_LABELS` 原缺 `API_/BROWSER_PAYMENT_UNKNOWN`，队列标题 fallback 显原始英文枚举给运营看。
- 处置：`27ce902` 补中文标签（同样真实页面验收抓到，node 测试只断言按钮文案、漏标题）。已修，确认。

## F-74 token 告警依赖最近 100 条（P3）

- 观察：队列从 `alerts?limit=100` 里挑 `PROVIDER_TOKEN_EXPIRED`；listAlerts 不支持按类型过滤，OPEN 告警超 100 条时 token 告警可能被淹没漏报。
- 处置：执行窗口已登记 UNVERIFIED_LEDGER；系现有 API 局限。确认，留观察。

## 治理：审查员角色决定仍未落盘

- D-284=三点裁定、D-285=数字墙恢复；本报告建议给「审查员角色」的编号一路被占，该决定至今未进 DECISIONS，现应用 **D-286**。（非代码问题，提醒 Lemon。）

## 已推送状态

- 前 6 提交（至 `bbd9c9d`）已 push origin/main；`27ce902`/`6642171` 未推、未部署。已 push 的含 F-68 已修版本——origin 上无已知崩溃版本。

## 本次未覆盖

- CDK/卡片/设置页（未做）、营业条方向 A 落地（未做）、部署门槛的生产环境端到端复跑、两条既有红测试。未改任何被审文件、未碰生产。

---

# 批次4：`19647a3` 营业条方向 A（路线切换接回工作台 + 修"永远切不动"）

- 批次头：截至 2026-09-19 UTC｜审查对象 `19647a3`（本地领先 origin/main 1、未推、未部署；`27ce902`/`6642171` 已推 origin）｜生产 ⑤b 未动｜板块 E｜可审点＝工作区干净。

## 结论：通过，质量高，无新 P1/P2

认真核了两个最可能藏雷处，均通过：

1. **根因诊断准确**（"路线切换永远切不动"的三个串联洞）：`.default-recharge-method` 按钮全项目从未渲染 / `state.rechargeMethod` 只读从未赋值 → `expectedCurrentMethod` 恒 `'NONE'` → `VERSION_MATCH` 必失败 / 路线区不显示当前走哪条。修复：renderDecisions 渲染路线块 + 赋值 `state.rechargeMethod`（admin.js renderDecisions 段）。
2. **字段位置 + 值域都对（独立验，非信其隔离库验收）**：位置 `providerHealth.rechargeMethod` 确在 `admin-read-service.js:809`，值取自 `recharge_executor_kind`；值域——后端 worker `workflow-handlers.js:121` `if (!['API','BROWSER'].includes(executorKind)) throw ROUTE_NOT_EXECUTABLE` 权威消费逻辑证明取值域就是这两个，前端 `.toUpperCase()` 比较与后端一致。
3. **切路线（资金路由，敏感）有二次确认**：`admin.js:1527` `window.confirm(…只影响切换后新建订单…)`，符合 D-119「production action confirm once」；`:1525` 前端也 guard method 值域；`expectedCurrentMethod: state.rechargeMethod`（:1532）传真实当前方式＝修复核心；拒切原因（browser_recharge_not_ready / rejected + `switchCheckReasons` 逐项）文案齐全，符合面一 C1「拒切显示逐项原因」。
4. **测试 18/18 绿**（本审查员独立跑，含 5 条路线切换用例 + 字段位置锁死）。三层验收（界面 / 业务切得动 + DB 翻转 + 审计行 `c70f4326…` / 拒切路径）执行窗口在隔离库真做了。
5. **诚实项**：背景更正（D-284 ① 记的"挪去设置页"经核不成立，实为"没入口"）；未做标注（Browser 执行器就绪态切换未验，隔离库无 ACTIVE profile）。

## F-75 未覆盖：当前路线为 NONE 的首次设置未验（P3）

- 观察：`expectedCurrentMethod: state.rechargeMethod || 'NONE'`（admin.js:1532）。验收覆盖了 API↔BROWSER 互切，未覆盖"当前 rechargeMethod 为 null（从未设过）→ 首次设置"时传 `'NONE'` 的 `VERSION_MATCH` 行为。
- 影响条件：生产 provider_route 从未设过默认方式（罕见）。建议：次要，出现时补验即可。置信度：中。

## 本次未覆盖

- CDK（D-279）/卡片页（D-280）/设置页（未做）；Browser 就绪态切换；部署门槛的生产环境端到端复跑；两条既有红测试。未改被审文件、未碰生产。

---

# 批次5：`eef31d1`~`bb26f9e` CDK（D-279）+ 卡片页（D-280）

- 批次头：截至 2026-09-20 UTC｜审查对象 CDK+卡片页 8 提交（2084 行，已 push origin/main）｜生产 ⑤b 未动｜板块 E（触及 A/B）｜可审点＝工作区干净。
- **方法**：2084 行，按协议 P0/P1 优先**抽样审最高危维度、非逐行**。

## 结论：抽查 6 维度全过，无 P1/P2

1. **卡资格（D-280 硬约束）**：`card-inventory-eligibility.js` 是既有权威模块（`19647a3` 已在，**非本轮新建**——最初"新建即嫌疑"的前提被证伪）；核心 `eligibleInventoryCardSql` 搬移前后 diff **完全一致、一字未改**；卡片页/工作台经 `providerCardStockSql` 复用同一份。未另写一套。
2. **敏感数据**：卡号只 `encryptSecret`→ciphertext + pan_hmac，后端卡列表不 select 明文，前端一律只显 `last4`，登记框提示"别输完整卡号/安全码"。不泄露。
3. **CDK 前缀按产品（D-279②）**：`CDK_CODE_PREFIXES=['PLUS-','5X-','20X-','PJ-']` 格式校验含旧前缀（旧 PJ- 码继续收、不"导入即非法"）；生成按产品 + 未知安全回退 PJ-；核实客户兑换 `normalizeCdk` 只校长度+哈希、不看前缀（未盲目改兑换路径）。旧码保住。
4. **migration 055**：只加列（issued_at/issued_note/expires_at）、全可空、明确"不动存量、行为与迁移前一致"、带索引；expires_at 可兑与否运行时按路线判断（不落静态字段）。向后兼容。
5. **跨页口径一致**：工作台"卡与钱"（admin-read-service.js:683）与卡片页台账（card-stock-service.js:366）同调 `providerCardStockSql`，"可分配"永远同口径。
6. **测试**：admin-cards-page 15/15、cdk-service 10/10，本审查员独立跑绿。

亮点：多处比需求周全（验真兑换路径 / 迁移向后兼容 / 资格单一事实源）；执行窗口自查纠错（`bb26f9e` 撤回 D-273 同类的自建钱包键、订正"两条红测试实为六条"）。

## 覆盖边界（抽样非逐行，别当逐行审过）

未深覆盖：CDK 负债条 D-286 计算口径、码有效期 `expires_at` 运行时兑换判断、卡片页 token 输入框（D-280① 若已做的处理）、手动用卡/待销登记完整流程、admin.js 其余 +545 行、cards.css。未发现问题 ≠ 已逐行验证。

## 治理

- 审查员角色决定仍未落盘（D-286/287 已被占），应用 **D-288**。
- D-287「新增钱包底线设置键」已被 `bb26f9e` 撤回（改读 `provider_accounts.wallet_floor`），DECISIONS 该句过时，落 D-288 时订正。

## 本次未覆盖

- 设置页（未做）；上列抽样未深覆盖项；部署门槛生产端到端复跑；两/六条既有红测试清理。未改被审文件、未碰生产。

---

# 批次6：执行窗口交底 6 条薄弱点的独立核实

- 截至 2026-09-20 UTC｜针对执行窗口经 Lemon 转达的 6 条自陈薄弱点，独立核（不照其清单打钩）。

## 真发现（值得跟进）

- **#1b 今日窗口"唯一定义"没收全（P2）**：`todayCst8WindowSql` 号称唯一定义，但 `admin-read-service.js:555`（今日订单计数）、`:862`（今日订单过滤）两处仍手写 `TIMESTAMP(DATE(CONVERT_TZ(...)))-INTERVAL 8 HOUR`、未走它。当前结果一致（下界相同、上界对 created_at 列无影响），改"今天"定义时会漂移。执行窗口自陈"没系统搜第三处"——**坐实**，且具体位置正是它以为已合并的 admin-read。建议收编这两处，或显式标注"故意保留手写"。
- **#2 highvcc 查余额成功分支外网未验（P2，其自陈）**：只验了 `highvcc_token_missing` 失败分支，成功分支字段结构没在真实外网确认。外部字段未验真是本项目惯犯高发区。建议：确认成功分支字段有 highvcc 合同/真实样本依据，不能只凭失败分支就认成功分支对。
- **#6 externalCardId「两者不同」无样本（P3）**：生产 `provider_card_id = external_card_id` 全相同（30/30），前端用 externalCardId 定位卡（admin.js:1299/1420）做手动登记，"两者不同"分支未验。当前无样本，留观察。

## 澄清（它多虑或已做干净）

- **#1a 可分配 / #1c 钱包底线**：全库搜**无第二份**——可分配唯一走 `eligibleInventoryCardSql`（别处 inventory_status 全是状态迁移/分类计数），底线唯一 `provider_accounts.wallet_floor`（自建键已撤）。
- **#4 动了已验收测试、抽 harness**：**没削弱断言**——测试 18→21 全绿（本审查员独立跑），删 1 断言移进 helper 1（等价搬移），反而增强。
- **externalCardId 暴露本身**：**非敏感泄露**——是卡台卡 ID、非卡号/CVV/token，运营去卡台操作需要它。可接受。

## 确认（诚实标注属实）

- **#3 卡片页/迁移 055 生产零验证**：属实，是部署门槛（不影响 push、影响上生产），非 bug。
- **#5 F-65 供给开关红是有意留**：属实——F-65（`setSupplyAutomation` 双写）已知留 PROJECT_MAP §5、做供给控件时闭合，红非漏跑测试，不误报。

## 总评

交底 6 条：**2 条真 P2（#1b / #2）+ 1 条 P3（#6）** 值得跟进；其余多虑或已做干净、或属诚实标注。主动交底 + 审查员独立核，正是协议"记录分离、避免相互引导"下的健康协作。
