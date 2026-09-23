# 任务书：块 6 前置 — Free 账号直购 Pro 20X 的非付款 PoC（D-245 → 合同冻结）

## 目标
用一个**从未付费**的 ChatGPT 账号，在比特浏览器的隔离 Profile 里，从定价弹窗直接选 Pro 20x 进入 Checkout，**停在付款前**，把页面行为冻结成 `docs/contracts/2026-09-24_browser-free-pro20x-checkout-contract.md`。回答 D-141 列出的「从未观察过的」四件事里付款前的三件：
1. 定价弹窗的 Pro 卡片有没有 5x/20x 档位切换（旧观察 D-133/D-136 说没有；Lemon 手动观察说能直升）。
2. 免费账号点「Upgrade to Pro」后 Checkout 开在同页还是新标签；URL 前缀；`checkout-page-content` 是否存在。
3. Checkout 页的套餐名、金额/税行、按钮文案、表单字段与支付 iframe 来源——与 Plus Checkout 的差异。
（第四件「付款后 accounts/check 的 Pro 套餐字符串」属块 6 真钱那一单，不在本 PoC。）

## 范围（白名单）
- 新增：`browser-mvp/scripts/poc-free-pro20x-checkout-readonly.mjs`（隔离赛道，只读；只引用 `src/chatgpt-checkout-navigator.js` 与 `src/post-payment-session-recovery.js`，不改它们）。
- 新增：`docs/contracts/2026-09-24_browser-free-pro20x-checkout-contract.md`；证据 `artifacts/poc-free-pro20x-20260924/*.json`（不入库，摘要抄进合同）。
- 不动：`browser-mvp/src/**`（D-254；付款前三件更不许）、生产开关、常驻池、路线表、订单。

## 需要 Lemon 做的
- 在比特浏览器 **`Plus Browser PH Lane 2`**（备注「非付款隔离验证」，未被常驻池 Pilot 与预检 Lane 3/4 占用）里登录一个**从未付过费**的 ChatGPT 账号，登录完说一声。Session 不经过本仓库。
- 该账号不会被付款：脚本没有卡、没有付款开关、不点 Pay。

## 验收
1. 脚本一次跑完：`fieldsWritten: 0, submitCalls: 0`；证据 JSON 里没有邮箱 / accessToken / Checkout Session ID / PAN。
2. 合同写清：档位切换是否存在及标签；Checkout 打开方式；URL 前缀；套餐名与金额行样式；按钮文案；表单字段清单；iframe 来源；页面自己调的 checkout 接口的安全字段（plan_name / automatic_tax_enabled / currency / amount）。
3. 与现有 Plus 导航合同（`CHATGPT_PLUS_CHECKOUT_NAVIGATION_CONTRACT`）逐项比对，标出块 6 实现要改的点（组合层 `plan: 'plus'` 固定、`expect` 模式、付款后确认只认 plus 等），只列不改。
4. 菲律宾 sticky 出口在线（`38.60.246.34`）时的结果才算数；普通出口只作预筛。
5. 结论进 `DECISIONS.md`（D-360），`HANDOFF_NOW` 更新。

## 停下来问的情形
- 账号进的是「Confirm plan changes」弹窗（说明已付费）；
- 档位切换不存在且 Upgrade to Pro 直接进了 Plus 的 Checkout（与 Lemon 观察冲突）；
- 官方页面提示 Pro 暂停新订阅（D-146 时期出现过）。
