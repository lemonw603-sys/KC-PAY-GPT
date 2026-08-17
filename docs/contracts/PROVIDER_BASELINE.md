# Provider 适配器基线

- 日期：2026-08-17
- 性质：纯 fixture 合同测试；尚未连接真实供应商写接口

## HnskjCardProvider

- 认证头固定为 `X-API-Key`。
- 开卡固定 `quantity=1`。
- 开卡写请求必须带调用方传入的稳定 `X-Idempotency-Key`，适配器不生成替代 Key。
- HTTP 503 会被标记为“可使用原 Key 重试”，同时保留结果不确定性。
- 不满足 16–128 字符的幂等键在发请求前拒绝。
- 卡台响应只验证通用成功信封；卡详情和交易的具体字段等待真实样本冻结。

## ZzshuRechargeProvider

- 认证头固定为 `X-API-Key`，不使用 Bearer。
- 创建路径固定为 `/third-party/orders/direct`。
- 创建请求固定 `orderType=direct`、`planType=plus`。
- 创建成功必须同时有 `code=0`、`order_no`、`card_key`。
- `42902` 标记为“创建前容量不足，可退避重试”。
- `50001`、HTTP 5xx、超时、断流和响应无法解析均标记为不确定，不自动重建订单。
- 状态只接受 `pending`、`processing`、`success`、`failed`。
- 状态结果只返回订单状态字段；完整 Session、PAN 和 CVV 不从适配器返回给业务层。

## 测试结果

Provider 纯合同用例 14 个全部通过。随着调用审计、任务 runner 与 workflow handler 加入，当前 v1 测试总数为 44 个；本文件所述 Provider 合同结论保持不变。

测试覆盖：

- 请求 URL、认证头、请求体和幂等键。
- 成功响应字段。
- 卡台 503 与直充 42902 / 50001 的不同处理。
- 直充超时的不确定性。
- 未知状态拒绝。
- 响应中完整 token 和银行卡号不会进入适配器返回值。

## 尚未证明

- 卡台账户、余额、卡段和空卡片列表已完成一次获批的真实只读验证；字段结构已经固化为脱敏 fixture。
- 卡台真实开卡响应的卡 ID和卡详情结构。
- 卡台相同幂等键重放的实际返回行为。
- 直充生产环境的真实 50001、超时和状态响应。
- 供应商交易、退款和取消续费字段的实时形状。

## 调用审计边界

- Provider 调用开始前先写入 `provider_calls` 的 `STARTED` 记录。
- 成功、确定失败、可重试失败、Schema 错误和不确定结果分别记录。
- 响应摘要递归移除 API Key、授权头、Session、Token、PAN 和 CVV。
- 已用真实 MySQL 证明敏感字段不会进入 `response_summary_json`。
- 有副作用的调用如果已返回结果、但审计完成写入失败，统一标记为不确定且禁止自动重试。
