# AI充值业务｜唯一项目规划地图

> **用途**：只回答四件事：项目目标、当前生产事实、已完成/未完成、唯一执行顺序。
> **最后统一核对**：2026-09-04 CST。生产业务基线仍以 2026-09-02 SSH 核对为准；2026-09-04 另完成本地菲律宾 BitBrowser 官方 UI 非付款观察，未执行 Provider 写入或付款。
> 历史报告不能覆盖本地图；实时生产事实优先，变化后必须同步更新本地图与 `CURRENT_STATE.md`。
> 全链路、控制矩阵、自动补给状态机、库存最小模型、资金边界、通知、回滚和验收细则统一见 `docs/PROJECT_OPERATING_MODEL.md`。

> **2026-09-04 增量核对**：macOS→生产 MySQL loopback SSH 隧道前置路径已实测可用；BitBrowser Local API 本机可达；生产 Browser Worker 仍保持 `disabled/inactive`。生产 env 的 `root:pojia 0640` 与 systemd 服务账号匹配，不应误改为 `0600`；macOS 本地 launcher env 才要求 `0600`。详见 `docs/browser-research/MACOS_BROWSER_PRODUCTION_TUNNEL_CHECK_2026-09-04.md`。

## 1. 已确认的目标和原则

1. Plus 运营后台是中枢：客户提交 CDK + Session 后，系统应尽快自行完成资源准备和充值，不能要求运营逐单寻找底层开关。
2. API 与 Browser 共用订单、卡片、消费次数、资金栅栏和审计；默认充值方式是一个全局选择，只影响新订单，不做逐单路线选择。
   Browser 容量采用用户确认的 6 个常驻 BitBrowser Profile 池：单 Profile 单订单串行、Profile 之间并行；每个 Profile 固定隔离 Session/Checkout/运行身份/网络引用，先 1→3→6 分级验收。
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
| readiness | **只读 preflight 通过** | 2026-09-02 21:42 CST：`ok=true`、`blockers=[]`、Worker heartbeat 12 秒；这不等于逐单 Session/账号/Provider 最终结果已验证 |
| 通用 Provider / 卡片写 | false / false | Worker 进程环境 |
| 独立自动补余额 | DB gate=true；`pojia-card-funding.timer` 与 reconcile timer active/enabled | 独立 runner 只开补余额所需卡片写；空闲零写已验证，首笔真实补余额未验收 |
| 独立自动开卡 | DB gate=true；`pojia-card-stock-runner.timer` active/enabled，60 秒兜底 | stock runner 只开开卡所需卡片写；真实缺卡订单闭环未验收 |
| 当前 Plus 可立即分配 | **0 张** | 21:40 CST 本地库存投影 `ready=0/available=0`；卡 `2338`、尾号 `4643` 已绑定失败订单，仍为 `ASSIGNED`，不得写成可分配 |
| 每卡成功次数上限 | 3 | 已部署；连续跨订单实证仍不足 |
| 活动任务/资金风险/开放对账 | 0 / 0 / 0 | 2026-09-02 21:42 CST 只读 preflight |
| 最新 migration | 044 | 只读 readiness |
| 最新核对订单 | `PJV1-u696SEuwCQqyReHZ_FmP`=`RECHARGE_FAILED` | Provider 两次均明确返回“开通超时，请稍后查询是否已到账”；资金已清账，卡 `2338` 保持绑定，不得第三次盲重试或误报为库存 |

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
| Browser | 六 Profile 真实访问/隔离与共享队列非付款闭环已通过；付款未验收 | 单 Profile 已验证 Session/FREE/真实 Checkout/填卡/最终金额；六 Profile HTTP/Cookie/storage/指纹摘要=6/6；六条隔离 MySQL 队列任务全部非付款安全收敛 | 生产形态长时常驻、Mac Worker 接入与首笔真实付款；税费线等待第二类卡做单变量 A/B，当前共用一个菲律宾出口 |
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
- 当前没有可直接分配的 Plus 卡；卡 `2338`、尾号 `4643` 仍绑定失败订单，不能自动释放后复用。下一笔有效订单将依赖无卡自动开卡，但卡台余额 `$19.43` 低于卡段要求的最低账户余额 `$25`，所以真实来单前需先补足卡台账户余额，否则自动开卡会被卡台规则阻断。
- 核对充值成功、Plus、取消续费、卡余额/交易、对账和 Bark。

