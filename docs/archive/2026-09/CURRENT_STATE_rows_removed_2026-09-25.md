# 从 CURRENT_STATE 移出的历史行（2026-09-25）

这三行记的是一次性操作或某个窗口的过程，不是当前生产状态；它们的当前效果已反映在事实表的消费账本、CDK、备用卡各行。原文照录：

| 项目 | 当前值 | 核对时间（UTC） | 证据方式 |
|---|---|---|---|
| highvcc 备用卡台 A 已开卡片（本窗口） | 3 张：尾号 9839（$50，08:xx）、9354（$5，09:19）、3241（$3，09:35，开卡时因 detail() 竞态未即时入库，09:53 用 `reconcile-highvcc-card.mjs` 补记）；账户另有 $20 押金要从钱包余额里先扣，才是真实可开卡余额（Lemon 提供） | 2026-09-10 09:52 UTC | 平台卡片列表 + `cards` 表独立核对 |
| D-335历史案例收口 | 13:03:30 UTC精确2case＋10alert原子更新为RESOLVED，OPEN case 2→0，新增10条同状态order_events审计647～656。订单仍78（20成功/37失败/21关闭）；7单续费待核保留。当时保留的2条待对账账本后来已由D-343释放，当前数值见消费账本行。维护脚本固定cc10b30；12原记录备份在`/opt/pojia/maintenance/20260921-D335-cc10b30/targets-before.json`。 | 2026-09-21 13:08 UTC | reviews/2026-09-21-feedback-b-close/report.md及执行/独立复核证据 |
| D-343测试CDK收口 | Lemon确认上线前16个旧CDK及其中2条待对账单均为自测。00:01 UTC固定名单事务完成：16个CDK REDEEMED→REVOKED且仍绑定原订单，2条无PURCHASE账本RECONCILIATION→RELEASED；新增16+2审计，订单/attempt/卡/Provider失败证据等保护行不变。CDK总数81，现AVAILABLE21 / REDEEMED21 / REVOKED39。备份`/opt/pojia/maintenance/20260922-D343-90066ea/targets-before.json`为0600；没有部署或重启。 | 2026-09-22 00:02 UTC | `reviews/2026-09-22-d343-test-cdk-closeout/report.md`；新连接独立查询 |
