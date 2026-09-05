# Browser 卡前前置检查合同（2026-09-05）

## 目的

客户提交 Browser 路线订单后，不再因为卡片证据暂时陈旧而完全停止。系统并行保留
`ASSIGN_CARD`，同时执行 `BROWSER_PREFLIGHT`，先验证客户 Session、账号身份、当前订阅、
Plus Checkout、币种、金额、税费与支付表单是否可识别。

## 权威边界

- 前置检查只允许订单状态：`CREATED`、`WAITING_FOR_CARD`、`CARD_READY`。
- 只允许冻结为 `executor_kind=BROWSER` 的订单。
- Session 直接从订单的加密字段按 order id 短时解密；不得写入 task payload、WAL 或普通日志。
- 前置检查不得创建 `recharge_attempts`、`browser_runs`、付款许可或卡片消费预留。
- 前置检查不得读取 PAN/CVC、调用 Provider 写接口或点击付款。
- 只有 `BROWSER_PREFLIGHT` 的 payload 明确记录 `outcome=PASSED`，Browser 的
  `SUBMIT_RECHARGE` 才可被普通 Worker 领取。
- 正式填卡/付款前仍必须重新核对卡状态、余额、最新卡片详情和交易证据；前置检查不能替代资金门槛。

## Profile 标识

- `BROWSER_EXECUTOR_PROFILE_ID`：生产数据库 `executor_profiles.id`，负责 route/dispatch/run 租约绑定。
- `BITBROWSER_PROFILE_ID`：本机 BitBrowser Local API 的 Profile id，负责实际 open/close。
- 两者属于不同命名空间，禁止复用或隐式转换。

## 失败行为

- Session 无效、身份不一致或账号已是付费订阅：订单进入 `WAITING_FOR_SESSION`，客户可在原订单更换 Session。
- 无卡订单更换 Session 后回到 `WAITING_FOR_CARD`；已有绑定卡的订单回到 `CARD_READY`。
- 网络、ChatGPT 访问、页面结构或 Checkout 观察失败：最多 5 次、30 秒退避；不改变资金状态、不触发付款。
- 失败结果只持久化有限状态码和非敏感摘要。

## 当前验收边界

代码/回归通过不等于真实 Browser 付款通过。当前订单只允许执行到 Checkout 观察完成；付款写开关保持关闭。
