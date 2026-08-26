# Browser 上游运行合同（2026-08-26 用户确认版）

## 1. 最新优先级

用户确认本项目按以下顺序取舍：

1. 充值链路能跑通、顺畅、稳定；
2. 资金安全；
3. 敏感信息采用够用的保护，不为了绝对隔离增加不必要的复杂度。

Browser 执行时可以使用完成充值所需的完整卡资料和 Session。普通日志、WAL、截图、录像、客户页面和普通错误消息仍不记录这些原文。这里的限制是防止无意义扩散，不是阻止 Browser 完成业务。

## 2. 资金安全硬规则

- 同一订单不得出现第二个活动或未知资金 attempt；
- 同一张卡不得同时供两个订单使用；
- 付款提交前必须有唯一、短时、单次消费的 payment permit；
- 付款结果不明确时，run、attempt、订单和卡片必须锁定；
- `SUBMIT_UNKNOWN` / `PAYMENT_UNKNOWN` 禁止自动重试、自动换卡和切换执行器补付；
- 付款确认不等于最终交付完成；必须继续确认 Plus 已开通和自动续费已取消；
- 卡台扣款、Browser run、订单、卡片和最终权益必须可交叉追溯。

## 3. 正式调度链路和状态

用户确认后的目标流程是：

```text
订单 CARD_READY
→ 在同一事务中创建唯一 recharge_attempt、锁定订单/卡片并把订单推进为 RECHARGE_PROCESSING
→ Browser dispatch job 入队
→ Worker claim job
→ 创建/恢复 browser_run
→ 页面动作
→ payment permit
→ 真正点击付款前将 browser_run.payment_state 推进为 PAYMENT_SUBMITTING
→ 付款、Plus 激活、取消续费和对账
```

Browser **真正可以开始执行**时，数据库必须同时满足：

- `orders.status = 'RECHARGE_PROCESSING'`；
- `recharge_attempts.status = 'PREPARED'`；
- `recharge_attempts.funds_risk_state = 'ACTIVE'`；
- `recharge_attempts.executor_kind = 'BROWSER'`；
- `browser_dispatch_jobs.status = 'CLAIMED'` 且租约属于当前 Worker；
- 对应 `browser_run.status = 'RUNNING'` 后才允许页面动作。

`CARD_READY` 是创建资金 attempt 之前的业务准备状态，不是 Browser Worker 的最终可执行状态。`RECHARGE_PROCESSING` 表示 Browser 已在处理订单，但不表示已经点击付款；真正的付款提交阶段由 `browser_runs.payment_state = 'PAYMENT_SUBMITTING'` 精确表达。Browser 分支中曾使用的 `order=CARD_READY/RECONCILIATION_REQUIRED`、`attempt=PENDING/OBSERVING` 只属于隔离 PoC 投影，不能直接映射为共享生产状态。

当前代码仍在创建 attempt 时把订单推进为 `SUBMITTING`，Browser dispatch/run 也依赖该状态。这是已核实的当前实现，不是目标合同；接线改造需将 Browser 路线调整为上述 `RECHARGE_PROCESSING` 口径。历史 API 路线是否继续使用 `SUBMITTING` 由其自身提交语义决定，不在本次修改中强行统一。

`RECONCILIATION_REQUIRED` 只允许核对和人工处理，禁止创建新的付款动作。确认上一笔明确未付款后，必须由共享核心按受控状态迁移恢复，不由 Browser 自行改状态。

## 4. card / route / provider 正式绑定

- 本地卡片主键：`cards.id`；
- 卡台卡片引用：当前 HNSKJ 使用 `cards.provider_card_id`，Foundation v2 同时保留 `cards.external_card_id`；
- 卡片 Provider 账户：`cards.provider_account_id`；
- 订单冻结路线：`orders.fulfillment_route_id`；
- attempt 冻结路线：`recharge_attempts.fulfillment_route_id`；
- Browser 路线要求 `fulfillment_routes.executor_kind = 'BROWSER'`；
- 卡片必须通过 `cards.order_id = orders.id` 绑定到当前订单；
- 卡片 Provider 账户必须与冻结路线的 `card_provider_account_id` 一致；
- 旧订单继续使用其创建时冻结的路线和 Provider 引用，人工切换只影响新订单。

