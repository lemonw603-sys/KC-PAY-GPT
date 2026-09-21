# 同账户钱包提醒覆盖（D-338）

2026-09-21 UTC+8。**本地完成、未发布，真实手机请求0。** 只合并已经证实重叠的一组，不做几分钟内全部静音或跨账户猜测。

## 依据

D-336/337用户已定：余额逐笔继续、正常动态少打扰、需要介入才响、以邮箱定位；本轮用户同意继续推进合并。通知层无界面原型变化，后台沿原工作台C/卡片A。

card-supply-scheduler-service.js同一次scheduleFor计算walletPreflight后，可能先生成PROVIDER_WALLET_LOW、再生成CARD_SUPPLY_WALLET_LOW，两个key都包含同一opener.id，属于同一个钱包需要补充的操作。

14:24:23.143 UTC原始只读查询：

```sql
SELECT alert_type,dedupe_key,status,created_at,updated_at FROM operator_alerts
WHERE alert_type IN ('CARD_SUPPLY_WALLET_LOW','PROVIDER_WALLET_LOW','PROVIDER_TOKEN_EXPIRED','PROVIDER_SNAPSHOT_STALE')
ORDER BY alert_type;
```

```text
CARD_SUPPLY_WALLET_LOW card-supply-wallet-low:00000000-0000-4000-8000-000000000103 OPEN updated09-18 06:54:57.687 UTC
PROVIDER_WALLET_LOW provider-wallet-low:00000000-0000-4000-8000-000000000103 OPEN updated09-18 06:54:57.642 UTC
PROVIDER_TOKEN_EXPIRED provider-token-expired:00000000-0000-4000-8000-000000000103 OPEN
PROVIDER_SNAPSHOT_STALE provider-snapshot:hnskj RESOLVED
```

前两条同账户可以覆盖；后两条不同卡台，不能合并。operator-watch的付款停滞查询本身排除HUMAN_REQUIRED，并等待额外时间，不能把所有停滞与人工异常再统一吞掉。

## 规则及影响面

只在alert-notification-repository.claimNext增加过滤，不改变告警生成/状态或金额判断：

- 轻提醒必须是PROVIDER_WALLET_LOW，且key符合既有UUID账户格式。
- 重提醒必须是同账户CARD_SUPPLY_WALLET_LOW、仍OPEN，updated_at不早于轻提醒。
- 重提醒在当前白名单内，其BARK通知轮次与alert轮次一致，且状态为PENDING/SENDING/SENT，才覆盖较轻提醒。
- RETRY/DEAD/CANCELLED、未有当前轮次通知、重提醒已关闭或较老、不同账户/未知key均不覆盖。
- 轻提醒不标已发、不删除、不假设钱包恢复；后台保留OPEN，outbox保留PENDING。若重提醒解决而低余额仍在，它重新有资格发一次。正常入队机制会处理恢复/复发及事故轮次。
- 只读关联子查询，不把provider_accounts/orders/card/payment表加入领取锁。原邮箱查询继续在commit后进行，关键通知不因邮箱读取失败而丢失。

不新增表/索引/开关/时间窗口/常驻服务；余额变化与拒付永远不进入该覆盖分支。主提醒已在手机送达但服务端投递失败时可能仍触发兜底，这是保守防漏，不保证网络异常下“绝对只响一次”。较轻提醒先发、较重提醒后来才产生时也不能撤回前一条，后者是升级而非可事后消除的重复。

## 验证

- 18项真实本地MySQL检查通过，原7项通知/邮箱/事件去重回归保留，新增同账户覆盖、不同账户独立、余额变化保留、拒付保留、恢复后轻提醒、RETRY/DEAD兜底、旧轮次不覆盖、未知key不覆盖、旧观察不盖新预警、双领取进程并发。实际Bark请求0，临时库bark_copy_a020b346清理。日志coverage-mysql-tests.txt。
- 默认1077 tests / 1008 pass / 0 fail / 69 skipped，见coverage-full-tests.txt；未提供数据库的既有测试仍按skip标注，不算通过。
- 从真实repository构造SQL后，对生产只读执行EXPLAIN（剔除FOR UPDATE，不领取、不写库）：两个新增关联均eq_ref，分别用uq_operator_alert_dedupe与uq_alert_notification_channel，估计各1行；保留原外层排序。证据coverage-explain.txt。它证明当前schema可用/索引路径，不是未来任意规模的性能保证。
- [MySQL 8.4官方说明](https://dev.mysql.com/doc/refman/8.4/en/innodb-locking-reads.html)：外层锁定查询不自动锁住无锁定子句的嵌套查询；本轮另用真实双领取检查而不是仅凭文档放行。

## 完成与剩余

已完成这组明确重叠的本地规则与验证。其他类型没有可靠同因证据的不合并，不为覆盖数量引入复杂事件聚合。Bark新版仍未部署/真机验收，A/B整体未结束；23:20highvcc闲置复测标签未访问。下一步按主规划处理其余业务裁定和统一发布前验收，不自动启动发布。
