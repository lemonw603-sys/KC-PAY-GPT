# 订单 PJV1-412JIT_yfiuBpZeC39_m 被拒调查｜2026-09-01

## 结论（按证据强度）

这笔订单不是“系统没有卡”、不是余额不足、不是 Session 已经是 Plus，也不是请求超时或结果未知。订单已经被 ZZSHU 接受并创建外部订单 `8849`，随后上游最终把这次支付判定为**卡片被拒**：

```text
status=failed
failureReason=卡片被拒，请换卡后重提
paymentResult.success=false
paymentResult.status=failed
```

当前能确定的根因边界是：**ZZSHU/其下游支付处理方拒绝了卡 1839（尾号 1013）本次支付。** 上游返回中没有更细的拒付码、银行原因或 3DS/CVV 诊断，因此不能把原因进一步断言为余额、3DS、CVV、BIN、地区或某个银行规则。

## 现场只读证据

### 1. 本地订单、任务和资金

- 订单：`PJV1-412JIT_yfiuBpZeC39_m`，创建时间 2026-09-01 14:01:42 CST，最终 `RECHARGE_FAILED`。
- 外部订单：`8849`；`ASSIGN_CARD`、`PREPARE_RECHARGE`、`SUBMIT_RECHARGE` 完成，`POLL_RECHARGE` 12 次后得到失败，又做了 1 次确认查询。
- `recharge_attempt`：`FAILED`，`funds_risk_state=CLEARED`，没有 UNKNOWN 资金风险。
- 本地没有成功付款证据，未执行换卡、重试或第二次扣款。

### 2. ZZSHU 原始状态接口（只读复验）

对外部 `cardKey` 再查得 HTTP 200、业务层成功返回，但订单业务状态为 `failed`，失败详情仍只有“卡片被拒，请换卡后重提”；金额为 `982.14 PHP`。同一接口返回的账号套餐为 `free`，所以这不是已是 Plus 导致的 `40030` 拒绝。

对照历史成功订单 `6294`：同一路由、同一套餐和同一金额结构返回 `success`、`paymentResult.success=true`。本次差异发生在上游支付结果，而不是本地轮询或状态映射。

### 3. HNSKJ 卡 1839（只读复验）

- Provider 卡 ID：`1839`，尾号 `1013`。
- 卡台状态：`active`；余额：`16.00 USD`；卡段：`VISA-40024200`；有效期至 2031-05；卡资料字段完整。
- 交易列表只有一笔 `CARD_RECHARGE 16.00 USD SUCCESS`（发卡入金），**没有 PURCHASE 交易**。
- 因此卡台“active + 余额足够”只证明卡片在卡台侧就绪，不等于其在 ZZSHU/商户侧一定能通过消费；本次没有证据表明卡台已扣到这笔 Plus 款。

## 排除项

1. **不是余额不足**：支付前卡台只读余额为 `$16.00`，达到本订单最低余额 `$16.00`。
2. **不是卡片资料缺失**：HNSKJ 返回完整卡号、CVV、有效期，`card_details` 预检成功。
3. **不是 Session 已是 Plus**：ZZSHU 返回的账号套餐为 `free`；已是 Plus 的拒绝是另一类已验证的 `40030`。
4. **不是本地没提交**：`create_direct` 已成功创建外部订单 8849，后续状态查询得到最终失败。
5. **不是超时/未知结果**：创建和查询均有明确响应，attempt 已安全清账。
6. **不是已扣款后漏记**：HNSKJ 交易没有对应 PURCHASE，ZZSHU `paymentResult.success=false`。

## 当前代码是否有错误

- 订单状态机把本次明确失败收敛为 `RECHARGE_FAILED`，attempt 清除资金风险，并把消费账本保留在 `RECONCILIATION`，不自动换卡或重付；这部分符合资金安全规则。
- 但订单主表 `failure_reason` 当前保存的是通用文案“Recharge provider confirmed failure”；更具体的“卡片被拒，请换卡后重提”只存在于 `recharge_attempts.result_summary_json`，后台详情的 Provider 调用列表也不展示该字段。因而运营界面可能看不到真正的上游拒绝原文。这是**可修的展示/证据透传缺口**，不是导致本次被拒的原因。

## 不能从当前证据得出的结论

不能确认以下任一项：发卡行风控、商户类别限制、跨境/地区限制、BIN 不兼容、CVV/有效期校验失败、3DS 缺失或 ZZSHU 内部路由问题。要得到其中任一项，必须由 ZZSHU 提供更细的 decline code/processor response，或在其后台查看 8849 的支付明细；本轮没有进行任何重试或写操作。

## 后续建议（不自动执行）

1. 暂不再用卡 1839 重试，也不换卡自动重付；保留订单和资金账本现状。
2. 向 ZZSHU 索取订单 8849 的更细拒付字段；若接口始终只返回通用文案，则将“上游明确拒付、底层原因未知”作为最终可证结论。
3. 单独修正后台失败原因透传：在不暴露 PAN/Session 的前提下，把 `result_summary_json.failureReason` 显示为 Provider 原因；这不改变付款或重试策略。

## 用户删除卡后的复核（2026-09-01 15:02 CST）

- HNSKJ 只读复查显示卡 `1839` 已变为 `invalidating`，余额 `$0.01`，卡台列表中仍可见；这与用户“已删除/停用”的操作一致。
- 本地原快照仍是 `active/$16.00`，属于同步滞后。已执行一次**仅本地落库的只读同步**（HNSKJ `GET /cards/1839`，未调用任何写接口），现在本地已更新为 `status=invalidating`、`current_balance=0.010000`，同步时间为 `2026-09-01T07:02:12Z`。
- 本地 `inventory_status` 仍为 `ASSIGNED` 是有意保留的失败订单证据；该卡有订单 `PJV1-412JIT_yfiuBpZeC39_m` 的 ACTIVE assignment，当前不会被资格 SQL 分配。不能为了显示“删除”而直接释放这条 assignment，否则会丢失失败后的资金/卡片关联证据。
