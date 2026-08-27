# 外部 API 合同基线

- 日期：2026-08-19
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
- 2026-08-17 经用户单次审批，使用新建 Key 完成 `/account/profile`、`/account/balance`、`/card-types`、`/cards` 四个只读接口验证，均返回 HTTP 200 与 `success=true`。Key 未落盘，审批已用完。
- 2026-08-18 更换已暴露 Key 后，后台将新 Key 显示为“有效”，服务器保存值与创建时完整值的 SHA-256 一致，但 `/api/open/v1/account/profile` 仍返回 HTTP 401、`API Key 无效`。在运营方解释或修复前，生产 `PROVIDER_READS_ENABLED` 保持关闭，不把后台“有效”标签视为 API 可用证据。
- 同日经单独批准，使用同一 Key 从本地网络出口复测也返回相同的 HTTP 401，已排除仅服务器出口 IP 被限制；故障收敛为该 Key 未进入实际 API 鉴权数据源，或鉴权端对新 Key 的全局校验异常。

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
- 本次真实响应未返回 `X-RateLimit-Limit`、`X-RateLimit-Remaining` 或 `Retry-After` 响应头。

### 已验证读取结构

- `/account/profile`：`id` 为 number；`balance` 为 string；包含 `username`、`email`、`currency`、`activeCards`、`levelName`、`createdAt`。
- `/account/balance`：`balance` 与 `exchangeRate` 均为 string，`currency` 为 string。
- `/card-types`：`data.cardTypes` 为数组；本次返回 8 个卡段。费用、金额和费率字段均为 string；`exchangeRate` 为 number。
- `/cards`：返回分页对象 `{cards,total,page,pageSize,source}`；本次账户无卡，尚不能确定卡片条目结构。

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
- 2026-08-18 单笔开卡实测：`POST /cards/purchase` 的成功外壳未返回卡片 ID；新增卡先出现在 `/cards`，状态为 `processing`，后转为 `failed`。账户余额先暂扣，再在失败后全额恢复。结论：成功外壳仅表示请求受理，不能表示卡片已创建成功；收到响应后必须恢复卡片 ID，并等待 `active + 余额到账 + 完整卡资料` 才能进入直充。

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

> 重要实现状态：文档中的 `POST /cards/{id}/recharge` 是给既有卡片追加余额的候选接口；截至 2026-08-21，v1 `HnskjCardProvider` 尚未实现该方法，项目也未对该写接口做真实调用。2026-08-18 已验证的成功 PoC 使用的是 `POST /cards/purchase` 开卡，再调用 ZZSHU 直充，不是对既有卡调用本接口。

余额提取接口也要求 `X-Idempotency-Key`，卡上约保留 0.01 USD。v1 不自动提取。

## 3. 直充平台已确认合同

### 认证和归属

- 三个接口都要求非空 `X-API-Key`。
- 平台不验证 Key 是否由其发放；该值实质上是订单归属命名空间，不是可靠的身份认证。
- 查询旧订单必须使用创建时的相同 Key。
- v1 仍将该值作为服务端秘密配置，保持稳定且不进入前端或日志。

部署约定：Provider 密钥只注入 worker 的 provider 环境文件；Web 进程不加载这些密钥。`npm run provider:read-check` 仅执行只读连通性和响应 Schema 检查，并在资金写入开关开启时拒绝运行。

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

### C4：交易与退款合同

2026-08-19 通过 HNSKJ `GET /cards/{id}/transactions` 对真实卡片做只读核对，确认返回外壳为 `success/message/data`，当前现场 `data` 的键为 `transactions/total/source`；此前样本曾出现 `page/pageSize/cardNo`，不能把它们当成稳定字段。当前真实卡片 493 返回 0 条交易，因此本次没有新增真实交易条目样本。适配器采用两种兼容策略：有合法分页元数据时按页同步；无分页元数据且返回条数等于 `total` 时接受为完整响应；无分页元数据但条数小于 `total` 时以 `TRANSACTION_PAGINATION_UNSUPPORTED` 失败关闭，避免漏账。交易项已确认字段（来自已保存样本/fixture，当前现场未重新出现）：

- `id`、`type`、`status`、`amount`、`currency`、`fee`、`tradeTime`。
- `originalAmount`、`originalCurrency`、`relatedTxnId`、`settlementStatus`、`platformCardId`。
- 已观察到的类型：`CARD_RECHARGE`、`PURCHASE`、`CARD_BALANCE_RETURN`。
- `CARD_RECHARGE`（再次向卡内存款）永远不能判定为退款；金额正负和余额变化不能覆盖这条规则。
- `CARD_BALANCE_RETURN` 不能仅凭类型判定为退款，也不能仅凭类型排除退款；必须结合原始 `PURCHASE`、商户、关联交易和状态继续核对。
- `PURCHASE` 可能先返回 `processing`，不能直接视作最终扣款完成。
- `relatedTxnId` 在当前样本为空，不能假设退款一定带原交易关联 ID。
- `cardNo` 仍属于敏感字段，后台和日志不得展示或持久化明文。

当前 Provider 已对这些字段做运行时 Schema 校验；交易同步已接入后台只读任务，退款只生成“疑似退款”候选，不自动确认或提取余额。没有真实退款样本前，候选不能表述为官方已退款。

