# 客户订单提交合同

- 日期：2026-08-17
- 路径：`POST /api/v1/orders`
- 当前范围：仅创建 Plus 订单，不触发真实 Provider 写入

## 请求

```json
{
  "cdk": "<customer-cdk>",
  "session": {
    "user": { "id": "...", "email": "..." },
    "account": { "id": "..." },
    "expires": "2026-11-01T08:34:59.567Z",
    "accessToken": "<three-part-jwt>",
    "sessionToken": "<five-part-jwe>"
  }
}
```

- `session` 必须保留 ChatGPT Session 的完整 JSON，未知扩展字段不会被删除。
- 本地预检查必填字段、`accessToken` 的 JWT 形状与 `iat/exp`、`sessionToken` 的五段 JWE 形状，并要求 access token 至少剩余 5 分钟。
- 本地不验证 JWT 签名；真实有效性最终由直充上游验证。
- 卡段和开卡金额不允许客户传入，只读取内部 `app_settings`。

## 成功响应

```http
HTTP/1.1 201 Created
```

```json
{
  "order": {
    "publicNo": "PJV1-...",
    "status": "CREATED"
  }
}
```

不向客户返回内部订单 ID、CDK ID、卡段、任务 ID 或任何 Session 字段。

## 错误

| HTTP | `error` | 含义 |
| --- | --- | --- |
| 400 | `invalid_order_request` | 请求不是 JSON 对象 |
| 400 | `incomplete_session` 等 | Session 结构或有效期预检失败 |
| 409 | `cdk_unavailable` | CDK 不存在、无效或已被使用 |
| 503 | `ordering_paused` | `accept_new_orders=false` |
| 503 | `ordering_not_configured` | 默认卡段或开卡金额未配置 |
| 429 | `rate_limited` | 单进程单 IP 每分钟默认最多 10 次 |

## 原子性与存储

一次成功请求在同一 MySQL 事务中：

1. 锁定接单开关和默认卡配置。
2. 按 SHA-256 哈希锁定一枚 `AVAILABLE` CDK。
3. 创建 `CREATED` 订单，Session 以 AES-256-GCM 密文保存。
4. 将 CDK 改为 `REDEEMED` 并绑定订单。
5. 写入创建事件和唯一 `PURCHASE_CARD` 任务。

任一步失败则整体回滚。同一 CDK 并发提交时只有一个请求能成功。

## 订单状态查询

路径：`POST /api/v1/orders/status`

客户可使用创建响应中的 `publicNo`：

```json
{ "publicNo": "PJV1-..." }
```

或使用原 CDK 找回已绑定订单：

```json
{ "cdk": "PJ-..." }
```

两者必须且只能提交一个。CDK 在查询服务内转换为 SHA-256，不会传入数据库查询日志或响应。

成功响应：

```json
{
  "order": {
    "publicNo": "PJV1-...",
    "status": "PROCESSING",
    "updatedAt": "2026-08-17T10:00:00.000Z"
  }
}
```

客户状态只有：

| 客户状态 | 含义 |
| --- | --- |
| `QUEUED` | 订单已建立，等待执行 |
| `PROCESSING` | 开卡、提交或轮询中 |
| `REVIEWING` | 提交结果不明、对账异常或未知内部状态，需要复核 |
| `SUCCESS` | 直充已返回最终成功 |
| `FAILED` | 失败已经延迟复查确认 |

- 查询不返回内部状态、失败原因、卡信息、Session、Provider 或退款信息。
- 已关闭订单根据关闭前最后一个业务状态返回成功、失败或复核，不把 `CLOSED` 暴露给客户。
- 成功和失败响应均带 `Cache-Control: no-store`。
- 默认单 IP 每分钟 30 次；不存在返回 `404 order_not_found`，请求同时包含两种凭证或均缺失返回 `400 invalid_order_query`。
