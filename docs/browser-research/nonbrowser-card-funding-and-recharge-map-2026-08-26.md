# 非 Browser 卡台/卡片/充值链路与 Browser 交接地图

日期：2026-08-26  
范围：只读核实 Browser 需要依赖的卡台、库存、卡片补余额和非 Browser 直充能力；未改非 Browser 代码，未调用真实资金写接口。

## 1. 先给结论

用户记忆中的“卡台（开卡-充值）→ 浏览器自动化充值”需要拆成两条不同的业务路径，不能把“卡台账户充值”“卡片开卡”“既有卡补余额”“Plus 充值”混成一个“充值”字段：

```text
卡台账户钱包（人工/卡台侧入金）
        ↓
HNSKJ 卡台开卡（POST /cards/purchase）
        ↓
卡片状态/余额/卡资料就绪
        ├─ 非 Browser：ZZSHU direct API（POST /third-party/orders/direct）
        └─ Browser：ChatGPT Checkout/Stripe 执行器（当前仍未接线）

既有库存卡余额不足
        ↓
HNSKJ 卡片补余额（POST /cards/{id}/recharge）
        ↓
卡片余额/交易只读对账
        ↓
后续可分配给非 Browser 或 Browser（必须按订单/尝试合同绑定）
```

**代码已经存在，但不在同一份当前 Browser 基线上：**

- HNSKJ 卡台读/开卡/卡片补余额适配器、库存、卡资金账本和后台能力，已在
  `/Users/lemon/.codex/worktrees/nonbrowser/AI充值业务` 的
  `codex/nonbrowser-integration-20260825 @ c202a57`（包含 `f3bbe93`）中形成；该 worktree 当前干净。
- 当前 Browser worktree `/Users/lemon/.codex/worktrees/9128/AI充值业务 @ c5ca6b6` 没有这些新版 card-funding 文件；主工作树 `/Users/lemon/code/AI充值业务 @ bd9f05b` 也未包含 `card_funding_attempts` 这批提交。不能把“其他 worktree 有代码”写成“Browser 当前已接通”。
- 生产只读/后台证据显示卡台目录、卡片同步和库存观察在运行；卡余额充值写入保持关闭，`card_funding_attempts=0`/开关 false 的证据已记录，不能称为已自动补余额。

## 2. 卡台 API 的真实口径

### 2.1 HNSKJ Open API

来源：项目 `docs/contracts/API_BASELINE.md`、`对接api.md`、非 Browser worktree 的 `v1/src/providers/hnskj-card.js`。

- Base URL：`https://card.hnskj.vip/api/open/v1`
- 认证：`X-API-Key`，不是 Bearer。
- 成功外壳：`{success:true,message,data}`；金额/余额通常是字符串，不能把浮点显示值当作精确账本。
- 读取：`/account/profile`、`/account/balance`、`/card-types`、`/cards`、`/cards/{id}`、`/cards/{id}/transactions`。
- 开卡：`POST /cards/purchase`，请求含 `cardTypeId`、`quantity=1`、`openCardAmount`、稳定 `X-Idempotency-Key`。
- 既有卡补余额：`POST /cards/{id}/recharge`，请求含正整数 `amount` 和稳定 `X-Idempotency-Key`；适配器实现见非 Browser worktree 的 `hnskj-card.js:348-365`。
- 提取余额：`POST /cards/{id}/withdraw`，也要求稳定幂等键；不是 Browser 充值步骤，仍保持人工确认。

关键口径：

1. `openCardAmount` 是**卡片初始余额/开卡预算**，不是 Plus 实际扣款金额。
2. 卡台账户余额是**平台钱包**，不是某张库存卡余额。
3. 卡片补余额是**向已有卡增加 USD 余额**，不是开新卡，也不是给 ChatGPT 充值。
4. 只有卡台卡状态 active、卡余额达到不可变最低门槛、卡号/有效期/CVV 完整，才可进入后续执行器。
5. 卡台开卡成功响应曾不返回卡片 ID；正式代码必须先保存列表基线、再按差异恢复，缺 ID/差异不明时禁止重开。

