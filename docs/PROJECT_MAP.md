# AI充值业务｜唯一项目规划地图

> **用途**：只回答四件事：项目目标、当前生产事实、已完成/未完成、唯一执行顺序。
> **最后统一核对**：2026-09-02 00:32 CST。已对照前后端代码，并通过 SSH 复核部署后的生产 release、systemd、Worker 实际进程环境、只读 readiness 和新卡实时库存；本轮未执行 Provider 写入或付款。
> 历史报告不能覆盖本地图；实时生产事实优先，变化后必须同步更新本地图与 `CURRENT_STATE.md`。
> 全链路、控制矩阵、自动补给状态机、库存最小模型、资金边界、通知、回滚和验收细则统一见 `docs/PROJECT_OPERATING_MODEL.md`。

## 1. 已确认的目标和原则

1. Plus 运营后台是中枢：客户提交 CDK + Session 后，系统应尽快自行完成资源准备和充值，不能要求运营逐单寻找底层开关。
2. API 与 Browser 共用订单、卡片、消费次数、资金栅栏和审计；默认充值方式是一个全局选择，只影响新订单，不做逐单路线选择。
3. API 正常目标 2 分钟内，Browser 正常目标 5 分钟内；超过目标但仍能继续时保持处理中，不因超时自动转人工。
4. 有合格卡但余额不足时优先精确补足；没有合格卡时自动开一张带目标余额的新卡。无真实需求时不轮询卡台做无效付费读取。
5. Provider **API 最小充值执行权限是生产常驻能力**，不是日常营业开关；已确认目标基线是只开 `PROVIDER_RECHARGE_WRITES_ENABLED=true`，通用 Provider 写、卡片写与 Browser 付款权限分别控制。
6. 资金结果未知时不重付、不换卡、不换路线；防重复付款、唯一 attempt、资金栅栏和审计保留。
7. 一卡可跨订单顺序复用，后台全局设置成功次数上限 1–4，当前确认值为 3；同一时刻一张卡只服务一个活动订单。
8. 当前旧失效批次（含 8590）永久停用；4744 仅用于 Claude；6807 按实时资格使用。未来新卡不继承旧批次结论。
9. 系统为个人内部使用：优先跑通、顺畅、稳定、资金安全；不因过度敏感信息隔离或推测性指标扩大系统。
10. 真实订单、交易、退款、资金和审计证据不物理删除；后台简化以合并、下沉和隐藏噪音为主。

## 2. 业务主链

```text
客户提交 CDK + Session
  → 创建订单并冻结当前默认路线
  → 立即检查卡片资格与余额
  → 有低余额合格卡：精确补足；无合格卡：自动开目标余额卡
  → 建立唯一充值 attempt / 资金栅栏
  → API 或 Browser 执行
  → 确认 Plus、取消续费、同步交易/余额、对账与通知
```

15 分钟资料/交易新鲜度是**订单触发的按需刷新条件**，不是“订单超过 15 分钟就失败”的期限。

## 3. 当前生产事实（现场核对）

| 项目 | 当前事实 | 证据/含义 |
|---|---|---|
| 生产 release | `/opt/pojia/releases/20260901-browser-access-block-7bad460f26d311d8f15103c86933a276cf4b9d14` | 已部署 Browser 访问阻断重试修复；直接回滚点为 `20260901-provider-reason-569e8ee` |
| Web / API Worker | active / active | systemd 现场读取 |
| Browser Worker | inactive / disabled | 本轮短暂启动完成非付款测试后已停止；未进入真实 Browser 付款 |
| 接单 / 派发 | true / true | 只读 readiness；当前后台已处于营业业务状态 |
| 默认路线 | API | 只读 readiness |
| Worker 最终 API 充值能力 | **true** | 已安装最小权限 drop-in，重启后进程环境为 `PROVIDER_RECHARGE_WRITES_ENABLED=true` |
| Provider recharge account | `write_enabled=1` | 数据库只读核对；Worker 进程充值 gate 同样为 true，当前可执行 |
| Provider card account | `write_enabled=0`，circuit=CLOSED | 当前 stock/funding runner **不以该字段为写门禁**，而以各自窄范围进程 gate 为准；这个语义不一致需在后续收敛，不得猜测它当前会阻断补给 |
| readiness | **只读 preflight 通过** | 2026-09-01 15:54 CST：`ok=true`、`blockers=[]`、Worker heartbeat 2 秒；这不等于逐单 Session/账号/Provider 最终结果已验证 |
| 通用 Provider / 卡片写 | false / false | Worker 进程环境 |
| 独立自动补余额 | DB gate=true；`pojia-card-funding.timer` 与 reconcile timer active/enabled | 独立 runner 只开补余额所需卡片写；空闲零写已验证，首笔真实补余额未验收 |
| 独立自动开卡 | DB gate=true；`pojia-card-stock-runner.timer` active/enabled，60 秒兜底 | stock runner 只开开卡所需卡片写；真实缺卡订单闭环未验收 |
| 当前 Plus 可立即分配 | **1 张** | 本轮自动开卡生成新卡 `provider_card_id=2338`、尾号 `4643`，余额 `$16`，测试订单取消后已释放为 `AVAILABLE`；旧批次均 `RETIRED`，4744 为 Claude 专用 |
| 每卡成功次数上限 | 3 | 已部署；连续跨订单实证仍不足 |
| 活动任务/资金风险/开放对账 | 0 / 0 / 0 | 2026-09-01 15:54 CST 只读 preflight |
| 最新 migration | 044 | 只读 readiness |
| 最新订单 | `PJV1-412JIT_yfiuBpZeC39_m`=`RECHARGE_FAILED` | API 订单完成一次提交与轮询；Provider 返回明确失败“卡片被拒，请换卡后重提”，外部订单号 `8849`，资金风险已清除，无成功付款；卡片按失败策略保留为不可直接分配，待后续核对 |

