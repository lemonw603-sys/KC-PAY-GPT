# 7 笔续费待核专项审计

2026-09-22（UTC+8）。本轮仅生产只读核查和落盘：**没有进入客户账号、没有点取消续费、没有调用后台确认接口、没有补账或清提醒**。

## 依据清单

- 决策：D-248 定“充值成功但取消续费未确认”不能卡住客户交付，但必须提醒并收口；D-309 定这是订单续费义务，应在工作台队列处理，不是通过删卡或关掉提醒解决。
- 原型：本步不改 UI，不涉及新原型。已发布的工作台 C 版“待复核续费”队列保持不变。
- 生产查询：[`audit.sql`](audit.sql)，脱敏原始输出见 [`raw.tsv`](raw.tsv)；2026-09-21 16:30:15.748 UTC 执行。当时 release 及三个服务现场见 [`runtime.txt`](runtime.txt)。
- 正式收口实现：`v1/src/services/manual-cancellation-service.js:18-68`；只允许已成功且续费待核的订单，写入 `subscription_cancelled=1`、清除待核并追加审计事件，不会再付款。

## 已验证事实

生产当场仍是 **7 笔**，全部为 `RECHARGE_SUCCESS + cancellation_review_required=1`；7 笔的 `subscription_cancelled` 和 `cancellation_checked_at` 均为 NULL。每笔都有 `close-manually-fulfilled` 事件，但没有 `manualCancellation` 事件、没有 Browser `CANCELLATION_CONFIRMED`记录，也没有 `ORDER_CANCELLATION_UNCONFIRMED` 告警行。最后一点只说明这批历史单没生成该类型的告警行，**不能推导为续费已关**；工作台待办由订单字段派生。

| 订单 | 账号 | 系统内付款执行 | 消费账本 / 关联流水 | 续费证据 |
|---|---|---|---|---|
| PJV1-VHl_hgWctg78JwDajOVR | 18***@qq.com | 无 attempt/run | CONSUMED 16 / PURCHASE 15.75 USD | 无 |
| PJV1-DqcnqHF0tPlxDhygTtAA | sh***@gmail.com | 无 attempt/run | RELEASED 16 / 无关联流水 | 无 |
| PJV1-pom5NfWiskFl9u4Aspdm | qi***@gmail.com | 3 次付款前安全中止，SESSION_INVALID | CONSUMED 16 / PURCHASE 15.75 USD | 无 |
| PJV1-NnL3DWl9sCCHWsT2krMy | 81***@qq.com | 1 次付款前安全中止，CHECKOUT_DRIFT | CONSUMED 16 / PURCHASE 15.75 USD | 无 |
| PJV1-BUGAhkA9dYVdLiD6WQac | ch***@gmail.com | 1 次付款前安全中止，ACCOUNT_STATUS_UNKNOWN | CONSUMED 16 / PURCHASE 15.75 USD | 无 |
| PJV1-G3Ni4WrwJERVUOg5tl3x | w1***@gmail.com | 1 次付款前安全中止，CHECKOUT_DRIFT | CONSUMED 16 / PURCHASE 15.75 USD | 无 |
| PJV1-zdprG5vkLzo7UKs8XEe1 | 17***@qq.com | 1 次付款前安全中止，CHECKOUT_DRIFT | CONSUMED 16 / PURCHASE 15.75 USD | 无 |

有 Browser run 的 5 笔全部是 `FAILED_SAFE + PRE_PAYMENT_ABORT`，`PAYMENT_SUBMIT` 均为 0；另 2 笔没有正式 attempt/run。因此，系统没有在这 7 笔上执行过可以产生“已取消续费”证据的付款后流程。

6 笔已有 `CONSUMED 16 USD` 及一笔关联 `PURCHASE COMPLETE 15.75 USD`。`PJV1-DqcnqHF0tPlxDhygTtAA` 仍只有 `RELEASED 16 USD`，无关联卡台流水，与 D-256 既有结论一致；本轮没有出现能支持补账的新证据。

## 业务判断与建议

1. 这 7 笔不是可以按年龄清掉的“历史垃圾”。未确认关闭自动续费时，客户账号下个周期可能再向我方卡片扣款。
2. 不建议为这 7 笔新做自动化或新页面。数量小、又是历史一次性尾巴；复用现有正式后台入口逐笔收口，对系统最简单、最稳定。
3. 正确顺序是：进入对应 ChatGPT 账号 → 现场看订阅是否会续费 → 若会续费则关闭 → 看到“已取消/到期不续费”的页面事实 → 再点现有后台“已在账号里取消续费”。若无法登录或页面事实不清楚，该笔继续保留待核，不猜测收口。
4. `PJV1-DqcnqHF0tPlxDhygTtAA` 的账本缺口与续费是两件事。取消续费确认后可以先收续费待办；消费账本仍保留“证据不足、不补”。

## Lemon 后续裁定：不进账号，由销卡阻断续费

Lemon 明确“不用处理，我会销卡”，覆盖本报告原先建议的逐账号取消方案。不再进入7个客户账号，不使用“已在账号里取消续费”按钮；业务风险通过卡台销卡阻断后续扣款。

22:36:10.513 UTC只读查与7笔关联的4张卡，证据见[`card-audit.sql`](card-audit.sql)→[`card-audit.tsv`](card-audit.tsv)：1657/3159/7402仍为AVAILABLE、5371已RETIRED且source_present=0；4张均无活动assignment、非终态订单或未结退款案例。这支持“销卡不会打断当前订单/退款处理”，不代表卡台销卡已实际完成。

销卡后还需将卡的系统状态登记为RETIRED，否则1657/3159/7402会继续显示旧的AVAILABLE。现有`card-retirement-service.confirmRetired`只收卡状态，**不会清除订单的`cancellation_review_required`**；现有人工续费按钮会写`subscription_cancelled=1`，不能用来冒充销卡。因此在Lemon确认卡台销卡完成前，7笔待办和3张未退役卡都保留；后续只做销卡结果核实和如实登记，不重开账号取消方案。
