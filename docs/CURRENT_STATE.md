# 当前生产状态｜事实表

每行一个事实，带核对时间与证据方式；变化时改行，不追加段落。旧版快照原文：`docs/archive/2026-09/CURRENT_STATE_snapshot_2026-09-07.md`。

| 项目 | 当前值 | 核对时间（UTC） | 证据方式 |
|---|---|---|---|
| 生产 release | `/opt/pojia/releases/20260908-cancelfix-bad14cc`（commit `bad14cc`，取消释放卡保留 MANUAL_IMPORT 同步等级；含 `bf2f25c` CDK 二次下单修复与 `37ceaff` 付款开关修复） | 2026-09-08 02:3x | `readlink -f /opt/pojia/current`；switch live/ready/admin 均 200 |
| 回滚点 | `/opt/pojia/releases/20260908-pro-0073d45`（再前 `20260908-importwarn-370c7ce`；050 迁移只增行不改结构） | 同上 | 部署记录 |
| 最新数据库备份 | `/var/backups/pojia/pojia-20260907T194041Z.sql.gz.enc`，完整性 OK | 19:40 | `pojia-ops backup/verify`（prepare 阶段） |
| pojia-web | active（19:41 随 release 切换重启，无错误日志） | 19:41 | systemctl / journalctl |
| pojia-worker（API） | inactive（09-06 03:46 UTC 人为停止；09-07 09:28 UTC 短启约 10 秒推进测试单后再次停止） | 09-07 09:29 | systemctl |
| pojia-browser-worker | inactive / disabled | 16:35 | systemctl |
| pojia-card-funding.timer | active | 16:35 | systemctl |
| pojia-card-read-sync.timer | active | 16:35 | systemctl |
| pojia-card-stock-runner.timer | inactive / disabled（旧每分钟自动开卡架构已废弃） | 16:35 | systemctl |
| 健康 | `127.0.0.1:3100` live 200 / ready 200；公网 plus 与 ops 200 | 16:36 | curl |
| 数据库迁移 | `050_pro_products`（09-07 19:16 经 `deploy-release.sh migrate` 两遍应用；生产核对：products 3 个、Browser 路线 3 条接单、Pro 卡台选择 = backup-a、`minimum_required_card_balance:pro_5x/pro_20x` = 16.00） | 09-07 19:16 | schema_migrations / 只读查询 |
| accept_new_orders | true | 13:31 | app_settings |
| dispatch_new_recharges / 模式 | true / AUTOMATIC | 13:31 | app_settings |
| 默认路线 | Browser（`CHATGPT_PLUS_BROWSER_V1` accepts_new_orders=1，API=0） | 13:31 | fulfillment_routes |
| Browser 当前卡台 | 备用卡台 A（`manual_excel` / `backup-a`） | 13:31 | browser_card_source_selections |
| browser_dispatch_enabled | true | 13:31 | app_settings |
| browser_payment_writes_enabled | false | 13:31 | app_settings |
| Browser Profile productionWritesEnabled | false | 13:31 | executor_profiles |
| card_auto_replenishment_enabled | false | 13:31 | app_settings |
| card_balance_recharge_enabled | true | 13:31 | app_settings |
| card_max_successful_payments | 3 | 13:31 | app_settings |
| default_open_card_amount / minimum | 16 / 16（09-07 08:28–09:33 UTC 曾临时 8.00 供演练单分卡；已恢复） | 09:33 | app_settings（经服务层 `setMinimumRequiredCardBalance`） |
| Worker 进程写权限 | worker：`PROVIDER_RECHARGE_WRITES_ENABLED=true`（drop-in），通用/卡片写 false；funding 单元：`PROVIDER_CARD_WRITES_ENABLED=true`；env 文件 `PROVIDER_READS_ENABLED=true` | 16:35 | `systemctl cat` |
| HNSKJ 卡 | `5980` DEPLETED，余额 $0.31（09-07 12:07 UTC 直充扣 $15.69，占用已释放）；其余 5 张 ASSIGNED 于历史订单且 ≤ $0.01；5 张 DEPLETED；HNSKJ 可分配 0 | 09-07 14:42 | cards |
| 备用卡 A | `5501` $8.87（分配给测试单，assignment ACTIVE；演练已释放资金占用）；`0237` $0；门槛恢复 16 后可分配 0 | 09-07 09:40 | cards / card_assignment_history |
| HNSKJ 卡台 | 09-05 起故障；09-07 12:06 UTC 前已恢复（读同步与交易同步成功，`provider_calls` SUCCESS）；开卡/补余额未再验证 | 09-07 14:00 | provider_calls / cards.last_transaction_synced_at |
| 订单总况 | RECHARGE_SUCCESS 2 / RECHARGE_FAILED 8 / CLOSED 10（含 09-07 取消的两单遗留等 Session 单，CDK 已退回）/ CANCELLATION_PENDING 1（API 路线 `PJV1-7EYSr3AZfjVl5JZQwTZt`：09-07 12:07 UTC 误触发直充，14:33 POLL 确认成功，实付 982.14 PHP，账本 CONSUMED；取消续费 RECHECK 待 Worker）/ WAITING_FOR_SESSION 0 | 09-07 14:42 | orders / tasks |
| 活动资金与运行 | ACTIVE/UNKNOWN attempt 0；open run 0；open dispatch 0；RESERVED 账本 0；open lease 0；ISSUED permit 0 | 16:41 | 只读聚合查询 |
| 最近 Browser 运行 | 09-07 09:29–09:35 UTC 测试单演练：run `84686b57…` FAILED_SAFE / RELEASED / `PRE_PAYMENT_ABORT` / `BROWSER_REHEARSAL_STOPPED`；`PAYMENT_SUBMIT=0`、permit 0；报价 PHP 982.14 / 税 0.00；Lane 3 保留填好的结账页 | 09:40 | browser_runs / 本机 live.wal |
| 最近真实单 | `PJV1-RCbAiI0IkGMy-hCBgMSn`：自动化到 Checkout 未填表 → 运营者手工付 Plus + 20X（143.13）→ 09-06 16:40 以「人工付款已完成」收口为 RECHARGE_SUCCESS；`PAYMENT_SUBMIT=0`，证据 `MANUAL_PAYMENT_CONFIRMED` | 16:41 | orders / browser_runs / browser_operations |
| 告警 | OPEN 10：8 条 09-01 起的「卡台余额变化」info 噪音（后台不显示）、1 条 CARD_STOCK_LOW（阈值 0，修复后不再新生成）、1 条 ORDER_WAITING_FOR_CARD；首页已可关闭 | 09-06 13:31 | operator_alerts |
| 本机 | BitBrowser Local API + mihomo（launchd 单实例）；SSH 隧道 13306→3306 由会话后台任务保持（掉线需重拉）；无常驻 Worker 进程（常驻池脚本已备好，未长期运行）；Lane 3 窗口开着并保留演练结账页 | 09-07 12:05 | pgrep / BitBrowser list |
| 已上线（本次 release） | `ae68195`：无卡的等 Session 订单可取消（退回 CDK）。复核：两单遗留订单取消成功、CDK 回 AVAILABLE；Web 200 | 14:42 | 服务层调用结果 |
| 已知未修 | 本机绕过连接池直连写入造成该单 attempt/dispatch/账本 `created_at` 偏后 8 小时；后台控制事务并发时可能 `ER_LOCK_DEADLOCK`（失败关闭，需重试） | 09-07 | HANDOFF_LOG |

## 事实表之外

- 客户页 v2（09-03，`3cef082`）与夜间配色（`eba5331`，`?v=11`）已部署；成功态文案固定为 Plus，产品扩展时需改状态映射。
- 生产使用量为零的功能（三方对账案例、退款观察、灰度许可、CDK 交付记录、订单标签/备注/补发）按基线删除清单处理。
- 备用卡台导入完整快照是供给核心能力，保留；每次导入代表该卡台全部卡片。
