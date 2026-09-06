# BitBrowser 真实订单前置闸门

> 目的：防止把本地预检误报为生产可执行，也防止真实订单结束后才发现基础能力遗漏。未满足“必须项”不得创建新的 Browser 测试订单。

## 当前硬事实（2026-09-05）

- 生产 Browser Worker：`inactive/disabled`。
- 生产 Browser target：`LOCAL_FIXTURE`。
- 生产 Worker 当前只接 `GoogleChromeControlRuntimeAdapter`，尚无 BitBrowser runtime adapter。
- 最新客户订单已冻结为 API，不能改称 Browser，也不能靠重复提交 CDK 修正。
- 本地 BitBrowser Local API、单 Profile、CDP、ChatGPT 公开首页已通过一次只读预检；这不等于共享 Worker 已接入。

## 创建 Browser 订单前必须全部通过

### A. 执行器

- BitBrowser adapter 已实现并接入统一 `RuntimeAdapter` 合同；
- Local API health/list/open/close/CDP 超时和错误均有安全退出；
- Profile ID、平台、代理、locale/timezone 绑定校验；
- Worker 可从共享订单队列领取 Browser job，并写入 heartbeat；
- Worker 目标不是 `LOCAL_FIXTURE`；
- 付款写权限、Provider 写权限、卡台写权限仍关闭。

### B. 订单和路线

- 提交前后台默认路线明确为 Browser；
- 提交后订单 `executor_kind=BROWSER`；
- Browser dispatch job/run 出现且 profile 绑定一致；
- API 订单与 Browser 订单不会互相 fallback；
- CDK 只绑定一次，失败不重复消费。

### C. 资源和卡

- 已有卡实时状态、余额、同步时间和 assignment 可核对；
- 本次优先使用已有卡，不依赖开卡/补余额；
- 卡台维护状态不会被误判为无卡或触发开卡循环；
- 卡使用次数、并发占用和释放规则可核对。

### D. Session 和页面

- Session 仅通过加密材料边界进入运行时；
- 账号身份和 Plus 状态可验证；
- 登录、首页、问卷、弹窗、Checkout 导航均有处理；
- Cloudflare、页面漂移、Session 失效、超时均安全停止；
- 不读取或持久化无关敏感材料。

### E. 账单地址和税费

- MockAddress 配置和地址分配可读取；
- 地址真正进入 Checkout，而不只是后台生成；
- 同卡地址复用、不同卡优先分离、地址池耗尽策略可验证；
- Checkout 现场读取套餐、邮箱、币种、原价、税费、总额；
- 地址不能以“免税州”标签代替真实税费证据。

### F. 付款前和收尾

- 到付款按钮前有明确安全停止点；
- 付款前证据保存并脱敏；
- Session、卡材料、Profile、租约正确清理；
- 订单、Browser run、任务、审计状态一致；
- 不点击付款时能安全终态；
- 若税费为 0 且金额正确，才进入最后一次人工付款确认。

### G. 异常和恢复

- Local API/Proxy/Profile/CDP 断线；
- Worker 崩溃、租约过期、重复投递；
- Checkout summary 不完整；
- 访问阻断、3DS/挑战、未知页面；
- 卡台维护、余额证据过期；
- 任一异常均不重复付款、不换卡重付、不制造无限 attempt。

## 退出条件

只有 A-G 全部有代码/测试/运行证据，才允许创建新的真实 Browser 测试订单。否则只能继续隔离测试或修复，不得把订单提交当成测试开始。
