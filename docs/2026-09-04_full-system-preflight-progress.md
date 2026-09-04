# 全系统体检进展｜2026-09-04

## 已完成板块

### 生产/部署

- release `/opt/pojia/releases/20260903-dark-surface-eba5331`
- Web、API Worker、card-stock/funding/read-sync timer、Bark dispatcher 均 active
- `/health/ready` 返回 `{"status":"ready"}`

### 客户页与运营后台

- 客户页生产页面可访问，CDK/Session/查询入口存在
- 管理后台已登录，默认路线控件存在，当前 API 选中、Browser 禁用
- Browser 控制面可读，当前 dispatch 0、run 0

## 当前生产 API 证据（管理员会话读取）

- overview/readiness：HTTP 200；默认 API；API 执行就绪；CARD_SUPPLY 为 BLOCKED
- card-stock：HTTP 200；provider rulesFresh=true、purchaseEnabled=true、defaultCardTypeId=16、cardTypes 含 16、catalog openingBlocked=false、unresolvedActive=0、available=0
- 卡台余额 `18.84 USD`；卡段声明 minimum account balance `25 USD`
- card-stock 返回 `replenishmentUsedToday=24`、`replenishmentDailyLimit=5`、`replenishmentRemainingToday=0`
- Browser dispatch-jobs：HTTP 200，20 条历史任务均已 CANCELLED/FAILED_SAFE，无活动任务

## 当前矛盾/待定位

1. `card-stock` 已显示默认卡段 16 存在、规则新鲜且 catalog `openingBlocked=false`，但 overview/readiness 仍以“默认卡段未就绪”阻断。必须定位 `defaultCardTypeReady` 投影或生产进程/数据差异，不能盲目放行。
2. 今日补给使用量 24 大于日限额 5；需要确认统计口径（历史 requested_count、时区或限额变更），不能把它解释为当前重复开卡。
3. 当前可分配卡为 0，现有卡多为 ASSIGNED/DEPLETED/RETIRED；Browser 真实订单条件尚未满足。

## 下一板块

继续核对订单/资金/库存/自动补给和 Browser readiness 的代码与生产投影；在矛盾定位前不切换路线、不创建真实订单。

本报告只记录只读证据，未执行 Provider 写入、开卡、补余额或付款。

## 2026-09-04 深核增量：新卡错误占用与缺卡误报

- 已确认 Provider 卡 2772/尾号 9051 为 active、余额 $16，失败订单 9414 没有 PURCHASE；`RECONCILIATION` 消费账本与 ACTIVE assignment 未释放，是 available=0 的直接根因。
- 已确认补给“24/5”不是开了 24 张卡：24 个 automatic 请求中 23 个开卡前失败、实际只成功 1 张。订单重试绕过 scheduler 反复直插任务是根因。
- 已完成候选修复：失败后触发交易同步并在双重证据下释放；订单不再直插开卡任务；自动自愈不再推缺卡 Bark；终态按 opened_count 统计日用量。
- 验证：定向 14/14、隔离 MySQL 5/5、v1 全套 521（477 pass/44 skip/0 fail）。
- 当前状态：已部署并完成生产只读同步；2772 已恢复 AVAILABLE/READY，overview available=1/readiness=READY，补卡用量=1/5，开放提醒=0。
- 详细证据：`docs/2026-09-04-card-availability-root-cause-and-fix.md`。
