# ChatGPT Plus Checkout 真实只读观察（2026-08-26）

## 目的与边界

在已通过上号器 Session Bootstrap 和 `/api/auth/session` 身份核对的专用 Google Chrome Profile 中，真实进入 ChatGPT Plus Checkout，核对套餐、金额、支付表单和提交边界。

本次允许创建 Checkout Session，但禁止填卡、点击最终订阅、真实付款和卡台写调用。

## 实际路径

```text
ChatGPT 首页
→ “升级”
→ 个人方案弹窗
→ “升级至 Plus”
→ 首次出现用途问卷
→ “跳过”
→ 再次“升级至 Plus”
→ /checkout/openai_llc/<redacted-session-id>
→ Stripe Payment Page 初始化
```

用途问卷不是每次必然出现，不能硬编码成固定必经页面；自动化必须按页面状态分流。

## 已验证运行时事实

### 价格弹窗

- 当前账号显示免费版。
- 个人 `ChatGPT Plus` 显示 `$20/月`。
- 地区按钮显示“美国”。

### Checkout 页面

- 页面路径：`https://chatgpt.com/checkout/openai_llc/<redacted-session-id>`。
- 套餐：`Plus 套餐`，按月订阅。
- 币种：`USD`。
- 今日应付：`US$20.00`。
- 预估税费：`US$0.00`。
- 页面说明会按月自动续订，取消前每月收取 `US$20.00`。
- `form[data-testid="checkout-form"]` 存在。
- Stripe 安全输入框存在：卡号、有效期、CVC。
- 支付方式 UI 同时出现银行卡和 PayPal。
- `button[type="submit"]` 的“订阅”控制存在且启用。
- Stripe `payment_pages/<redacted-id>/init` 返回 HTTP 200，说明 Checkout Payment Page 已真实初始化。
- Stripe 页面包含 hCaptcha/invisible challenge 相关 frame；这只证明风控组件被加载，不等于本次已经弹出可见验证码或已经通过挑战。

## 安全结果

```text
checkoutCreated=true
fieldsFilled=0
submitCalls=0
paymentClicked=false
cardApiCalls=0
```

没有读取或填入 PAN/CVC，没有点击“订阅”，没有真实扣款，没有调用 HNSKJ 卡台读取或写入接口。
证据保存后已关闭 Checkout 页面，专用 Profile 只保留 ChatGPT 首页和扩展管理页，避免后续误用过期 Checkout Session。

## 代码匹配结果

原 `CheckoutObserver` 只识别本地 fixture 的 `data-checkout-plan/currency/amount`，真实页面不会提供这些属性，因此不能把旧单元测试写成真实站点已兼容。

本轮根据真实 DOM 增加 `CHATGPT_PLUS_CHECKOUT_CONTRACT`：

- 使用稳定的 `data-testid="checkout-summary-column"` 和 `data-testid="checkout-form"`；
- 从“今日应付金额/Estimated tax”行解析币种、应付金额和税费；
- 跨 Stripe frame 只读确认 `cc-number/cc-exp/cc-csc` 字段存在；
- 确认提交控制存在/启用，但绝不点击；
- URL 漂移或摘要不完整时 fail-closed。

真实 Checkout 重放结果：

```text
currency=USD
amount=20.00
estimatedTax=0.00
paymentFormPresent=true
submitControlPresent=true
submitControlEnabled=true
cardFieldsPresent.cardNumber=true
cardFieldsPresent.expiry=true
cardFieldsPresent.cvc=true
submitCalls=0
```

## 本地证据

以下证据位于未跟踪 `artifacts/`，不会混入 Git 提交：

- `/Users/lemon/.codex/worktrees/9128/AI充值业务/artifacts/browser-checkout-observe/2026-08-26-live/checkout-readonly.png`
- `/Users/lemon/.codex/worktrees/9128/AI充值业务/artifacts/browser-checkout-observe/2026-08-26-live/checkout-readonly-sanitized.json`

截图可能包含当前专用账号页面信息，仅作为本地运行证据；文档和 Git 不保存 Session、邮箱、账号 ID、Checkout Session ID 或卡材料。

## 验证命令

```bash
npm --prefix browser-mvp run check
npm --prefix browser-mvp test
git diff --check
```

结果：`check passed`，`48/48 passed`，`git diff --check passed`。

## 已发现但尚未完成的核心缺口

当前 `BrowserExecutionService` 能在“已经拿到 Checkout 页面”的前提下观察页面，但不能从 ChatGPT 首页自动处理：价格弹窗 → 可选用途问卷 → Checkout Session 创建 → Checkout URL 接管。

因此下一步不是填卡，而是实现一个 fail-closed 的 Checkout Navigation 状态机并接入执行器。它必须：

1. 从已核对身份的 ChatGPT 页面开始；
2. 只允许打开价格页和创建 Checkout Session；
3. 对用途问卷做可选分支，不依赖固定出现顺序；
4. 到达 Checkout 后立即交给 `observeCheckout()`；
5. 不暴露填卡或 submit 能力；
6. 保持 `submitCalls=0` 并记录 Checkout Session 创建事实。

首次真实付款仍必须单独向用户确认。

## Checkout Navigation 状态机实现与真实重放

Browser 代码提交 `d9b19e6` 已将上述人工路径接入 `BrowserExecutionService`：

```text
首页标记与身份核对
→ 打开价格弹窗
→ 可选用途问卷（可在 Plus 点击前或后出现）
→ 创建 Checkout Session
→ 等待 Stripe 安全字段就绪
→ observeCheckout()
```

状态机只允许点击明确的导航控件；控件如果是 `type=submit`、位于 form 内、匹配不唯一或被未知页面覆盖，则 fail-closed。导航合同开启时必须同时提供只读 Checkout observer 合同。

真实重放过程发现并修正三个仅依靠 fixture 无法发现的竞态：

1. ChatGPT 在 `DOMContentLoaded` 时标题/升级按钮尚未 hydration，现等待必需页面标记可见后再校验最终标题。
2. 用途问卷可能在定位 Plus 按钮后才覆盖页面，现在检测遮挡并跳过后重试同一 upgrade attempt。
3. Checkout 主 form 先出现，Stripe 卡号/有效期/CVC iframe 后加载；现在合同要求三项安全字段在 10 秒内全部就绪，否则停止。

最终专用 Chrome 真实执行结果：

```text
status=OBSERVED
sessionIdentity.verified=true
sessionIdentity.httpStatus=200
checkoutCreated=true
questionnaireSkipped=true
currency=USD
amount=20.00
estimatedTax=0.00
paymentFormPresent=true
submitControlPresent=true
submitControlEnabled=true
cardNumber/expiry/cvc present=true
fieldsFilled=0
submitCalls=0
paymentClicked=false
cardApiCalls=0
```

证据序列为 `intent(1) → page-signature(2) → checkout-navigation(3)`，记录的 Checkout URL 只保存 digest，不记录 Checkout Session ID。执行后关闭新建 Checkout 页面。

最终验证：`npm --prefix browser-mvp run check` 通过；`npm --prefix browser-mvp test` **53/53 passed**；`git diff --check` 通过。
