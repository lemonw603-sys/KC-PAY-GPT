# 项目规划地图｜前端、后端、代码与生产统一对抗核查

核查时间：2026-08-31 10:30–11:10 CST
目标文件：`docs/PROJECT_MAP.md`
原则：运行事实优先；发现确定问题直接修正；未执行的事情不得写成完成。

## 一、核查表面

本轮不是只看文档，实际交叉核对了：

1. 运营后台 v19 HTML/JS/CSS、就绪摘要、开始营业接口及 actionId 跳转；
2. 订单 Worker 的任务领取、API/Browser 路由、`SUBMIT_RECHARGE` 和 Provider 写门禁；
3. 自动开卡、订单驱动补余额、卡片同步、取消订单和运营提醒；
4. 本地 `main`、生产 release `/opt/pojia/releases/20260831-order-funding-c185d19`、migration、systemd unit/timer；
5. 生产 MySQL 当前设置、路由、活动订单/任务/资金风险、OPEN alerts；
6. 公网 ops/plus live/ready、生产最近日志；
7. 全新 MySQL 8.4 migration 001–044、v1、Browser 与 legacy 回归。

## 二、对抗核查结论

原地图方向基本正确，但存在一处 P0 和三组确定漂移，因此原地图不能直接作为“当前可运营”证明。

### P0｜默认 API 看似营业，实际最终充值权限关闭

生产实证：

- `accept_new_orders=true`；
- `dispatch_new_recharges=true`；
- 默认路线 `LEGACY_HNSKJ_ZZSHU_V1 / API / accepts_new_orders=1`；
- Worker `PROVIDER_RECHARGE_WRITES_ENABLED=false`。

后端 `workflow-handlers.js` 在 API 提交前会返回 `RECHARGE_WRITES_DISABLED`。因此历史两笔真实成功只证明临时授权窗口走通过，不能证明当前新订单可无人值守完成。

原前端只看 Worker 心跳，原只读 readiness 也未检查该能力，会造成“开始营业成功/体检通过，但实际不能充值”的假就绪。

已修正：

- Worker 心跳持续写入 `worker_recharge_writes_enabled`；
- 后台默认 API 时同时要求 Worker 健康和真实充值权限；
- 只读 readiness 在营业开关已开、默认 API、权限关闭时报告 `api_recharge_execution_disabled`；
- Web 不会隐式打开资金权限。
- 仓库新增可审计的最小权限 systemd drop-in 模板；确认后安装即可长期打开 API 充值，同时保持通用 Provider 写、卡片写和 Browser 付款关闭，避免现场手改产生配置漂移。

仍需单独确认：部署时是否把 Worker 的最小 `PROVIDER_RECHARGE_WRITES_ENABLED` 长期开启。该动作会让后续真实订单具备真实充值能力，不能由本轮只读核查擅自执行。

### P1｜空闲自动开卡仍每分钟重复读取 Provider

生产日志连续证明：

```json
{"handled":false,"providerRulesSynced":true,"automatic":{"scheduled":false,"reason":"NO_DEMAND"}}
```

根因是 runner 先刷新卡台规则/余额，再检查本地是否存在真实订单需求。它违反“空闲 timer 只查数据库、尽量减少按次 API 调用”的决策，而且与 5 分钟卡目录同步重复。

已修正：

- 先查本地需求/任务；
- `NO_DEMAND` 不刷新 Provider；
- 真实需求遇到规则过期时只刷新一次再重试调度；
- PROVISIONING 卡仍只按本地查询结果逐卡同步；
- 非过期类错误不吞掉、不伪装为成功。

### P1｜等待卡片提醒在订单取消后残留

生产存在 1 条 `ORDER_WAITING_FOR_CARD/critical/OPEN`，但活动订单和 `WAITING_FOR_CARD` 均为 0，且该 alert 没有 `order_id`。

根因：创建提醒时只写 dedupe key；取消等待卡订单时没有关闭提醒。

已修正：

- 新提醒写入 `order_id`；
- 取消订单时按 `order_id` 或稳定 dedupe key 关闭；
- migration 044 回填历史关联并关闭已离开等待状态的陈旧提醒。

### P2｜有价值的余额 Bark 变成后台噪音

生产有 2 条历史 `PROVIDER_BALANCE_CHANGED/info/OPEN`。余额变化 Bark 本身有价值，但旧后台把全部 OPEN alert 都显示为“内部提醒”，使信息提示长期占位。

已修正：

- Bark 和余额变化审计原样保留；
- 后台内部提醒与 `openAlertCount` 只展示 warning/critical 可行动项；
- migration 不删除历史余额证据。