退款合同仍需继续核对：

获得真实退款样本后记录：

- 退款交易类型与状态变化。
- 是否关联原交易 ID。
- 退款入卡余额还是平台账户余额。
- 余额和交易各自的同步延迟。
- 提取退款余额的费用和幂等响应。

### C5：2026-08-18 真实 Plus 完整 PoC

- 参数：卡段 `1`（`Z-43612081`）、开卡金额 `$16`、最低就绪余额 `$16`、`planType=plus`。
- 卡台账户余额：`102.420000 → 85.840000 USD`。
- 卡片最终：Provider 卡 ID `493`、状态 `active`；敏感卡资料未写入本文件。
- 直充订单：已获得 `order_no` / `card_key`，最终状态 `success`。
- 实际支付：`982.14 PHP`。
- 取消续费补查：`is_subscription_cancelled=1`。
- 直充后卡片只读核对：余额约 `$0.03`；交易摘要显示一笔 `$16` 卡充值和一笔约 `$15.97` 的支付处理记录，符合开卡余额扣除后保留少量余额的现象。
- 结果：供应商独立 PoC 从开卡、异步识别、卡资料就绪、直充创建、最终成功到取消续费补查通过；它没有进入当前正式订单库，因此不能宣称“正式系统完整订单链路已验证”。未执行自动重开或重复直充。
- 2026-08-19 只读复核：原始 `provider-poc-state.json` 为 `FINISHED`，且 ZZSHU 当前查询仍返回 `success / 982.14 PHP / is_subscription_cancelled=1`；HNSKJ 卡 `493` 当前余额 `$0.02`，原始成功交易仍为 `$16` 入金和 `$15.97`（`982.14 PHP`）已结算支付。
- 同次只读复核还发现 2026-08-19 13:43:31 一笔 `OPENAI *CHATGPT SUBSCR`、`$78.24` 的失败支付尝试。它没有扣款；用户已确认这是主动点击升级套餐后产生的失败支付，不是系统自动续费。该原因来自用户确认，交易记录本身只证明授权失败。

## 5. 当前阻塞与处理

| 未知项 | 实现前处理 |
| --- | --- |
| 卡台开卡成功外壳不含卡 ID | 正式 Worker 已在写入前持久化卡片基线；响应缺 ID 或进程中断后只做列表差异恢复，禁止自动重开 |
| 相同幂等键是否返回原卡信息 | 仍需单独验证，结果未知时不得更换幂等键重开 |
| 卡片状态枚举和可用时点 | 已观测 `processing → failed` 与 `processing → active`；只有 `active + 余额达标 + 完整凭据` 可继续 |
| 交易类型、状态和退款关联 | 真实消费及退款样本验证 |
| 实际 Plus 所需卡内金额 | C3 计算，不在代码中先写死 |
| 直充创建响应丢失后的恢复 | 上游增加幂等/业务单号查询；此前进入人工队列 |

## 6. 2026-08-18 全文合同复核补充

本次复核完整阅读了两份上游资料：

- `对接api.md`（GPT-KCCatk / HNSKJ 的完整账户、卡片和 `/pay` API）
- `/Users/lemon/Downloads/开放API对接文档.md`（ZZSHU 三方正价开通 API）

两份资料不是同一套接口，不能混用认证方式或状态含义：

1. HNSKJ 的卡台 Open API 使用 `X-API-Key`，当前项目只使用其账户、卡段、开卡、卡详情、余额和交易接口；其完整 `/pay` API 使用另一套 Bearer/API Key + Scope 合同，不是当前项目的直充 Provider。
2. ZZSHU 三方 API 使用非空 `X-API-Key` 作为订单归属标识，创建路径为 `/third-party/orders/direct`，且没有调用方幂等键。当前项目继续使用 HNSKJ 提供卡片、ZZSHU 执行直充的双 Provider 架构。
3. ZZSHU 请求没有金额字段。`planType=plus` 决定套餐和上游实际扣款，创建响应中的 `payment_amount` / `payment_currency` 当前可能为空；实际金额只能以最终订单/交易记录为准。HNSKJ 的 `openCardAmount` 仅是卡片预存金额，不是直充扣款金额。
4. ZZSHU 状态接口支持单个或数组 `cardKey`；v1 每个本地订单只查询一个 `cardKey`，因此使用单值是有意的范围限制，不是遗漏批量协议。
5. ZZSHU 文档允许状态响应携带最新 Session、完整卡号和 `payment_result`；适配器已在业务层只保留必要字段并在审计层脱敏，不能把原始响应直接写日志或返回前端。
6. `failed` 首次出现后延迟 2–3 秒复查、`is_subscription_cancelled=0` 不否定充值成功、`50001`/超时不得自动重建等规则已纳入 Worker；创建成功只视为入队，必须等最终 `success`。直充创建现由指定订单、短时、一次性 Permit 控制；Permit 消耗后任何失败都禁止自动再次创建。

金额设计已拆分：订单分别保存 `open_card_amount` 和 `minimum_required_card_balance`，后者在接单时从运营配置生成不可变快照。直充成功状态返回的 `payment_amount` / `payment_currency` 另存为实际支付结果；上游为空时保持为空，不用余额差额猜测。默认最低余额配置保持空值并使接单失败关闭，待真实成功订单确认后再填写。
