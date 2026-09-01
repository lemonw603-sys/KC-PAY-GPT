# BitBrowser Session / Checkout 只读观察（2026-09-02）

## 边界

本轮使用已有独立 BitBrowser 测试 Profile 和用户已确认的测试 Session。不创建订单，不连接生产队列，不读卡资料，不填卡，不点击付款，不调用项目 Provider/卡台接口。Session 原文未写入日志、文档或 artifact。

## 第一次实际观察

- BitBrowser Local API 健康检查通过，Profile 启动和 Playwright CDP 接管成功，且只有一个 BrowserContext。
- 全新注入测试 Session 后，`https://chatgpt.com/` 返回 HTTP 200。
- `/api/auth/session` 返回 HTTP 200，邮箱/用户/账号摘要与测试 Session 中已知身份全部匹配；这一次证明 Session 登录有效。
- 账号检查接口返回 HTTP 200，订阅状态观察为 `FREE`，不是已有 Plus。
- 进入 Plus 选择流程后，现有导航合同在等待 “Checkout 或问卷过渡” 时超时；未识别到 Checkout，因此 fail-closed 停止。
- 没有卡字段写入，没有付款 submit 点击，没有项目 Provider/卡台调用，Profile 已关闭。

## 单次页面漂移诊断

在获得“Checkout 过渡超时”这一新证据后，做了一次不重复升级点击的诊断性重进：

- Session 身份接口阶段继续进入账号检查，但本次订阅检查返回 HTTP 403，被归类为 `ACCOUNT_STATUS_UNKNOWN`。
- 按 fail-closed 规则在点击 Plus 入口之前停止；`upgradeClicks=0`。
- 未再重复尝试，Profile 已关闭。

## 证据

- `artifacts/bitbrowser-session-readonly-20260902/result.json`
- `artifacts/bitbrowser-session-readonly-20260902/checkout-drift.json`

两个 JSON 均为 `0600`，只保存布尔值、HTTP 状态、摘要和脱敏错误码。

## 已证明与未证明

**已证明：**

1. 该 BitBrowser Profile + 当前网络可被 CDP 接管并访问 ChatGPT。
2. 该测试 Session 至少在首次观察中登录有效，身份摘要完全匹配。
3. 首次账号订阅证据为 `FREE`。
4. 现有 Checkout 导航合同与当前真实页面过渡不完全匹配，但已正确停在付款前。

**未证明：**

1. Checkout 的当前 URL/页面形状、Plus 套餐、币种和金额。
2. 第二次订阅检查 HTTP 403 是临时风控、接口限流还是 Session/账号状态变化。
3. 长时运行、断线恢复、付款和付款后状态。

下一步应先采集当前 Plus 入口点击后的脱敏 URL/新页签/对话框状态，冻结新导航合同；在账号检查再次稳定返回前不重复点击升级入口。