**当前状态**：API 最小充值权限、接单、自动派发、自动开卡和自动补余额均已开启；生产只读 preflight `ok=true/blockers=[]`。当前没有 Plus 可分配卡，下一笔有效 API 订单应进入“无合格卡→自动开新卡”分支，而不是给旧卡补余额。

### 最新拒付的证据边界

订单 `PJV1-412JIT_yfiuBpZeC39_m` 已现场复查：ZZSHU 订单 `8849` 明确返回 `failed`/“卡片被拒，请换卡后重提”，目标账号套餐为 `free`；HNSKJ 卡 `1839/1013` 为 `active`、`$16`、资料完整且无 PURCHASE 交易。故障已收敛到“上游支付处理方拒绝该卡”，不能从现有响应进一步断言具体银行、3DS、CVV、BIN、地区或余额原因。订单已清账，不得自动换卡重付。证据报告：`docs/2026-09-01_order-412JIT-card-decline-investigation.md`。

用户已在卡台删除/停用该卡；最新只读状态为 `invalidating/$0.01`，本地已同步。失败订单的 ACTIVE assignment 仍保留作为审计证据，不参与新订单资格计算。

该单暴露的后台失败原因噪音已部署修复：生产只读投影已返回 attempt 中经脱敏的真实 Provider 原文“卡片被拒，请换卡后重提”；未来确认失败也会把该原文落到订单主表，通用失败文案只作为无原文时的兜底。

库存口径更正：旧批次未绑定卡不是“余额不足可补款”，而是已确认因服务器更换永久不可用，`card_operational_overrides` 均为 `RETIRED`；4744/1065 为 Claude 专用。它们不得进入自动补余额或新订单分配。只有未来新接管且通过实时证据的卡才纳入 Plus 库存。

## 4. “开始营业”真实合同（按代码核对）

点击“开始营业”时，系统会重新读取概览和卡库存并检查：

| 检查 | 通过/自动处理 | 失败后的当前入口 |
|---|---|---|
| 默认路线 | API 或 Browser 可识别 | 跳到“卡台路线” |
| API Worker | Worker 健康且真实充值能力已开启 | Worker 不健康跳“对账”；**API 权限关闭目前无跳转入口** |
| Browser | Browser 执行器就绪 | 跳到 Browser 状态 |
| 卡供给 | 有可分配卡；或可自动补余额；或自动开卡规则、快照和默认卡段就绪 | 跳到卡余额充值、库存或刷新卡台规则 |

全部无 `BLOCKED` 后才依次打开接单、打开自动派发；若第二步失败，会补偿关闭接单，避免部分开启。

它**不会**修改 systemd、Provider account 或任何 Provider 写权限，也不会立即开卡/补钱；自动补给在真实订单需要时触发。

当前跳转事实：卡台规则、卡片库存、卡余额充值、Browser、对账、卡台路线已有映射；API 执行权限关闭只有文字提示，没有按钮。 默认充值方式切换按钮目前显示在总览的设置区，可在 API/Browser 间切换，仅影响新订单；切换 Browser 前会检查 Browser dispatch、活动 profile 和心跳。“卡台路线”页面本身仍专门负责不同卡台/Provider route 的切换，两者不是同一个动作。这是待收敛缺口，不能再写成“所有阻断都有入口”。

