# 菲律宾 ChatGPT Plus `982.14/1100.00` 路线差异（2026-09-03）

## 已确认事实

1. 项目 2026-08-18 独立真实 Plus PoC 最终成功，Provider 和卡台交易均记录 `982.14 PHP`。
2. 2026-08-29 第二笔正式 API 订单最终成功，平台结算 `982.140000 PHP`，卡台记录 `15.76 USD` PURCHASE。
3. 运营方于 2026-09-03 确认近期还有多笔订单实际以 `982.14 PHP` 成交。因此该价格是当前可实现目标，不是仅存在于旧截图的推测。
4. 当前菲律宾 BitBrowser Profile 的非付款实测，在填写卡片和 Delaware 账单地址后为基础价 `982.14 PHP`、VAT `117.86 PHP`、合计 `1100.00 PHP`；未点击 Subscribe。
5. 运营方确认业务出口必须使用菲律宾；美国出口不得作为后续实验或生产解法。

## 外部调查

- 菲律宾 BIR RR 3-2025 对在菲律宾消费的数字服务征收 12% VAT，并允许使用支付信息、居住/账单地址、IP/SIM 等信息判断买方位置；信号冲突时应取得至少两个不冲突的位置证据：<https://bir-cdn.bir.gov.ph/BIR/pdf/RR%203-2025.pdf>。
- 菲律宾 Apple App Store 当前公开列出 ChatGPT Plus `PHP 999.00`，证明不同销售渠道可以采用不同的税内含/本地定价：<https://apps.apple.com/ph/app/chatgpt/id6448311069>。
- 菲律宾社区报告中既有平台吸收 VAT、标价不增加的案例，也有税额在结账时额外增加的案例；“未单列 VAT”不能等价为“没有 VAT”：<https://www.reddit.com/r/taxPH/comments/1mabmo4>。
- 订阅社区存在“美国出口 + 菲律宾定价 + 美国免税州地址后显示约 `982 PHP`”的经验记录，但这只是待复现线索，不能直接成为生产规则：<https://t.me/s/landiansub?before=16384>。

## 当前推断边界

`1100.00` 与 `982.14` 的差异恰为 12%，但已知证据不能证明由任何单一字段决定。当前最有价值的候选变量是：

1. 账号地区和菲律宾定价轨道的选择时点；
2. Checkout 创建入口、创建请求及税务上下文是否不同；
3. 卡片 BIN/发行地区和支付信息；
4. 账单地址在创建 Checkout 前后生效的时序；
5. 账号资格、促销或既有订阅定价；
6. Web 与 App Store 等销售渠道。

Delaware 地址在菲律宾出口下没有改变税额，只能排除“地址单变量必然生效”，不能排除地址与其他定位信号组合后的影响。

## 2026-09-03 新一轮社区与实现对照

新增证据把“页面显示的 `982.14`”和“最终应付 `982.14`”分开了：

- 一张公开的菲律宾 ChatGPT Plus 账单明确列出：订阅净价 `982.14`、12% VAT `117.86`、最终应付 `1100.00`。因此价格网站或 Checkout 配置中的 `982.14` 可能只是 PSP 净价，不能单凭该字段证明免税成交：<https://www.scribd.com/document/996990553/Invoice-Pgfdbz9d-0002>。
- 社区中能复现 `982` 最终价的具体经验组合是“美国出口 + 手动选择菲律宾价格 + 美国免税州地址”：<https://t.me/s/landiansub?before=16384>。它与本项目“Browser 出口固定菲律宾”的已确认约束冲突，所以只能用来说明税务定位是组合信号，不能直接照搬。
- 公开支付实现显示，除了 Checkout 创建请求外，还存在 `POST /backend-api/payments/checkout/snapshot`，用于把账单国家/州等资料写入 Checkout 快照；该请求是否发生、发生在什么时候，以及其后总额是否改变，是当前比继续随机换地址更有价值的检查点：<https://github.com/1537271403/pay153-checkout-link/blob/main/stripe_checkout.py>。
- 公开实现同时确认 `POST /backend-api/payments/checkout` 的 `custom/hosted` 两种模式以及 `billing_details.country/currency` 输入；当前 UI 入口与显式 `PH/PHP + custom` 是否生成同一税务上下文，仍须现场 A/B：<https://gist.github.com/fangyuan99/e93a81f634b68c570a0edb1fee39a511>。

目前最强的、但尚未现场证明的候选机制是：**税不是由页面地址输入框单独决定，而是在 Checkout 创建与 billing snapshot 更新时，根据创建入口、显式地区、出口、卡 BIN 和账单资料联合计算。** 现有 API 成功单没有保留上游 Checkout 创建出口与 snapshot 时序，不能用“API 成交价为 `982.14`”反推其出口一定是菲律宾。

## 已完成的观察器补强（尚未执行新一轮现场 A/B）

`browser-mvp/scripts/observe-bitbrowser-checkout-tax-nonpayment.js` 已增加：

1. Checkout 创建请求的脱敏字段：入口、套餐、`custom/hosted`、billing country/currency；
2. `/checkout/snapshot` 是否发生、HTTP 状态、country/state 和地址字段是否齐全（只记布尔值，不记姓名、街道、城市、邮编原文）；
3. `/configs/PH` 的 country/currency/price/tax/VAT/PSP 等白名单字段；
4. 填卡前、填卡后、账单地址后的三段金额时间线；
5. Stripe 请求只记脱敏后的 URL path 与状态，Checkout ID 被替换为 `:checkout`；
6. 最终证据再次扫描 Session、Token、PAN、CVC、完整地址、Checkout ID 等禁止内容。

新增 7 项脱敏测试；Browser 全量为 `150 total / 145 passed / 5 environment-skipped / 0 failed`。本轮没有打开 BitBrowser、没有读取 Session/卡资料、没有创建 Checkout、没有付款。

## 非付款 A/B 矩阵

在同一代码版本、同一计划、顺序执行且不点击 Subscribe 的前提下：

| 组 | 出口 | 账号/定价轨道 | 支付与账单资料 | 目的 |
| --- | --- | --- | --- | --- |
| A | 固定菲律宾出口 | 当前测试账号，常规升级入口 | 已验证资料 | 基线：预计 `1100.00` |
| B | 固定菲律宾出口 | 独立 FREE 测试账号，显式菲律宾定价入口 | 与 A 同类资料 | 观察账号/入口差异 |
| C | 固定菲律宾出口 | 与 B 同类账号 | 更换为历史 `982.14` 成功卡段/BIN 对应资料 | 观察支付信息差异 |
| D | 固定菲律宾出口 | 同一账号 | 在创建 Checkout 前先建立匹配账单资料，再创建全新 Checkout | 观察税务上下文创建时序 |
| E | 菲律宾 App Store | 独立测试账号 | 不购买 | 核对公开 `999.00` 是否对账号可见 |

Web 组全部使用同一菲律宾出口，一次只改变一个变量。每组只记录：Checkout URL 摘要、创建入口/关键请求结构摘要、计划、币种、基础价、税额、最终总额、账号/运行环境的不可逆摘要和 `submitCalls=0`。不记录 Session、PAN、CVC 或完整地址。

## 完成标准

- 至少有一条 Browser 路径在地址填写后连续两次稳定显示 `982.14 PHP`；或明确证明现有 Browser Web 路径无法复现，并选择已核实的更低成本渠道。
- 任何价格结果都不能绕过最终金额稳定检查、预算门禁和付款 permit。
- 本报告不代表已执行上述 A/B；当前仍为待验证计划。
