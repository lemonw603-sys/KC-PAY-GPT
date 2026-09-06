# BRFE 主规划完整性审查（2026-08-23）

## 审查目的

核对新主规划是否覆盖用户确认的总需求、Browser 基线、实施总计划、赛马合同以及订单/CDK/卡片/资金栅栏/审计/恢复接口。本文只做规划完整性审查；不代表生产、真实 Session、菲律宾出口或真实付款已经验证。

## 证据分类

- **代码证据**：仓库中的实现、迁移和接口。
- **测试证据**：本地 mock、隔离 MySQL、soak 或故障注入结果。
- **数据库/网络证据**：隔离数据库拓扑、HTTP/页面/代理观测；必须注明环境。
- **生产证据**：真实生产只读或受控写入。本审查没有新增生产证据。
- **历史聊天证据**：用户曾确认的方向，不能替代运行验证。
- **未核验**：尚无可复现证据，不能晋级或外推。

## 已发现的遗漏或表达不足

### P0：必须补进主规划的业务不变量/接口

1. **最终成功不是支付成功**：必须同时确认 Plus 激活和自动续费取消；支付成功但取消未知进入 `CANCELLATION_PENDING`，不能重付（基线/代码+隔离测试；生产未核验）。
2. **付款许可与资金状态机**：`PAYMENT_ARMED → PAYMENT_SUBMITTING → PAYMENT_UNKNOWN/SETTLED`、permit 一次性消费、同事务锁账、未知后只允许 reconcile-only（合同/代码+测试；真实支付未核验）。
3. **Browser attempt 映射边界**：复用唯一 `recharge_attempts`；Browser route 的 `provider_account_id` 可为空；页面动作写 `browser_runs/checkpoints`，不伪造 `provider_calls.create_direct`（基线/代码+测试）。
4. **订单、账号、卡片、Checkout artifact、控制权五类互斥**：同订单/账号/卡片不得并发；同账号最多一个活动 run 和一个活动 artifact；人工接管与 Worker 不能同时持有输入控制权（合同/迁移/测试）。
5. **Session 生命周期**：仓库外 `0600`、显式 Cookie 家族、内存优先、旧 Session 不长期保存、账号身份必须比对；更换次数/72 小时规则仍归订单核心负责（基线/代码+隔离测试；真实页面未核验）。
6. **卡片与资金归属**：默认一卡一单；卡必须合格库存；付款未知或争议卡不得释放/复用；卡 recharge pending 不换幂等键重打（总需求/卡片合同/代码+测试）。
7. **Checkout artifact**：完整 URL/fragment 只能进加密短期 vault；普通库、任务、日志、截图、HAR、通知只保留 opaque ref/hash；过期或打不开不能仅凭时间重建（合同/代码+MySQL 测试）。
8. **停止开关分离**：停止新订单/派发不停止已付款订单的激活确认、取消续费和对账；付款写开关、订单派发权限、实验 kill switch 必须分别可审计（基线/总计划/后台合同；部分代码证据）。
9. **人工接管合同**：`REQUESTED→FROZEN→TRANSFERRED→RELEASED`，step-up、确认词、幂等 operation、同 Context、未知时锁账；远程流媒体/桌面通道仍未实现（合同/代码+本地测试；生产未核验）。
10. **赛马胜出与指标**：按 cohort 比较流程闭环、账号安全、恢复、证据完整性、成本和人工率；Checkout 后不得切 lane；最终一个 champion、最多一个 fallback（合同/历史聊天/代码合同测试；真实 cohort 未核验）。

### P1：主规划应明确但不阻塞当前本地阶段

11. HNSKJ 卡库存、开卡、补余额、交易同步、自动补卡上限与 Browser attempt 的卡绑定时序。
12. CDK→订单→Session→卡片→attempt→run→交易→Plus/取消→审计/对账的双向追溯和客户/后台字段分层。
13. `PAYMENT_UNKNOWN`、`RECONCILIATION_REQUIRED`、取消待确认、账号已 Plus、页面漂移、3DS/验证码等异常的恢复矩阵和禁止动作。
14. 24 小时/350 单仿真的真实分母：突发到达、无效 Session、代理不足、卡拒绝、3DS、人工 SLA、对账积压；不能只测均匀成功脚本。
15. 告警、runbook、证据保留/销毁、敏感数据不进入日志/trace/HAR，以及数据库主从/故障转移证据缺口。
16. 运营后台只读时间线、异常恢复台、Worker 下线、批次指标、危险操作 step-up；不得用“强制成功”覆盖未知状态。

## 明确冲突（先列出，再采用的处理）

| 冲突 | 影响 | 处理 |
|---|---|---|
| 新主规划为 A 并行 soak、B 本地 mock 已通过；旧 `BRFE_HANDOFF`/旧 roadmap 仍写“当前阶段 1、不得进入阶段 2” | 新模型会误判停止点 | 以本主规划为 BRFE 当前入口；A 仍未最终关闭，B 仅是无付款本地子闸门，可并行；外部/PH/付款仍被 A-D 闸门阻止 |
| 总实施计划的 P1-P8 是全业务路线；BRFE 主规划的 A-E 是 Browser 子项目路线 | 可能把两种阶段编号混为一谈 | 在交接入口同时标注“全业务阶段”和“BRFE 子项目阶段”，Browser 不替代总业务阶段 |
| 目标容量写有 200–300 单/日、350 单/24h 仿真、用户曾提“几百单” | 容量口径不一致 | 规划层保留 350 作为仿真门槛、200–300 作为首期运营目标；真实容量必须以端到端分母和受控证据重新冻结 |
| US VPN 可做观察；PH 出口仍缺失 | 把 US 结果外推 PH | US 只属于 `NON_PH_US` cohort；PH 必须新 manifest/cohort，不能覆盖或晋级 |
| 历史“Provider route/permit”命名与 Browser 不同 | 可能伪造 Provider 调用或引入第二账 | Browser route 不要求 Provider account、不写伪造 `provider_calls.create_direct`；只复用 attempt/资金/审计接口 |

## 审查结论

原主规划已覆盖方向、阶段、赛马、证据和停止原则，但对上述 P0/P1 业务接口与退出证据写得过于概括，确实不足以让下一模型无歧义接手。已将遗漏补入主规划，并把旧交接入口标为历史状态，避免“阶段 1/阶段 2”冲突继续制造噪音。

## 仍未核验

没有新增生产证据；真实客户 Session、菲律宾 sticky 出口、真实 Checkout/支付、真实 Plus 激活/取消、生产容量和账号风控概率仍未验证。

本次后续对抗审查另见 `docs/archive/2026-08/2026-08-23_browser-master-plan-adversarial-review.md`；它将 A 拆为 A1/A2，并收窄 D 的 Checkout 观察边界。
