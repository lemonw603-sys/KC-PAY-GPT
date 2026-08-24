# 当前状态快照（2026-08-24）

> 本文件只保留当前有效状态；历史过程以 `HANDOFF_LOG.md` 和验证报告中的带日期证据为准。

## 已验证事实（本轮现场/代码证据）

- 生产 release：`/opt/pojia/releases/20260823-admin-ui-alert-7587d44`。
- Web、Worker、MySQL、Bark 正常；卡库存付费 runner 未运行；只读同步和目录同步 timer 正常。
- 最新迁移：`037_card_discovery_latest_index`。
- readiness：`ok=true`；接单、派发和三类 Provider 写入均关闭；活动 Permit、资金风险、对账案件、Browser 活动队列均为 0；存在 1 个历史遗留活动任务。
- HNSKJ 只读检查和网页只读核验通过：余额 `75.670000 USD`、18 张可见卡、7 张 active；本轮未执行开卡、卡余额充值或其他写操作。
- 运营后台已登录并完成逐页只读交叉验证：总览、订单、异常、资金证据、卡余额充值、卡台路线、Browser、库存、CDK 均可访问。
- 后台现场口径：累计订单 3、自动处理中 1、三方对账异常 1、资金结果未决 0、卡余额充值待处理 0、待验证新卡 13、本地可分配卡 0、Browser run 0、CDK 可使用批次 10。
- 客户付款前 dry-run：Session JSON 前缀尾部多 19 个非 JSON 字符；在浏览器内存清理后解析成功，但因 `acceptNewOrders=false` 被页面短路，没有发出 `/api/v1/orders`。
- 本地当前工作树测试最近一次结果：409 tests / 375 pass / 0 fail / 34 skipped。408/374/0/34 是较早代码状态的历史结果。

## 用户确认的当前条件

- 我方生产服务器被用户确认正常；现场只读证据与该确认一致。
- 卡台已恢复正常；本轮只读证据证明读取正常，写卡/付款写入尚未验证。
- 当前禁止真实付款。
- 用户不需要手动操作后台开关；如获准进行测试，由执行窗口负责开关操作并复原。
- Session 原文不得发送到聊天或写入普通日志/交接文档。

## 当前阻塞与未完成

- `acceptNewOrders=false` 阻止创建测试订单；`dispatchNewRecharges=false` 和 Provider 写入关闭。
- 真实成功订单、卡片写入、卡余额充值、Plus 付款、取消续费和资金对账尚未验证。
- 生产遗留 `ASSIGN_CARD/PENDING` 任务、长期 `VALIDATING` intake batch、2 张 quarantine/review 卡及 1 条历史 `UNCERTAIN provider_call` 尚未处置。
- Browser 真实付款尚未验证。

## 建议（不是新业务决策）

- 若继续做仅创建订单的付款前 dry-run，可考虑临时开启接单、保持派发和 Provider 写入关闭；该建议需单独确认，且会写入真实订单数据。
- 不应在没有合法 Session 时开启生产接单空等。

## 协作分工

- 其他模型：负责升级、优化和改造实施，并对其代码和测试负责。
- 本窗口：负责需求/方向审查、跨模块对齐、对抗式审查、集成验收和生产前闸门。
- 业务规则可以被证据质疑和重新确认；不得静默改变，也不得把建议写成决策。
