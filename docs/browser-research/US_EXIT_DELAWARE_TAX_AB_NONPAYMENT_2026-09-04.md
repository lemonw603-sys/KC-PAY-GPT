# 美国出口 + Delaware 非付款税费 A/B（2026-09-04）

## 目标与边界

只回答一个窄问题：在同一测试 Session、同一测试卡和同一 Delaware 账单地址下，把 BitBrowser 出口从菲律宾换成美国后，ChatGPT Plus Checkout 如何定价和计税。

- 独立一次性 BitBrowser Profile，不同步 Cookie、Session、LocalStorage、IndexedDB 或支付地址。
- 测试前 Cloudflare trace 为 `loc=US`，ChatGPT 公开页 HTTP 200。
- 只到 Subscribe 之前；没有点击、没有付款、没有 Provider/卡台写入。

## 现场结果

Session 身份匹配，账号状态为 `FREE`，通过常规升级入口进入真实 ChatGPT Plus Checkout。

| 观察点 | 基础价 | 预估税 | 当日应付 |
| --- | ---: | ---: | ---: |
| 填付款资料前 | `USD 20.00` | `USD 2.40` | `USD 22.40` |
| 填卡后 | `USD 20.00` | `USD 2.40` | `USD 22.40` |
| 填写 `US/DE` 账单地址后 | `USD 20.00` | `USD 0.00` | `USD 20.00` |

其他关键证据：

- pricing config 请求是 `/configs/US`，Plus 月付配置为 `20 USD`。
- Checkout create 返回 `billingCountry=US`、`billingCurrency=USD`、`checkoutUiMode=custom`。
- 地址更新后观察到 Checkout snapshot `204`；当次浏览器观察器未取到 request body，所以不把 snapshot 请求内部国家/州字段写成已证明。
- 最终页面字段回读为 `US/DE`；Subscribe 控件存在且可用，但 `submitCalls=0`。
- 清理结果：7 个字段已清空，Session/输入临时文件已删除，Cookie/storage 已清理，Profile 已关闭。

## 与菲律宾基线的对比结论

菲律宾常规路线之前现场结果为 `PHP 982.14 + VAT 117.86 = PHP 1100.00`。本次美国出口常规升级入口直接进入了 **US/USD 定价轨道**，Delaware 地址把税从 `USD 2.40` 更新为 `USD 0.00`。

因此本次证明：

1. 出口国家是 Checkout 地区/币种选择的决定性组合信号之一。
2. 在已进入 US/USD 轨道后，Delaware 地址可以把当次显示税降为 0。
3. 它**没有**复现 `PHP 982.14` 最终价，因为常规入口已切换为 `USD 20.00`。
4. 要验证社区线索“美国出口 + 显式 PH/PHP 定价”，必须在创建 Checkout 时显式锁定 `PH/PHP`，不能把本次常规 US 入口结果冒充为该结论。

这一结果只是诊断对照，不改变当前 Browser 生产出口保持菲律宾的业务决策。

## 本轮发现并修正的观察器问题

1. 冷 Profile 中账号接口可以先于页面升级控件完成 hydration；导航器改为有界等待，且点击等待上限从 5 秒改为 15 秒。
2. 当前中文 Checkout 文案是“按月订阅”和“今日应付金额”，已加入金额解析。
3. Stripe 合法 URL 路径含 `cookie`，原先对整个 JSON 做子串搜索会误报。现在禁止字段检查只扫描字段名，禁止原值仍扫描整个证据；对敏感父节点不再递归提取 pricing signal。

Browser 全量测试：`151 total / 146 passed / 5 environment-skipped / 0 failed`。

## 旧显式 `PH/PHP` 创建尝试（证据已降级）

在用户同意继续后，旧观察器曾增加显式 API 创建模式，请求包含 Plus 套餐、`PH/PHP` 和 `custom` 模式，且没有付款调用。事后对照当前生产前端 bundle 与一次上游前 abort 的官方请求捕获，确认该实现并不等价于官方调用：它使用附件中的旧 `accessToken` 裸调 API，缺少官方动态生成的 Sentinel、设备和目标路由请求头。

现场结果：

- 第一次创建返回 HTTP 400；原观察器只保留状态码。
- 补充安全错误摘要后只重试一次，仍为 HTTP 400，公开错误是 `Our systems have detected unusual activity. Please try again later.`
- 在线窄探测已达 2 次，按规则停止，不继续重复创建 Checkout。
- 两次都停在 Checkout 创建前：未进入支付页、未填卡、未点击 Subscribe、`submitCalls=0`。一次性 Session/输入文件已删除，Profile 已关闭。

因此，这两次返回只能证明旧裸调探针被拒绝，不能证明账号被禁、出口被禁或 `US 出口 + PH/PHP` 被官方路径拒绝，也不能判断最终税额。当前官方 UI 拦截样本已确认真实请求同时携带 bearer、Sentinel、设备和目标路由请求头；新实现保留整条官方请求，只重写 `billing_details.country/currency`，并最多放行一次上游 Checkout 创建。离线/拦截验证已通过，真实零付款复验仍待执行。

## 证据路径

脱敏现场结果（不纳入 Git）：

```text
/Users/lemon/.codex/worktrees/9128/AI充值业务/artifacts/browser-us-tax-ab-20260904/result-success.json
```
