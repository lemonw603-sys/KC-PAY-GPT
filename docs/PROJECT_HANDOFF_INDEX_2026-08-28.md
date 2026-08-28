# 项目统一交接索引（2026-08-28）

本文件是入口索引，不替代详细证据。事实优先级：生产运行结果 > 只读 Provider/数据库证据 > 测试产物 > 决策记录 > 讨论草稿。

## 当前生产状态（已核验）

- Release：`/opt/pojia/releases/20260828-card-sync-43ca767`
- Web active；Worker inactive；卡库存付费 runner inactive
- 接单、派发开关均为 `false`
- Provider 写开关均为 `false`
- 最新迁移：`037_card_discovery_latest_index`
- HNSKJ 只读：account `67`、7 种卡类型、19 张可见卡；ZZSHU 连接正常
- 当前同步稳定：连续 3 个目录周期无新增 discovery
- 有 1 个 `ASSIGN_CARD/PENDING`（task 22），订单处于 `WAITING_FOR_CARD`

## 已确认业务规则

- V1 当前只做 Plus；一张已开通卡可服务不同产品，卡类型不是产品类型。
- 新开卡默认 Provider 卡类型为 `16 / VISA-40024200`；这是当前配置，不是永久 ID 白名单。
- 卡段采用“人工刷新目录 + 手动选择默认卡段 + 持久使用”模式，不按每单选择。
- 已消费/绑定卡原则上不复用；特殊复用必须人工决定并保留证据。
- 一卡多充的消费次数账本和付款前预留已实现；跨订单自动复用仍未启用。
- 消费计数以本地成功订单占用 + Provider 唯一交易 ID 的 `PURCHASE + SUCCESS` 双重证据为准；注资和余额转出不计入。

## 已实现并验证

- 卡目录/详情/交易只读同步与 Provider 字段归一化。
- 卡类型缺失时仅允许唯一精确名称映射，无法映射进入审查状态。
- 低库存告警去重、当前 route account 读取、同步任务与库存状态链路。
- API 真实订单历史链路曾完成：开卡、充值、Plus 激活、取消自动续费（见 `docs/REAL_E2E_SINGLE_ORDER_TEST_PLAN_2026-08-24.md` 及相关证据）。
- 卡片同步专项已合并并部署；单元/全量测试 402 通过，隔离 MySQL 33 通过。
- 总体规划最新对抗审查：`docs/PLAN_ADVERSARIAL_REVIEW_2026-08-28.md`；一卡多充必须在付款前预留额度，不能只在成功后计数。
- 一卡多充账本已接入 API/Browser 共享资金链：付款前预留、付款确认消费、明确未提交释放、UNKNOWN 保留核对；生产尚未部署。

## 当前未完成或需后续设计

1. Provider 卡段 ID/属性变化的人工刷新和默认选择 UI/API（D-098）。
2. 一卡多充的历史证据回填、后台前端展示，以及跨订单受控分配规则；只读 API 已提供，当前尚未启用自动复用。
3. 费用快照、变化检测和后台提醒（当前只读费率：开卡 0.50 USD、支付 0.5%、拒付 0.40 USD）。
4. `1065`、`917` 的历史产品对应关系仍需可追溯证据确认；已确认 `1065` 有 Claude 200 USD 成功消费，`917` 当前 Provider 返回中未见 ChatGPT 商户记录。
5. task 22 和 Worker 恢复需单独运营确认；不得自动推进。

## 重要边界

- 生产已部署代码与本地 `main` 的后续文档提交可能不同；部署事实以 release 路径和运行检查为准。
- 任何“口述事实”必须在独立证据核验后才能改变库存或订单状态。
- 新卡类型、新费用、新 Provider route 均不得自动放行；先记录、审查、人工确认。

## 详细文档入口

- 决策单一事实源：`docs/DECISIONS.md`
- 跨窗口记录：`docs/HANDOFF_LOG.md`
- 卡同步审查与生产证据：`docs/ADVERSARIAL_REVIEW_CARD_SYNC_2026-08-27.md`
- 生产运行手册：`docs/PRODUCTION_PREP_RUNBOOK.md`
- Browser 线交接：`docs/BROWSER_RECHARGE_MODULE_REPORT_2026-08-25.md`、`docs/BRFE_HANDOFF_2026-08-25.md`
- 一卡多充账本实施与审查：`docs/CARD_CONSUMPTION_LEDGER_IMPLEMENTATION_2026-08-28.md`