两个必须保留的实际边界：

- 这是一次“开始营业”时的快照；若营业后执行能力漂移，当前代码不会自动关闭已开的接单/派发。
- 自动补给 readiness 目前主要看 DB 业务开关、快照和默认卡段；尚未将独立 runner/timer 心跳、其窄范围进程 gate、开卡日限额和未决任务全部纳入按钮检查。卡 Provider account 的 `write_enabled=0` 当前又不是 runner 实际门禁，不得把它猜成按钮已检查或当前阻断。本轮已另行只读确认当前两个独立 runner 可用。

## 5. 板块状态

状态口径：**已验收**=真实/生产证据；**已部署待实单**=代码与生产能力存在但缺真实闭环；**开发/并行**=不能宣称生产完成。

| 板块 | 状态 | 已证明 | 未完成 |
|---|---|---|---|
| 订单/CDK/Session/任务/资金核心 | 已验收 | 两笔真实 API 成功历史；幂等、UNKNOWN、任务与资金边界 | 连续运营与并发放量 |
| API 充值 | 历史真实成功；当前执行基线已恢复 | 付款前暂停演练走到 `SUBMITTING` 且未外部提交；executor capability 传递已修；生产充值 gate=true、preflight 无 blocker | 下一笔有效 Session 的真实订单；当前 `WAITING_FOR_SESSION` 订单不构成成功链路验收 |
| 付款前暂停机制 | 已验证并清理 | 正确停在外部 `create_direct` 前；测试订单/资金栅栏已正式收敛 | 非日常生产能力，默认应关闭 |
| 自动补余额 | 已部署待实单 | 订单驱动、5 秒本地领取、15 秒低调用对账、空闲零 Provider 写 | 首笔低余额精确补差额→到账→原订单继续 |
| 自动开卡 | 已部署待实单 | 无需求不刷新 Provider；自动规则已开启 | 真实无卡订单唯一开卡及自动恢复 |
| 一卡多单 | 已部署待连续实单 | 全局 1–4、当前 3、共享账本/容量门禁 | 连续订单计数、释放、上限停止 |
| 库存与运营覆盖 | 已部署，有历史数据缺口 | 旧批次停用、Claude 专用卡、未来新卡按证据接管 | `6807/1477` 现为 Provider `invalidating` 且保留历史 ACTIVE assignment，当前资格计算不会分配；这是系统状态与“卡实际可用”运营事实的待收敛缺口 |
| 运营控制面 | 部分部署 | 开始营业、默认路线、就绪摘要及部分跳转；API 权限基线已恢复 | 补齐 API 权限漂移无入口；用真实运营复核入口与噪音 |
| 客户充值页 | 已部署，待下一笔成功实单验收结果态 | Claude 单列三步设计已接入真实客户 API；生产 CSP、桌面/390px、教程、历史订单查询、时间线和 Session 更换入口已复验 | 下一笔真实成功订单验收成功邮箱、完成时间与完整时间线；不为此另造测试订单 |
| Browser | 生产形态非付款测试已执行，付款仍未验收 | 客户式 CDK+Session 订单已创建；系统自动开卡、分卡并启动 Browser Worker；付款前未发生外部支付 | 本轮因 ChatGPT 返回 `CHATGPT_ACCESS_BLOCKED` 未到 Checkout；发现并修复阻断重试循环；下一轮需重新在可访问环境执行一次到付款按钮前的观察 |
| 对账/Bark/费用监控 | 部分验收 | 资金 UNKNOWN、余额变化 Bark、交易证据基础 | 连续订单校准误报；费用标准/变化监控 |
| 放量/恢复 | 未验收 | 备份、健康检查、回滚点 | 3–5 单→10–20 单→恢复演练→100–300 单/日 |

## 6. 唯一执行顺序

### P0｜保持并监测已恢复的生产执行基线

- 已恢复并核对 API 常驻最小执行能力：Worker `PROVIDER_RECHARGE_WRITES_ENABLED=true`；保持 Worker 通用 Provider/普通卡片写与 Browser 付款关闭。独立 funding/stock runner 保持它们已确认的窄范围卡片写权限，不得被误关。
- 保持 `RECHARGE_SUBMIT_HOLD_BEFORE_PROVIDER` 关闭。
- 部署/重启后只读验证：readiness `ok=true`、Worker 心跳能力为 true、无活动测试 task/attempt/资金栅栏。
- 这是恢复已确认生产基线，不把它做成每单手动开关。
- 当前生产为 `7bad460`，已完成部署后健康、Browser 访问阻断重试修复和只读 readiness 核对；无 migration 变化，直接回滚点为 `569e8ee`。

