# 接班一屏（HANDOFF_NOW）

更新：2026-09-24 08:5x（UTC+8）＝ 00:5x UTC。当前执行顺序以 **D-352** 为准。上一窗口（1da900ae）在此收尾。

## 现在的状态（证据：CURRENT_STATE.md；以下 00:48 UTC 现查）

- 生产 release **`20260924-supply-blocked-once-2f91f00`**（D-363 ⑤，02:14 UTC；回滚点 `20260924-wb-remaining-2830063`）。默认路线 BROWSER（D-353），Browser Plus 用 highvcc（backup-a）。
- 块 0～3、块 5 已发布；欠账 3（每卡单数按产品，D-361，迁移 059）、欠账 15（工作台「剩 N 张 · 能充 N 单」，D-362）已发布；每周自检 `scripts/weekly-check.sh` 已就位（D-360，「可离开」第四条）。
- 可分配 Plus 卡 1 张（highvcc 8718，能充 3 单）；钱包快照 HNSKJ $104.71（00:48 UTC）/ highvcc $34.24（00:13 UTC）。
- **HNSKJ 供卡故障进行中**：`supply_fault_state=FAULT`、`CARD_STOCK_PURCHASE_DISABLED`（HNSKJ 卡类型接口返回 `purchaseEnabled=false`，卡台侧原因未知），最近一次 00:44:49 UTC。当前不影响接单（Browser 走 highvcc；HNSKJ 只供 API 路线，按 D-253 不转台）。
- 本机常驻池 PID 6667 + supervisor 61962 在跑（块 3 拉起的正式池，保留）。

## 待处理的四个问题（Lemon 2026-09-24 08:3x UTC+8 提出；只查了、**都没改**）

1. **卡与钱排版被改**：「自动补 / 需人工开」下沉第二行是上一窗口 D-362 **未先问 Lemon** 自作主张（`workbench.css` `.wb-prod` flex-wrap + `small{width:100%}`），需按他意见重做。两台钱包样式不同**不是这次改的**（自 `a45ec41` 起：HNSKJ 读本地快照 → 绿 chip；highvcc 无快照，点「刷新余额」才出数 → 灰 chip + 按钮，`admin.js` renderWbCards）。
2. **「更新登录」跳到贴 token 框 / 提示条不消失**：按钮 `data-highvcc-target="token"` → `openHighvccTarget` 固定滚到 token 输入框，不判断 token 是否还有效（卡片页只写「token 已配置 上次更新于」）。提示条不消失的根因：`showNotice`（`admin.js:203`）**没有自动消失**，只能被下一条覆盖或刷新页面。Lemon 说的文案「已保存，改动立刻生效」在代码里只出自设置页保存（`admin.js:3417`），书签路径文案是「highvcc 登录 token 已自动保存…」——他看到的是哪条**未核实**。
3. **卡片页 highvcc 只有「查余额」没有余额**：`admin.js:1323` 起 highvcc 格只渲染按钮；点了滚到「一键开卡」折叠区在那里显示余额，格子本身不回填。
4. **HNSKJ 故障一会儿推 3 条**：已核实推送（`alert_notifications` SENT）：故障 00:13 一次；「缺卡但开不出来」00:14、00:30、00:45:58 三次（`incident_version` 1→3）。机制：调度器每 15 分钟（`SUPPLY_FAULT_RETRY_MS`）重试故障卡台，重试时 `accountCanOpen` 放行 → 先 `resolveSupplyAlert` 关掉缺卡告警 → 读钱包仍 `purchaseEnabled=false` → 重标故障、缺卡告警重开 → 057 触发器把「重开」算新事件 → 再推。**2026-09-24 01:11 UTC 新窗口复查：00:48:38 UTC 后台（账号 `admin`，谁点的未核实）已把 HNSKJ Plus 水位 1→0，调度器转 `NO_DEMAND` 不再重试，推送停在 00:45:58 第 3 次**；**⑤ 已发布并在生产验过**（02:15:33 UTC 首轮把挂着的缺卡告警关掉、无新推送；D-363：故障重试不再先关缺卡告警；缺口真补上或真开出卡才关；隔离库带真实 057 触发器复现旧代码 v1→v4、修后整段只 v1）。