### P2｜3–5 单连续 API 运营

- 验证一卡多单计数、补卡/补钱、失败恢复、调用次数、时延和提醒。
- 只修真实链路暴露的问题，不新增推测模块。

### B｜Browser 并行线

- 本轮已按真实业务创建测试 CDK+Session 订单，临时切换默认路线为 Browser；系统自动开卡并分配后，Browser 访问被 ChatGPT/网络返回 `CHATGPT_ACCESS_BLOCKED`，在付款前安全终止。测试订单、资金风险、租约和 Browser Worker 已清理，默认路线已恢复 API。
- 已修复：`CHATGPT_ACCESS_BLOCKED`、Checkout 导航/观察阻断不再回到 `CARD_READY` 重排 `SUBMIT_RECHARGE`；改为终态 `RECHARGE_FAILED`，避免重复创建 attempt。修复已部署到当前 release 并通过定向测试。
- 单 Profile Delaware 非付款税费复验已完成：测试 Session 身份匹配且为 FREE，真实 ChatGPT Plus Checkout 填入卡片和 Delaware 账单地址后，稳定金额仍为基础价 `PHP 982.14` + VAT `PHP 117.86` = `PHP 1100.00`；Subscribe 可用但未点击，`submitCalls=0`，字段/Session/Profile 已清理。不能再把免税州地址视为菲律宾 Checkout 的免税规则或成本依据（详见 `docs/browser-research/BITBROWSER_DELAWARE_NONPAYMENT_TAX_OBSERVATION_2026-09-03.md`）。
- 税费观察器已补齐 Checkout 创建、billing snapshot、pricing config、Stripe 脱敏路径和填卡/地址前后金额时间线；又增加 CDP POST body 取证和严格运行 Cookie allowlist，避免观察脚本自己破坏 Cloudflare 访问状态。当前 Browser 全量 `153 total / 148 passed / 5 environment-skipped / 0 failed`。
- 美国出口一次性非付款对照已完成：常规升级入口直接选中 `US/USD`，地址前 `USD 22.40`，填写 `US/DE` 后税额变为 0、总额 `USD 20.00`；`submitCalls=0`。随后旧探针用附件旧 token 裸调 Checkout API，绕过当前官方前端的 Sentinel/设备/目标路由请求链并得到两次 HTTP 400；该结果已降级为无效实现证据，不能解释为账号被禁或上游对 `US + PH/PHP` 的有效裁决。随后两级修正已实测：①保留官方请求头但在 Sentinel 生成后改 POST body，仍返回 HTTP 400，说明这种后改写仍不等价于官方请求；②改为在前端构建 POST 前切换到官方 PH pricing config，成功读到 `plus.month=1100 inclusive` 与 `psp_override=982.14 exclusive`，但前端生成的是 `US/PHP`，因地区不一致已在本机 abort，Checkout 上游请求为 0。账号“被禁”的说法已撤销。
- 回到菲律宾 Profile 后，已用官方 UI 原生请求完整重跑：Checkout create 是 `PH/PHP`、HTTP 200、`automatic_tax_enabled=true`；填入当前 HNSKJ 测试卡和 `US/DE` 后仍为 `982.14 + 117.86 = 1100.00 PHP`，且未观察到 ChatGPT checkout snapshot 请求。`submitCalls=0`。所以当前组合未命中 `psp_override`，下一步只在有第二类 BIN/发卡路由测试卡时做单变量 A/B，不再重复同卡（详见 `docs/browser-research/PH_OFFICIAL_UI_PSP_ROUTE_NONPAYMENT_2026-09-04.md`）。
- 容量方向已确认并完成真实 1→3→6 Profile 访问/隔离验收：6 个常驻隔离 Profile，单 Profile 串行、Profile 间并行；六路同时达到 ChatGPT HTTP 200、Cookie/localStorage 隔离和运行时指纹摘要差异 `6/6`。已修复客户清理误删 Cloudflare 运行 Cookie，以及生产池并发突发启动造成 Local API 部分成功的问题；生产池现为物理窗口顺序打开、页面任务并行。六路共用一个菲律宾出口，用户确认现阶段不以多出口作为阻断（详见 `docs/browser-research/BITBROWSER_SIX_PROFILE_ACCESS_AND_ISOLATION_VERIFICATION_2026-09-03.md`）。
- 非付款闭环通过后，再单独确认首笔真实 Browser 付款；成功后再讨论把全局默认路线从 API 切为 Browser。

