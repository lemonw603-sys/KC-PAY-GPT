# BRFE 主规划与阶段闸门（2026-08-23）

## 目标

在不建立第二套业务系统的前提下，把现有订单、CDK、卡片、资金栅栏、审计和异常恢复接到可持续的 Browser Plus 履约链路。首要交付目标是流程真实闭环；账号安全和降低误判风险是并列放行闸门。

## 大阶段

## 赛马机制（贯穿阶段 C-D，服务于阶段 E 选择）

赛马是 BRFE 内部的多 lane 实验机制，不是第二套业务系统。所有 lane 共享现有订单、资金栅栏、审计、对账和后台；Runtime、Cookie/Session、网络出口和页面适配作为可替换实验轴，实验数据按 cohort 隔离。

- `AUTH_READ_ONLY` 可以同账号做平衡顺序的只读配对，但禁止创建 Checkout；
- `CHECKOUT_MUTATING` 只能使用隔离账号 cohort，且同一账号/窗口不能被第二条 lane 创建 Checkout；
- Checkout 创建前可以做 lane 预路由；创建后 route 冻结，不能自动切 lane；
- 付款结果未知、页面挑战或无法解释的异常时，停止该 run/lane，不换卡、不重付、不自动切换；
- 赛马胜出规则必须同时考虑流程闭环、账号安全、异常恢复、证据完整性和运营成本；
- 正式路线最多一个 champion 和一个在 Checkout 创建前可选的预验证 fallback，其余 lane 留证后归档。

### A. 控制面稳定性

范围：dispatch、lease、Worker 崩溃/接管、数据库连接恢复、队列积压、资源趋势和长 soak。

退出条件分两层：A1 控制面稳定性在隔离 soak/故障注入中无漏领/重复、未知状态不重付、残留为 0、资源趋势可解释；A2 高可用拓扑证据需要双节点/代理或等价隔离拓扑。当前单 MySQL 拓扑只能完成 A1，A2 标记 `NOT_AVAILABLE_IN_TEST_TOPOLOGY`，不得冒充生产高可用。

### B. 本地 Browser 执行

范围：真实 Playwright + 本地 mock 页面、Context 隔离、页面漂移、popup、多页面、租约中断、人工冻结、checkpoint 和审计。

退出条件：本地执行闭环通过，敏感动作可 fail-closed，租约/人工冻结能抢占；不使用真实 Session、外部页面或付款。

### C. 非 PH 只读观察

输入层：`NON_PH_FUNCTIONAL`。`NON_PH_US` 仅保留历史实验材料，不再作为当前主线输入或晋级候选。

范围：服务器身份 probe、只读页面事实、Session Loader 和脱敏证据。

退出条件：输入合法、身份事实可解释、页面结果与网络限制分开记录；不创建 Checkout，不产生价格/付款/PH 风控结论。

### D. 菲律宾生产相似输入

输入层：`PH_GENERIC` 或 `PH_STICKY_PRODUCTION_LIKE`，必须新建 manifest/cohort；菲律宾 VPN 到位后直接建立 PH 输入，不把美国 VPN 作为前置或对照依赖。

范围：菲律宾出口、账号/网络配对和页面事实的只读观察。默认不创建 Checkout、不写支付；如需观察 Checkout，必须新建 `CHECKOUT_MUTATING` 隔离 cohort、独立 manifest、一次 `checkout_create_grant`，并在当次操作确认后执行；仍禁止填写真实卡和点击付款。

退出条件：网络证据、账号 cohort、页面和价格事实可复现；任何异常按 cohort/runtime/profile/network 冻结，不自动换路或重付。没有仓库外 `0600` Session 输入时，只做 manifest/观察器/脱敏证据测试，不宣称真实账号观察结果。

### E. 受控真实履约

只有 A-D 通过且用户当次明确确认后，才进入真实 Checkout/付款设计、卡台协同、灰度和生产接入。未知付款结果必须先对账，不能重付。

## 横向控制轨道

