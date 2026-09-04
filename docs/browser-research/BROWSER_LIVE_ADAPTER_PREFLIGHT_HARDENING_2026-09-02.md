# Browser LIVE Checkout 付款前加固（2026-09-02）

## 目标与边界

本轮只改 Browser worktree 的付款代码边界和隔离测试，不连接生产 Browser 队列，不启动生产 Worker，不读取真实 Session/PAN/CVC，不填真实卡，不点击 ChatGPT 的 Subscribe，不调用 Provider/卡台写接口。

## 现场发现的代码不一致

- `LiveChatGPTPaymentAdapter` 已存在，但 `loadPaymentExecutorConfig()` 对任何 `LIVE` 模式一律抛 `LIVE_PAYMENT_ADAPTER_UNAVAILABLE`，因此已有 adapter 实际不可配置。
- adapter 使用较早的 checkout 摘要直接填卡和点击；卡 BIN/地区可能使税费或 `Due today` 在填卡后变化，旧代码没有点击前重读。
- 旧 adapter 只检查卡号/CVC 的基本格式，没有验证过期年月。
- 旧 adapter 没有强制余额预算决策；当前只读页面已经观察到 PHP 基础价、VAT 与最终应付额不同，这个缺口会直接放大余额不足风险。
- `browser-mvp/package.json` 的静态检查没有覆盖 live adapter 与其测试。

## 本轮修复

1. `LIVE` 配置不再被无条件拒绝，但必须同时满足三道独立门禁：
   - `BROWSER_PAYMENT_EXECUTOR_ENABLED=true`
   - `BROWSER_PAYMENT_WRITES_ENABLED=true`
   - `BROWSER_LIVE_PAYMENT_CONFIRMATION` 精确匹配
2. Live adapter 在任何卡字段写入前重读 checkout，并核对套餐摘要、币种、基础/税费后的最终金额与 submit selector。
3. 填卡后、唯一一次 submit 点击前再次重读；任何税费、币种、总额或控件漂移都以 `CHECKOUT_DRIFT` 在点击前停止。
4. Live adapter 必须获得显式 `budgetGuard` 的肯定结果；余额预算不通过以 `INSUFFICIENT_CARD_BALANCE` 在点击前停止，不进入付款 UNKNOWN。
5. 卡有效期增加完整月份校验；字段在成功、失败或未知后继续 best-effort 清空。
6. 付款执行器把已证明发生在点击前的余额不足归入 `PRE_SUBMIT_FAILED`，不会污染成 `SUBMIT_UNKNOWN`。
7. `npm run check` 已覆盖 live adapter 和定向测试。

## 验证

```text
npm --prefix browser-mvp run check
→ passed

node --test browser-mvp/test/live-chatgpt-payment-adapter.test.js browser-mvp/test/payment-executor.test.js
→ 15/15 passed

npm --prefix browser-mvp test
→ 124 total / 120 passed / 4 environment-skipped / 0 failed

npm --prefix browser-mvp run smoke:worker:readonly
→ readonly config/systemd 11/11
→ isolated MySQL payment/UNKNOWN + production-shaped readonly Chrome 3/3
```

隔离测试新增证明：填卡后金额从 `1100.00` 漂移到 `1200.00` 时点击次数为 0、字段已清空；预算拒绝时卡号字段从未写入。MySQL mock 继续证明一次 submit intent、UNKNOWN 后不可重放；外部付款调用为 0。

## 当前真实停止点

- BitBrowser + 菲律宾出口 + 测试 Session 已到真实 ChatGPT Plus checkout，并只读识别 PHP/VAT/Due today。
- Live adapter 的付款前合同已经比旧版完整，但**尚未接入生产 Worker composition**。
- 真实 `budgetGuard` 仍需把卡的权威余额与当前 checkout 总额通过明确汇率/余量规则换算；不得继续沿用固定 `$16` 作为 PHP `₱1,100` checkout 的充分余额证明。
- 付款结果 observer、Plus 激活、取消续费、卡交易与最终对账仍需生产实现和隔离验证。
- 当前生产 Browser Worker 与付款 gate 必须继续关闭；任何真实 Subscribe 点击仍需要单独确认。