### 2.2 与根目录 `对接api.md` 的区别

`对接api.md` 同时描述了另一套 `/api/v1` GPT-KCCatk API（Bearer API Key、`/pay`、`/bank-cards`），它不是当前 HNSKJ Open API，也不是当前 Browser 的卡台接口。当前项目非 Browser 主路线使用：

```text
HNSKJ Open API：提供卡台账户、卡段、卡片和卡资金动作
ZZSHU API：执行 Plus 直充和状态轮询
```

不能把 `/bank-cards/{id}/balance` 当成 HNSKJ 的 `/cards/{id}/recharge`；两者认证、字段和归属模型不同。

## 3. 非 Browser 主链路（代码已核实）

### 3.1 客户订单到卡片

非 Browser v1 的实际工作流（非 Browser worktree）：

```text
CDK + Session
→ order-intake-service 创建订单、绑定 CDK、保存卡台卡段/开卡金额快照
→ PURCHASE_CARD：HNSKJ /cards/purchase（稳定幂等键）
→ CARD_PROVISIONING：读取卡片详情
→ VERIFY_CARD：active + 余额达标 + 完整卡资料
→ CARD_READY：卡片专属绑定，资料仅短期保存
```

关键代码：

- `v1/src/services/order-intake-service.js`
- `v1/src/workers/workflow-handlers.js`
- `v1/src/db/repositories/workflow-repository.js`
- `v1/src/providers/hnskj-card.js`
- `v1/migrations/001_initial.sql`、`005_card_provisioning.sql`、`007_card_balance_and_payment_amount.sql`

### 3.2 非 Browser Plus 充值

```text
CARD_READY
→ SUBMIT_RECHARGE
→ HNSKJ 卡资料 + Session
→ ZZSHU POST /third-party/orders/direct
→ 保存 order_no + card_key
→ POLL_RECHARGE 查询 pending/processing/success/failed
→ success 后补查取消续费
```

关键代码：

- `v1/src/providers/zzshu-recharge.js`
- `v1/src/workers/workflow-handlers.js`
- `v1/src/services/order-status-service.js`

ZZSHU 创建接口**没有调用方幂等键**，所以：明确成功后只保存 `order_no/card_key`；超时、断流、50001 或 Schema 不确定必须进入 `SUBMIT_UNKNOWN`/人工对账，不能换卡、换 key 或自动再建单。`success` 才是开通成功；`queue done`、HTTP 200、页面文案都不是成功证明。

### 3.3 既有库存卡补余额

非 Browser worktree 已实现的能力分为四层：

1. **调度**：`card-funding-scheduler.js` 找出 active、未绑定订单、低于最低余额的库存卡，创建 `PREPARED` 尝试；同一卡只允许一个 prepared/active/unknown/settled 栅栏。
2. **资金账本**：`v1/migrations/030_card_funding_attempts.sql` 建立 `card_funding_attempts`，记录卡、Provider 账户、金额、幂等键、状态、资金风险状态、外部引用和结果摘要，并与 `provider_calls` 关联。
3. **执行**：`card-funding-executor.js` 先 `begin` 写 STARTED 审计，再调用 `HnskjCardProvider.rechargeCard()`，将明确成功设为 `SETTLED`、处理中设为 `PENDING/ACTIVE`、不确定设为 `MANUAL_REVIEW/UNKNOWN`。
4. **对账/人工**：`card-funding-reconcile-runner.js` 只读刷新卡余额/交易，达到最低余额才结算；后台 `card-funding-attempts/:id/resolve` 只允许人工记录结论，不能凭空创建第二次 Provider 调用。

相关迁移：`030_card_funding_attempts.sql`、`033_replenishment_settings_audit.sql`、`034_card_funding_prepared_fence.sql`、`035_card_funding_manual_actions.sql`。

## 4. 卡库存进入后续执行器的条件

非 Browser 的库存代码不是“拿到卡就可用”，而是：

