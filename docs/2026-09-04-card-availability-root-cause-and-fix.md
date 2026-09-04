# 新卡不可分配与缺卡误报｜根因、修复与验证（2026-09-04）

## 结论

生产并非没有卡。Provider 卡 `2772`（尾号 `9051`）为 `active`、余额 `$16.00`，但失败订单留下的消费账本和活动绑定没有自动释放，导致库存资格查询把它排除，后台显示“Plus 可分配 0”。同一错误投影又触发“订单正在等待卡片”。此外，订单重试路径绕过自动补卡调度器直接反复创建开卡任务，今天产生 24 个请求记录，但实际只成功开出 1 张卡，后台错误显示为“24/5”。

## 生产原始证据

- 内部订单：`b0770450-b367-4364-b884-9cdce0150441`；外部充值单 `9414`；状态 `RECHARGE_FAILED/PROVIDER_CONFIRMED_FAILURE`。
- Provider 最终结果：`paymentResult.success=false`，失败原文“验证策略失败，请稍后重试”，金额 `982.14 PHP`。
- recharge attempt：`FAILED/CLEARED`。
- 卡 `2772`：`active`，余额 `$16.000000`；两次同步均只有 `CARD_RECHARGE 16 USD SUCCESS`，没有 `PURCHASE`。
- 卡消费账本仍为 `RECONCILIATION`，assignment 仍为 `ACTIVE`，这是 `available=0` 的直接阻断条件。
- 今日 `card_stock_jobs` 共出现 24 个 automatic requested row，前 23 个均 `opened_count=0`，最后 1 个 `COMPLETED/opened_count=1`。因此真实开卡使用量是 1，不是 24。

## 代码根因

1. `commitRechargeFailure()` 将失败后的消费账本保守地置为 `RECONCILIATION`，但没有触发并消费“卡交易无扣款”这一第二证据来结束占用。
2. `assignAvailableCard()` 在每次订单重试时直接插入 automatic stock job，只排除 PENDING/RUNNING；前一任务安全预检失败成为 REVIEW_REQUIRED 后，下一次重试又创建新任务，绕过 scheduler 的规则、余额、日限额入口。
3. 自动补卡/只读同步正在自愈时仍创建 `ORDER_WAITING_FOR_CARD`，把“系统正在自动处理”当成“需要人工介入”。
4. 日用量统计累加所有 `requested_count`，包括开卡前安全失败且 `opened_count=0` 的任务。

## 最小修复

- Provider 确认失败后立即排入一次卡片交易只读同步。
- 仅在以下条件同时满足时自动释放账本和 assignment：订单为 Provider 明确失败、attempt 为 `FAILED/CLEARED`、同步晚于 attempt 完成、卡余额仍覆盖保留金额、同步后不存在成功 PURCHASE。任一条件不满足继续保留 `RECONCILIATION`。
- `WAITING_FOR_CARD` 成为唯一持久化需求触发；只有 stock scheduler 能在实时规则、余额、目录和日限额核对后创建付费开卡任务。订单每次重试不再直插任务。
- 开卡前的确定性预检失败且 `opened_count=0` 记为 `FAILED`，允许条件恢复后重新调度；部分开卡或结果不明仍为 `REVIEW_REQUIRED`。
- 自动自愈期间不推送缺卡 Bark；只有自动补卡实际未完成时创建一个按订单去重的提醒。
- 日用量改为：PENDING/RUNNING 计预留 requested；终态计真实 opened。历史 24 条会投影为真实使用 1。

## 验证

- 定向单元测试：14/14 通过。
- 隔离 MySQL 关键场景：5/5 通过，包括失败卡证据释放、库存按需同步、补余额、日限额、自动补卡。
- v1 全套：521 项；477 通过，44 跳过，0 失败。
- 隔离 MySQL 额外全文件运行出现两个与本修复无关的旧夹具污染失败；本修复相关命名场景在同一数据库全部通过。

## 部署与历史收敛

当前为代码候选，尚未部署。部署后需对卡 `2772` 发起一次只读同步；新逻辑会在事务内自动释放其错误占用。随后复核：available=1、active assignment=0、ledger=RELEASED、今日自动补卡使用量=1、无重复缺卡 Bark。该动作不付款、不充值、不新开卡。
