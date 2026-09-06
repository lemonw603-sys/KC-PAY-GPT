# “三方对账”与付款未知关系核查（2026-09-06）

> 本轮读取当前代码并通过生产数据库只读核对。未修改生产、未创建订单、未付款。

## 1. 当前所谓“三方”

现有 API 投影实际比较：

1. 本地订单状态；
2. ZZSHU `create_direct` 充值平台调用/订单证据；
3. HNSKJ 卡片交易证据。

`reconcileOrderEvidence` 将付款提交未知、充值平台订单号缺失、成功订单缺金额、卡交易不匹配等归类为人工复核或证据等待。

Browser 的权威证据不同：Browser run/payment checkpoint、ChatGPT Plus 激活/取消观察、卡交易。当前通用“三方”SQL仍硬编码 ZZSHU，不能直接代表 Browser 对账。

## 2. 与付款结果未知的关系

相关，但不是同一件事：

- `PAYMENT_UNKNOWN/SUBMIT_UNKNOWN` 是一种需要对账的触发原因；
- 三方对账还覆盖明确成功但卡交易未同步、金额不匹配、失败订单却出现成功扣款等证据冲突；
- 一笔付款未知应先进入有界自动核验，超时仍不明确才生成需要人工处理的对账案例；不能因此暂停其他订单或整条链路。

## 3. 生产现场结果

- 生产 migration：047。
- `reconciliation_cases`：0 条，当前无真实 OPEN/ASSIGNED/RESOLVED 案例。
- 订单总数：20。
- 运营总览动态 SQL 当前计算“三方对账异常”：4 单。
- 这 4 单全部是 `CLOSED/RECHARGE_FAILED` 且存在 ZZSHU `create_direct` 调用但没有 `recharge_order_no`；Provider outcome 分布为 `DEFINITE_FAILURE` 3 次、`FAILED` 1 次。

结论：至少当前总览的 4 个“三方对账异常”主要是投影误报。明确失败没有外部充值订单号本身是正常结果，不应作为需要运营处理的对账异常。

## 4. 已确认的结构问题

### P0｜明确失败被误报

`RECONCILIATION_ISSUE_SQL` 只判断“调用过 create_direct 且没有 recharge_order_no”，没有排除 `DEFINITE_FAILURE/FAILED`。生产当前 4 个异常均由此产生。

### P0｜卡片关联仍使用旧 `cards.order_id`

交易同步、成功 PURCHASE 和金额匹配 SQL 通过 `cards.order_id=o.id` 找卡。项目已支持一卡跨订单复用并使用 `orders.assigned_card_id`/消费账本；新订单不一定是该卡的 legacy owner。生产已有 3 单 `assigned_card_id` 与 `cards.order_id` 不一致。继续使用旧关联会漏掉后续复用订单的交易证据。

### P0｜API 证据模型硬编码到 Browser

总览 SQL硬编码 `provider='zzshu'`、`recharge_order_no` 和订单 `actual_payment_*`。Browser 成功链路当前通过 Browser operations、Plus activation、cancellation 和卡交易确认完成，并不会在成功事务中填充 ZZSHU 订单号；因此未来 Browser 成功单可能被旧 API 三方模型误判。

### P1｜动态异常与案例队列是两套口径

总览动态算出 4 个异常，但 `reconciliation_cases` 为 0。运营者看到“有异常”，进入案例队列却没有可处理记录，造成“经常不好”的体验和不可信提示。

## 5. 保留还是删除

### 应保留的核心

保留“证据收敛/对账”能力，因为它处理真实资金边界：

- 点击付款后结果未知；
- 本地成功但账号未激活；
- 账号已激活但卡交易/金额明显冲突；
- 明确失败却出现成功扣款；
- 付款成功但后续取消续费状态不明。

### 不应保留的现状

- 不保留当前硬编码 ZZSHU 的统一“三方异常”口径作为 Browser 判断；
- 不把“等待交易同步”当异常；
- 不把明确失败且没有外部订单号当异常；
- 不继续同时展示动态异常数量和空案例队列；
- 不因一单对账暂停其他订单或营业。

## 6. 推荐收敛方向（待用户确认）

运营层只保留三类：

1. `付款结果核实中`：系统自动观察，不要求人工，不阻塞其他订单；
2. `证据待同步`：普通状态，不计入异常；
3. `需要人工核对`：只有有明确冲突或自动观察超时才进入，并产生真实 `reconciliation_case`。

证据按执行方式分开：

- API：本地订单 + ZZSHU 明确结果 + HNSKJ 卡交易；
- Browser + HNSKJ：Browser payment/Plus 观察 + HNSKJ 卡交易；
- Browser + 手工卡台：Browser payment/Plus 观察 + 本地消费账本/下一次完整快照校准；无实时交易 API 本身不算异常。

总览数字应直接来自真实待处理案例或一致的物化投影，不能继续出现“总览 4 个异常、案例队列 0 个”的分裂。

## 7. 当前状态

本轮只完成分析和建议，尚未修改 SQL、状态机、后台文案或生产。
