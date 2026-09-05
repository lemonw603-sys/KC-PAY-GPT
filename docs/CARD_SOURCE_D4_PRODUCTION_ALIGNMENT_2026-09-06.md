# 卡台来源与对账收敛｜D4 生产部署前对齐

> 核对时间：2026-09-06（Asia/Shanghai）  
> 状态：D4 已完成现场核对；发现生产发布一致性阻断，D5 暂不得开始。  
> 边界：除停止故障自动开卡 timer 与关闭其数据库总开关外，未部署、未迁移、未导入卡片、未启动 Browser Worker、未付款。

## 1. 当前生产原始事实

- `current`：`/opt/pojia/releases/20260905-browser-zero-tax-04e08e6`。
- Web、API Worker：`active`；`/health/live={"status":"ok"}`，`/health/ready={"status":"ready"}`。
- Browser systemd Worker：`inactive/disabled`；数据库 `browser_payment_writes_enabled=false`。
- 数据库：MySQL 8.4.11 容器运行正常；最高 migration 为 `047_browser_billing_address_assignments`。
- migration 048 的 5 张新表、订单冻结来源字段及 Browser 付款核实字段均不存在，符合“尚未部署”的边界。
- 路线：API `accepts_new_orders=0`，Browser `accepts_new_orders=1`；Browser dispatch 开启，但 Browser heartbeat 为空，远程 Browser Worker 未运行。
- 未决资金与执行：ACTIVE/UNKNOWN recharge attempt=0、ACTIVE/UNKNOWN funding attempt=0、RUNNING task=0、OPEN/ASSIGNED reconciliation case=0、活动 Browser run/dispatch=0。
- 最新加密备份完整性校验 `OK`；D5 前仍须创建并验证一份当时的新备份。

## 2. migration 048 前滚核对

- 生产共有约 20 个订单、11 张卡、20 条 Browser run，相关表很小；现有订单与路线、路线与卡账户均无孤儿引用。
- 在隔离 MySQL 8.4 中从 migration 001 顺序执行到 047，加入 API/Browser 代表旧订单后执行 048：成功，用时约 `0.441s`。
- 旧 API 与 Browser 订单的 `frozen_card_provider_account_id` 均成功回填；Browser 当前来源、备用卡账户、付款核实字段均建立成功。
- 048 是增量结构。代码回滚时结构可以保留，旧代码会忽略新列/表；不得在已有新订单写入冻结来源后盲目删除结构。
- MySQL DDL 不是整体事务；D5 必须先新建并验证备份，迁移失败时不得反复执行或继续切换 release，应从最早失败语句判断是前滚修复还是恢复备份。

## 3. 生产发布一致性阻断

以 release 名称中的提交 `04e08e6` 为预期，对生产受控目录做完整 SHA-256 对比：

```text
expected=231
actual=233
same=204
changed=27
missing=0
extra=2
```

27 个不一致文件包含订单/任务/库存/补款/Browser repository、Provider、服务端、后台和客户页。现场进一步把生产 blob 对回 Git 历史，确认不同文件分别来自多个更早提交。该 release 是在旧 release 上做 Browser-only 逐文件覆盖形成的组合产物，不能再把目录名中的 commit 当作整套生产代码版本。

这是机制性问题：此前只校验本轮改动的少数 Browser 文件，没有校验整个 release 是否等于一个确定提交，因此旧业务代码被后续局部发布继续携带。

## 4. 自动开卡故障与止损

生产旧 `workflow-repository.js` 会在同一 `WAITING_FOR_CARD` 订单每次重试时重新插入开卡任务，只排除 PENDING/RUNNING，不排除已经明确 `REVIEW_REQUIRED` 的同一需求。60 秒 timer 随后逐个领取并再次调用卡台。

现场观察：

- 停止前累计 969 条卡库存任务，其中大量为 `AUTOMATIC/REVIEW_REQUIRED/PROVIDER`；
- 本轮故障窗口任务 `opened_count` 合计为 0，数据库没有新增卡；
- 资金 attempt 中没有 ACTIVE/UNKNOWN；
- 不能因为“没有开卡成功”而保留这种无限新任务机制。

用户确认该每分钟自动开卡机制无需恢复后，已执行：

- `pojia-card-stock-runner.timer=inactive/disabled`；
- `pojia-card-stock-runner.service=inactive`；
- `app_settings.card_auto_replenishment_enabled=false`，并写入 `admin_setting_events`；
- 等待超过一个完整周期后，任务总数和最新创建时间均未变化（仍为 969，最新 `2026-09-05T22:32:12.365Z`）；
- Web/API Worker 保持 active，API/Browser 路线、只读同步和独立补余额机制未被关闭。

未来不得恢复该 timer 架构。自动开卡若重新上线，必须改为订单需求触发、同一需求唯一任务、明确失败停止、有界恢复，并独立验收。

## 5. D5 前阻断与唯一下一步

1. 从一个确定提交使用 `git archive` 构建完整候选，禁止复制旧 release 后逐文件覆盖。
2. 候选生成全量 tracked-file manifest；上传后逐项验证，任何 changed/missing 均禁止切换。
3. 将已经在主线修复的“订单重试不直接创建付费开卡任务”包含进完整候选。
4. 明确保留自动开卡 timer 为 disabled，不随部署恢复。
5. 对 969 条历史任务只做保留证据后的状态收敛，不物理删除；执行前另做数据影响清单。
6. 部署窗口再次核对路线、Browser heartbeat、未决资金、活动任务和新备份，再执行 migration 048。

D4 结论：migration 048 本身具备小表前滚候选条件；生产 release 混装与自动开卡任务风暴已被识别并完成止损。发布机制修复提交为 `8012da8`：新增单一 commit 归档器与全量 verifier，删除旧自动开卡 timer 部署单元；修改、缺失、额外文件三类反例均能失败关闭。由该提交生成的本地候选位于 `artifacts/release-candidate-20260906-8012da8/`，825 个 tracked 文件校验通过。当前生产仍未部署该候选；D5 只能在用户单独确认、创建新备份并再次核对运行状态后开始。
