# 免费账号直购 Pro 的结账页行为（非付款 PoC 观察）｜2026-09-24

任务书：`docs/tasks/2026-09-24-block6-pro20x-poc.md`。脚本：`browser-mvp/scripts/poc-free-pro20x-checkout-readonly.mjs`（只读；另有一次临时只读探针读单选框状态，跑完即删）。
证据（不入库）：`artifacts/poc-free-pro20x-20260924/free-pro_20x-2026-09-24T16-56-57-051Z.json`、`free-pro_5x-2026-09-24T16-58-37-356Z.json`。
**每次运行 `fieldsWritten: 0, submitCalls: 0`；没有卡、没有付款开关、没点 Subscribe；结账标签页结束即关。**

## 条件

- 比特浏览器 `Plus Browser PH Lane 3`（备注「非付款隔离验证」，编号摘要 `9d7445ff…`；不是常驻池 `Plus Browser PH Pilot`）。Lemon 同意使用其中已登录的免费测试号（2026-09-24）。
- 出口 `38.60.246.34`、国家 PH（运行前经该窗口代理 `127.0.0.1:17897` 实测）——任务书验收 4 的菲律宾固定出口。
- 账号：`/api/auth/session` 200；账户接口 `plan=free`、无有效订阅；定价弹窗显示 **「Rejoin Plus」**＝**曾订阅过 Plus**（不是「从未付费」）。

## 观察（2026-09-24 16:56～17:05 UTC）

| 问题（任务书） | 观察 |
|---|---|
| 1. 定价弹窗 Pro 卡有没有 5x/20x 档位切换 | **有**。`role=radio` 两枚：`5x`（`aria-checked=true`、`data-state=on`，默认选中）、`20x`（`aria-checked=false`、**`disabled=true`**）。弹窗按钮：Personal / Business / Your current plan / Upgrade to Go / Rejoin Plus / 5x / 20x / Upgrade to Pro |
| 2. 点「Upgrade to Pro」后结账开在哪 | 选 5x → **同页**打开，URL 前缀 `https://chatgpt.com/checkout/openai_llc/…`，`checkout-page-content`（导航合同的就绪选择器）存在。导航动作：`pricing-already-open` → `tier-selected:5x` → `upgrade-requested` |
| 3. 结账页套餐名、金额、按钮、字段、iframe | 页面上两个档位单选：「5x more usage than Plus ₱6,490/month」（选中）与「20x more usage than Plus ₱9,990/month」（**`disabled=true`**）；金额行 `₱5,794.64` + `VAT (12%) ₱695.36` = `₱6,490.00`；付款按钮文案 **`Subscribe`**；可见字段：两枚档位单选 + 税号勾选框 `#subscription-tax-id`；卡信息在 `js.stripe.com` iframe 内 |
| 页面自己调的 `POST /backend-api/payments/checkout` | 200；`tag=custom_checkout_session`、`checkout_ui_mode=custom`、`automatic_tax_enabled=true`、**`plan_name=chatgptprolite`**（5x）、`requires_manual_approval=true`、`status=open`、`payment_status=unpaid`、`checkout_provider=open_ai` |

## 结论（只写观察，不补原因）

- **5x：可以从定价弹窗直接进结账页**，路径与 Plus 同型（同页、同一就绪选择器），套餐名 `chatgptprolite`，价格含 12% VAT。
- **20x：这个账号在这个出口下，定价弹窗与结账页两处都被禁用**，页面无说明。与「免费号可直升 20X」（D-245，Lemon 手动观察）冲突；**原因未知**——账号曾订阅 Plus、所在出口、账号本身资格、官方暂停等都未排除。按任务书「停下来问」。
- 与现有 Plus 导航合同的差异（块 6 实现要改的点，只列不改）：组合层 `plan` 不能固定 `plus`；Pro 需要在弹窗里选档（现已由导航合同的 `tier-selected` 支持 5x）；结账页按钮是 `Subscribe`；付款后确认要认 `chatgptprolite`（以及 20x 的套餐名——未观察到）；Pro 价格含 VAT，与 Plus 当时「税 0」不同，报价核对规则要按套餐分开。
- 未观察：20x 的结账页、20x 的 `plan_name`、付款后 `accounts/check` 的 Pro 套餐字符串（后者属块 6 真钱单）。
