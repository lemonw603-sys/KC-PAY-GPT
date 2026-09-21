# 第⑥步整体发布前只读核对

核对时间：2026-09-21 01:55～02:01 UTC（09:55～10:01 UTC+8）。本地候选代码7efa926。用户同意继续生产只读核对与发布准备；未授权或执行生产迁移/发布/开关修改。

## 范围与结论

范围是第⑥步四页整体上线（工作台/CDK/卡片/设置）及共同运行依赖，不是只查CDK。CDK有专项实现、数据库、UI与用户试用；其他三页已有基础联动、异常展示及部分视觉契约，不是每一个资金按钮和全部业务场景都重新验过。详细本地覆盖见联合验收报告。

线上版本及关键开关与文档大体一致；进程PID/重启次数、最近备份、服务器启动时间已变化，state-check的“一致”不能覆盖这些未比对字段。当前没有非终态订单或活动Browser账号槽。**尚不能直接执行057：迁移账户只有库级ALL，binlog开启且trust_function_creators=0，创建触发器的额外权限门槛未处理。**

## 原始查询与输出

SSH只读：readlink -f /opt/pojia/current；systemctl show各单元的ActiveState/MainPID/NRestarts；/proc/<pid>/cwd；curl本机ready。

```text
2026-09-21T01:55:55Z
/opt/pojia/releases/20260918-step5b-b0a36d4
pojia-web: active / PID3053 / NRestarts2
pojia-worker: active / PID2035 / NRestarts0
pojia-bark-notifications: active / PID3105 / NRestarts9
三者cwd均为上述release/v1
{"status":"ready"} HTTP=200
uptime -s: 2026-09-21 01:08:52
date +%Z: UTC
磁盘78G，总使用21G、可用53G（28%）
```

通过prod-query.sh只读执行：

```sql
SELECT version,applied_at FROM schema_migrations ORDER BY version DESC LIMIT 4;
SELECT status,COUNT(*) n FROM orders GROUP BY status;
SELECT COUNT(*) active_runs FROM browser_runs WHERE active_account_key_hmac IS NOT NULL;
SELECT task_type,status,attempts,max_attempts FROM tasks WHERE status IN ('PENDING','RUNNING','RETRY');
SELECT status,COUNT(*) n FROM card_stock_jobs WHERE status IN ('PENDING','RUNNING','REVIEW_REQUIRED') GROUP BY status;
SELECT funds_risk_state,COUNT(*) n FROM recharge_attempts WHERE funds_risk_state IN ('ACTIVE','UNKNOWN') GROUP BY funds_risk_state;
SELECT status,COUNT(*) n FROM alert_notifications GROUP BY status;
SELECT @@version,@@log_bin,@@log_bin_trust_function_creators;
SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE();
```

```text
054_card_retirement  2026-09-18 06:26:29.144
053_card_source_selections_and_supply 2026-09-18 00:03:27.321
052_cards_bin 2026-09-11 13:28:54.294
051_orders_cdk_id_reusable 2026-09-08 01:25:03.611
orders: CLOSED21 / RECHARGE_FAILED37 / RECHARGE_SUCCESS20
active_runs: 0
tasks: BROWSER_PREFLIGHT PENDING 0 5
card_stock_jobs上述活动/待核状态: 0行
recharge_attempts ACTIVE/UNKNOWN: 0行
alert_notifications: CANCELLED29 / SENT123
MySQL8.4.11 / log_bin1 / trust_function_creators0
现有触发器: 0行
```

补查该PENDING任务与订单关联：`BROWSER_PREFLIGHT / PENDING / order_status=CLOSED / attempts=0`；没有执行或清理它。它是遗留待办，不把“无在途订单”夸大成“所有任务表为空”。本机Browser心跳记录最后读取为2026-09-21T02:02:50.655Z，未重启worker。

开关查询返回：accept_new_orders=true、dispatch_new_recharges=true、browser_payment_writes_enabled=true、card_auto_replenishment_enabled=true、card_balance_recharge_enabled=false。本轮不改变；当前空闲不保证迁移时仍空闲，执行前要重查并经确认进入维护窗口。

## 057权限与备份

在生产migration.env对应身份，经正式配置/连接池仅执行SHOW GRANTS与系统变量SELECT，输出不含凭据：

```text
GRANT USAGE ON *.*
GRANT ALL PRIVILEGES ON `pojia`.*
{ log_bin: 1, trust_creators: 0 }
```

库级ALL包含TRIGGER，但不含全局SUPER。在开启二进制日志且未信任创建者时，MySQL对CREATE TRIGGER有额外要求；参见[MySQL8.4 CREATE TRIGGER](https://dev.mysql.com/doc/refman/8.4/en/create-trigger.html)与[Stored Program Binary Logging](https://dev.mysql.com/doc/refman/8.4/en/stored-programs-logging.html)。没有在生产“试跑DDL”，不能通过失败试错留下两列已加、触发器未建的半迁移。需先在隔离环境按同权限复核并明确受控执行方式，经用户确认后再动生产权限或系统变量。

生产备份脚本实查含 --single-transaction --routines --events --triggers；备份账号SHOW GRANTS含SELECT/LOCK TABLES/SHOW VIEW/EVENT/TRIGGER，覆盖触发器读取。

只读执行现有备份verify（不是新建备份或恢复）：

```text
/var/backups/pojia/pojia-20260920T033154Z.sql.gz.enc: OK
backup_integrity=OK
backup_file=/var/backups/pojia/pojia-20260920T033154Z.sql.gz.enc
backup timer: active，下一次2026-09-21 03:30:16 UTC
```

verify只证明校验和/解密/gzip完整性，不证明本轮恢复演练成功，也不代表已备份057（生产还没有057）。正式发布前应重新备份；触发器的DEFINER账户必须保留必要权限，不能机械照旧手册“迁移后撤销/删除账户”导致触发器执行失效。

## 待确认执行顺序（未执行）

1. 明确057权限、迁移中断续做/回退与触发器DEFINER处理；重查剩余只读风险和维护窗口。
2. 用户批准推送候选及prepare：单提交打包、上传、备份与全量manifest校验。prepare有服务器写入/备份动作，本轮未运行。
3. 用户批准维护窗口与055/056/057迁移，执行前重查在途订单和资金任务；不得因本次空闲直接停服务。
4. 用户批准switch，web/worker/bark全部换到相同release，新连接独立核验。
5. 失败时优先保持维护状态。只切回旧应用不保证保留新有效期/用途/告警轮次行为；不要自动删列、删触发器或倒回整库覆盖新数据。

本轮未推送、未构建/上传release、未执行迁移/重启/开关/真实资金动作。8804试用页未操作。
