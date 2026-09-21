# 第⑥步使用反馈第一批发布（D-341）

2026-09-22 UTC+8。用户在D-340本地收口后明确同意发布。生产于2026-09-21 15:59 UTC切换到`20260921-feedback-d340-7e88952`，固定提交`7e88952fa26fc1e6670b3e0e0ef4f60bc507a2b1`。

## 范围与前置

- 决策：D-332/333工作台钱包与交互，D-336～340 Bark规则，D-339近7天成功率，D-341发布授权。
- 原型：`step6-workbench-compare.html` C、`step6-opsbar-v5.html` 乙-3、`step6-cards-compare.html` A；通知无独立页面原型，以D-340短文案为验收版。
- 切换前生产原始查询：订单`CLOSED 21 / RECHARGE_FAILED 37 / RECHARGE_SUCCESS 20`；非终态0，活动attempt 0，open Browser run 0。
- 本批无新迁移，`v1/scripts/customer-sql-probe.sh` 5条客户链SQL全通过；未修改D-254受限Browser付款代码。
- 本地最新验证：Bark专项23/23，隔离MySQL 19/19，默认全量1080 tests / 1011 pass / 0 fail / 69 skipped。

## prepare与switch

- manifest 1325项一致，候选commit与发布名匹配。
- 备份`/var/backups/pojia/pojia-20260921T155914Z.sql.gz.enc`经checksum和解密/gzip完整性检查通过。本批无DDL，没有运行migrate。
- 回滚点：`20260921-step6-9b9f181`；切换脚本同时重启web/worker/bark。

## 发布后独立证据

```text
current=/opt/pojia/releases/20260921-feedback-d340-7e88952
pojia-web                 PID 538098  cwd .../20260921-feedback-d340-7e88952/v1
pojia-worker              PID 538103  cwd .../20260921-feedback-d340-7e88952/v1
pojia-bark-notifications  PID 538173  cwd .../20260921-feedback-d340-7e88952/v1
live=200  ready=200  admin_login=200  overview_unauth=401
```

`admin.js`、`admin.css`、`cards.css`的HTTP内容SHA256与新release磁盘文件分别一致。生产新连接复查：

```text
accept_new_orders=true
dispatch_new_recharges=true
browser_payment_writes_enabled=true
card_auto_replenishment_enabled=true
card_balance_recharge_enabled=false
nonterminal_orders=0
```

D-340历史重推保护复查：

```text
BROWSER_ORDER_SUBMITTED  alert=OPEN  delivery=SENT  count=36
attempt_count min=1 max=1
last sent_at=2026-09-18 06:54:21.676 UTC
```

切换后历史来单无新尝试或补推证据。下一笔真客户来单才是手机真机验收点，本轮未为测试主动发真实Bark。

## 发布检查脚本订正

switch首次输出`bark cwd=/`，独立`systemctl show`+实际`/proc/PID/cwd`证明是重启窗口的瞬时假值，真实cwd为新release。本轮将`deploy-release.sh` 改为只有cwd精确等于候选release才通过，否则15秒后失败停止，不再打印误导性“/”。这是未来发布门槛修正，不改生产业务逻辑。
