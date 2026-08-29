# Browser 付款执行通道合同（设计阶段）

## 目的

定义只在受控确认后启用的 Browser 付款边界；本文件不启用真实付款，也不授予生产写权限。

## 付款前条件

1. 账号身份已核对且订阅状态为 `FREE`。
2. Checkout 摘要为 Plus，币种/金额已识别，安全卡字段已出现。
3. 订单、attempt、卡片消费预留、路线、Provider 和 executor profile 均由数据库权威复核。
4. 仅允许一个活动资金 attempt；签发 permit 后先持久化 `PAYMENT_SUBMITTING` intent。
5. 卡资料只在 Browser 进程内短租约使用，不写入日志、WAL 或返回对象。

## 外部动作与结果

- 付款按钮只能由确定性页面适配器定位；不得用模型猜测或模糊文本授权。
- 点击付款后无论浏览器崩溃、超时还是响应缺失，统一进入 `PAYMENT_UNKNOWN`，禁止重付、换卡或换执行器。
- 明确拒绝可标记失败；明确成功后仍必须分别确认 Plus 已激活和自动续费已取消。

## 成功判据

`payment confirmed` + `Plus active` + `subscription cancelled` + 卡台交易证据匹配订单金额/币种。任一缺失均进入人工核对，不得标记最终成功。

## 实施顺序

先用现有 `BrowserPaymentExecutor` 和 Mock 适配器完成状态机/未知结果回归；再在单独确认后实现 LIVE 页面点击适配器；最后进行一单真实付款灰度。生产付款开关在此之前保持关闭。
