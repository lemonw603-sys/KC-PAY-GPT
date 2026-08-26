# 当前状态快照（2026-08-25）

> 本文件只保留当前有效状态；历史过程以 `HANDOFF_LOG.md` 和验证报告中的带日期证据为准。

## 已验证事实（本轮现场/代码证据）

- 生产 release：`/opt/pojia/releases/20260825-nonbrowser-e32a6fd-fixed`，候选提交 `e32a6fd`。
- Web、Worker、MySQL、Bark 正常；卡库存付费 runner 未运行；只读同步和目录同步 timer 正常。
- 最新迁移：`037_card_discovery_latest_index`。
- readiness：`ok=true`；`acceptNewOrders=false`、`dispatchNewRecharges=false`、三类 Provider 写入均关闭；活动 Permit、资金风险、对账案件、Browser 活动队列均为 0；存在 1 个历史遗留 `ASSIGN_CARD/PENDING` 任务（task 22），未擅自清理。
- 发布后公网 `/health/live`、`/health/ready` 均 HTTP 200；线上 `admin.js`、`admin.css` SHA-256 与候选包一致；未认证 POST 接单/派发新路由均返回 401。
- 部署后刷新已登录后台确认：总览显示“接收新订单”和“自动充值（对已接订单自动购买 Plus）”两个独立控制项，分别显示“开始接单”和“开始自动充值”；未点击任何写入按钮。
- 已逐页只读打开总览、订单、异常队列、资金证据核对、卡余额充值、卡台路线、Browser 执行、卡片库存、CDK 管理，页面均正常渲染。
- HNSKJ 只读检查和网页只读核验通过：余额 `75.670000 USD`、18 张可见卡、7 张 active；本轮未执行开卡、卡余额充值或其他写操作。
- 运营后台已登录并完成逐页只读交叉验证：总览、订单、异常、资金证据、卡余额充值、卡台路线、Browser、库存、CDK 均可访问。
- 后台现场口径：累计订单 3、自动处理中 1、三方对账异常 1、资金结果未决 0、卡余额充值待处理 0、待验证新卡 13、本地可分配卡 0、Browser run 0、CDK 可使用批次 10。
- 客户付款前 dry-run：Session JSON 前缀尾部多 19 个非 JSON 字符；在浏览器内存清理后解析成功，但因 `acceptNewOrders=false` 被页面短路，没有发出 `/api/v1/orders`。
- 本地候选定向回归：36/36 通过；全量测试：369 pass / 34 skipped / 3 fail（Unicode worktree customer 静态页 500、两个 Browser 测试缺 `playwright`）。

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
- Browser 上游运行合同已按用户最新确认修正：必须先建立唯一 attempt 并锁定资源，但 Browser 尚未点击付款时订单应为 `RECHARGE_PROCESSING`，真正提交付款由 `browser_run.payment_state=PAYMENT_SUBMITTING` 表达。当前共享代码仍提前使用 `SUBMITTING`，独立 Browser worktree 仍使用 PoC 状态投影；两侧均待接线改造，因此生产 Browser 接线尚未完成。
- 合同对抗式审查确认 3 个生产接线前 P0：permit 签发时缺少权威卡/路线/余额复核；缺少付款前安全退出与 Session 修复的原子闭环；状态调整散布于完整资金链，不能只改入口。报告见 `docs/2026-08-26_browser-runtime-contract-adversarial-review.md`；当前真实 Browser 付款仍关闭，未发现已发生资金事故的证据。

## 建议（不是新业务决策）

- 若继续做仅创建订单的付款前 dry-run，可考虑临时开启接单、保持派发和 Provider 写入关闭；该建议需单独确认，且会写入真实订单数据。
- 不应在没有合法 Session 时开启生产接单空等。

## 协作分工

- 其他模型：负责升级、优化和改造实施，并对其代码和测试负责。
- 本窗口：负责需求/方向审查、跨模块对齐、对抗式审查、集成验收和生产前闸门。
- 业务规则可以被证据质疑和重新确认；不得静默改变，也不得把建议写成决策。