1. **证据轨道**：每个结论标记为生产证据、数据库/网络证据、代码证据、测试证据、历史聊天证据或未核验内容。
2. **偏差轨道**：发现旧结论、当前代码和新要求冲突时，先写冲突清单、影响和备选方案，不自行静默选择。
3. **安全轨道**：账号、Session、订单、attempt、Checkout artifact 和 runtime/profile/network 隔离；挑战、漂移、租约丢失和未知结果立即停手。
4. **恢复轨道**：每阶段都要有暂停、人工接管、回滚/清理和重启恢复证据；不可逆操作前必须停下确认。
5. **交接轨道**：重大节点同步 Browser 状态、`DECISIONS.md`、合同/报告、主规划和 BRFE 接班入口。
6. **资源轨道**：24 小时等长 soak 使用 detached runner，不依赖聊天窗口；长任务结果以日志、进程状态和独立数据库查询为准。

## 业务不变量与接口覆盖（每个阶段都必须引用）

1. **订单链路**：CDK→订单→Session 恢复→合格卡→唯一 `recharge_attempt`→`browser_run`→交易/页面检查点→Plus 激活→取消续费→审计/对账；Browser 不创建第二订单或第二资金账。
2. **Provider 边界**：Browser route 不要求 Provider account，不写伪造 `provider_calls.create_direct`；`provider_account_id` 可为空，执行配置由 `executor_profile_id`/版本冻结表达。
3. **资金边界**：`PAYMENT_ARMED` 后必须获得一次性 permit；`PAYMENT_SUBMITTING`、permit 消费、attempt 风险状态原子提交。任何未知结果进入 `PAYMENT_UNKNOWN/RECONCILE_ONLY`，禁止重付、换卡、换 Worker、换 lane。
4. **成功定义**：支付/开通成功不等于最终成功；必须再确认 Plus 与 `is_subscription_cancelled=1`，取消未知只能进入 `CANCELLATION_PENDING`/人工复核。
5. **资源互斥**：订单、账号、卡片、Checkout artifact、`CONTROL_OWNER` 各自持久化租约；同账号最多一个活动 run/artifact，人工和自动 Worker 不得同时输入。
6. **Session/敏感数据**：Session 输入在仓库外 `0600`、显式 Cookie 家族、内存优先；dispatch/日志/trace/HAR/普通库仅保存引用、哈希和脱敏证据，完整 authority 只进短期加密 vault。
7. **卡与库存**：默认一卡一单；资金未知、消费、退款/争议或隔离卡不得释放/复用；卡充值 pending 不得换幂等键重打。
8. **停止与恢复**：停止新接单与停止派发分开；不影响既有订单的激活确认、取消和对账。异常矩阵、人工接管、清理/销毁、重启恢复必须有独立证据。

## 阶段退出证据矩阵

| 阶段 | 可声称 | 不可声称 | 关键证据 |
|---|---|---|---|
| A | 控制面在隔离拓扑的稳定性结果 | 生产高可用、真实付款安全 | soak、故障注入、残留查询、拓扑说明 |
| B | 本地 BrowserContext/页面适配 fail-closed | 外部页面、真实 Session、真实账号行为 | Playwright mock 集成、漂移/租约/冻结测试 |
| C | 非 PH 只读身份/页面事实（按 cohort） | PH 价格/支付/风控、充值成功 | manifest、网络/HTTP/页面脱敏证据 |
| D | PH 生产相似输入下的可复现只读/受控观察 | 生产容量或账号封控概率 | PH manifest、出口证明、cohort 报告、对抗审查 |
| E | 经当次确认的受控真实履约 | 未经确认的生产放量、未知后重付 | 单笔/小批真实订单、交易/Plus/取消/对账闭环 |

## 重大偏差处理

以下情况必须暂停当前阶段并回对本规划：改变默认网络依赖、把 US cohort 晋级为 PH、引入真实 Session/Checkout、修改资金状态机、增加自动重试/换路、发现生产写入或付款路径、或任何证据类别被误写成另一类证据。

## 当前停止点

- 主线：阶段 B 已通过本地 mock 子闸门，准备进入阶段 C 前置；C 当前只采用 `NON_PH_FUNCTIONAL`，不再推进 `NON_PH_US`；
- 并行：阶段 A detached 24 小时隔离 soak 已完成本轮窄证据（360/360 claim、0 duplicate、360 heartbeat、残留 0）；A1 仍保留网络级故障轴未关闭，A2 为 `NOT_AVAILABLE_IN_TEST_TOPOLOGY`。
- 生产：未接入；真实开卡、Checkout、付款和菲律宾 cohort 未执行。