**当前推进点（2026-09-04）**：本地只读 env 已在仓库外生成并通过配置加载器检查（BitBrowser 六 Profile、headed、付款/Provider/卡资金写入关闭）。下一步才运行 launcher `--check`/不付款 canary；未完成前不加载 launchd、不启动常驻生产 Browser Worker。

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

## 2026-09-02 Browser 最新进度（现场核对）

- API 生产线保持默认路线；Browser Worker 仍为 `inactive/disabled`，本轮未部署、未付款。
- BitBrowser 单 Profile 非付款闸门已实测通过：公开页面可达，测试 Session 身份匹配且账号为 FREE；进入真实 ChatGPT Plus Checkout 并填写卡片和 Delaware 地址后，金额仍为基础价 `PHP 982.14`、VAT `PHP 117.86`、合计 `PHP 1100.00`。Subscribe 可用但未点击，`submitCalls=0`，结束后已清理。
- 成本口径已纠正：运营方确认近期多单确实以 `PHP 982.14` 成交，仓库内两笔真实成功 API 证据也独立支持该价格；因此 `1100.00` 不是菲律宾充值不可避免的统一成本，只是当前 Browser 环境的实测结果。运营方同时确认 Browser 生产出口保持菲律宾；美国出口只完成了一次明确允许的诊断对照，不列为当前生产候选。
- `codex/browser` 已基于当前 main 实现 1–6 Profile 常驻池：单 Profile 单订单、Profile 间并行；订单间清理页面/Cookie/storage；清理失败隔离槽位；第 7 个并发拒绝。
- 对抗审查已修复地址/税费与付款许可顺序：先无付款地填写卡和账单地址并读取最终总额，再将 Checkout 摘要绑定权威 permit/submit intent；permit 后金额漂移仍停止。
- 生产形态准备已补齐：macOS launcher 支持单/多 Profile、默认 `ONCE`/显式 `CONTINUOUS`；六 lane 共用一个进程 heartbeat，默认每 10 秒更新，不再随 lane 数放大数据库写入；配置模板已同步且未含真实 ID/代理/密钥。
- 代码验证：税费观察器补强后 Browser 普通全量 `150 total / 145 passed / 5 environment-skipped / 0 failed`；此前已用全新临时 MySQL 8.4、完整 migrations 001–044 将当时 4 个数据库跳过项逐项实跑为 `4/4 passed`；v1 repository 定向 `21/21`。当前新增的 BitBrowser 六 Profile 现场集成项仍因每日额度保持 environment-skipped。
- Browser 下一步：六 Profile + 隔离 MySQL 共享队列非付款闭环已于 2026-09-04 复验通过，下一阶段转为生产形态长时常驻和 Mac Worker 接入，付款门禁仍关闭。税费线已确认当前 HNSKJ 卡组合不命中 `psp_override`；只在有第二类 BIN/发卡路由测试卡时继续单变量 A/B，不因等待该卡阻塞 Worker 接入。
- 详细实施/审查：`docs/browser-research/BROWSER_SIX_PROFILE_POOL_IMPLEMENTATION_2026-09-02.md`、`docs/browser-research/BROWSER_SIX_PROFILE_PRODUCTION_SHAPE_PREPARATION_2026-09-02.md`。
