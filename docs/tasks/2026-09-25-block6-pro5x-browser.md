# 任务书：块 6 — Browser 路线支持 Pro 5x（D-370，20x 官方暂停不做）

## 目标
5x 单和 Plus 单走**同一条路**：选 5x 档进结账 → 免税账单后零税报价 → 付款（提交段不动）→ 确认账号已是 Pro → 取消续费 → 收口。不再走旧的「先买 Plus 再升级」两步走。

## 现状（代码证据，2026-09-25 只读核对）
- 非 Plus 一律走旧两步走：`production-live-pool-worker.js:256` 非 plus → `UPGRADE_DIALOG_STOP`。
- 写死 Plus 的地方：`shared-live-composition.js:210`（观察 `plan: 'plus'`）、`chatgpt-checkout-navigator.js:536`（包装函数固定 `plan: 'plus'`）、`chatgpt-post-payment-verifier.js:238/239/254`（付款后确认与取消续费前都要求套餐名含 `plus`）、`browser-card-transaction-reader.js:52/163/186`（交易金额只认 Plus 区间）。
- **不用改的**：付款前报价核对只查「比索、税为 0、前后一致」，不含 Plus 价（`live-chatgpt-payment-adapter.js:97-100`）；导航已支持选 5x 档（D-369 实测 `tier-selected:5x`）；每卡 5x 只充 1 单（D-361）；5x 最低余额 $95 / 开卡 $100 够用（D-370 更正：免税后约 $93）。

## 改动白名单（越界即停下来问）
1. `browser-mvp/src/production-live-pool-worker.js` — 5x 走 `CANCEL_RENEWAL`，把订单套餐传给导航与核实。
2. `browser-mvp/src/shared-live-composition.js` — 观察与导航用订单套餐，不再固定 plus。
3. `browser-mvp/src/chatgpt-checkout-navigator.js` — 包装函数接受套餐参数（只改 :536 附近，不动点击安全规则）。
4. `browser-mvp/src/chatgpt-post-payment-verifier.js` — 按套餐确认；**5x 付款后账号上的套餐名至今未观察到**：对不上时一律进「付款后需人工确认」，绝不判失败、绝不重付。
5. `browser-mvp/src/browser-card-transaction-reader.js` — 金额区间按套餐（5x ≈ ₱5,794.64 / ≈ $93）。
6. 对应测试文件。
- **不动**：付款前三件（`billing-address-fill.js` / `live-chatgpt-payment-adapter.js` / `payment-executor.js` 提交段，D-254）；旧两步走代码只让 5x 不再走进去，删除留到之后清理。
- v1 侧另列：客户页成功文案按套餐（D-344 留到 Pro 建设时）、订单详情的旧 Pro 两步人工确认（`browser-admin-service.js`）。

## 验收（D-254：全量测试 + 一次演练都绿才算改完）
1. browser-mvp 与 v1 全量测试通过；新增「5x 走 CANCEL_RENEWAL」「5x 套餐名对不上→人工确认不重付」「5x 金额区间」测试，并对旧代码做变异验证。
2. **一次 5x 不付款演练**：停在付款前，看到选 5x 档、免税后零税报价（预期 ₱5,794.64）、付款点击 0。
3. **一次 Plus 回归演练**：确认 Plus 没被改坏。
4. 常驻执行池重启加载新代码前问 Lemon。
5. 重开 5x 下单入口（路线 305）前问 Lemon；真钱验收等第一张 5x 客户单（D-370 更正）。

## 前置条件（需要 Lemon）
- **演练要一个免费号的登录凭证，由 Lemon 在客户页用 CDK 建单**（Session 不经 AI）：Lane 3 那个号可以用，需要 Lemon 从 Lane 3 窗口取出它的 Session。
- **5x 演练要一张 5x 卡**：现在 5x 库存 0，开一张 = 从卡台钱包转 $100 进卡（加手续费）。这是资金动作，需 Lemon 批；或 5x 演练先只走到「零税报价」、不分卡（需另评估演练工具是否支持）。

## 进展（2026-09-25 01:3x UTC+8，D-371）
- 验收 1 ✅：代码在分支 `block6-pro5x`（`71f6ae3`）；browser-mvp 306/0、v1 1027/0；新增 6 条测试，4 处变异验证全变红。白名单第 3 项（导航包装函数）不需要改。
- 验收 2 ⛔：5x 演练卡在「没有 5x 卡」（Lemon 不开卡）。
- 验收 3 ⏳：Plus 回归演练待 Lemon 在客户页用 Lane 3 号建单；演练期间常驻池要暂停（需 Lemon 同意）。
- 验收 4/5 ⏳：合 main、重启常驻池、重开路线 305 均待 Lemon。
- 2026-09-25 01:1x UTC+8（D-372）：导航拦截 `0e97bab`；验收 2 的「无卡零税」变体做不成（无卡时页面没有地址栏），5x 零税仍未验；验收 3 等 Lemon 建单，常驻池暂停中。