Browser 不调用卡台开卡、卡余额充值、销卡或提现等写接口。需要写卡台的动作仍由运营后台/卡台服务负责。

## 5. 卡片就绪口径

共享核心在创建资金 attempt 前已执行权威检查：

- 卡状态属于 `active/available/usable/ready`；
- 卡余额达到订单的 `minimum_required_card_balance`；
- 卡资料存在；
- 卡片只读同步时间不超过 15 分钟；
- 订单的 `PREPARE_RECHARGE` 已完成；
- 不存在已有活动、未知或已结算的资金 attempt。

因此 Browser 不应另造一套 `READY + digest + validUntil` 业务真相。若需要投影证据，digest 只作为上述数据库快照的完整性摘要；有效期不得晚于共享核心的 15 分钟同步时效，并且付款 permit 签发时必须再次检查。

## 6. Session 责任边界

- Session 的权威记录仍属于订单；当前生产结构为 `orders.session_ciphertext`，没有正式 `session_ref` 数据库列；
- Browser 可以通过当前订单/attempt/run 的受控执行上下文取得并使用 Session；
- 不要求为了 opaque `session_ref` 新建额外密钥柜或中间服务；
- Session 更换仍遵循原订单最多 3 次和可恢复状态规则；
- Browser 不自行持久化第二份长期 Session 事实源。

## 7. 审计关联

当前正式审计主链为：

```text
order.id
→ recharge_attempts.id
→ browser_runs.id
→ browser_checkpoints / browser_operations / payment_permits
→ checkout_artifacts / execution_resource_leases / browser_interventions
→ reconciliation_cases / browser_post_payment_observations
```

因此 `browser_runs.id` 就是一次 Browser 执行的正式运行引用，不需要再造一个语义不明的 `audit_ref`。如外部接口需要 `audit_ref`，应直接使用或明确映射到 `browser_run_id`。

## 8. 卡台读取和刷新策略

- 调度前使用共享核心已有的卡片同步结果，不由 Browser 重复轮询卡台；
- 进入执行上下文时最多读取一次当前卡片材料；
- 付款 permit 前再次使用共享数据库事实检查卡状态、余额、同步时效、订单/卡/route 绑定和资金 attempt；
- 若卡片同步已超过 15 分钟，先停止 Browser，由共享卡片同步服务刷新；
- 卡台读取失败或结果不明确时 fail-closed，不调用卡台写接口，不靠 Browser 循环重试；
- 页面运行期间不定时刷新卡台；付款后由共享交易同步和对账链路读取卡台交易。

## 9. 当前实现差异与接线要求

当前共享核心已经拥有 `recharge_attempts`、`browser_dispatch_jobs`、`browser_runs`、付款 permit、检查点、资源租约、UNKNOWN 锁定和付款后状态表。

当前需要修正两处实现差异：共享核心的 Browser 路线仍将订单提前写为 `SUBMITTING`；Browser 独立 worktree 的 `browser_upstream_ready_projection`、`PENDING/OBSERVING`、`AVAILABLE` 卡和独立 `audit_ref` 仍是 PoC 合同。接线时应同时修正这两处，不建立平行状态机。

生产接线验收必须证明：

1. 同一 attempt 只产生一个可执行 dispatch/run；
2. 卡、路线、Provider、订单绑定一致；
3. Session 和卡资料可供执行器正常使用；
4. 普通证据不记录敏感原文；
5. 付款 permit 只能消费一次；
6. 崩溃或未知结果后不会再次付款；
7. Plus 开通、取消续费和卡台交易最终能回到同一订单审计链。
