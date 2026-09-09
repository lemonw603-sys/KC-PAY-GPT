# AI充值业务｜当前运行模型与验收总册

> **层级**：`PROJECT_MAP.md` 的详细配套，不另行决定优先级。  
> **最后核对**：2026-08-31 23:03 CST。
> **标记**：`[事实]`=代码或运行证据；`[决策]`=用户已确认；`[建议]`=尚未确认/实施，不能当现状。

## 1. 端到端业务链路

| 阶段 | 输入/动作 | 权威状态或证据 | 失败/未知处理 | 当前证据级别 |
|---|---|---|---|---|
| 客户入口 | CDK + Session | CDK 兑换、订单创建、路线冻结 | Session/账号可修复错误回到可恢复状态；CDK 不重复使用 | `[事实]` 生产运行 |
| 派发 | Worker 领取订单任务 | task lease、executor kind | 无能力的 Worker 不领取；租约过期按规则恢复 | `[事实]` 代码/测试 |
| 资源准备 | 找卡、按需刷新证据 | `WAITING_FOR_CARD` / `CARD_READY`、卡运营策略、容量预留 | 可恢复就等待/重试；不把余额不足当坏卡 | `[事实]` 已部署；实单覆盖不全 |
| 自动补余额 | 合格低余额卡精确补差额 | funding attempt `PREPARED→SUBMITTING/PENDING→SETTLED` | 明确未扣款可失败；不明结果 `UNKNOWN`，禁止重补 | `[事实]` 已部署，首笔真实闭环未验收 |
| 自动开卡 | 无合格卡时开目标余额卡 | 唯一库存任务、Provider 卡、卡接管 | 不因 timer 重复开卡；无需求不读取 Provider | `[事实]` 已部署，真实无卡闭环未验收 |
| 付款授权 | 建立唯一 recharge attempt、资金栅栏 | `CARD_READY→SUBMITTING` | 并发/重放复用或拒绝，不产生第二次外部提交 | `[事实]` 付款前演练通过 |
| API 执行 | Provider `create_direct` | Provider call + attempt + 外部订单 | 充值前确定失败可恢复；提交结果未知锁 `SUBMIT_UNKNOWN` | `[事实]` 历史两单成功；当前生产充值 gate=true、只读 preflight 通过 |
| Browser 执行 | Browser job/run、Checkout、付款 | Browser lease、run、payment operation | 付款前失败可恢复；点击后未知只对账不重付 | `[事实]` 非付款/隔离；真实付款未验收 |
| 交付收口 | Plus 确认、取消续费 | `RECHARGE_SUCCESS`、取消标记 | 支付成功但后验未知不能重付，进入核对 | `[事实]` 历史 API 实单 |
| 资金/运营闭环 | 交易、余额、对账、Bark | Provider 交易证据、资金风险、对账案件、通知 outbox | 未决资金优先核对，保留全部历史证据 | `[事实]` 基础存在；连续运营校准未完成 |

## 2. 控制面检查与跳转矩阵

### 2.1 日常控制

| 控制 | 真实作用 | 是否逐单操作 | 当前状态 |
|---|---|---|---|
| 默认充值方式 | API/Browser，订单创建时冻结，只影响新订单 | 否，长期选择 | API |
| 开始营业 | readiness 通过后打开接单+派发 | 否，营业期开一次 | 当前接单/派发已 true |
| 暂停接单 | 停止新订单，不应中止已有订单追踪 | 否 | 已有独立底层能力 |
| 追踪已有订单/交易同步 | 后台持续能力，不应成为每单开关 | 否 | `[决策]` 应常驻 |

### 2.2 “开始营业”检查

| check | 代码条件 | 失败 actionId | 前端去向 | 自动解决？ |
|---|---|---|---|---|
| `EXECUTION_ROUTE` / 未配置 | route 不是 API/BROWSER | `OPEN_PROVIDER_ROUTES` | 卡台路线 | 用户选择 |
| `EXECUTION_ROUTE` / API Worker | Worker heartbeat 健康 | `OPEN_RECONCILIATION` | 对账 | 否，查看运行异常 |
| `EXECUTION_ROUTE` / API 权限 | `rechargeWritesEnabled=true` | **无** | **无** | 否；应为部署常驻配置 |
| `EXECUTION_ROUTE` / Browser | Browser ready | `OPEN_BROWSER_STATUS` | Browser | 否 |
| `CARD_SUPPLY` / 有卡 | available > 0 | 无 | 无 | 已就绪 |
| `CARD_SUPPLY` / 低余额卡 | needsFunding > 0 且 funding 开 | 无 | 无 | 订单到达后自动补 |
| `CARD_SUPPLY` / funding 关 | needsFunding > 0 | `OPEN_CARD_FUNDING` | 卡余额充值 | 用户处理/开启能力 |
| `CARD_SUPPLY` / 无卡可自动开 | 自动补卡+快照新鲜+purchase enabled+默认卡段存在 | 无 | 无 | 订单到达后自动开 |
| `CARD_SUPPLY` / 规则未就绪 | 自动补卡开但规则/卡段不满足 | `REFRESH_PROVIDER_RULES` | 卡片库存 | 用户刷新/选择 |
| `CARD_SUPPLY` / 无卡且补卡关 | 无恢复能力 | `OPEN_CARD_STOCK` | 卡片库存 | 用户处理 |

