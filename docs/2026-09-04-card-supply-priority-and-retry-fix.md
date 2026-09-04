# 自动补余额与自动开卡优先级收口（2026-09-04）

## 当轮实时事实

- 生产 release：`/opt/pojia/releases/20260904-card-availability-a8bd7e6-real`。
- 运营后台实时 API：Plus 可分配 1 张（`2772/9051`），`active/AVAILABLE/READY`，余额 `$16`；自动开卡和自动补余额均为 true，开放提醒 0。
- stock/funding/reconcile timer 分别为 60/5/15 秒，均 active/enabled；各自 service 最近退出码为 0。
- 卡台实时余额 `$18.84`，卡段合同返回 `requireMinBalance=1/minBalanceUsdt=25`。这是 Provider 的开卡前条件，不是本地“开卡后保留余额”设置，不能安全改写为 `$18`。

## 本轮修正

1. 自动开卡 scheduler 在付费排任务前再查一次合格低余额卡；只要存在可补卡，就返回 `FUNDABLE_CARD_EXISTS`，不与补余额链路抢跑开新卡。
2. 多张可补卡时选择当前余额最高的卡，只补最小差额，避免原来按最低余额卡优先造成额外资金占用。
3. Worker 使用 repository 实际返回的 `replenishmentPending`，自动开卡进行中订单按 5 秒快速重试，不再因字段错配退化为 60 秒。

## 验证

- 定向单元测试：45/45 通过。
- 全量无生产数据库回归：522 total / 478 passed / 44 environment-skipped / 0 failed。
- 全新临时 MySQL 8.4 + 完整 migrations：本轮两个关键场景 2/2 通过：
  - 多张低余额卡选最小补款差额；
  - 存在可补卡时禁止自动开新卡。
- 同一全新隔离 MySQL 的完整集成文件另有 1 个旧用例文案期望偏差（`PREPARING` vs `PROCESSING`），与本轮补给状态机无关；上述新增关键场景已单独在全新库通过。

## 尚未冒充完成的边界

- 本轮未开卡、未补余额、未付款。
- 真实低余额卡“唯一补差额→到账→原订单继续”仍待首笔生产验收。
- 只有 Provider 自身将 `minBalanceUsdt` 改为 18，或切换到实测允许该阈值的卡段/账户，系统才能按 18 执行。
