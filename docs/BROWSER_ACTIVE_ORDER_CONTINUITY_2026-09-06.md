# Browser 活动订单连续性规则与 2026-09-06 故障纠偏

## 结论

Browser 充值的首要目标是让一笔订单在同一个 BitBrowser Profile、同一个登录会话和同一组页面中连续完成。安全边界是“不同客户之间隔离”，不是在同一客户的活动订单中反复清 Cookie、关页面或重新上号。

```text
空闲 Profile
→ 清理上一订单残留一次
→ 绑定新订单
→ 写入 Session 一次
→ Plus Checkout（填卡、账单、Session 邮箱、重报价）
→ 付款与结果确认
→ 如为 20X，在原 Profile 原登录状态继续人工升级
→ 最终订单完成/明确作废
→ 清理并释放 Profile
```

## 不可破坏的运行规则

1. 活动订单期间不得自动清除或覆盖已有 ChatGPT Session Cookie。
2. 重新连接 BitBrowser Profile 不得关闭已有页面。
3. 付款前的可恢复失败不得清空已经填写的卡片、账单和邮箱。
4. Worker 超时或失败只断开自动化控制，保留可见 Profile 供原地恢复。
5. Plus → 20X 不是订单边界；必须沿用原 Profile，不重新向客户索取 Session。
6. 只有订单最终成功、明确作废或运营者明确释放后，才允许跨客户清理。
7. 若 Profile 已有 Session，先复核其身份；不得用原始 Session 强行覆盖服务端可能已经轮换的新 Cookie。

## 本次代码纠偏

- `BitBrowserControlRuntimeAdapter.open()` 改为无损连接，不再删除继承页面。
- Executor 只复用唯一的当前订单 ChatGPT 页面；不存在时才新建，出现多个匹配页面时保留现场并报告歧义，不再继续制造新标签页。
- `CookieSessionBootstrapAdapter.bootstrap()` 发现已有 Session 时保留现场，不再清除后重放原 Token；后续身份探测仍负责确认是否为目标客户。
- 上号器发现 Profile 已有 Session 时保留原登录并打开 ChatGPT，不再反复清 Cookie。
- LIVE 执行失败或超时改为 `detach`，而不是关闭活动订单 Profile。
- 付款前重报价失败保留已填写表单；只有越过外部付款提交边界后才执行卡字段的尽力清理。
- 卡材料租约从隐式 60 秒调整为覆盖一次完整自动 Checkout 的 5 分钟，避免正常页面等待导致中途失效并重开流程。
- 生产 LIVE Worker 的数据库连接池生命周期已有异步顺序测试，证明 Worker 真正结束后才关闭。

## 今天暴露的直接问题

### P0：成交动作被工程检查取代

用户要求在当前 Checkout 填写账单和邮箱时，执行者转去重复检查进程、Profile、预检和付款机制，没有完成最短成交动作。代码本来已有 `fillBillingAddress()` 与 `fillTransientBillingEmail()`；问题是执行顺序错误，不是缺少填写能力。

### P0：活动登录现场被实现主动破坏

Runtime 连接时关闭已有页面；Session Bootstrap 与上号器反复覆盖 Cookie；异常路径关闭 Profile；付款前失败清空表单。这些行为共同造成重复登录、重复打开 Checkout 和客户 Session 失效风险。

### P0：一次自动运行没有进入可诊断的填表阶段

真实 LIVE 已到 Checkout，但卡片、地址和邮箱均未写入，最终超时。现有 WAL 只到 `checkout-navigation`，不能区分卡材料读取、Secure Field 定位、账单填写或重报价中的具体停点。后续只增加少量无敏感信息的阶段事件，不再用重复开关窗口代替定位。

### P1：Profile 与扩展判断错误

本机同时存在多个 BitBrowser Profile 和多个 Checkout。检查者只看 Preferences，漏掉命令行 `--load-extension`，错误判断上号器未安装。以后必须按当前活动 Profile 的 CDP/进程实况判断，禁止把其他 Profile 的页面当作当前订单。

### P1：本次成功不能算自动化验收

运营者手工完成了 Plus 的邮箱、账单和付款。本次只能记为“人工 Plus 成功”；自动填写、自动零税重报价、自动付款和 20X 最终完成均不得据此宣称已跑通。

## 为什么一个订单没有解决

根因不是订单复杂，而是执行者没有始终锁定“当前订单、当前 Profile、当前页面、下一项成交动作”四个事实，把后台安全设施当成主流程，并在遇到阻碍后反复回到起点。修复原则不是继续加闸门，而是让安全机制服务于连续成交：只阻止跨客户串用和重复付款，不破坏同一订单的已登录现场。

## 尚未完成

- 终态后的统一 Profile 清理仍需接入真实订单释放动作；当前补丁先保证活动订单不被破坏。
- Checkout 填卡已增加脱敏阶段标签（安全控件、账单、邮箱、重报价、付款前复核、提交、结果观察）；仍可在后续需要时补充各阶段耗时。
- 需要在部署后用单个无付款回归证明：一次上号、一次 Checkout、自动填写邮箱与免税账单、重报价后停在付款前，全程不关闭 Profile。