`[事实]` readiness 不检查具体 Session、账号资格、具体卡的 15 分钟证据或 Provider 最终响应；这些属于逐单运行时门禁。`[已知缺陷]` API 进程权限关闭没有 actionId，但用户又不应被要求逐单操作；正确修复是恢复常驻基线并在后台显示配置漂移，不是增加日常付款按钮。

`[事实边界]` 当前自动补给检查尚不包含独立 runner/timer 心跳、其窄范围进程 gate、开卡日限额/账户资金和未决补给任务；营业后执行能力漂移也不会自动关闭已开的接单/派发。卡 Provider account 当前 `write_enabled=0`，但 stock/funding runner 不以它为门禁；不得将这个字段猜成当前阻断。因此营业检查是“开启瞬间的最小就绪摘要”，不是全链路持续健康保证。本轮已另行只读确认当前 stock/funding runner 和 DB gate 开启。

## 3. 自动补给状态机

### 3.1 最小决策

```text
订单需要卡
  ├─ 有合格且余额足的卡 → 预留容量 → CARD_READY
  ├─ 有潜在合格卡但证据过期 → 只读同步一次 → 重新判定，不同时付费开新卡
  ├─ 有合格低余额卡 + funding 开 → 创建唯一 funding attempt → WAITING_FOR_CARD
  │    ├─ SETTLED → 刷新卡/恢复分配 → 原订单继续
  │    ├─ 明确失败/未扣款 → 清除风险，按规则继续
  │    └─ PENDING/UNKNOWN → 保留资金栅栏，只核对，不重复补钱
  ├─ 无合格卡 + 自动补卡开 → 创建唯一开卡任务 → WAITING_FOR_CARD
  │    └─ 新卡接管/证据就绪 → 原订单继续
  └─ 无恢复能力 → 明确阻断与运营入口
```

- `[决策]` 有卡先补钱，无合格卡才开新卡。
- `[事实]` funding 5 秒 timer 只领取本地任务；15 秒 reconcile 低调用核对；自动开卡 60 秒兜底。订单路径自身立即排任务，不依赖 60 秒后才开始。
- `[事实]` 空闲不做全库存预充值，不高频刷新 Provider。
- `[未验证]` 生产真实精确补额和真实无卡开卡后的订单即时恢复。

## 4. 库存最小模型

库存不是简单的“有卡”或“有钱”，而是**当前订单是否能使用的计算结果**。为避免过度设计，只保留五个维度：

1. 卡健康：Provider 明确可用/永久不可用；
2. 运营策略：Plus 可用、产品专用、永久停用；
3. 资金准备：余额足/可自动补/资金未知；
4. 使用容量：活动订单占用、成功次数预留/已消费、全局上限；
5. 证据状态：资料/交易需按需刷新，抓取失败不等于卡坏。

主视图可收敛为：**可立即使用、系统准备中、需人工处理、永久停用**。原始 Provider 状态、余额、同步时间、交易和历史只在详情/审计保留。`[建议]` 是否实际修改现有后台分类，应以接下来真实订单操作证据决定，不在本次文档纠偏中擅自改 UI。

## 5. 资金幂等与不可跨越边界

- 每次充值只有一个 durable attempt；API 与 Browser 共用资金账。
- 分卡与成功次数在事务内预留；明确未提交才释放；付款后或 UNKNOWN 保留占用。
- Provider 外部调用必须有稳定幂等/operation 证据；重放不得产生第二次提交。
- API 在外部调用前可安全停；外部调用后无权威结果则 `SUBMIT_UNKNOWN`，不能换卡/换路线重付。
- funding `SETTLED` 是历史完成证据，不永久占用新补额；`PREPARED/ACTIVE/UNKNOWN` 阻止并发补额。
- 取消订单不能直接删除 attempt、Provider call 或资金证据；必须走正式状态收敛。

