# 第二单真实 API 全链路验证（2026-08-29）

## 结果

- 订单查询码：`PJV1-uVsqgepiEHu3tfpQKQq-`
- 客户邮箱：`exkk3390@gmail.com`
- 产品：ChatGPT Plus
- 使用卡片：Provider 卡 `1628`，尾号 `6185`
- 直充订单号：`7025`
- 最终订单状态：`RECHARGE_SUCCESS`
- 平台结算金额：`982.140000 PHP`
- Plus 开通后已确认取消自动续费：`subscription_cancelled=1`
- 充值 attempt：`SUCCESS / SETTLED`

本单从客户 CDK + Session 提交开始，经过卡片分配、付款前准备、单笔 Permit、API 创建、状态轮询、成功确认和取消续费复核，完成了第二次真实端到端闭环。

## 资金与门禁证据

- 真实创建前：订单无 recharge attempt、无 ZZSHU 创建调用、无资金风险。
- 用户当次明确允许后，签发 5 分钟单笔 Permit，并只为本次灰度临时启用 ZZSHU 账户写权限和 recharge-specific Worker 写开关。
- `create_direct` 只出现 1 次并成功，外部订单号为 `7025`。
- 完成后：Provider 账户 `write_enabled=0`，单笔 Permit 已撤销；常驻 Worker 的三类 Provider 写开关仍为 false。
- 最终 readiness：`ok=true`；活动任务、UNKNOWN Provider 调用、活动/未知资金风险、开放对账案件均为 0。
- 接单和自动派发维持用户此前手动开启的状态，不因本单清理而关闭。

## 卡片交易证据边界

- 卡台已读到本次 `PURCHASE 15.760000 USD`，交易 ID `agg_tx_3eskrt48lubis`。
- 05:59 UTC 再次只读同步后，卡片余额已从 `$16.00` 变为 `$0.24`，与 `15.76 USD` 的消费金额一致；07:16 UTC 又完成一次仅针对卡 `1628/6185` 的低频只读同步，任务 `COMPLETED`，交易仍为 `PROCESSING / UNSETTLED`，余额仍为 `$0.24`。资金扣减已经有独立余额证据，但交易最终状态仍待后续只读补证。
- 订单、Plus 开通和取消续费已由充值 Provider 明确确认成功；卡台 PURCHASE 的最终状态仍由后续只读同步补证，不触发重付。

## 本单发现并修复的缺陷（已部署）

订单最初短暂进入 `WAITING_FOR_CARD`，原因不是没卡：卡 `6185` 有 `$16`、资料完整且未使用，但分配规则要求交易证据 15 分钟内新鲜，而全量定时同步默认按 60 分钟到期，形成时间窗口不一致。

主线已做低调用量修复：

- 不把全卡目录改成高频轮询；
- 只有真实订单等待且存在安全但过期的候选卡时，按需排入 1 张卡的只读余额/交易同步；
- 同步完成后，原 `ASSIGN_CARD` 任务按已有重试机制继续；
- 过期数据仍不能直接用于分配或付款。

主线回归：466 total / 429 pass / 0 fail / 37 environment-skipped。用户确认后，从生产基线制作仅含该修复的安全提交 `bba4105`，独立 release 为 `/opt/pojia/releases/20260829-order-demand-sync-bba4105`；安全分支回归 464 total / 427 pass / 0 fail / 37 environment-skipped。

后续已补真实数据库回归：在全新临时 MySQL 8.4、完整 migration 001–040 上，新增用例证明过期安全候选卡第一次只排入一个 `PENDING / requested_by=worker` 只读同步任务、订单进入 `WAITING_FOR_CARD`、第二次调度不会重复排队、卡片不会被提前绑定且不会产生 Provider 调用；完整 `mysql-integration.test.js` 34/34 通过。当前 v1 无数据库环境全量回归为 467 total / 429 pass / 0 fail / 38 environment-skipped。

部署前备份 `/var/backups/pojia/pojia-20260829T060414Z.sql.gz.enc` 完整性通过。部署后 Web、Worker、卡片只读/目录同步和 Bark 服务正常，ops/plus 四个 live/ready 端点均 HTTP 200；readiness `ok=true`，所有 Provider 写开关保持 false。
