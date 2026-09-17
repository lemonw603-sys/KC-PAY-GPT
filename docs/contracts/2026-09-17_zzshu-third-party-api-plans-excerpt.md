# ZZSHU 三方接口文档摘录：套餐取值与 Pro 正价开通（2026-09-17 抓取）

> 来源：https://card.zzshu.pro/docs（SPA，正文在 `assets/ApiDocsPage-Bl41q-hn.js`）。抓取时间 2026-09-17 ~10:20 UTC，只读，原文未改。用途：D-248 核实「API 路线能否充 Pro」。**本仓库 `对接api.md` 是另一个系统（GPT-KCCatk，gogpt.id88.icu）的文档，不是 ZZSHU 的，此前被当成 ZZSHU 合同引用属误。**
>
> 关键结论（原文见下）：`planType` 取值 `plus` / `pro5` / `pro20` / `plus_to_5x` / `renew_20x`；`plus` / `pro5` / `pro20` 是给**免费账号**正价开通，需银行卡；本仓库 `plan_type` 的 `pro_5x` / `pro_20x` 需映射为 `pro5` / `pro20`。生产至今 `create_direct` 只传过 `plus`（`provider_calls` 10 条 plus、4 条 NULL）。

---

（以下为前端包中文档字符串的固定窗口截取，前后可能带少量 JS 碎片，原文未改）

import{_ as I,m as b,o as H,f as m,d as t,e as A,b as N,t as v,u as w,F as O,q as D,g as M,r as E,j as J,k as j,a as x,h as G,n as R}from"./index-CEpyPl3Y.js";const $='# ChatGPT 正价开通 · 开放 API 对接文档

> **API Key 获取说明**：`X-API-Key` 由下游自行填写任意非空 CDK / 字符串即可。本站**不校验**该值是否由本站发放、不校验剩余次数、开通成功也**不扣次**。建议下游自己固定使用同一把 Key，以便用同一把 Key 查询自己的订单。
>
> **强烈推荐使用 `direct` 直充方式**：三方系统接入时，建议默认使用 `orderType=direct`，由下游直接提交本次支付所需的银行卡信息。该方式调用链路更直接，不依赖平台银行卡库存，通常更适合稳定、可控的自动化开通。
>
> **`card_key` 兼容性提示**：`orderType=card_key` 当前仍可下单（使用平台卡库选卡），仅作为兼容能力保留。新接入、重构或迁移中的三方系统请使用 `orderType=direct`。

本文档用于下游系统通过 API Key 创建正价开通订单并查询订单最终状态。

生产环境地址：请替换为你的站点根地址，例如 `https://example.com/`

生产 API Base URL：`https://example.com/api/v1`

接口统一前缀：`/api/v1`

当前提供三个接口：

- `GET /api/v1/third-party/user`：确认当前 `X-API-Key` 可被接受（不校验真伪）。
- `POST /api/v1/third-party/orders/direct`：创建三方订单，同时支持直充订单和卡密订单。
- `POST /api/v1/third-party/orders/status`：使用创建接口返回的卡密查询最新订单状态。

> 注意：创建接口路径中的 `direct` 是历史保留命名。实际订单类型由请求体 `orderType` 决定，支持 `direct` 和 `card_key`。

## 接入流程

推荐下游按以下流程接入：

1. 自行准备一把 `X-API-Key`（任意非空 CDK / 字符串），保存到服务端配置，不要写入前端。
2. 后续查询订单时使用同一把 Key。
3. 准备 ChatGPT Session JSON。**必须原样提交 Session 接口返回的完整 JSON**，不能只拼 `email` 和 `accessToken`。缺少 `sessionToken`、`user.id` 或 `expires` 会直接拒绝下单。
4. **使用 `orderType=direct` 直充方式对接 API**。
5. 调用创建订单接口。
6. 创建成功后保存响应中的 `order_no` 和 `card_key`。
7. 使用 `card_key` 定时调用订单状态查询接口。
8. 查询到 `status=success` 或 `status=failed` 后停止轮询。

创建订单接口受系统维护开关控制。管理员关闭充值后，接口在认证后、创建订单前直接返回 HTTP `403`、业务码 `40305`；用户信息和订单状态查询接口不受影响。

