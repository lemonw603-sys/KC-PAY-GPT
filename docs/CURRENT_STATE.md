# 当前生产状态｜事实表

每行一个事实，带核对时间与证据方式；变化时改行，不追加段落。旧版快照原文：`docs/archive/2026-09/CURRENT_STATE_snapshot_2026-09-07.md`。

| 项目 | 当前值 | 核对时间（UTC） | 证据方式 |
|---|---|---|---|
| 生产 release | `/opt/pojia/releases/20260909-askform-cc3bba0`（commit `cc3bba0`，后台 askForm 对话框 + 「已在账号里取消续费」收口动作/路由 + 开卡补钱「关闭」按钮；无新迁移；回滚点 `20260908-cancelfix-bad14cc`） | 2026-09-09 06:3x UTC | `readlink -f /opt/pojia/current`；switch live/ready/admin 均 200；公网复验见 HANDOFF |
| 回滚点 | `/opt/pojia/releases/20260908-cancelfix-bad14cc`（再前 `20260908-cdkreuse-bf2f25c`；本版无迁移，直接切回即可） | 2026-09-09 06:3x UTC | 部署记录（switch 输出 ROLLBACK 命令） |
| 最新数据库备份 | `/var/backups/pojia/pojia-20260909T063405Z.sql.gz.enc`，完整性 OK（release prepare 阶段） | 2026-09-09 06:34 UTC | deploy-release prepare 输出 |
| pojia-web | active（09-09 06:34 UTC 随 release 切换重启；5 分钟内无错误日志） | 2026-09-09 11:46 UTC | systemctl / journalctl |
| pojia-worker（v1 任务 Worker） | active（处理 ASSIGN_CARD/PREPARE/SUBMIT_RECHARGE/POLL 等；Browser 路线的 BROWSER_PREFLIGHT 与付款由本机 worker 跑） | 2026-09-09 11:46 UTC | systemctl |
| pojia-browser-worker | inactive / disabled（Browser 执行在本机，来单人工拉） | 2026-09-09 11:46 UTC | systemctl |
| pojia-card-funding.timer | active | 2026-09-09 11:46 UTC | systemctl |
| pojia-card-read-sync.timer | active | 2026-09-09 11:46 UTC | systemctl |
| pojia-card-stock-runner.timer | inactive / disabled（旧每分钟自动开卡架构已废弃） | 2026-09-09 11:46 UTC | systemctl |
| 健康 | `127.0.0.1:3100` live 200 / ready 200；后台登录页 200（ADMIN_HOST） | 2026-09-09 06:35 UTC | curl（服务器本机） |
| 数据库迁移 | 最新 `051_orders_cdk_id_reusable`（09-08 01:25 UTC 应用；050 于 09-07 19:16 UTC）；仓库最新亦为 051，无待应用迁移 | 2026-09-09 11:46 UTC | schema_migrations / 仓库 v1/migrations |
| accept_new_orders | true | 2026-09-09 11:46 UTC | app_settings |
| dispatch_new_recharges / 模式 | true / AUTOMATIC | 2026-09-09 11:46 UTC | app_settings |
| 默认路线 | Browser（`CHATGPT_PLUS_BROWSER_V1`/`PRO_5X`/`PRO_20X` accepts_new_orders=1，旧 API 路线=0） | 2026-09-09 11:46 UTC | fulfillment_routes |
| Browser 当前卡台 | 备用卡台 A（`manual_excel` / `backup-a`） | 13:31 | browser_card_source_selections |
| browser_dispatch_enabled | true | 2026-09-09 11:46 UTC | app_settings |
| browser_payment_writes_enabled | **false**（09-09 为 rehearsal/预检关闭并带审计；真单来时 `go-live.sh --arm` 开回） | 09-09 | app_settings / admin_setting_events |
| Browser Profile productionWritesEnabled | false（随付款开关同步） | 09-09 | executor_profiles config_public_json |
| card_auto_replenishment_enabled | false（与补余额构成首页「开卡补钱」的"部分开启"态） | 2026-09-09 11:46 UTC | app_settings |
| card_balance_recharge_enabled | true（对手动卡无效） | 2026-09-09 11:46 UTC | app_settings |
| card_max_successful_payments | 3 | 2026-09-09 11:46 UTC | app_settings |
| 最低所需卡余额 | default 16 / pro_5x 16 / **pro_20x 150**（09-09 05:33 UTC 调，独立核实；5X 上线前同调） | 2026-09-09 11:46 UTC | app_settings（`minimum_required_card_balance:*`）+ admin_setting_events |
| Worker 进程写权限 | worker：`PROVIDER_RECHARGE_WRITES_ENABLED=true`（drop-in），通用/卡片写 false；funding 单元：`PROVIDER_CARD_WRITES_ENABLED=true`；env 文件 `PROVIDER_READS_ENABLED=true` | 16:35 | `systemctl cat` |
| HNSKJ 卡 | `5980` DEPLETED，余额 $0.31（09-07 12:07 UTC 直充扣 $15.69，占用已释放）；其余 5 张 ASSIGNED 于历史订单且 ≤ $0.01；5 张 DEPLETED；HNSKJ 可分配 0 | 09-07 14:42 | cards |
| 备用卡（manual_excel） | 可分配仅 `7402` $49（09-08 导入，NORMAL/AVAILABLE）。5 张手动测试卡 `0601/2911/7428/5501/0237` 已打 `RETIRED` override（拒付未付成/耗尽/余额已提现回卡台，09-08 清理收尾），退出分配池 | 09-08 晚 | cards / card_operational_overrides |
| 可分配卡（资格 SQL，Plus 门槛 16） | **1 张**（7402）。非终态订单 0，无占卡单 | 2026-09-09 11:46 UTC | `ready-check.sh` 同口径查询 |
| HNSKJ 卡台 | 09-05 起故障；09-07 12:06 UTC 前已恢复（读同步与交易同步成功，`provider_calls` SUCCESS）；开卡/补余额未再验证 | 09-07 14:00 | provider_calls / cards.last_transaction_synced_at |
| 订单总况 | RECHARGE_SUCCESS 4 / RECHARGE_FAILED 15 / CLOSED 12 / CANCELLATION_REVIEW_REQUIRED 1（`PJV1-7EYSr3AZfjVl5JZQwTZt`：已付 Plus 982.14 PHP，取消续费复核待处理）/ WAITING_FOR_SESSION 0。失败数上升系 09-08 大量 Browser 测试单（付款前 drift/declined，均未扣款、CDK 退回、卡释放）；attempt funds_risk 全 CLEARED/SETTLED，无 ACTIVE/UNKNOWN | 09-08 晚 | orders / recharge_attempts |
| 活动资金与运行 | ACTIVE/UNKNOWN attempt 0；open run 0；账号槽 active_runs 0；RESERVED 账本 0；dispatch QUEUED/CLAIMED 0；ACTIVE 卡分配 0；`cards.inventory_status=ASSIGNED` 0（09-09 13:10 UTC 用 `close-stale-residue.mjs` 清掉终态单上残留的 5 条 job / 6 条分配，order_events 审计 10 条，消费账本未动） | 2026-09-09 13:12 UTC | 只读聚合查询（写后新连接独立核实） |
| 最近 Browser 运行 | 09-09 04:2x UTC rehearsal `PJV1-zLUtyjBjxrYnQsLeTpBN`（free 账号 e4938aca，Lane4）：preflight COMPLETED → `PRE_SUBMIT_STOPPED/BROWSER_REHEARSAL_STOPPED`，报价 PHP 982.14 / 税 0.00，run payment_state NOT_STARTED、PAYMENT_SUBMIT 0；随后以 `close-rehearsal-order.mjs` 收口 CLOSED 释放卡 | 2026-09-09 11:46 UTC | browser_runs / order_events |
| Browser 自动化里程碑 | 生产**全自动真实付款 0 次**；付款前全自动链路 rehearsal 2 次通过（09-07、09-09）；付款后同一浏览器登录态存活已验证（D-136）；下一笔真单即闭环验证 | 2026-09-09 11:46 UTC | UNVERIFIED_LEDGER / HANDOFF_LOG |
| 最近真实单 | API 路线 `PJV1-7EYSr3AZfjVl5JZQwTZt`（09-07 付 Plus 982.14 PHP，卡 5980；取消续费供应商未确认→09-09 07:06 UTC 用户经后台「已在账号里取消续费」收口 RECHARGE_SUCCESS）；Browser 路线 `PJV1-_VjINYXkOLLdiBrjpSZo`（09-08 stage1 付 Plus 卡 5501，SUBMIT_UNKNOWN 后手动核对为成功，20X 未付，account e4938aca 现为 free）；用户手动两阶段 wozaijiaoju1649（09-08 卡 0601：Plus $15.72 + 20X $127.01，系统外） | 2026-09-09 11:46 UTC | orders / order_events / 用户卡台后台 |
| 告警 | OPEN 16：PROVIDER_BALANCE_CHANGED 11（info 噪音，后台不显示）、BROWSER_ORDER_FAILED 4（09-08 测试单付款前失败）、CARD_STOCK_LOW 1 | 2026-09-09 11:46 UTC | operator_alerts |
| 本机 | BitBrowser Local API（`ready-check.sh` 发现未开会自动启动）+ mihomo（launchd `com.pojia.mihomo-ph` KeepAlive，出口锁菲律宾 38.60.246.34）；SSH 隧道 13306→3306 由 launchd `com.pojia.ssh-tunnel-13306` 守护；无常驻 Worker（来单 `go-live.sh --arm` 拉、`stop-live.sh` 收）；Lane4 clean 窗口 `51e915e` 为付款/演练身份 | 09-09 | launchctl / lsof / curl |
| 已上线（本次 release） | `20260909-askform-cc3bba0`：后台全部连环 prompt → askForm 对话框；「已在账号里取消续费」动作与路由 `/orders/:publicNo/cancellation-confirmed`；开卡补钱「关闭」按钮。复验：新资源版本已服务、新路由未登录 401、登录页 200 | 2026-09-09 06:35 UTC | 服务器本机 curl + ADMIN_HOST |
| 已知未修 | ①本机绕过连接池直连写入曾造成某单 attempt/dispatch/账本 `created_at` 偏后 8 小时（09-07），09-08 的手工 SQL 收口还留下了终态单残留（09-09 已清，见上；规则已固化：写库只走正式路径）；②后台控制事务并发时可能 `ER_LOCK_DEADLOCK`（失败关闭，需重试）；③手动卡付款后无独立卡侧扣款证据（对账恒匹配，靠 Plus 确认） | 2026-09-09 13:12 UTC | 本表 + HANDOFF_LOG |

## 事实表之外

- 客户页 v2（09-03，`3cef082`）与夜间配色（`eba5331`，`?v=11`）已部署；成功态文案固定为 Plus，产品扩展时需改状态映射。
- 生产使用量为零的功能（三方对账案例、退款观察、灰度许可、CDK 交付记录、订单标签/备注/补发）按基线删除清单处理。
- 备用卡台导入完整快照是供给核心能力，保留；每次导入代表该卡台全部卡片。
