# 菲律宾官方 UI PSP 路由非付款观察（2026-09-04）

## 目标与边界

在固定菲律宾出口、同一测试 Session、同一测试卡和同一 `US/DE` 账单地区下，完全通过 ChatGPT 官方 UI 创建 Plus Checkout，观察当前卡片/地址是否会将最终金额从 `PHP 1100.00` 切换到 pricing config 中的 `psp_override=982.14`。

- 不改写 Checkout POST，不裸调 Checkout API。
- 可填测试卡和账单地址，但不点击 Subscribe。
- 不调用 Provider/卡台，不创建生产订单，不产生付款。
- 证据仅保留地区、币种、金额、路由信号和字段存在性，不保留 Session、PAN、CVC 或完整地址。

## 现场前置修复

1. BitBrowser Profile 一度报“网络不通”；现场查明为本机 mihomo 进程未在运行，不是 ChatGPT 或 Checkout 代码故障。恢复后 Cloudflare trace 实测 `loc=PH` / `colo=MNL`。
2. 首次 Session 检查返回 `ACCOUNT_STATUS_UNKNOWN/HTTP 403`。定位到独立税费观察脚本在启动时清空了 Profile 的 Cloudflare/设备运行 Cookie，与生产 BitBrowser runtime 的已验证逻辑不一致。
3. 观察脚本已改为只保留五类运行 Cookie allowlist，Session/Auth/未知 Cookie、storage 和客户页面仍全部清理。预热后重跑成功。

## 现场结果

官方前端原生生成的 Checkout 请求已由 CDP 取证：

```text
entryPoint = all_plans_pricing_modal
planName = chatgptplusplan
checkoutUiMode = custom
billingCountry = PH
billingCurrency = PHP
Checkout response = HTTP 200
processorEntity = openai_llc
automatic_tax_enabled = true
```

金额时间线：

| 观察点 | 基础价 | VAT | 当日应付 |
| --- | ---: | ---: | ---: |
| 填付款资料前 | `PHP 982.14` | `PHP 117.86` | `PHP 1100.00` |
| 填卡后 | `PHP 982.14` | `PHP 117.86` | `PHP 1100.00` |
| 页面回读 `US/DE` 后 | `PHP 982.14` | `PHP 117.86` | `PHP 1100.00` |

其他证据：

- PH pricing config 仍同时返回 `plus.month=1100 inclusive` 和 `plus.month.psp_override=982.14 exclusive`。
- 当次未观察到 `/backend-api/payments/checkout/snapshot` 请求；因此不得把页面已回读 `US/DE` 扩大成“后端 Checkout 税务快照已改为 US/DE”。
- Subscribe 控件存在且可用，但 `submitCalls=0`。
- 结束时已清空 7 个字段、Session/Cookie/storage 和临时输入，Profile 已关闭。

## 结论

1. 当前 HNSKJ 测试卡 + 菲律宾出口 + 官方 UI + `US/DE` 地址的组合，不会切到 `982.14` 最终价。
2. `psp_override=982.14` 是官方配置中真实存在的另一支，但当前证据不能证明它的选择条件，更不能直接强制该金额。
3. 当前 Checkout 是 `automatic_tax_enabled=true` 的 PH/PHP 路径；页面账单地区变更未形成可见的 ChatGPT snapshot，且税额未变。
4. 对同一张 HNSKJ 卡重复跑已无新信息。下一个有价值的单变量 A/B 是：保持 Session、菲律宾 Profile、官方 UI 和账单地区不变，更换一类不同 BIN/发卡路由的合规测试卡。没有第二类卡时应暂停税费试验，不随机重试。

公开 BIN 数据库对当前卡 BIN 的发卡地归属存在互相矛盾的结果，所以不把第三方 BIN 查询当成本轮根因证据。

## 证据与验证

脱敏原始结果（Git 忽略）：

```text
/Users/lemon/.codex/worktrees/9128/AI充值业务/artifacts/browser-ph-psp-route-20260904/result-official-ui-ph-cdp.json
```

代码验证：

```text
npm run check: PASS
Browser full test: 153 total / 148 passed / 5 environment-skipped / 0 failed
submitCalls: 0
```