创建成功仅表示订单已经创建并进入异步开通队列，不表示开通已经完成。最终结果以状态查询接口返回的 `status` 为准。

## 本站约定

- `X-API-Key` 为下游自定义标识，任意非空字符串均可，本站不查库、不扣次。
- `points` 固定返回较大额度（当前为 `99990`），不代表真实扣次。
- 三方订单不消耗本站卡密次数。
- 套餐取值：`plus` / `pro5` / `pro20` / `plus_to_5x` / `renew_20x`。分别对应 Plus 正价开通、5X 正价开通、20X 正价开通、Plus 升 5X、20X 续费。`plus_to_5x` 也可传入别名 `plus5x`；`renew_20x` 也可传入 `20x_renew` / `pro20_renew`。
- `plus` / `pro5` / `pro20` 是给**免费账号**新开通：`token.account.planType` 必须为 `free`，并需要银行卡（`direct` 自填卡，`card_key` 用平台卡库）。
- `plus_to_5x` 是给**已有 Plus** 的账号升到 5X：`token.account.planType` 必须为 `plus`。用 `upgradeMode` 区分同卡 / 新卡：
  - `same_card`（默认，可省略）：**不传银行卡**，使用账号已绑的默认卡差价升级。
  - `new_card`：必须传银行卡（`direct` 自填卡，`card_key` 从平台卡库选卡），先加卡并设为默认卡，再差价升级。
  - 未传 `upgradeMode` 但直充请求里带了合法卡号，也按新卡升级处理。
  - 状态查询里的 `plan_type` 仍返回 `plus_to_5x`（不会映射成 `pro5`），并额外返回 `upgrade_mode`。
- `renew_20x` 是给 **Pro 20X** 续费（含暂停/欠费）：`token.account.planType` 必须为 `pro`（也接受 `chatgptpro`）。**必须传银行卡**。若账号暂停（`is_delinquent` 或 chatgptpro 发票 `due`），只用这张卡支付 Stripe 托管 due 发票，**不再加卡、不 POST renew**。未暂停则加卡并设默认卡，若未开启自动续费再打开。纯到期且无欠费发票时请走 20X 正价开通。成功后**不会**取消自动续费，`is_subscription_cancelled` 保持 `0`。状态查询里的 `plan_type` 返回 `renew_20x`（不会映射成 `pro20`）。
- 结账固定菲律宾比索 `PHP`；创建和状态里的 `payment_amount` / `payment_currency` 当前可能为 `null`。
- `token` 必须是完整 Session JSON，强制包含 `user`、`account`、`accessToken`、`sessionToken`、`expires`。
- `card_key` 订单的套餐由请求体 `planType` 决定，省略时默认 `plus`。`plus_to_5x` 且同卡升级时不从卡库选卡；`plus_to_5x` 新卡升级与 `renew_20x` 会从卡库选卡。
- 刷新后的最新 `accessToken` 会写回订单，状态查询的 `token` 为最新值。
- `is_subscription_cancelled`：`1` 已取消自动续费，`0` 未取消或未确认。正价开通与 Plus 升 5X 成功后会尝试取消自动续费；**20X 续费成功后保持自动续费**，该字段为 `0` 即符合预期。

## 通信约定

### 请求格式

- 协议：HTTP 或 HTTPS，生产环境必须使用 HTTPS。
- 数据格式：JSON。
- 字符编码：UTF-8。
- 请求头 `Content-Type`：`application/json`。
- 三方认证请求头：`X-API-Key`。

### 统一响应结构

业务接口正常进入应用处理后，响应使用以下结构：

```json
{
  "code": 0,
  "message": "success",
  "data": {}
}
```

字段说明：

- `code`：业务状态码。`0` 表示成功，非 `0` 表示失败。
- `message`：成功提示或失败原因。
- `data`：业务数据。失败时通常为 `null`。

下游必须同时判断 HTTP 状态码和响应体中的 `code`：

- HTTP `2xx` 且 `code=0`：业务成功。
- HTTP `4xx/5xx` 或 `code!=0`：业务失败。

请求字段类型、必填项或枚举值不符合 Schema 时，服务可能返回 HTTP `422` 的原生参数校验响应。下游应将所有非 `2xx` 响应视为失败，并记录响应内容用于排查。

