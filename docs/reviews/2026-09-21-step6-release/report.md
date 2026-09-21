# 第⑥步统一发布执行记录

> D-328更正：下文原现场31348是展示报告长度；实际待保存的是544字符差异摘要（生产SELECT-only代理拦截INSERT确认，未写库）。二者都超过255，但不能混作同一对象。修复保持只存摘要，见`../2026-09-21-report-capacity/report.md`。

授权：D-327，用户“同意 推进吧”。候选`66bfe98fdd35c84e4d60e081febcef31b6d6ff35`，目标`20260921-step6-66bfe98`。**结果：prepare完成，维护后发现日对账存储容量缺陷，在迁移前中止，已恢复原⑤b营业；未发布。**

## 前置核对（2026-09-21 06:46～06:47 UTC）

源代码：工作区干净；六项诊断验收sourceSha256逐个重算一致；候选到HEAD的v1/deploy/browser-mvp差异为空。

现场输出：

```text
current=/opt/pojia/releases/20260918-step5b-b0a36d4
web active/running PID3053 Result=success
worker active/running PID2035 Result=success
bark active/running PID3105 Result=success
ready={"status":"ready"} HTTP200
MySQL=8.4.11 log_bin=1 trust_function_creators=0
migrator=pojia_migrator@172.17.0.1 Super_priv=N account_locked=N
GRANT USAGE ON *.*
GRANT ALL PRIVILEGES ON pojia.*
nonterminal_orders=0 active_browser_slots=0 running_tasks=0
funds_active_unknown=0 stock_pending_running_review=0 funding_active_unknown=0
orders CLOSED21 / RECHARGE_FAILED37 / RECHARGE_SUCCESS20
cdks AVAILABLE21 / REDEEMED37 / REVOKED17
schema=054_card_retirement
API Plus route=1; Browser Plus/5X/20X routes=0
accept=true dispatch=true poll=true sync=true browser_dispatch=true browser_payment=true
card_auto_replenishment=true card_balance_recharge=false mode=AUTOMATIC
browser heartbeat=2026-09-21T06:47:16.190Z
memory available=1901 MiB; root disk available=53 GiB
9 project timers listed
ops executable=/usr/local/sbin/pojia-ops (root root 0755)
runtime.env=0600 root pojia; migration.env/root-password/backup-key=0600 root root
target release/bundle did not exist
```

计数查询使用orders非终态、browser_runs.active_account_key_hmac、tasks.RUNNING、recharge_attempts资金状态、card_stock_jobs的PENDING/RUNNING/REVIEW_REQUIRED、card_funding_attempts活动资金；均只读。SHOW GRANTS经现有容器内root凭据读取，不输出密码。维护前须重新核对，不能用本快照保证随后空闲。

## 执行边界

不测试真实资金、不改变付款开关或Pro路线、不清历史case/旧码、不重启本机Browser池。只恢复维护前状态；未知付款、备份失败、迁移冲突或临时权限无法撤回，均停止切换并保持安全维护。

## 实际执行与停止点

1. 推送origin/main成功（542e487→16c7b9a）。prepare固定66bfe98，manifest1249项通过、依赖安装完成。见[prepare.log](prepare.log)，没有switch。
2. prepare备份`/var/backups/pojia/pojia-20260921T064957Z.sql.gz.enc`通过校验。维护快照在服务器`/opt/pojia/maintenance/20260921-step6-66bfe98/snapshot.json`，原ops副本为同目录`pojia-ops.before`。
3. 06:52:41.170 UTC正式服务暂停接单（审计），九timer只stop、不disable，oneshot自然结束。再次查询orders/slots/tasks/funds/stock/funding/dispatch均0，停止web/worker/bark。
4. 维护点备份`/var/backups/pojia/pojia-20260921T065518Z.sql.gz.enc`校验通过。发现日对账早在04:02:17 UTC失败，在迁移前调查。`migrate-with-revoke.sh`只编写并做bash语法检查，**未执行，未授权SUPER**。

## 新发现：日对账报告无法保存

```text
pojia-daily-reconciliation.service Result=exit-code ExecMainStatus=1
InactiveEnterTimestamp=Mon 2026-09-21 04:02:17 UTC
journal: {"dryRun":false,"failed":true,"code":"ER_DATA_TOO_LONG"}
```

列定义查询：

```sql
SELECT DATA_TYPE,CHARACTER_MAXIMUM_LENGTH FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='app_settings' AND COLUMN_NAME='setting_value';
```

原始结果：`varchar / 255`。候选`createDailyReconciliationService({pool}).run({persist:false})`只读结果：`cardCount=30 / discrepancyCount=6 / reportCharacters=31348`。

`daily-reconciliation-service.js`的writeLastReport将完整JSON写入该列；run(persist:true)在返回前调用它，runner在返回后才记录心跳/汇总告警。字段容量不匹配，**只读成功不能证明定时保存/通知成功**。这是新确认的既有故障，不是本次维护造成；此前只读验收没有覆盖。修复需要新增数据库变更，不临时塞进批准的055～057。

## 已恢复原版（独立复核07:00 UTC）

```text
current=/opt/pojia/releases/20260918-step5b-b0a36d4
web active PID204712 / worker active PID204713 / bark active PID204714
三进程cwd均为该⑤b/v1，Result=success
ready={"status":"ready"} HTTP200
9 timers=active/enabled（与快照相同）
schema=054_card_retirement
migrator Super_priv=N，global USAGE + pojia库ALL
accept=true / dispatch=true / browser_payment=true / auto_replenishment=true / card_balance_recharge=false
nonterminal=0 / slots=0 / funds ACTIVE或UNKNOWN=0
cdks AVAILABLE21 / REDEEMED37 / REVOKED17（与维护前相同）
```

恢复接单审计：06:59:38.138 UTC false→true，actor=`codex:step6-release-20260921-restore-before-ddl`。除维护暂停/恢复外，原开关不变。新ops未安装、Pro路线未动、旧码/历史case未清理，没有发起真实资金测试。日对账旧故障仍未修。

服务器phase.json=`restored-before-migration`。准备包、加密备份、维护快照保留，不自动删除；后续不要对已存在release盲跑prepare或直接switch，先修容量、重新固定候选并确认新增迁移范围。

## 交付核对

| 项目 | 状态 |
|---|---|
| 推送、prepare、校验、备份 | 完成，有prepare.log |
| 暂停与恢复原营业状态 | 完成，有审计/新连接/新SSH证据 |
| 临时授权、055～057、switch、新ops安装 | 未执行 |
| 第⑥步生产发布 | 未完成，停在新缺陷待确认修复 |
| 容量迁移及真实报告落库验收 | 未获当次实施确认，未做 |
