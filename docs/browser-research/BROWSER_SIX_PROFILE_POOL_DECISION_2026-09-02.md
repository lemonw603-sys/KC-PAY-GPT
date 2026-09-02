# Browser 六 Profile 常驻池决策（2026-09-02）

## 已确认目标

- Browser 目标吞吐为至少平均一分钟完成一单。
- 第一版采用 **6 个常驻 BitBrowser Profile**；每个 Profile 同一时间只处理一个订单，Profile 之间并行。
- Profile 数量必须配置化；先单 Profile 完成真实验收，再扩到 3，最后扩到 6，不重建订单或资金核心。

## 隔离边界

1. **账号/Session**：一单独占一个 Profile 租约；开始前清理上一单 Session，注入后用服务器身份摘要核对目标账号；结束后再次清理。不得在同一 Profile 内并行两个客户 Session。
2. **页面/Checkout**：每单创建自己的 Checkout；不得跨订单复用 Checkout URL、页面或弹窗。
3. **卡片/资金**：每张卡同一时刻只允许一个活动订单；同一卡可按全局次数上限顺序复用，但不得在多个 Profile 并发使用。每单仍使用唯一付款 attempt 与 UNKNOWN 栅栏。
4. **浏览器指纹**：每个 Profile 保持稳定配置，不按订单随机重建或频繁改变；Profile 之间使用不同的持久化目录和运行身份。
5. **网络**：每个 Profile 绑定稳定的 `proxyRef`，订单期间不得换出口。当前现场材料只证明一个菲律宾节点可用，因此目前只能证明浏览器层隔离，尚不能宣称六路网络隔离；扩到 6 前必须核对代理并发、出口数量和稳定性。
6. **故障域**：403、Cloudflare、验证码、页面漂移或网络故障只暂停对应 Profile；其他 Profile 继续。付款结果 UNKNOWN 时只锁定对应订单/卡/attempt，不自动换 Profile、换卡或切 API 重付。

## 吞吐模型

- 单笔平均 5 分钟时，理论上 5 个并发 Profile 才能达到 60 单/小时；第 6 个用于页面延迟、清理和故障余量。
- 单 Profile 串行、多 Profile 并行；不靠一个 Profile 同时开多个客户账号。
- 6 Profile 是起始容量设计，不是已经通过真实页面验证的吞吐结论。扩容退出条件依次为：单 Profile 真实闭环、3 Profile 受控并发、6 Profile 持续运行和故障隔离。

## 运行效率

- Profile 常驻，避免每单调用 BitBrowser `open/close` 和触发每日开启次数限制。
- 新订单写入本地队列后立即唤醒空闲 Worker；空闲时不高频调用外部 Provider。
- Session 身份核对、卡片资源准备和余额检查在安全边界内前置/并行；Checkout、卡 iframe、账单地址 iframe 分阶段等待，不用整页高频刷新。

## 尚未实现/验证

- 当前 `BitBrowserProfileRuntimeAdapter` 仍按单次执行打开并关闭 Profile，六 Profile 常驻池尚未实现。
- 当前 BitBrowser 账户已触发每日打开窗口次数上限；其套餐能否同时常驻 6 个 Profile 尚未核实。
- 当前只证明一个菲律宾代理节点；真实 3/6 Profile 的代理并发和风控结果未验证。
- 真实 Browser 付款、付款后 Plus、取消续费和 6 Profile 容量均未验收。