### P1｜下一笔真实 API 订单

- 客户正常提交 CDK + Session，系统自动处理；不再先人为关闭应有能力。
- 当前已有 1 张可直接分配的 Plus 卡：Provider 卡 `2338`、尾号 `4643`、余额 `$16`、库存 `AVAILABLE`。下一笔有效订单应优先复用该卡，验收“自动分卡→API 充值→取消续费→交易/余额/对账”的完整链路；只有后续无合格卡时才再次验证自动开卡。
- 核对充值成功、Plus、取消续费、卡余额/交易、对账和 Bark。

### P2｜3–5 单连续 API 运营

- 验证一卡多单计数、补卡/补钱、失败恢复、调用次数、时延和提醒。
- 只修真实链路暴露的问题，不新增推测模块。

### B｜Browser 并行线

- 本轮已按真实业务创建测试 CDK+Session 订单，临时切换默认路线为 Browser；系统自动开卡并分配后，Browser 访问被 ChatGPT/网络返回 `CHATGPT_ACCESS_BLOCKED`，在付款前安全终止。测试订单、资金风险、租约和 Browser Worker 已清理，默认路线已恢复 API。
- 已修复：`CHATGPT_ACCESS_BLOCKED`、Checkout 导航/观察阻断不再回到 `CARD_READY` 重排 `SUBMIT_RECHARGE`；改为终态 `RECHARGE_FAILED`，避免重复创建 attempt。修复已部署到当前 release 并通过定向测试。
- 最新只读税费尝试：BitBrowser 菲律宾 Profile 可访问套餐页并显示 Plus ₱1,100；点击升级后停在 “Getting your plan ready”，未进入 Checkout，税费与 Delaware 地址影响尚未验证（详见 `docs/browser-research/BITBROWSER_TAX_READONLY_ATTEMPT_2026-09-02.md`）。
- 非付款闭环通过后，再单独确认首笔真实 Browser 付款；成功后再讨论把全局默认路线从 API 切为 Browser。

### E｜客户充值页体验线

- 正式代码已部署：删除左侧固定展示，采用填写资料→核对邮箱→页面内跟踪的单列流程。
- 客户确认邮箱前不建单；成功不再弹窗，邮箱、完成时间、查询码和客户时间线就地展示。
- 公网生产已验证教程、真实历史订单查询、ACTION_REQUIRED 时间线、桌面/移动无横向溢出和 Console 零错误；下一笔自然发生的真实成功订单再验成功邮箱与完成时间。

### P3｜控制面二次收敛

- 以 P1/P2 的真实操作证据收敛入口、重复信息和提醒。
- Provider 失败原因透传已部署并用既有失败单只读复验，不为此创建测试订单。
- 日常首页目标：默认充值方式 + 开始/暂停营业 + 一行就绪状态。
- 底层权限应显示真实状态但不要求逐单操作；明确无入口项的处理方式。

### P4｜放量与运营保障

- 10–20 单受控并发、费用监控、备份恢复演练；达标后再扩到 100–300 单/日。

## 7. 当前明确不做

- 不增加逐订单路线选择。
- 不恢复空闲全库存预充值或高频全量 Provider 扫描。
- 不把“超过 15 分钟”当订单失败。
- 不为 3DS/验证码等未出现条件预先阻断正常付款。
- 不建设第二套 Browser 订单/资金账或复杂策略服务。
- 不删除历史资金、订单、卡片、交易和审计证据。
- 不把 Browser 非付款证据说成真实付款完成。

## 8. 地图维护纪律

以下任一变化必须同一提交更新 `PROJECT_MAP.md` 与 `CURRENT_STATE.md`；涉及方向再更新 `DECISIONS.md`，执行证据进 `HANDOFF_LOG.md`：

1. 用户确认或推翻业务决策；
2. 代码完成、部署、真实验收之间发生状态变化；
3. release、systemd、数据库开关、默认路线或服务状态变化；
4. 唯一下一步或优先级变化。

新窗口首读：`PROJECT_MAP.md` → `CURRENT_STATE.md` → `PROJECT_OPERATING_MODEL.md` → 引用的证据报告。`DECISIONS.md` 是决策历史账本，其旧状态栏不得覆盖当前生产事实；`ROADMAP.md` 仅为历史明细，不得自行覆盖本地图。