```text
HNSKJ /cards 全量发现
→ 新卡 QUARANTINED
→ 两次稳定详情快照 + 卡段/余额/归属规则校验
→ ACCEPTED / AVAILABLE
→ 低余额 DEPLETED（不自动分配）
→ 已分配 ASSIGNED
→ 变化不明或历史使用异常 HELD_FOR_REVIEW
```

证据位置：`card-intake-service.js`、`card-catalog-sync-service.js`、`card-stock-service.js`、`card-provider-snapshot-service.js`。

卡台路由通过 `provider_accounts` + `fulfillment_routes` 解析；新订单按当前有效路线，旧订单/既有卡保留原 `provider_account_id`。没有有效路线时应 fail-closed，不回退到历史 HNSKJ 账户。

## 5. Browser 应该复用什么、不能直接复用什么

### 可复用（输入/只读/账本语义）

- 卡台卡片实体：`provider_account_id`、`provider_card_id`、`card_type_id`、`last4`、`inventory_status`、余额和同步时间。
- 卡片就绪判断：active + 最低余额 + 完整卡资料。
- 订单/卡片归属与状态事件、Provider 调用审计、卡片交易同步和资金风险状态。
- 当前有效卡台路线解析；Browser 任务启动时冻结 route/profile，不在执行中切换。
- 现有 `card_funding_attempts` 的“准备→提交→未知→只读对账→人工结案”思想，可作为 Browser 前置补余额的共享语义。

### 不能直接复用

- 不能让 Browser Worker 直接拿 `HNSKJ_API_KEY` 或调用 HNSKJ 开卡/补余额 API；这些属于卡台/资金 Provider，应该由非 Browser 控制面完成并只传卡引用/就绪证明。
- 不能把 `card_funding_attempts` 当作 Plus `recharge_attempts`；前者是**卡余额资金动作**，后者是**订单支付/权益动作**。
- 不能把 ZZSHU `create_direct` 的 `order_no/card_key` 当作 Browser Checkout artifact；两条充值路线必须分别建 attempt/artifact。
- 不能在 Browser 队列/WAL/普通日志保存 PAN/CVV、完整 Session、API key 或卡台私密响应。

## 6. 当前真实运行与未验证边界

已验证（代码/隔离运行/项目运行记录分开）：

- 非 Browser worktree 定向 card funding 测试：16/16 pass。
- Browser worktree `browser-mvp`：20/20 pass，soak 5328/5328，`submitCalls=0`。
- 非 Browser 生产只读证据：卡台目录/卡片只读同步、库存观察和后台“卡余额充值”页面可访问；卡余额充值写开关为 false，card funding runner 未作为自动写入路径运行。
- HNSKJ/ZZSHU 的真实读结构、HNSKJ 一次开卡/ZZSHU 一次成功 PoC 已有项目记录，但不等于当前 Browser 已接线。

未验证：

- HNSKJ `/cards/{id}/recharge` 的真实写响应、同一幂等键重放行为和生产扣款。
- Browser 从共享卡片引用到真实 Session/Checkout 的接线。
- Browser 是否采用 HNSKJ 卡台卡片、ZZSHU 直充，还是独立 Checkout 资金路径；当前 Browser route 仍未冻结。
- 真实 Browser Checkout/Stripe/Plus 权益和每日吞吐。

## 7. 对 Browser MVP 的直接影响

Browser MVP 下一阶段不能从 `browser-mvp` 直接调用卡台 API。最小适配边界应是：

```text
shared order/attempt
→ cardRef + routeRef + cardReadyEvidence（只读投影）
→ SessionProvider/SessionLease
→ BrowserContext
→ Checkout artifact
→ payment permit（另行冻结）
→ final entitlement + card transaction + order event
```

卡片补余额是否先于 Browser 执行，由共享控制面按“卡片余额门槛 + 资金风险锁”决定；Browser 只消费“已就绪、归属明确、未被其他 attempt 占用”的卡引用，不自己补卡、不自己开卡台账户、不自己决定最低余额。

