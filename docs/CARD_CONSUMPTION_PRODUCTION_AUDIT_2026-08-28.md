# 生产一卡多充消费账本只读审计（2026-08-28）

## 执行证据

- 生产 release：`/opt/pojia/releases/20260828-card-ledger-43ab997`
- 执行方式：生产服务器本地 Node 脚本，只读连接；Provider 写开关全部强制关闭。
- Web：active；Worker：inactive；`https://ops.vibebridge.top/health/ready` 返回 HTTP 200；`https://plus.vibebridge.top/health/live` 返回 HTTP 200。
- 审计结果：卡片 6 张，差异 1 张，需回填复核 1 张，本地账本复核 0 张。

## 差异记录

- Provider 卡 `493`（尾号 `8590`）：本地 `CONSUMED=0`，Provider `PURCHASE/SUCCESS=1`，交易 ID：`agg_tx_190ywhd2bk93r`；分类：`BACKFILL_REVIEW_REQUIRED`。

## 结论与边界

- 发现 1 条 Provider 多于本地账本的历史差异，**只代表需要人工核对，不代表已确认应回填**。
- 本轮未执行任何 INSERT、UPDATE、DELETE；未自动回填、未改变卡状态、未改变订单状态。
- 该差异的下一步是查对应历史订单、Provider 调用和交易证据，确认是否确属本项目 Plus 充值，再决定是否生成一次性回填方案。