## 6. API 与 Browser 双线

### API

- `[事实]` 历史至少两笔真实订单成功并取消续费。
- `[事实]` 当前 release 付款前链可到 `SUBMITTING`；executor capability 传递缺陷已修。
- `[事实]` 当前生产 Worker API 写权限为 true；2026-08-31 23:02 CST 只读 preflight `ok=true`、`blockers=[]`。
- `[事实]` 最新订单 `PJV1-HfAEiq8dBpDLXzt4t96e` 为 `WAITING_FOR_SESSION`：JSON 语法层已通过并建单，但业务 Session 尚未通过，且无活动 task/资金风险/UNKNOWN Provider call。
- 下一门槛：下一笔有效 Session 的真实订单→3–5 单连续运营。当前 `WAITING_FOR_SESSION` 不算成功验收。

### Browser

- `[决策]` Browser 是未来重点，API 可能后置/退出；但两线共用业务核心。
- `[事实]` 已有 adapter、Session/卡资料合同、租约/WAL、只读 Checkout、付款门禁、生产启动停止演练。
- `[事实]` Browser Worker 当前 inactive/disabled，真实付款未验收，默认 API 不应被它阻断。
- 下一门槛：当前 main/生产合同的非付款闭环→独立确认首笔真实付款→成功后才讨论默认路线切换。

## 7. 通知、监控与对账

| 类型 | 现行规则 | 还缺什么 |
|---|---|---|
| 卡台余额变化 | 变化时写 info 审计并发 Bark；不占后台“内部提醒” | 连续变化/失败投递复核 |
| 低库存 | 自动补给开启时不发不可行动骚扰提醒 | 真实订单下校准是否误报 |
| 等待卡片 | 绑定订单；取消/终态时关闭 | 连续订单复核去重和收口 |
| warning/critical | 后台只展示需要人工动作的 OPEN 项 | 检查每项是否有正确入口 |
| Bark 投递 | outbox 重试，readiness 统计 DEAD | 生产失败演练/运维入口 |
| 对账 | UNKNOWN、Provider/平台差异进入核对，不自动重付 | 连续实单、退款/拒付样本 |
| 费用监控 | 已提出开卡费/手续费/拒付费监控需求 | Provider 费用标准尚未形成已验证动态事实源；待实现 |

## 8. 部署、备份与回滚

- `[事实]` 当前 release：`20260831-prepayment-hold-55b6ec4`。
- `[事实]` 最近可见候选/回滚目录包括 `20260831-map-audit-d5fb3cf`、`20260831-order-funding-c185d19`、`20260831-control-browser-973cb72`；选择回滚点前必须核对 migration 和配置，不凭目录名直接切换。
- `[事实]` 最近加密数据库备份包括 `pojia-20260831T032547Z.sql.gz.enc`、`pojia-20260831T031529Z.sql.gz.enc`，并有对应 SHA-256；hold/unit 配置备份位于 `/var/backups/pojia/prepayment-hold-20260831T034708Z`。
- 发布原则：新建 release，不覆盖旧目录；备份 DB/unit/current；执行 migration；原子切换 current；daemon-reload/restart；核对服务、进程实际 env、readiness、公网 health、日志和资金活动。
- 回滚原则：先阻止新资金任务，再核对当前活动 attempt/UNKNOWN；只在 schema/代码兼容时切 release；恢复对应 unit/drop-in；重跑 readiness。不能用“服务 active”代替业务可执行验证。

## 9. 验收标准

### 恢复营业基线

- Worker `PROVIDER_RECHARGE_WRITES_ENABLED=true`，通用 Provider/普通卡片写/Browser 付款仍 false；hold=false。
- Provider recharge account write=1、circuit closed。
- readiness `ok=true` 且 blockers 为空；无测试残留 task/attempt/资金风险。

### 下一笔真实 API 订单

- 客户正常提交后无需人工找开关；路线冻结 API。
- 资源只读检查可按需重试；付费资源写必须幂等，低余额只有一个精确补额 attempt，无卡只有一个开卡任务，原订单自动继续。
- 外部充值只有一个提交；订单成功、Plus 确认、取消续费、卡交易/余额、对账一致。
- 不出现错误 Bark、重复付款、卡错分或 UNKNOWN 后重付。
- 正常目标 2 分钟；超时仍有路径则继续，不伪造失败。

### Browser 首单前

- 当前 main 的生产非付款闭环通过；Worker/dispatch/profile/heartbeat/lease 恢复通过。
- 付款开关仍关闭时可到最终提交前且提交次数 0。
- 真实付款必须单独确认；结果未知时证明不会第二次点击。

### 放量

