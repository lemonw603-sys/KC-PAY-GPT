# 第⑥步统一发布执行记录

授权：D-327，用户“同意 推进吧”。候选`66bfe98fdd35c84e4d60e081febcef31b6d6ff35`，目标`20260921-step6-66bfe98`。本文件按阶段更新；未写完成的步骤不得推断已执行。

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