### P2｜自动补给已开启，却仍产生人工低库存提醒

旧逻辑只在 `autoReplenishmentEnabled=true` 时创建 `CARD_STOCK_LOW`，这与业务含义相反：系统能按真实订单自动补给时，低库存不是人工动作。

已修正：

- 自动补给开启时关闭低库存人工提醒；
- 只有自动补给关闭、确实需要人工补卡时才展示低库存 warning；
- 首页文案改为“没有合格卡时按真实订单需求自动开卡”；
- “等待补卡”改为“等待卡片就绪”，说明系统先自动补余额/开卡，无法继续才人工处理。

### P2｜systemd 描述漂移

生产 timer 实际 `OnUnitActiveSec=60s`，但 Description 仍写“每 10 秒”；主线 unit 已写“每 60 秒”。功能频率正确，部署候选时重新安装 unit 即可消除描述漂移。

## 三、前后端合同复核

- 后台默认充值方式来自生产 `fulfillment_routes`，API/Browser 只影响新订单；合同一致。
- Browser 未启动只在默认 Browser 时阻断；默认 API 不因 Browser inactive 被误阻断；合同一致。
- 自动补余额、自动开卡属于资源恢复，不等价于最终 API 充值权限；原 UI 混淆了这两个层次，本轮已修正。
- 15 分钟卡资料/交易证据是“有订单时按需刷新”，不是订单超时失败；本轮未恢复高频全量刷新。
- 运营提醒不再用余额 info 或可自动恢复的低库存冒充人工故障。

生产 v19 静态资源与当前已部署 release 一致，公网资源/健康响应正常。本轮没有可用的已登录浏览器控制通道，因此没有把“管理员页面真实视觉点击复验”写成完成；候选部署后仍需用管理员登录态补一次布局、按钮、Network 和 Console 验收。

## 四、生产现场快照

- 主机：`elegant-unicorn-1.localdomain`；
- release：`/opt/pojia/releases/20260831-order-funding-c185d19`；
- migration：043；
- Web/Worker active；Browser Worker inactive；
- 自动开卡 timer 60 秒、funding timer 5 秒、funding reconcile 15 秒、卡目录 5 分钟；
- 活动订单 0、活动任务 0、活动/UNKNOWN funding 0；
- ops/plus 四个 live/ready：HTTP 200；
- 最近 45 分钟相关服务无 warning/error；
- OPEN alerts：2 条余额 info、1 条陈旧等待卡 critical；
- 未执行开卡、补余额、API 充值、Browser 付款、退款或提现。

## 五、代码与验证

本轮候选新增 migration 044，并在全新 MySQL 8.4 从 001 到 044 完整执行成功。

验证结果：

- v1 全量：506 total / 464 passed / 42 environment-skipped / 0 failed；
- 全新 MySQL 8.4 定向集成：41 total / 40 passed / 1 existing skipped / 0 failed；
- Browser：109 total / 105 passed / 4 skipped / 0 failed；
- legacy：14 files / 87 passed / 0 failed；
- `git diff --check`：通过。

## 六、修正后的唯一顺序

1. 完成本轮候选提交与部署前复核；
2. 由用户只确认一次：是否让默认 API 路线长期拥有最小真实充值执行权限；通用 Provider 写、开卡写和 Browser 付款继续独立；
3. 原子部署 migration 044、代码和 systemd unit；
4. 部署后验证：后台不再假就绪、只读 readiness 正确阻断/放行、空闲 3 个周期零 Provider 规则刷新、陈旧提醒关闭、静态资源与 main 一致；
5. API 执行配置一致后，再做首笔真实自动补余额验收；
6. 进入 3–5 单连续 API 运营验证，Browser 非付款线继续并行。

## 七、候选 release

- 候选 HEAD：`d5fb3cf`；
- 本地归档：`/tmp/aicharge-map-audit-d5fb3cf.tar.gz`；
- SHA-256：`71038bb373b95c49b1ff1124337c8fa42659da3283a547ba5ebea122ec1cc8c6`；
- 服务器候选：`/opt/pojia/releases/20260831-map-audit-d5fb3cf`；
- v1 与 browser-mvp 生产依赖已在候选目录干净安装，关键 JS 语法通过；
- 候选未切流，`/opt/pojia/current` 仍指向 `/opt/pojia/releases/20260831-order-funding-c185d19`；
- 使用候选代码对生产数据库执行只读 readiness，准确返回唯一 blocker `api_recharge_execution_disabled`；活动任务、资金风险、未知调用和开放对账案件均为 0。