3–5 单连续 API → 10–20 单受控并发 → 备份恢复演练 → 才讨论 100–300 单/日。每级都检查时延、API 调用次数、重复付款、资金差异、卡容量和提醒准确性。

## 10. 已知缺陷与未验证项

### 已知缺陷/漂移

1. API 常驻最小写权限已经恢复；仍缺少“权限日后漂移为关闭”时的后台 actionId/明确运维入口，但这不应演变成逐单手动按钮。
2. 候选 `3f23aa3` 已部署并通过部署后只读 preflight；自动补给已通过隔离 MySQL 验证，但真实生产低余额补款和无卡开卡闭环均未验收。
3. 此前地图未随 hold 演练更新，已在 `a5b2299` 修正；维护流程必须实际执行。
4. 当前已登录后台的 v20 完整视觉、点击、Network/Console 交叉验收没有最新证据。
5. 自动补给 readiness 尚不能发现独立 runner/timer 或卡 Provider account 的运行漂移，营业后也不会自动收口已开的接单/派发。
6. `6807/1477` 当前在生产的 Provider status/ACTIVE 历史 assignment 使它无法被新订单分配；必须把“卡实际可用”与“系统当前可分配”分开表达。

### 未验证

- 当前配置恢复后的真实 API 全链路；
- 自动补余额与自动开卡生产闭环；
- 一卡真实跨三单；
- Browser 真实付款；
- 费用变化监控、拒付/退款真实样本；
- 3–5/10–20 单稳定性和恢复演练。

## 11. 单一事实源与更新规则

落盘纪律与文件分工的唯一权威是根级 `CLAUDE.md`（「单一事实源」与「开发纪律」）和 `AGENTS.md`（阅读顺序、完成节点、离开前收尾清单）。本节不再重复维护那张分工表（2026-09-09 改造，用户同意），要点只有一句：**生产事实只在 `CURRENT_STATE.md`，方向在 `DECISIONS.md`，过程在 `HANDOFF_LOG.md`，接班看 `HANDOFF_NOW.md`，运维看 `RUNBOOK.md`。** 本文其余章节（链路、状态机、验收口径）继续作为 `PROJECT_MAP.md` 的详细配套。

## 12. 证据索引

- 当前代码/生产矩阵：`docs/archive/2026-08/2026-08-31_runtime-code-production-alignment-matrix.md`
- 地图权威纠偏：`docs/archive/2026-08/2026-08-31_project-map-authoritative-reconciliation.md`
- 全栈对抗审查：`docs/archive/2026-08/2026-08-31_project-map-full-stack-adversarial-audit.md`
- 两笔真实订单审查：`docs/archive/2026-08/2026-08-31_two-real-orders_full-chain-audit.md`
- 付款前 hold：`docs/archive/2026-08/2026-08-31_production-prepayment-hold-rehearsal.md`
- 自动补余额候选：`docs/archive/2026-08/2026-08-31_order-driven-card-funding-production-candidate.md`
- 卡同步机制：`docs/archive/2026-08/2026-08-30_card-sync-mechanism-audit.md`
- Browser 最新生产非付款结果：`docs/archive/2026-08/2026-08-30_browser-production-nonpayment-window-result.md`
- Browser 门禁审查：`docs/archive/2026-08/2026-08-29_browser-gate-adversarial-review.md`

## 2026-09-05｜就绪声明的证据门禁（新增）

此前将“代码/本地测试准备好”错误表述为“生产真实 Browser 已准备好”。今后任何“可以开始”声明必须同时列出并现场证明：

1. 生产 release 与 commit；
2. Web/Worker/Browser Worker 实际状态；
3. Browser target 是否为真实执行目标而非 `LOCAL_FIXTURE`；
4. 路线、Provider 写权限和资金开关；
5. 当前订单/任务是否已出现并可观测；
6. 账单地址、卡、Session、Profile 的当前证据；
7. 明确区分“代码通过”“只读预检通过”“真实订单可执行”“付款已验收”。

缺一项不得使用“已准备好/已跑通”表述；必须说明缺口和下一项可逆动作。每单不重复完整体检，但第一次、部署后、路线/Profile/代理变更和异常恢复必须重新执行对应层级检查。

## 2026-09-05｜路线一致性硬门禁

- 提交前读取后台当前默认充值方式。
- 提交后读取订单冻结的 `executor_kind`；Browser 订单必须出现对应 Browser dispatch job/run，API 订单不得被称为 Browser 测试。
- 订单路线一旦冻结不允许静默切换；若路线错误，先停止并走明确的订单处置策略，禁止重复提交 CDK 猜测修复。
