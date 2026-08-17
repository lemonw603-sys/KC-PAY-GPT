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