### 时间格式

状态查询响应中的时间字段使用北京时间字符串：`YYYY-M-D HH:mm:ss`。

示例：`2026-8-16 17:30:00`

## API Key 认证

三个接口都必须在请求头中携带 API Key：

```http
X-API-Key: <cdk_code>
```

认证规则：

- 请求头必须带非空的 `X-API-Key`。
- 本站**不校验**该值是否由本站发放，任意 CDK / 字符串均可。
- 不校验剩余次数，也不因次数用尽拒绝下单。
- 不需要同时携带后台登录接口的 Bearer token。

使用建议：

- 不要放在 URL、查询参数或请求体中。
- 不要写入前端页面、浏览器代码、公开仓库或普通业务日志。
- 日志中如需记录，只保留前后少量字符并做脱敏。
- 请固定使用同一把 Key。本站按这把 Key 归属订单，换 Key 后查不到旧订单。

## 查询当前用户信息

`GET /api/v1/third-party/user`

成功 HTTP 状态码：`200 OK`

该接口用于下游确认当前 `X-API-Key` 已被接受。本站不校验 Key 真伪。接口无请求体。

### 请求头

```http
X-API-Key: <cdk_code>
```

### cURL 示例

```bash
curl -X GET "https://example.com/api/v1/third-party/user" \\
  -H "X-API-Key: <cdk_code>"
```

