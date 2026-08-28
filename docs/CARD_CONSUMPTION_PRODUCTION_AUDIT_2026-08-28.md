# 生产一卡多充消费账本只读审计（2026-08-28）

## 执行证据

- 生产 release：`/opt/pojia/releases/20260828-card-ledger-43ab997`
- 执行方式：生产服务器本地 Node 脚本，只读连接；Provider 写开关全部强制关闭。
- Web：active；Worker：inactive；`https://ops.vibebridge.top/health/ready` 返回 HTTP 200；`https://plus.vibebridge.top/health/live` 返回 HTTP 200。
- 审计结果：卡片 6 张，差异 1 张，需回填复核 1 张，本地账本复核 0 张。

## 差异记录

- Provider 卡 `493`（尾号 `8590`）：本地 `CONSUMED=0`，Provider `PURCHASE/SUCCESS=1`，交易 ID：`agg_tx_190ywhd2bk93r`；分类：`BACKFILL_REVIEW_REQUIRED`。
- 对卡 `493` 的只读交叉查询：`order_id=NULL`、余额 `$0.010000`、存在完整资料、存在成功 PURCHASE；因此它当前不满足最低余额 `$16`，不会被正常库存资格查询分配。该交易的具体业务订单归属仍需人工从历史 Provider/订单证据确认，不能自动回填。
- 用户补充确认：卡 `493`（尾号 `8590`）于 2026-08-18 用于一个 Plus 充值；因卡台服务器更换，该卡之后永久不可用。此条已记录为用户提供的业务事实；本轮未仅凭口述自动回填账本或直接改生产卡状态。

## 后续只读复核（2026-08-28）

已在当前生产 release 上重新执行只读审计并按 `provider_card_id=493` 查询交易与订单关联：

- 卡当前本地状态仍为 `status=active`、`inventory_status=AVAILABLE`、`order_id=NULL`、余额 `$0.010000`。
- 2026-08-18 21:00:54 有 `card_recharge` 成功 `$16.00`；21:02:08 有 `purchase` 成功，商户 `OPENAI`，金额 `-$15.97`，Provider transaction ID `agg_tx_190ywhd2bk93r`；21:09:30 有余额转出成功 `$0.01`。
- 2026-08-19 13:43:31 另有一笔 OPENAI purchase 失败（金额 `-$78.24`，手续费 `$0.30`）。
- 生产 `orders` 与 `provider_calls` 中未找到能以卡 `493` 或成功交易 ID 直接关联的本地订单主键；现有本地订单记录与该卡仍是断开的。

因此，“该卡曾成功支付一次 Plus”已有 Provider 交易证据支持；“因卡台服务器更换而永久不可用”是已确认的运营事实。两者共同说明该卡永远不应作为可分配卡，但生产状态尚未自动修改。

## 结论与边界

- 发现 1 条 Provider 多于本地账本的历史差异；结合用户补充，该卡的业务用途已明确，但仍缺少本地订单/账本主键证据，**不能仅凭口述自动回填**。
- 本轮未执行任何 INSERT、UPDATE、DELETE；未自动回填、未改变卡状态、未改变订单状态。
- 该差异的下一步是查对应历史订单、Provider 调用和交易证据，确认是否确属本项目 Plus 充值，再决定是否生成一次性回填方案。
