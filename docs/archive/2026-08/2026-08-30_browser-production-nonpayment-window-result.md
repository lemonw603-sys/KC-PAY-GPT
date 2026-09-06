# Browser 生产形态非付款安全窗口结果（2026-08-30）

## 结论

本轮已真实验证“客户入口创建订单 → 创建时冻结 Browser 路线 → 正常派发尝试”的生产路径，但**没有进入 Browser Checkout**。

停止原因不是 Session、Browser Worker、路由或代码异常，而是生产没有余额达到 `$16` 的可分配 Plus 卡。正常分卡逻辑将订单推进到 `WAITING_FOR_CARD`，并以 `CARD_STOCK_EMPTY` 等待；因此没有建立充值 attempt、Browser job、Browser run 或资金预留。

这同时纠正了此前运行计划中的一处错误：**余额不足卡不能在真实生产订单链路中被当成可付款卡分配后继续到 Checkout**。如果强行改数据库、降低订单最低余额或绕开分卡，会破坏本次要验证的真实链路，不能作为有效验收。

## 输入与边界

- 测试 CDK：`PJ-AJYYS-DZ95T-VD3XC-UT6UA`
- 创建订单：`PJV1-TZmbNEpYNd0Gs_YgRKF_`
- 路线：`CHATGPT_PLUS_BROWSER_V1 / BROWSER`
- Session：使用用户指定的仓库外测试附件；只解析第一个完整 JSON，尾部附加文本被忽略；原文未进入文档、Git 或普通日志。
- Browser Worker：生产 `EXTERNAL_READONLY + CHATGPT_ACCOUNT_CHECKOUT` 配置，付款执行器保持 `false/MOCK`。
- 所有付款及 Provider 写入开关保持关闭；未读取 PAN/CVC，未填卡，未点击付款，未产生付款、开卡、卡充值或卡台写入。

## 实际执行证据

1. 安全窗口前活动 task、attempt、Browser job/run/lease 均为 `0`。
2. 临时停止接单和自动派发，备份 Browser env、systemd 单元和控制面状态。
3. Browser Worker 使用生产配置通过 `--check`，启动后持续返回 `IDLE`，专用心跳正常更新。
4. 临时打开 Browser dispatch gate，并通过正式管理服务把全局默认充值方式切为 Browser。
5. 仅短暂开放接单；客户 `POST /api/v1/orders` 返回 HTTP `201`，订单创建成功。
6. 创建后立即停止接单；数据库确认订单创建时已冻结 Browser route。
7. 开启正常派发后，`ASSIGN_CARD` 按真实库存判定返回 `CARD_STOCK_EMPTY`；订单进入 `WAITING_FOR_CARD`。
8. 当时生产卡片余额为 `$0.24`、`$0.07`、`$0.01` 等，且已绑定、耗尽或停用；不存在余额达到订单最低要求 `$16` 的可分配 Plus 卡。
9. 因分卡未通过，充值 attempt、Browser dispatch job 和 Browser run 均未创建；Worker 未访问 ChatGPT。

## 清理与恢复

- 测试订单已通过正式取消服务关闭：`CLOSED / CANCELLED_PRE_SUBMISSION`。
- 测试 CDK 已正常兑换并绑定该订单，状态为 `REDEEMED`，不得再次使用。
- 全局默认充值方式已恢复为 API。
- `accept_new_orders=true`
- `dispatch_new_recharges=true`
- `browser_dispatch_enabled=false`
- Browser Worker 已停止，保持 `inactive/disabled`，专用心跳已清空。
- Browser env 已从备份恢复。
- 活动 task、ACTIVE/UNKNOWN attempt、Browser job/run/lease 均为 `0`。
- Web 与 API Worker 均为 active；ops/plus 的 live/ready 四个公网端点均为 HTTP `200`。
- 服务器备份目录：`/var/backups/pojia/browser-nonpayment-20260830T084134Z`

## 下一次正确验收条件

不新增测试专用旁路，不降低真实订单的余额/资金门禁。准备一张已同步、可分配且余额至少 `$16` 的 Plus 卡后，重新执行同一生产非付款窗口；届时仍保持付款与 Provider 写入关闭，目标才是让正式订单自然创建 Browser attempt/job，并在 Checkout 付款按钮前 safe-abort。