上一窗口给过的建议（Lemon **未批**，新窗口先对齐再定）：①卡与钱改回一行、放不下才两行，先给原型；②两台钱包统一成「上次余额 + 查询时间 + 刷新」；③成功提示 4 秒自动消失、失败保留，「更新登录」先查 token 是否可用；④卡片页 highvcc 格直接显示余额并就地刷新；⑤故障重试期间不先关缺卡告警、真开出卡才关（同一故障只推一次）——建议最先做。临时止响已发生（见上，水位 0）；HNSKJ 为何停开卡仍需 Lemon 去卡台看。

## 下一可执行项（按 D-352 块序）

1. 上面四个问题：**D-363 定先做⑤，再①～④一批**（①先给原型）。⑤ 已发布。**①～④ 已本地实现并验收、未发布**（D-364）：等 Lemon 看截图（卡与钱改前/改后、卡片页台账栏）后说发布；发布前要重冻卡片页原型（`_frozen/cards-a/` + `step6-cards-a.html` 那格），否则 `cards-page.json` 契约一直报 5 处高度差。本机隔离库 `pojia_ui_d363`（容器 pojia-stage1-mysql）与临时凭据留着给这一轮改版用，定稿后删库。
   - 同文件两条待 Lemon 定：欠账 16（调度器一轮只看一个候选，触发条件「下次动调度器时」已到）；欠账 17（转台开卡按水位会一张接一张开，代码显示、生产 0 次，见 PROJECT_MAP）。
2. **块 4**：Plus Browser 真钱一单——**不排**（D-363：Lemon 不花钱、没有 free 号）。流程：关付款开关与下单查心跳 → Lemon 建演练单 → 单单 rehearsal → 收口放卡 → 开回开关 → 真单 → 盯成功与取消续费 → 对账（RUNBOOK §2）。
3. **块 6 前置**：Free→Pro 20x 非付款 PoC，任务书 `tasks/2026-09-24-block6-pro20x-poc.md`，脚本 `browser-mvp/scripts/poc-free-pro20x-checkout-readonly.mjs` 已写未跑。挂起：Lemon 没有无订阅账号（曾付费、当前无订阅的也行，按钮会是 Rejoin Pro）。
4. **块 7**：删表盘点（只出清单不动生产）+「可离开」剩「连续 10 单 Plus 无人介入」（等真单）。

## 已定不做 / 禁区

- 付款前三件（`billing-address-fill.js` / `live-chatgpt-payment-adapter.js` / `payment-executor.js` submit 段）不改（D-254）；browser-mvp 改动走任务书白名单。
- 不重开：D-248、D-240、D-253、D-249、D-275、D-306。critique 裁定（D-359）：「需要我处理」桶内不按风险分色、订单页默认桶不改。
- 资金与生产动作当次确认；**发布先问**。

## 待 Lemon 定

- 「可离开」第一条（10 次演练 + 两单真钱）没有可执行路径：Lemon 不花钱、没有 free 号（D-363），需给选项让他定。
- `DESIGN.md`「概览」一节的措辞核对。

## 未验证边界

- 当前 release 真实付款、取消续费、付款不明恢复、Browser 崩溃补核、分卡当场同步均无真单样本（`UNVERIFIED_LEDGER`）。
- HNSKJ `purchaseEnabled=false` 的卡台侧原因未知。
- FB-04：1657 / 3159 / 7402 三张 highvcc 卡 Lemon 尚未销卡（不急）。
- 代码显示的六条结构性问题（D-352）未在生产复现；web/worker/bark 三进程 journal 去向未查到。

## 每块收尾

跑 `scripts/wrapup-check.sh`；向 Lemon 交「我理解的决定」清单；重写本文件。