### 成功响应

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "id": "0",
    "username": "api-user",
    "email": "",
    "points": 99990,
    "role": "normal",
    "status": "active",
    "is_active": true
  }
}
```

### 响应字段

- `id`
  - 类型：字符串。
  - 含义：兼容字段，当前固定为 `"0"`。

- `username`
  - 类型：字符串。
  - 含义：兼容字段，当前固定为 `api-user`。

- `email`
  - 类型：字符串。
  - 含义：固定返回空字符串。不是某笔订单中的 ChatGPT 账号邮箱。

- `points`
  - 类型：整数。
  - 含义：兼容字段，当前固定为 `99990`。本站不按此值扣次，下游不必据此判断能否下单。

- `role`
  - 类型：字符串。
  - 当前固定值：`normal`。

- `status`
  - 类型：字符串。
  - 当前固定值：`active`。

- `is_active`
  - 类型：布尔值。
  - 当前固定值：`true`。

### 安全说明

接口不会返回以下敏感字段：

- CDK / API Key 原文
- 密码或密码哈希
- 登录 token
- ChatGPT accessToken 或 sessionToken

缺少 `X-API-Key` 时返回 `40106`。本站不会因为 Key 未在后台登记、已用尽或已锁定而拒绝。

## 创建三方订单

`POST /api/v1/third-party/orders/direct`

成功 HTTP 状态码：`201 Created`

### 请求头

```http
X-API-Key: <cdk_code>
Content-Type: application/json
```

### 订单类型

> **接入建议：请使用 `direct`。** 对新接入、重构或迁移中的三方调用方，`direct` 应作为默认 API 方案：下游直接为每笔订单提供银行卡信息，不依赖平台银行卡库存，支付资源及失败排查也更明确。
>
> `card_key` 当前仍可下单，但仅作为存量兼容能力保留。请勿基于 `card_key` 开展新的接口对接。

请求体通过 `orderType` 区分支付方式：

- `direct`（强烈推荐）：`plus` / `pro5` / `pro20` / `renew_20x` 由下游上传银行卡；`plus_to_5x` 默认同卡升级可不传卡，`upgradeMode=new_card` 时必须传卡。
- `card_key`：下游上传查询用卡密，套餐由 `planType` 决定（可省略，默认 `plus`）。`plus` / `pro5` / `pro20` / `renew_20x` 以及 `plus_to_5x` 新卡升级从平台卡库选卡；`plus_to_5x` 同卡升级不选库内卡。

创建请求进入服务后，会按以下顺序处理：

1. 校验 `token` 是完整 Session JSON 对象。
2. 校验 `token.user.id`、`token.user.email`。
3. 校验 `token.account.id` 是非空字符串。
4. 校验 `token.accessToken` 的 JWT 结构和有效时间。
5. 校验 `token.sessionToken`、`token.expires` 均存在且格式有效。
6. 按 `planType` 校验账号当前套餐：`plus` / `pro5` / `pro20` 要求 `account.planType=free`；`plus_to_5x` 要求 `account.planType=plus`；`renew_20x` 要求 `account.planType=pro`。
7. 确认请求头 `X-API-Key` 非空（不查库、不扣次）。
8. 检查系统是否处于维护关闭。
9. 检查当前开通队列是否已满。
10. 根据 `orderType`、`planType` 与 `upgradeMode` 校验银行卡或查询卡密。`plus_to_5x` 同卡升级跳过银行卡与卡库；新卡升级与 `renew_20x` 需要卡。
11. 创建订单并投递异步开通队列。

无效 token 会在写入订单前被拒绝。

### 计费规则

三方开放接口**不扣本站卡密次数**：

- `X-API-Key` 任意非空即可，不要求本站已发放。
- 创建订单不预占、不扣次。
- 开通成功也不扣次。
- `GET /api/v1/third-party/user` 的 `points` 为兼容字段，固定 `99990`。

### 公共请求字段

- `orderType`
  - 类型：字符串。
  - 必填：是。
  - 可选值：`direct`、`card_key`。
  - 含义：本次订单的支付方式。

- `token`
  - 类型：JSON 对象。
  - 必填：是。
  - 含义：ChatGPT Session 接口返回的**完整 JSON**。只拼 `email` + `accessToken` 会被拒绝。该对象会随订单保存，供开通、刷新 Token 和取消续费使用。

- `token.user`
  - 类型：JSON 对象。
  - 必填：是。
  - 含义：ChatGPT 用户信息对象。

- `token.user.id`
  - 类型：字符串。
  - 必填：是。
  - 含义：ChatGPT 用户 ID。

- `token.user.email`
  - 类型：字符串。
  - 必填：是。
  - 含义：开通目标 ChatGPT 账号邮箱，也会写入订单 `email`。

- `token.account`
  - 类型：JSON 对象。
  - 必填：是。
  - 含义：开通目标 ChatGPT 账户信息。

- `token.account.id`
  - 类型：字符串。
  - 必填：是。
  - 校验：去除首尾空格后不能为空，数字、`null`、对象或数组均不允许。
  - 含义：开通目标 ChatGPT Account ID。

- `token.accessToken`
  - 类型：字符串。
  - 必填：是。
  - 含义：ChatGPT accessToken。`plus` / `pro5` / `pro20` 用于创建 checkout 并支付；`plus_to_5x` 用于预览差价并提交订阅升级；`renew_20x` 用于加卡并开启自动续费（暂停账号会先支付欠费发票）。
  - 校验：必须是三段式 JWT，payload 必须能解析，必须包含数值型 `iat`、`exp`，并且当前时间不能超过 `exp`。

- `token.expires`
  - 类型：字符串。
  - 必填：是。
  - 含义：Session 过期时间，例如 `2026-11-01T08:34:59.567Z`。

- `token.sessionToken`
  - 类型：字符串。
  - 必填：是。
  - 含义：ChatGPT `__Secure-next-auth.session-token`（五段 JWE）。开通成功后旧 accessToken 会失效，必须用它刷新 Token、查询套餐并取消自动续费。
  - 注意：空字符串、`null`、数字、对象或数组都会被拒绝。

`token` 中除上述字段以外的其他 Session 字段必须尽量原样传入，服务会按原 JSON 保存。下游不应修改 accessToken / sessionToken 内容，也不要在日志中输出完整 token。只手工拼接部分字段会返回 `40028`。

### 必须提交的 token 结构

下游必须直接传递 ChatGPT Session 接口返回的完整 JSON，禁止只拼 `email` 和 `accessToken`。

推荐结构示例：

```json
{
  "WARNING_BANNER": "<sensitive-information-warning>",
  "user": {
    "id": "user-example",
    "name": "Example User",
    "email": "user@example.com",
    "idp": "auth0",
    "iat": 1785662977,
    "amr": [
      "otp",
      "urn:openai:amr:otp_email"
    ],
    "mfa": false
  },
  "expires": "2026-11-01T08:34:59.567Z",
  "account": {
    "id": "account-example",
    "planType": "free",
    "structure": "personal",
    "isUsageBasedSeatEnabled": false,
    "isConversationClassifierEnabledForWorkspace": true,
    "hasFloraFeature": false,
    "isFedrampCompliantWorkspace": false,
    "isDelinquent": false,
    "residencyRegion": "no_constraint",
    "computeResidency": "no_constraint"
  },
  "accessToken": "<chatgpt_access_token>",
  "authProvider": "openai",
  "sessionToken": "<chatgpt_session_token>",
  "rumViewTags": {
    "light_account": {
      "fetched": false
    }
  }
}
```

字段要求分级：

- 接口强制要求（缺一即拒绝）：
  - `user.id`
  - `user.email`
  - `account.id`
  - `accessToken`
  - `sessionToken`
  - `expires`

- 推荐原样传递：
  - `WARNING_BANNER`
  - `user.name`
  - `user.idp`
  - `user.iat`
  - `user.amr`
  - `user.mfa`
  - `account` 中除 `id` 外的其他字段
  - `authProvider`
  - `rumViewTags`

- 允许的扩展字段：
  - ChatGPT Session JSON 中存在的其他字段也可以传入。
  - 服务会将完整 `token` JSON 保存到订单，不会主动删除未知字段。

注意事项：

- 示例中的 ID、邮箱和 token 均为占位值，下游必须替换为实际 Session 数据。
- 不要将真实 `accessToken` 或 `sessionToken` 写入接口文档、工单、聊天记录、截图或普通日志。
- `expires` 是 Session 层的过期时间参考；当前创建订单前的强制有效性判断以 `accessToken` JWT payload 中的 `iat` 和 `exp` 为准。
- `account.planType` 表示账号**当前**套餐，必须和本次 `planType` 匹配：新开通（`plus` / `pro5` / `pro20`）只能提交 `free`；Plus 升 5X（`plus_to_5x`）只能提交 `plus`；20X 续费（`renew_20x`）只能提交 `pro`。本次要开的套餐仍由请求体 `planType` 决定。不匹配会返回业务码 `40030`。

## 创建直充订单

`plus` / `pro5` / `pro20` / `renew_20x` 的直充订单使用下游请求中提供的银行卡和套餐。`plus_to_5x` 仍用 `orderType=direct`：同卡升级不传卡，新卡升级必须传卡，见下方「创建 Plus 升 5X 订单」。

> **下单容量提示**：如果创建订单时返回 `当前并发过高，请稍后重试`（HTTP `429`，业务码 `42902`），表示服务器当前可处理的订单量已满，并非请求参数或银行卡信息错误。请勿高频连续重试，建议等待一段时间后重新下单。

### 请求示例

```json
{
  "orderType": "direct",
  "cardNumber": "4242424242424242",
  "expMonth": 12,
  "expYear": 2032,
  "cvv": "123",
  "token": {
    "user": {
      "id": "user-example",
      "email": "user@example.com"
    },
    "expires": "2026-11-01T08:34:59.567Z",
    "account": {
      "id": "account-example"
    },
    "accessToken": "<chatgpt_access_token>",
    "sessionToken": "<chatgpt_session_token>"
  },
  "planType": "pro5"
}
```

### 直充专用字段

- `cardNumber`
  - 类型：字符串。
  - 必填：`orderType=direct` 且 `planType` 为 `plus` / `pro5` / `pro20` / `renew_20x` 时必填；`plus_to_5x` 仅在 `upgradeMode=new_card`（或未传 `upgradeMode` 但带了卡号）时必填，同卡升级不传。
  - 格式：`12-19` 位数字，不允许空格或连字符。
  - 含义：本次支付或加卡使用的银行卡号。

- `expMonth`
  - 类型：整数。
  - 必填：与 `cardNumber` 相同。
  - 范围：`1-12`。
  - 含义：银行卡有效期月份。

- `expYear`
  - 类型：整数。
  - 必填：与 `cardNumber` 相同。
  - 范围：`2000-9999`。
  - 含义：银行卡有效期年份。
  - 校验：`expYear/expMonth` 不能早于服务器当前月份。

- `cvv`
  - 类型：字符串。
  - 必填：与 `cardNumber` 相同。
  - 格式：`3-4` 位数字。
  - 含义：银行卡安全码。

- `planType`
  - 类型：字符串。
  - 必填：`orderType=direct` 时必填。
  - 可选值：`plus`、`pro5`、`pro20`、`plus_to_5x`（别名 `plus5x`）、`renew_20x`（别名 `20x_renew` / `pro20_renew`）。
  - 含义：需要开通、升级或续费的 ChatGPT 套餐。
  - 对应关系：
    - `plus` → ChatGPT Plus（免费账号新开通）
    - `pro5` → ChatGPT Pro 5X（免费账号新开通）
    - `pro20` → ChatGPT Pro 20X（免费账号新开通）
    - `plus_to_5x` → Plus 升级到 Pro 5X（已有 Plus；用 `upgradeMode` 选同卡或新卡）
    - `renew_20x` → Pro 20X 续费（含暂停/欠费恢复；加新卡并开启自动续费）

- `upgradeMode`
  - 类型：字符串。
  - 必填：否。仅 `planType=plus_to_5x` 时生效，其他套餐忽略。
  - 可选值：`same_card`、`new_card`（也接受 `same` / `new`）。
  - 默认：未传且未带卡号时为 `same_card`。
  - 含义：Plus 升 5X 使用账号已绑默认卡，还是先加一张新卡再升级。非法值返回 `40020`。

### 直充处理说明

- 系统会生成 `DIRECT-` 前缀的随机卡密，例如 `DIRECT-kcJ_wcE5lyTQqjdZYfymdINXFoLk47WI`。
- 随机卡密写入订单 `card_key` 并通过创建响应返回。
- 下游必须保存该 `card_key`，后续通过它查询订单状态。
- `plus` / `pro5` / `pro20`：银行卡号、有效期和 CVV 会随任务保存，worker 走正价开通协议（Plus / 5X 走 gptplus，20X 走 gpt20x），结账国家/货币固定为 `PH` / `PHP`。
- `plus_to_5x` 同卡：不保存新卡，worker 预览差价后对 ChatGPT `subscriptions/update` 提交 `updated_plan=chatgptprolite`，用账号已绑默认卡扣差价。
- `plus_to_5x` 新卡：先走账单页加卡并设为默认卡，再执行与同卡相同的 `subscriptions/update`。
- `renew_20x`：若账号暂停/欠费，只用提交的卡支付 Stripe 托管 due 发票，不加卡、不 POST renew。未暂停则加卡并设为默认卡，查询 `will_renew`；未开启则 `POST /subscriptions/renew` 打开自动续费。不走 checkout。纯到期且没有欠费发票时不能续费。
- 正价开通与 Plus 升 5X 成功后会刷新 Token，查到对应套餐后再取消自动续费。**20X 续费成功后保持自动续费，不会取消。**

## 创建 Plus 升 5X 订单

已有 Plus 账号用 `planType=plus_to_5x` 升到 5X。Session 必须是 Plus 账号。用 `upgradeMode` 选择同卡或新卡。

### 同卡升级请求示例

账号上已有默认支付卡时，不要再传卡号。`upgradeMode` 可省略，默认 `same_card`。

```json
{
  "orderType": "direct",
  "planType": "plus_to_5x",
  "upgradeMode": "same_card",
  "token": {
    "user": {
      "id": "user-example",
      "email": "user@example.com"
    },
    "expires": "2026-11-01T08:34:59.567Z",
    "account": {
      "id": "account-example",
      "planType": "plus"
    },
    "accessToken": "<chatgpt_access_token>",
    "sessionToken": "<chatgpt_session_token>"
  }
}
```

### 新卡升级请求示例

```json
{
  "orderType": "direct",
  "planType": "plus_to_5x",
  "upgradeMode": "new_card",
  "cardNumber": "4242424242424242",
  "expMonth": 12,
  "expYear": 2032,
  "cvv": "123",
  "token": {
    "user": {
      "id": "user-example",
      "email": "user@example.com"
    },
    "expires": "2026-11-01T08:34:59.567Z",
    "account": {
      "id": "account-example",
      "planType": "plus"\
