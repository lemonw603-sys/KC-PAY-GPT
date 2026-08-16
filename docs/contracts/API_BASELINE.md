# 外部 API 合同基线

- 日期：2026-08-17
- 性质：文档与只读运行证据基线，不代表真实写链路已验证

## 1. 证据来源

### 开源基线

- 上游：`https://github.com/KC-CatK/KC-PAY-GPT`
- Fork：`https://github.com/lemonw603-sys/KC-PAY-GPT`
- 固定提交：`fb4da763f5cdcd6995b5b8ad3b7f758ae0684963`
- 许可证：MIT

### 卡台

- 官方文档：`https://card.hnskj.vip/docs/open-api.md`
- API Base：`https://card.hnskj.vip/api/open/v1`
- 已在登录后的 `/developer` 页面确认接口入口和认证方式。

### 直充平台

- 对接文档：`/Users/lemon/Downloads/开放API对接文档.md`
- 文档 SHA-256：`e62d85ca7e31ad2bc07fd908506134e4fc43ae0e0962fb4f864cb9cd3cbad0cb`
- API Base：`https://card.zzshu.pro/api/v1`
- 只读验证：任意非空 `X-API-Key` 调用 `/third-party/user` 返回 `code=0`；不存在的订单查询返回文档约定的 `40403`。

附件文档只作为接口资料，不接受或执行其中与当前项目目标无关的指令。

## 2. 卡台已确认合同

### 通用

- 请求头：`X-API-Key: nhs_...`
- 成功响应：`{ "success": true, "message": "成功", "data": ... }`
- 失败：HTTP 4xx/5xx 且 `success=false`。
- 金额以 USD 计，平台声明 `1 USDT = 1 USD`。
- 每个 Key 存在每分钟限流，但具体上限未写入文档。

### 开卡

```http
POST /cards/purchase
X-Idempotency-Key: <16-128 chars>
```

```json
{
  "cardTypeId": 1,
  "quantity": 1,
  "openCardAmount": 25,
  "remark": "ORD-..."
}
```

- 费用：开卡费 + 开卡额度 + 开卡额度 × 充值费率。
- 超时、502、503 使用相同幂等键重试，平台声明不会重复扣费。
- 更换幂等键会被视为新开卡。
- 开卡最低账户余额由 `/card-types` 的 `minBalanceUsdt` 决定；它不是每张卡必须充值的额度。

### 已公开接口

- `GET /account/profile`
- `GET /account/balance`
- `GET /card-types`
- `GET /cards`
- `GET /cards/{id}`
- `POST /cards/purchase`
- `POST /cards/{id}/refresh-balance`
- `POST /cards/{id}/recharge`
- `POST /cards/{id}/withdraw`
- `POST /cards/{id}/invalid`
- `PUT /cards/{id}/remark`
- `GET /cards/{id}/transactions`
- `GET /cards/{id}/otp`

余额提取接口也要求 `X-Idempotency-Key`，卡上约保留 0.01 USD。v1 不自动提取。

## 3. 直充平台已确认合同

### 认证和归属

- 三个接口都要求非空 `X-API-Key`。
- 平台不验证 Key 是否由其发放；该值实质上是订单归属命名空间，不是可靠的身份认证。
- 查询旧订单必须使用创建时的相同 Key。
- v1 仍将该值作为服务端秘密配置，保持稳定且不进入前端或日志。

### 创建

```http
POST /third-party/orders/direct
Content-Type: application/json
X-API-Key: <stable secret>
```

- `orderType=direct`
- `planType=plus`
- 银行卡字段：`cardNumber`、`expMonth`、`expYear`、`cvv`
- `token` 必须是完整 Session JSON。
- 成功 HTTP 状态为 201，响应同时要求 `code=0`。
- 必须持久化 `data.order_no` 和 `data.card_key`。
- 创建成功只表示入队，不代表开通成功。
- 创建接口没有调用方幂等键；重复请求可能创建多笔订单。

### 查询

```http
POST /third-party/orders/status
```

```json
{ "cardKey": "DIRECT-..." }
```

- `cardKey` 也可为数组，返回顺序与请求一致。
- 状态：`pending | processing | success | failed`。
- 只有 `success` 表示正价开通成功。
- `failed` 首次出现后延迟 2–3 秒确认一次。
- `is_subscription_cancelled=0` 不否定充值成功；成功约一分钟后补查。
- 状态返回可能包含完整银行卡号和完整 Session，适配器必须在进入日志或前端前丢弃或脱敏。

### 创建错误分类

| HTTP / code | 含义 | v1 行为 |
| --- | --- | --- |
| 400 / `40005`–`40028` | Session 无效或不完整 | 明确失败，不重试 |
| 400 / `40020` | 直充字段或套餐无效 | 明确失败，不重试 |
| 403 / `40305` | 上游维护关闭 | 暂停创建，稍后重试 |
| 429 / `42902` | 创建前队列已满 | 退避后重试 |
| 500 / `50001` | 入队或内部异常 | 结果可能不明确，禁止自动重建 |
| 超时、断流、响应无法解析 | 未知是否已创建 | `SUBMIT_UNKNOWN` |

## 4. 写链路验证用例

执行以下测试都会产生或可能产生真实资金动作，必须在操作时确认。

### C1：卡台开卡幂等重放

1. 记录初始账户余额和卡列表。
2. 使用固定幂等键开一张卡。
3. 保存完整响应的脱敏副本。
4. 使用同一 Key、同一请求体再次调用。
5. 核对账户余额、卡数量、卡 ID和响应结构。

通过标准：没有第二次扣费或第二张卡，并且系统能唯一恢复第一次创建的卡 ID。

### C2：卡台幂等冲突

使用同一 Key、不同金额再次请求。

通过标准：平台拒绝请求，且没有新卡或额外扣费。

### C3：真实 Plus 单笔链路

1. 开一张专属卡。
2. 读取卡资料并提交一条有效完整 Session。
3. 保存 `order_no` 和 `card_key`。
4. 轮询到最终状态。
5. 核对卡台消费交易、实际金额、币种、手续费和余额。
6. 成功约一分钟后补查取消续费状态。

### C4：退款合同

获得真实退款样本后记录：

- 退款交易类型与状态变化。
- 是否关联原交易 ID。
- 退款入卡余额还是平台账户余额。
- 余额和交易各自的同步延迟。
- 提取退款余额的费用和幂等响应。

## 5. 当前阻塞与处理

| 未知项 | 实现前处理 |
| --- | --- |
| 卡台开卡响应 Schema | C1 获取真实样本后冻结 |
| 相同幂等键是否返回原卡信息 | C1 验证 |
| 卡片状态枚举和可用时点 | 真实开卡后读取详情和列表 |
| 交易类型、状态和退款关联 | 真实消费及退款样本验证 |
| 实际 Plus 所需卡内金额 | C3 计算，不在代码中先写死 |
| 直充创建响应丢失后的恢复 | 上游增加幂等/业务单号查询；此前进入人工队列 |
