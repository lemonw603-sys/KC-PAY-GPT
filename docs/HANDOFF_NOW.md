# 接班一屏（HANDOFF_NOW）

更新：2026-09-19 UTC。第⑥块**「付款不明一条链」已闭合（F-61~F-63 + 新发现的 B1），已提交 `88037c4`，未推远端、未部署**（Lemon 定：发布前先补隔离库端到端那一跑）。生产未动，仍 ⑤b。接手者先读 AGENTS.md 四份顺序 + `docs/tasks/` face-1~5 账本再动手。

## 生产版本（本窗口开工时现场核实）

- 生产 = **`20260918-step5b-b0a36d4`（⑤b 旧后台）**，本轮**没有发布**。开工时 `state-check.sh` 与 `CURRENT_STATE` **一致**（release / 三服务 active / 可分配 2 / 非终态 0 / 迁移 054）。
- 本机：临时 http.server 8801 已停；常驻 Browser 池 **PID 67131 未动**，别当残留杀。

## 本轮做了什么（提交 `88037c4`，7 文件 +154/−54，**未推远端、未部署**）

Lemon 裁定三点后开工：营业条方向 **A**（原型 C 的接单/派单/付款 3 toggle + 路线切换块留工作台）、sidebar **四页做完再统一换**候光皮、自动完成率**先空着标「待接入」**；范围＝**只闭付款不明一条链**。

- **B1（新发现的闭环缺口）** `browser-admin-service.js`：Browser 的正式收口 `RESOLVE_UNKNOWN_PAYMENT` 原本**不关**自己的 `browser-payment-unknown:{attempt}` case 与 `browser-browser_payment_unknown:{order}` 告警（全库只有 API 侧关）——订单/卡/账本都收口了、工作台那条 case 还挂着，运营只能去点「关闭记录」擦掉（那按钮不动资金）。已在收口成功、CHARGED/NOT_CHARGED 两路汇合处补关 case+告警，与 API 侧对称。
- **F-61** `admin.js`：付款不明 case（API/BROWSER 两类）的「解决」→「**去核实收口**」，带 `publicNo` 跳订单详情做正式收口，不再内联只关 case；非付款不明才留「关闭记录」并改名。
- **F-62** `admin.js`：`unverifiableCount`→`unverifiableAmountCount`；缺字段显「—」不显 0。
- **F-63** `admin.js`：`loadOverview` 六来源失败标 `__error`；队列空态与日对账把「接口失败」和「真没有」分开，不再把读取失败说成「今天清爽」。
- 集成测试：`browser-resolve-...test.js` 造 case+告警、snapshot 加两列、cleanup 补删、三个成功用例断言收口后 RESOLVED。

**更正一条早前判断**：「API 路线前端零 UI」是错的——API 收口 UI（`data-order-resolve-unknown` → `/resolve-unknown-submission`，确认串 `已核实 {publicNo} {outcome}`）一直都在，我当时 grep 词漏了它。所以原计划的 F-1b **不需要做**。

## 已验证 / 未验证（别说成已完成）

**已验证**：相关单测全绿（browser-admin 8/8、reconciliation-case 12/12、unknown-submission-resolve 5/5+4skip、admin-read 20/20、app 74/74）；`node --check` OK；**node vm 加载真实 admin.js 调真实 `renderWbQueue`/`renderWbRecon` 四态隔离断言全过**（去核实收口+跳订单详情+无旧「解决」／无待办清爽／接口失败不冒充清爽／无法核对显真实 30／缺失显—／日对账失败显读取失败）。

**未验证（UNVERIFIED_LEDGER 2026-09-19 条）**：
- 本机无 `TEST_DATABASE_URL` → 集成测试 **11 例全 skip**，**B1 的真实 DB 效果没在隔离库实跑**；端到端（点收口→订单/attempt/账本/卡/case/告警全收口）也没跑。**发布前应补这一跑。**
- 内置浏览器交互工具本轮持续报错（navigate/截图可用，read_page/javascript `-32603`），**没做真实浏览器点击验证**，用 node 侧替代。

## 下一步（按既有执行顺序，不改范围）

1. **补隔离库端到端那一跑**（Lemon 已定：发布前必须补）：配 `TEST_DATABASE_URL` 让 `browser-resolve-unknown-payment-mysql-integration.test.js` 三例转绿，或按 RUNBOOK 在隔离库造一单 Browser 付款不明→订单详情收口→逐项核对订单/attempt/账本/卡占用/case/告警。跑通后再谈发布。**本窗口的提交（`88037c4` 闭链 + `48524ec` 状态同步）全部留在本地、未推远端 —— Lemon 2026-09-19 明确定「先不 push」**；推远端与发布都要他当次点头，别顺手推。
2. 继续第⑥块剩余：营业条按**方向 A** 落实（3 toggle + 路线切换块带面一四项校验留工作台）→ 队列其他来源（F-64 的 `retirementDueCount`/无主扣款落点，属卡片页范围）→ CDK（D-279 七条）→ 卡片页（D-280 八条）→ 设置页；随后⑦、⑧，再 D-243 集成验收。
3. F-65 供给控件双写（`setSupplyAutomation` 仍写两键）留在 PROJECT_MAP §5，做供给控件时闭合。

## 禁止 / 注意

- 开卡 / 补余额 / 充值 / 付款 / 退款 / 切路线 / 发布 / 改开关 / 重启 worker **先开口问**；范围外只报不改（D-254，不碰 browser-mvp）。
- **发布门槛三件缺一不可**：外观符合选定方案 + 数据字段口径正确 + 按钮业务结果正确；测试数量 / HTTP 200 / SQL 有返回**不替代**任何一件。
- 工作区另有审查员窗口所建未跟踪文件 `docs/reviews/STEP6_BASIS_REVIEW_2026-09-19.md`（F-66：基准未冻结即开工——已被 Lemon 开工前三点裁定化解）。**Lemon 2026-09-19 定：留着不动**——非本窗口所建，不替他提交、不删、不改；`wrapup-check.sh` 因此会一直报「工作区干净 ✗ 1 个文件未提交」，这是已知且有意的，不是遗漏。
- 本窗口过程教训：有几轮把工具调用写成普通文本、没真执行却当成功继续（幻觉），靠真实 grep 才纠回。**改一处立刻 grep/Read 核实落盘，别信自己的「成功」叙述**；bash 输出也出现过行号/内容错乱，精确定位一律 Read + `wc -l` 复核。
