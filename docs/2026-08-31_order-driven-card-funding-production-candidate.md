# 2026-08-31｜订单驱动自动补余额生产候选

## 结论

运营控制面已部署，但自动补余额此前只能算“账本和编排存在”，不能算生产完成：生产 funding timer 关闭，旧 systemd unit 即使启用也会因卡写权限为 false 立即失败。现已直接修正并形成候选 `95ee5ad`；普通发布仍不会产生资金写入，受控启用和真实小额验收需要单独确认。

## 本轮直接修正

1. systemd unit 只开放 `PROVIDER_CARD_WRITES_ENABLED=true`，同时新增独立 `CARD_FUNDING_EXECUTION_ENABLED=false` 硬门禁；Web、API 充值和 Browser 付款权限不随之开放。
2. 自动补余额改为订单驱动。没有客户订单时不扫描、也不预充所有低余额卡；生产能力开关关闭时不创建 attempt、不执行已有 PREPARED。
3. 客户订单遇到合格低余额卡时创建唯一 PREPARED attempt；订单任务 5 秒重试，funding timer 5 秒领取，满足 API 两分钟内资源准备目标。
4. PENDING 对账每 15 秒先读取一次余额；余额未达到目标时不读取交易列表，达到目标后才读一次交易并更新库存，减少按次收费 API 调用。
5. 补余额 PREPARED、ACTIVE、UNKNOWN 均阻止卡片被订单分配；Provider 已接受但本地提交失败一律 UNKNOWN，禁止自动重付。
6. 对账成功使用同一次卡详情响应把卡片从 DEPLETED 恢复为 AVAILABLE，等待订单随后自动重试分配；不再要求第二次重复卡详情读取。
7. 等待卡片的订单若在 Provider 写入前取消，会同步取消 PREPARED 补余额和尚未开始的自动开卡任务；已进入 Provider 侧的资金动作继续只做账本对账，不伪装成“从未发生”。
8. 删除无订单也会扫描并预充低余额卡的旧 scheduler，避免多余资金占用和 API 调用。

## 对抗式审查发现并修正的问题

- 旧 service 与 runner 权限合同互相冲突，启用必失败。
- 补余额对账成功后只更新余额、不恢复库存分类，订单可能永久等待。
- 卡片在资金 PENDING/UNKNOWN 时仍可能进入可分配查询。
- Provider 已接受后本地落账失败可能被错误清成 definite failure，带来再次补钱风险。
- 控制面仍把低余额卡永久视为阻塞，没有识别已启用的自动补余额能力。
- 等待订单取消后，尚未提交的补余额/开卡任务可能继续执行。

以上均已修正，不只记录。

## 验证

- 全新临时 MySQL 8.4，migration 001–043 全部成功。
- v1 串行全量：498 total / 497 passed / 1 既有 fake-provider skipped / 0 failed。
- v1 无数据库全量：498 total / 456 passed / 42 environment-skipped / 0 failed。
- Legacy：87/87。
- Browser：109 total / 105 passed / 4 database-skipped / 0 failed。
- `git diff --check` 通过。
- 生产只读预检：当前 release `20260831-control-browser-973cb72`；Web/Worker/库存 timer 正常；funding timer inactive/disabled；只读 reconcile timer active/enabled；`card_balance_recharge_enabled=false`；无 WAITING_FOR_CARD 订单；无 PREPARED/ACTIVE/UNKNOWN funding attempt。

## 发布与启用边界

第一步可直接发布候选代码与 unit，但保持：

- `CARD_FUNDING_EXECUTION_ENABLED=false`；
- `card_balance_recharge_enabled=false`；
- `pojia-card-funding.timer` disabled；
- API/Browser 付款权限不变。

发布后只读验收通过，再申请一次确认，同时开启独立 gate、数据库能力开关和 funding timer。真实验收只选择一张明确允许补余额的低余额卡，记录补前余额、精确补款、Provider 调用次数、交易证据和补后订单恢复；出现 UNKNOWN 立即停止，不自动再补。

## 发布结果

- 已发布 release：`/opt/pojia/releases/20260831-order-funding-c185d19`。
- 回滚点：`/opt/pojia/releases/20260831-control-browser-973cb72`。
- 部署前加密备份：`/var/backups/pojia/pojia-20260831T015201Z.sql.gz.enc`，完整性 OK。
- systemd unit 备份：`/var/backups/pojia/funding-units-20260831T015159Z`。
- Web/Worker active；库存 timer active/enabled；只读 funding reconcile timer 已按新 unit 重启为 15 秒；Browser Worker inactive/disabled。
- paid funding timer 仍为 inactive/disabled；独立 `CARD_FUNDING_EXECUTION_ENABLED=false`；数据库 `card_balance_recharge_enabled=false`。
- 数据库无 PREPARED/ACTIVE/UNKNOWN funding attempt、无 WAITING_FOR_CARD 订单。
- ops/plus 四个公网 live/ready 均 HTTP 200；`pojia-ops check`、备份完整性和最近日志检查通过。
- 本次发布未执行卡余额充值、开卡、API/Browser 付款、退款或提现。


## 生产开启结果

- 用户于 2026-08-31 明确确认开启。
- 第一次操作脚本在变更前因 heredoc 语法错误退出；复核 timer、drop-in 和数据库后确认没有部分变更，再执行修正版。
- 开启备份：`/var/backups/pojia/funding-enable-20260831T020605Z`。
- systemd：`pojia-card-funding.timer` active/enabled；drop-in 将独立 gate 设为 `CARD_FUNDING_EXECUTION_ENABLED=true`。基础 unit 继续将 API/订单充值权限设为 false，只在 funding 进程内窄开 `PROVIDER_CARD_WRITES_ENABLED=true`。
- 数据库：`card_balance_recharge_enabled=true`，审计 actor/reason 已记录。
- 空闲验收：无等待卡订单，无 PREPARED/ACTIVE/PENDING/UNKNOWN 资金任务；开启后 `card_recharge` Provider 调用为 0；runner 仅返回 `{"handled":false}`。
- 系统验收：Web/Worker、funding/reconcile timers 正常；Browser Worker 保持关闭；公网健康、`pojia-ops check`、备份完整性和日志检查通过。
- 尚未执行真实补余额，因此候选的最后退出条件仍是首笔订单驱动真实补差额：必须证明唯一 Provider 写调用、幂等键、到账与交易证据、库存恢复和订单自动继续；UNKNOWN 不重试。
