# D-343｜上线前测试CDK一次性收口

时间：2026-09-22（UTC+8）。范围仅为Lemon确认的16个测试CDK及其中2条未扣款账本；没有部署、重启、付款、开卡、退款或客户账号操作。

## 依据与批准

- Lemon确认这16个CDK和2条待对账订单均为自己测试，CDK尚未正式对客户开放，并在了解影响后回复“以上同意”。
- 决策：D-343。无页面改动，原型不适用。
- 执行前生产原始摘要：

```text
cdk_scope  16  16  16  CLOSED,RECHARGE_FAILED
ledger_scope  PJV1-412JIT_yfiuBpZeC39_m  ac7fcc59-3110-4cea-9338-bad9fe350f8e  RECONCILIATION  16.000000  FAILED  CLEARED  1013  0
ledger_scope  PJV1-u696SEuwCQqyReHZ_FmP  7509bb13-6c44-4b7f-b2d2-04e148bbfe28  RECONCILIATION  16.000000  FAILED  CLEARED  4643  0
```

两单各有两条最终Provider证据，均为`status=failed/paymentResult.success=false`；失败原因为“卡片被拒”与“开通超时”。两单无OPEN case/alert、活动分配或未结退款。

## 实现与验证

- 固定脚本：`v1/scripts/close-historical-test-cdks.mjs`，提交`90066ea`，SHA256 `a6f0fdd208e6107574af32ced486b98f8f70305a038e08f7212a46be4a397ca7`；没有公开路由或长期页面。
- 默认dry-run；固定16个订单和2个ledger；验证订单终态、CDK绑定、无历史成功事件、attempt终态、无活动分配/退款、Provider失败、卡已退役及无PURCHASE。apply必须匹配dry-run摘要。
- 隔离MySQL实际跑通“dry-run无写→apply→独立查询”：1 pass / 0 fail；默认V1套件1081 tests / 1011 pass / 0 fail / 70 skipped。
- 服务器维护目录：`/opt/pojia/maintenance/20260922-D343-90066ea`，父目录0700；目标原值备份`targets-before.json`为0600、15452字节。脚本和依赖固定到生产release对应目录，没有覆盖release文件。
- 生产dry-run与apply使用同一`planDigest=2868a9f0fb406b9ca259ee310df7e38e4500073028a4d7fef2c7f929b129595b`。一笔SERIALIZABLE事务完成：16个CDK `REDEEMED→REVOKED`，仍绑定原订单；2条ledger `RECONCILIATION→RELEASED`；新增16条`cdk_admin_events`与2条同状态`order_events`审计。事务内保护对象哈希不变。

## 新连接独立复核

2026-09-22 00:02:17.102 UTC：

```text
target_cdks   16  revoked=16  still_bound=16  revoked_at=16  reasoned=16
target_ledgers 2  released=2  released_at=2  reasoned=2
audits        cdk_events=16  ledger_events=2
orders        CLOSED=21  RECHARGE_FAILED=37  RECHARGE_SUCCESS=20
ledger_status CONSUMED=19  RELEASED=52
runtime       accept_new_orders=true  dispatch_new_recharges=true  browser_payment_writes_enabled=true  active_orders=0
release       /opt/pojia/releases/20260921-feedback-d340-7e88952
services      pojia-web=active  pojia-worker=active  pojia-bark-notifications=active
```

CDK总数仍81，仅状态分布变为AVAILABLE21 / REDEEMED21 / REVOKED39。没有修改订单终态、恢复CDK库存或重跑充值；生产服务和release未变化。

## 后续边界

这批历史测试CDK与2条待对账账本已闭合，不再重复调查或增加分类功能。7笔续费待核/销卡、`PJV1-DqcnqHF0tPlxDhygTtAA`缺消费证据是不同事项，仍按D-342及既有证据处理。
