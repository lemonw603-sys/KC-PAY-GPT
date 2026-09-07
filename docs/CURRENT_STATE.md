# 当前生产状态｜事实表

每行一个事实，带核对时间与证据方式；变化时改行，不追加段落。旧版快照原文：`docs/archive/2026-09/CURRENT_STATE_snapshot_2026-09-07.md`。

| 项目 | 当前值 | 核对时间（UTC） | 证据方式 |
|---|---|---|---|
| 生产 release | `/opt/pojia/releases/20260907-admin-daily-b1c32f4`（commit `b1c32f4`，881 文件 manifest OK） | 2026-09-07 00:57 | `readlink -f /opt/pojia/current` |
| 回滚点 | `/opt/pojia/releases/20260907-manual-payment-1699197` | 同上 | 部署记录 |
| 最新数据库备份 | `/var/backups/pojia/pojia-20260907T005617Z.sql.gz.enc`，完整性 OK | 00:56 | `pojia-ops backup/verify` |
| pojia-web | active | 16:35 | systemctl |
| pojia-worker（API） | inactive（09-06 03:46 UTC 人为 SIGTERM，防历史任务抢卡） | 16:35 | systemctl + journal |
| pojia-browser-worker | inactive / disabled | 16:35 | systemctl |
| pojia-card-funding.timer | active | 16:35 | systemctl |
| pojia-card-read-sync.timer | active | 16:35 | systemctl |
| pojia-card-stock-runner.timer | inactive / disabled（旧每分钟自动开卡架构已废弃） | 16:35 | systemctl |
| 健康 | `127.0.0.1:3100` live 200 / ready 200；公网 plus 与 ops 200 | 16:36 | curl |
| 数据库迁移 | `048_manual_backup_card_import` | 13:31 | schema_migrations |
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
| default_open_card_amount / minimum | 16 / 16（全局值，待改为按产品） | 13:31 | app_settings |
| Worker 进程写权限 | worker：`PROVIDER_RECHARGE_WRITES_ENABLED=true`（drop-in），通用/卡片写 false；funding 单元：`PROVIDER_CARD_WRITES_ENABLED=true`；env 文件 `PROVIDER_READS_ENABLED=true` | 16:35 | `systemctl cat` |
| HNSKJ 卡 | `5980` $16 AVAILABLE（唯一可分配）；其余 5 张 ASSIGNED 于历史订单且 ≤ $0.01；5 张 DEPLETED | 13:31 | cards |
| 备用卡 A | `5501` $8.87 DEPLETED（09-06 付款 143.13 后）；`0237` $0 AVAILABLE；可分配 0 | 16:54（快照导入） | cards / manual_card_import_batches |
| HNSKJ 卡台 | 09-05 起返回维护响应（success=false），只读同步 5 分钟退避；开卡与补余额不可用 | 09-06 | HANDOFF_LOG |
| 订单总况 | RECHARGE_SUCCESS 2 / RECHARGE_FAILED 7 / CLOSED 8 / WAITING_FOR_CARD 1（API 路线 `PJV1-7EYSr3AZfjVl5JZQwTZt`，每分钟重试等卡）/ WAITING_FOR_SESSION 2 | 16:40 | orders |
| 活动资金与运行 | ACTIVE/UNKNOWN attempt 0；open run 0；open dispatch 0；RESERVED 账本 0；open lease 0；ISSUED permit 0 | 16:41 | 只读聚合查询 |
| 最近真实单 | `PJV1-RCbAiI0IkGMy-hCBgMSn`：自动化到 Checkout 未填表 → 运营者手工付 Plus + 20X（143.13）→ 09-06 16:40 以「人工付款已完成」收口为 RECHARGE_SUCCESS；`PAYMENT_SUBMIT=0`，证据 `MANUAL_PAYMENT_CONFIRMED` | 16:41 | orders / browser_runs / browser_operations |
| 告警 | OPEN 10：8 条 09-01 起的「卡台余额变化」info 噪音（后台不显示）、1 条 CARD_STOCK_LOW（阈值 0，修复后不再新生成）、1 条 ORDER_WAITING_FOR_CARD；首页已可关闭 | 09-06 13:31 | operator_alerts |
| 本机 | BitBrowser Local API + mihomo（launchd 单实例）；SSH 隧道 13306→3306 常驻；LIVE Worker 无常驻进程 | 13:40 | pgrep |
| 已上线（本次 release） | `45f953c` 备用卡导入不再因 SETTLED 冻结卡片；`96008d4` 后台小修（CDK 免密码/不清空、告警可关、阈值 0 不告警、藏死控件、`admin.js?v=24`）。公网复核：alerts/close 未登录 401、前端无 10 分钟清空、CDK 不走密码 | 00:58 | curl + 生产文件 grep |
| 已知未修 | 本机绕过连接池直连写入造成该单 attempt/dispatch/账本 `created_at` 偏后 8 小时；后台控制事务并发时可能 `ER_LOCK_DEADLOCK`（失败关闭，需重试） | 09-07 | HANDOFF_LOG |

## 事实表之外

- 客户页 v2（09-03，`3cef082`）与夜间配色（`eba5331`，`?v=11`）已部署；成功态文案固定为 Plus，产品扩展时需改状态映射。
- 生产使用量为零的功能（三方对账案例、退款观察、灰度许可、CDK 交付记录、订单标签/备注/补发）按基线删除清单处理。
- 备用卡台导入完整快照是供给核心能力，保留；每次导入代表该卡台全部卡片。
