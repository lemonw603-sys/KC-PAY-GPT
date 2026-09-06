# AI充值业务｜唯一项目规划地图

> **2026-09-06 Browser LIVE P0 第四批（生产发布）**：当前 HEAD `556ba97` 已从单一 commit 构建为 841 文件候选并发布到 `/opt/pojia/releases/20260906-browser-live-556ba97`，回滚点为 `20260906-import-errors-c6e9f48`。Web/API Worker、内外网 live/ready 通过；Browser Worker/旧自动开卡继续关闭，数据库付款开关和 Profile 生产权限均为 false，活动 Browser/资金为 0。本机正式 LIVE `--check` 已同时通过生产数据库、BitBrowser Local API 和 Pilot Profile。HNSKJ 只读卡查询仍被卡台维护 403 阻断，数据库 5980 仍 `$16`、手工备用卡仍 `$0/$2`；所以下一步不是提交订单，而是卡片充值后取得最新权威卡资料，再直接执行订单级付款关闭回归。

> **2026-09-06 Browser LIVE P0 第三批（提交 `ff34feb`）**：已在临时 MySQL 8.4 隔离库执行完整 Browser 套件，`154/154/0/0`。对抗审查先复现了旧夹具缺少订单冻结卡源、相反付款开关用例并行互扰等失败，再修复测试合同和串行 smoke；新增 UNKNOWN 恢复、付款已确认未收口恢复、UNKNOWN 超时三条 MySQL 证明，均保持 `PAYMENT_SUBMIT=1`、恢复阶段新增付款调用 `0`。生产仍未部署；下一步从当前 HEAD 构建候选 release，部署时继续保持 Browser Worker 与付款关闭，再执行生产 LIVE `--check`。

> **2026-09-06 Browser LIVE P0 第二批（代码提交 `bc8ee2f`）**：已新增独立 `production-live-worker.js` 的安全 `--check/--once` 双模式、HNSKJ/手工卡路线化交易核验、实体卡级账单地址稳定绑定、付款 UNKNOWN/付款已确认未收口的专用 Session 与同 Profile 只读恢复；付款确认现在原子建立后续核验计划，恢复 SQL 精确限制批准订单，成功后收口订单/attempt/run/账本/assignment/dispatch。Browser `151/147/4/0`、v1 `552/505/47/0`，本机 Pilot Profile HTTP 200、无 Cloudflare、0 submit。生产只读复核仍为 release `c6e9f48`、Browser Worker/付款/旧自动开卡关闭、活动 Browser/资金/派发为 0；**尚未部署，也尚未完成隔离 MySQL 跳过项和订单级非付款回归**。下一步按 `docs/BROWSER_LIVE_P0_IMPLEMENTATION_2026-09-06.md` 构建候选并以付款关闭状态部署核验。

> **2026-09-06 Browser LIVE P0 实现进度（本地候选）**：已修正卡前 preflight 零税时序，保留最终付款前 `PHP+零税+算术一致` 强校验；手工备用卡的账单地址不再被解密层丢弃；Browser 上游投影已改为以订单冻结卡源而非旧路线卡台为权威。新增单订单绑定的 LIVE 配置/组装边界、真实 Plus+取消续费核验器，并把资金时序改为“填写+重报价+最终复核后才落 payment intent，随后单次点击”。Browser 全量 `138 pass / 4 skip / 0 fail`，v1 定向 `18 pass / 0 fail`。仍未完成生产 LIVE 进程、付款 UNKNOWN 真实调度和单 Profile 非付款候选回归；未部署、未启用付款。

> **2026-09-06 Browser 真实首单验收计划**：已基于当前代码和生产现场落盘 `docs/BROWSER_REAL_E2E_ACCEPTANCE_PLAN_2026-09-06.md`。重新核对发现当前仍只有可运行的 readonly Worker；`payment-executor.js` 会拒绝 LIVE，真实 Plus/取消观察器仍为 mock，付款未知协调器也未接入生产调度。因此不得在充卡后立即提交订单；下一动作先收口 LIVE Worker、填卡后零税闸门和付款后观察/未知核实，付款保持关闭完成单 Profile 非付款回归后，再提交新 CDK + Session。

> **2026-09-06 D6 卡源生产验收进行中（当前最高优先级）**：生产后台/API、Browser 卡源 HNSKJ↔备用 A 双向切换、不接管旧订单、切换审计、2 卡完整快照与幂等重放均已实测。页面误导已由 `c9f482e` 修复；空/损坏卡文件已由 `c6e9f48` 稳定分类为客户端错误。当前生产 release 为 `/opt/pojia/releases/20260906-import-errors-c6e9f48`，827 文件 manifest 通过，空文件接口实测返回 `HTTP 400 manual_card_file_invalid`。最终卡源已恢复 HNSKJ；备用两卡余额均低于 `$18`，不会被 Plus 分配。Browser Worker、付款、旧自动开卡继续关闭；969 条 stock jobs 跨完整周期未增长。下一步为有达到 `$18` 门槛的卡后执行真实 Browser 订单验收，当前不能宣称付款链路完成。证据见 `docs/CARD_SOURCE_D6_PRODUCTION_ACCEPTANCE_2026-09-06.md`。

> **2026-09-05 订单可观测性纠偏（重要）**：本轮曾误判“客户提交结果只停留在客户页面、系统没有跨窗口订单发现机制”。现场复核证明该判断不成立：订单创建事务已持久化 `orders`、`order_events` 和对应 `tasks`，Browser 路线还会写入 `BROWSER_PREFLIGHT` 任务；本次新订单 `PJV1-AH6M688B3Wfv5_vxISmp` 已在生产数据库落库，状态为 `WAITING_FOR_CARD`、路线 `BROWSER`，`ASSIGN_CARD` 任务为 `PENDING`（最近错误 `CARD_STOCK_EMPTY`）。此前“查不到”是执行窗口误用了本机无 `mysql` 客户端并在未读到生产数据库前做了结论，不是系统漏写订单。已停止残留的本地测试进程，并将缺失的 Browser 建单任务写入生产候选 `/opt/pojia/releases/20260905-order-preflight-130349` 后重启 Web、复验 `ready`；后续先用生产 Node/mysql2 只读查询或后台订单查询接口核对，再回答订单是否存在；不新增重复的“订单收件箱”模块，避免过度设计。

> **2026-09-05 Browser 零税流程多样本收口（最新）**：已完成两个独立 BitBrowser Profile 的身份有效、全新 Checkout 前后对照，均从 `PHP ₱982.14 + VAT ₱117.86 = ₱1,100.00` 在填卡、US/DE 账单地址和瞬时 Session 邮箱后重算为 `PHP ₱982.14 + Tax ₱0 = ₱982.14`；另有一个身份有效零税样本。全程未点击 Subscribe、未付款。正式代码已收口真实标签/千分位、PHP/零税/金额一致性、卡→地址→重报价顺序、Session 空响应稳定等待、`Rejoin Plus` 水合重试和 BitBrowser 最后一页存活问题。Browser `132/128/4/0`、v1 `532/486/46/0`。提交 `04e08e6` 已发布为 `/opt/pojia/releases/20260905-browser-zero-tax-04e08e6`；生产哈希、Browser `--check=READY`、Web/Worker、live/ready 均通过，Browser Worker 保持 `inactive/disabled`。**下一步不是继续猜税额，而是把本机正式 Worker 的卡资料/地址租约接入当前真实 Browser 订单，并在付款前再做一次订单级核对；真实 Browser 付款仍未验收。** 证据见 `docs/browser-research/BITBROWSER_TAX_MULTI_SAMPLE_2026-09-05.md`。

> **2026-09-05 BitBrowser 代理生命周期已修复（本机现场）**：此前开窗失败的直接证据是 `ECONNREFUSED 127.0.0.1:17897`。已将 mihomo 从无主进程迁移为用户级 launchd 单实例服务 `com.ai充值业务.mihomo`，固定使用 BitBrowser 代理目录；健康闸门现在同时检查“仅一个 mihomo、17897 监听归属正确、经代理访问 ipify 成功”。当前现场 `PID=45732`、出口 `38.60.246.34`、`LOCAL_MIHOMO_PROCESSES=1`，BitBrowser Local API 与生产只读状态复核均通过。ChatGPT Cloudflare challenge 仍是独立的页面访问问题，未宣称已解决。

> **2026-09-05 单 Profile 复核已通过**：代理修复后，Pilot Profile `10f0dc7b534844c083165796447d5893` 完成 `open → CDP → chatgpt.com → close`；HTTP `200`、正常标题、未出现 Cloudflare challenge。未注入 Session、未进入 Checkout、未创建订单、未付款。原始证据见 `artifacts/bitbrowser-single-profile-check-20260905/result.json`。

> **2026-09-04 补给与恢复机制最新事实**：生产已部署 `/opt/pojia/releases/20260904-funding-recovery-race-4bf84f9`，包含补款明确失败有界恢复 `0e5a82d` 与“陈旧低余额卡先同步、禁止抢跑开卡” `4bf84f9`。部署前，卡台账户余额恢复到 `$34.83`，系统在旧卡 9051 证据陈旧时抢先开了 `2833/5980/$16`，随后自动分配并提交 API 订单 9440，Provider 明确失败“验证策略失败，请稍后重试”。无 PURCHASE，卡 5980 仍 `$16/AVAILABLE`并已安全释放；测试订单已终态失败，不再对其重试或补款。

> **用途**：只回答四件事：项目目标、当前生产事实、已完成/未完成、唯一执行顺序。

> **2026-09-05 Browser Checkout 入口修复已完成**：针对真实只读观察发现的页面漂移，导航器现在在首页 Upgrade 不存在时，会安全点击可见 Profile 菜单（`[data-testid="accounts-profile-button"]`）后再定位 Upgrade；所有候选仍经过非表单导航控件校验，付款提交控件继续禁止。持久 BitBrowser Context 注入 Session 前只清理旧的 `__Secure-next-auth.session-token` 分块，不触碰 Cloudflare/代理 Cookie，避免跨订单残留。Browser 全量（本轮 `npm test`：120 pass/4 skip/0 fail）通过；提交 `92fc70e`。尚未部署生产，尚未重跑真实订单前置观察。
> **最后统一核对**：2026-09-02 00:32 CST。已对照前后端代码，并通过 SSH 复核部署后的生产 release、systemd、Worker 实际进程环境、只读 readiness 和新卡实时库存；本轮未执行 Provider 写入或付款。
> 历史报告不能覆盖本地图；实时生产事实优先，变化后必须同步更新本地图与 `CURRENT_STATE.md`。

> **2026-09-05 备用卡台接入开发批次（本地未部署）**：根据实际模板 `/Users/lemon/Downloads/卡片列表.xls`（内容为 OOXML/XLSX ZIP，不能只按 `.xls` 后缀判断）已实现第一批：`048_manual_backup_card_import.sql`、备用卡解析/预览/确认导入服务及后台入口。备用卡源 `manual_excel` 使用 `sync_tier=MANUAL_IMPORT`，不进入 HNSKJ 同步、自动开卡或补余额；Browser 路线通过 `fulfillment_route_card_sources` 支持 HNSKJ 优先、备用卡兜底。PAN/CVC 仅 AES-GCM 加密，预览和日志不返回明文。模板现场解析为 2 行，余额 `$2` 与 `$0` 均不满足当前 Plus 最低余额，未宣称可用。v1 定向测试 105/105；尚未提交、尚未部署 048、尚未导入生产。
> 全链路、控制矩阵、自动补给状态机、库存最小模型、资金边界、通知、回滚和验收细则统一见 `docs/PROJECT_OPERATING_MODEL.md`。

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
| 生产 release | `/opt/pojia/releases/20260904-funding-recovery-race-4bf84f9` | 已部署补款失败有界恢复与陈旧卡先同步修复；直接回滚点 `20260904-funding-recovery-0e5a82d` |
| Web / API Worker | active / active | systemd 现场读取 |
| Browser Worker | inactive / disabled | 本轮短暂启动完成非付款测试后已停止；未进入真实 Browser 付款 |
| 接单 / 派发 | true / true | 只读 readiness；当前后台已处于营业业务状态 |
| 默认路线 | API | 只读 readiness |
| Worker 最终 API 充值能力 | **true** | 已安装最小权限 drop-in，重启后进程环境为 `PROVIDER_RECHARGE_WRITES_ENABLED=true` |
| Provider recharge account | `write_enabled=1` | 数据库只读核对；Worker 进程充值 gate 同样为 true，当前可执行 |
| Provider card account | `write_enabled=0`，circuit=CLOSED | 当前 stock/funding runner **不以该字段为写门禁**，而以各自窄范围进程 gate 为准；这个语义不一致需在后续收敛，不得猜测它当前会阻断补给 |
| readiness | **只读 preflight 通过** | 2026-09-01 15:54 CST：`ok=true`、`blockers=[]`、Worker heartbeat 2 秒；这不等于逐单 Session/账号/Provider 最终结果已验证 |
| 通用 Provider / 卡片写 | false / false | Worker 进程环境 |
| 独立自动补余额 | DB gate=true；`pojia-card-funding.timer` 与 reconcile timer active/enabled | 独立 runner 只开补余额所需卡片写；空闲零写已验证，首笔真实补余额未验收；与自动开卡的抢跑收口已部署 |
| 独立自动开卡 | DB gate=true；`pojia-card-stock-runner.timer` active/enabled，60 秒兜底 | stock runner 只开开卡所需卡片写；存在合格低余额卡或活动补款时不再抢跑；真实缺卡订单闭环未验收 |
| 当前 Plus 可立即分配 | **1 张** | 新卡 `2833/5980=active/AVAILABLE/$16`，失败订单的 assignment/ledger 已安全释放；`2772/9051=DEPLETED/$0.01` |
| 每卡成功次数上限 | 3 | 已部署；连续跨订单实证仍不足 |
| 活动任务/补款 ACTIVE 或 UNKNOWN | 0 / 0 | 测试订单任务已结束；无未决补款资金风险 |
| 最新 migration | 045 | `045_card_sync_priority` 已在生产落库 |
| 当前测试订单 | `PJV1-tw-hliEBgnOfdEVsxn5r`=`RECHARGE_FAILED` | 自动开卡/分配/API 提交已运行；外部订单 9440 明确失败，资金 `CLEARED`，无 PURCHASE |

**当前状态**：API 最小充值权限、接单、自动派发、自动开卡和自动补余额均已开启；Web/Worker/补给 timer 均 active，`/health/ready=ready`。当前有 1 张 `$16` 可分配卡 5980。补款失败有界恢复和陈旧卡先同步修复已生产生效，但尚未用新的低余额订单验收成功到账。

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
| 自动补余额 | 恢复修复已部署，待新实单 | 订单驱动、空闲零 Provider 写、明确失败安全清账、有界自动恢复 | 下一次真实低余额订单验收 `$16`→到账→原订单继续 |
| 自动开卡 | 生产链路已运行 | 无卡订单唯一开卡 2833→分配→原订单继续；失败后卡安全释放 | 陈旧低余额卡抢跑漏洞已修，待下一次自然需求复验 |
| 一卡多单 | 已部署待连续实单 | 全局 1–4、当前 3、共享账本/容量门禁 | 连续订单计数、释放、上限停止 |
| 库存与运营覆盖 | 已部署，有历史数据缺口 | 旧批次停用、Claude 专用卡、未来新卡按证据接管 | `6807/1477` 现为 Provider `invalidating` 且保留历史 ACTIVE assignment，当前资格计算不会分配；这是系统状态与“卡实际可用”运营事实的待收敛缺口 |
| 运营控制面 | 部分部署 | 开始营业、默认路线、就绪摘要及部分跳转；API 权限基线已恢复 | 补齐 API 权限漂移无入口；用真实运营复核入口与噪音 |
| 客户充值页 | 已部署，待下一笔成功实单验收结果态 | Claude 单列三步设计已接入真实客户 API；生产 CSP、桌面/390px、教程、历史订单查询、时间线和 Session 更换入口已复验 | 下一笔真实成功订单验收成功邮箱、完成时间与完整时间线；不为此另造测试订单 |
| Browser | 生产形态非付款测试已执行，付款仍未验收 | 客户式 CDK+Session 订单已创建；系统自动开卡、分卡并启动 Browser Worker；付款前未发生外部支付 | 本轮因 ChatGPT 返回 `CHATGPT_ACCESS_BLOCKED` 未到 Checkout；发现并修复阻断重试循环；下一轮需重新在可访问环境执行一次到付款按钮前的观察 |
| 对账/Bark/费用监控 | 部分验收 | 资金 UNKNOWN、余额变化 Bark、交易证据基础 | 连续订单校准误报；费用标准/变化监控 |
| 放量/恢复 | 未验收 | 备份、健康检查、回滚点 | 3–5 单→10–20 单→恢复演练→100–300 单/日 |

### 当前容量边界（2026-09-04 现场复核）

- 生产普通 Worker 当前未显式设置 `WORKER_CONCURRENCY`，按代码默认值为 1。
- 补余额/补余额对账/自动开卡目前分别按 5 秒、15 秒、60 秒 timer 运行，每轮各只领取 1 个 attempt/job。
- 当前 `card_stock_low_threshold=0`，没有预先准备的可用卡缓冲。因此“每单到来后才临时开卡或补款”不满足峰值约 1 单/分钟的目标；100–300 单/日仍是未验收能力，不能由离线等效测试或单笔成功外推。
- 放量方向保持简单：先使用一卡最多 3 次的顺序复用降低补给次数，再建立小型可用卡缓冲；完成 3–5 单连续和 10–20 单受控并发后，依据实测瓶颈调整 Worker、补款与开卡的有限并发，不做无限并发。

## 6. 唯一执行顺序

### P0｜保持并监测已恢复的生产执行基线（已完成，持续保持）

- 已恢复并核对 API 常驻最小执行能力：Worker `PROVIDER_RECHARGE_WRITES_ENABLED=true`；保持 Worker 通用 Provider/普通卡片写与 Browser 付款关闭。独立 funding/stock runner 保持它们已确认的窄范围卡片写权限，不得被误关。
- 保持 `RECHARGE_SUBMIT_HOLD_BEFORE_PROVIDER` 关闭。
- 部署/重启后只读验证：readiness `ok=true`、Worker 心跳能力为 true、无活动测试 task/attempt/资金栅栏。
- 这是恢复已确认生产基线，不把它做成每单手动开关。
- 当前生产 release 为 `/opt/pojia/releases/20260904-funding-recovery-race-4bf84f9`；整数补款 `8caccfb`、失败恢复 `0e5a82d` 与陈旧卡/开卡竞态修复 `4bf84f9` 均已部署。

### P1｜当前唯一执行项：下一笔真实 Browser 订单前收口

- 当前 5980 已是 `$16/AVAILABLE`，不为了制造补款场景自动提现或销卡。
- 下一笔 Browser 真实订单前，复核默认路线、BitBrowser Profile、付款许可和中止点；一次性说清验收清单。
- 用户确认本次 Browser 实单要同时验收“无合格 Plus 卡→系统自动开一张带目标余额的新卡→分配→Browser 付款”。现有 5980 不提现、不销卡；测试窗口内只允许用可逆的运营隔离模拟其不可分配，结束后恢复。执行前必须先满足 Provider 开卡余额合同，并确保没有其他新订单被该临时状态影响。
- 用户随后决定改为在测试窗口正式注销现有 5980 后验证真实无卡分支；注销前必须重新读取余额和交易，并在同一次资金确认中明确余额提取、注销、自动开卡与最终付款的影响及停止点，不能因聊天中的方向确认直接执行资金写入。
- Browser 付款增加 MockAddress 账单地址来源：只复用其免税州地址/身份字段，不生成或替换卡号；采用固定版本、运行时 Schema 校验和内部缓存，禁止每单依赖抓取第三方网页。运营后台提供启停、默认州、生成预览和最近版本/错误状态。填入账单地址后必须重新读取 Checkout 税额与总额；地址来源本身不等于免税成功。
- 自动补余额成功到账仍放在下一次自然低余额场景验收，不重试已终态失败订单。
- “API / Browser 默认充值方式”切换能力已在生产代码和后台总览设置区存在；本轮不重复开发，先把 Browser Worker、派发和心跳恢复到 ready，再由现有按钮完成切换并把切换本身纳入验收。布局优化留到链路跑通后。

### P2｜自然订单中的共享补给验收与 3–5 单连续 API 运营

- 验证一卡多单计数、补卡/补钱、失败恢复、调用次数、时延和提醒。
- 只修真实链路暴露的问题，不新增推测模块。

### B｜Browser 并行线

- 本轮已按真实业务创建测试 CDK+Session 订单，临时切换默认路线为 Browser；系统自动开卡并分配后，Browser 访问被 ChatGPT/网络返回 `CHATGPT_ACCESS_BLOCKED`，在付款前安全终止。测试订单、资金风险、租约和 Browser Worker 已清理，默认路线已恢复 API。
- 已修复：`CHATGPT_ACCESS_BLOCKED`、Checkout 导航/观察阻断不再回到 `CARD_READY` 重排 `SUBMIT_RECHARGE`；改为终态 `RECHARGE_FAILED`，避免重复创建 attempt。修复已部署到当前 release 并通过定向测试。
- 最新只读税费尝试：BitBrowser 菲律宾 Profile 可访问套餐页；复用仍有效的既有 Checkout 后，现场确认基础价 ₱982.14 + 12% VAT ₱117.86 = ₱1,100。未填卡时页面没有账单地址输入区，所以 Delaware 地址影响尚未验证（详见 `docs/browser-research/BITBROWSER_TAX_READONLY_ATTEMPT_2026-09-02.md`）。
- 容量方向已确认：实现 6 个常驻隔离 Profile，按单 Profile 串行、多 Profile 并行达到约一分钟一单；当前 adapter 仍是每次执行开关 Profile，且只证明一个菲律宾节点，尚未实现或验收六路运行（详见 `docs/browser-research/BROWSER_SIX_PROFILE_POOL_DECISION_2026-09-02.md`）。
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

## 8. 当前全系统体检入口（2026-09-04）

本轮同步频率与 P0 对抗式复查已落盘：`docs/2026-09-04-sync-frequency-and-p0-review.md`。结论是 timer 频率本身不是主要问题，库存同步队列的优先级/失败隔离/单任务吞吐才是 P0；该同步可靠性修正与自动补余额、无卡自动开卡生产闭环应作为同一批 P0 推进。

2026-09-04：同步 P0 release `/opt/pojia/releases/20260904-sync-p0-6aff7fe` 已部署；迁移 045、优先级/待复核隔离、轻量指标和最多 4（硬上限 6）并发 runner 已上线。生产 Web/Worker/read-sync timer active，`/health/ready=ready`；未执行资金写入。

下一笔 Browser 真实订单前，必须按 `docs/2026-09-04_full-system-preflight-scope.md` 一次性核对客户充值页、运营后台（含 Browser）、订单/资金、库存/卡台/自动补给、后端共享核心及生产部署。该体检不创建订单、不调用 Provider 写接口、不付款；结果必须区分实时证据、代码证据、历史快照和未验证。统筹按板块定时汇报“已完成/进行中/下一块/阻塞”，不以微步骤反复打断。

## 9. 地图维护纪律

以下任一变化必须同一提交更新 `PROJECT_MAP.md` 与 `CURRENT_STATE.md`；涉及方向再更新 `DECISIONS.md`，执行证据进 `HANDOFF_LOG.md`：

1. 用户确认或推翻业务决策；
2. 代码完成、部署、真实验收之间发生状态变化；
3. release、systemd、数据库开关、默认路线或服务状态变化；
4. 唯一下一步或优先级变化。

新窗口首读：`PROJECT_MAP.md` → `CURRENT_STATE.md` → `PROJECT_OPERATING_MODEL.md` → 引用的证据报告。`DECISIONS.md` 是决策历史账本，其旧状态栏不得覆盖当前生产事实；`ROADMAP.md` 仅为历史明细，不得自行覆盖本地图。

## 9. 2026-09-04 MockAddress 集成状态

- 代码已在主线落盘：固定版本本地地址数据、确定性 JIT 地址来源、HNSKJ material boundary 接入、运营后台账单设置接口/页面及 migration 046。
- 这是“账单地址候选来源”，不是免税保证；每次 Browser Checkout 填写后仍必须以页面重新计算的 tax/total 为准。不得把地址生成器的州标签写成平台税务结论。
- 当前尚未部署；主线 Browser Worker 仍是生产只读实现，真实 Browser 付款未验收。下一步先完成 Browser 分支选择性对齐、migration/后台只读部署验证和非付款回归，再决定是否进入资金动作。

- 卡台注销补充规则（用户 2026-09-04 现场确认）：注销后保留约 `$0.01`、其余退回卡台余额；当天开出的卡暂不能注销。测试不再强制销卡，若规则阻止则保留卡并正常使用；执行前仍需读取实时状态确认。

- 地址策略已确认：默认一张卡固定一个账单地址；不同卡优先一对一占用不同地址槽位，并通过 migration 047 持久化，避免进程重启后重新分配。地址重复控制是降低相关性风险的措施，不是免税或支付成功保证。

- 地址策略修订：不强制一张卡只能绑定一个地址；优先保持一对一，地址池耗尽时允许按最低使用次数复用，避免因地址不足阻断正常订单。

### 2026-09-04 对齐审查增量

- 已完成 MockAddress/Browser 对齐的代码级审查并修正 migration 047：地址池不足时允许最低使用次数复用，避免“尽可能一张卡一个地址”与数据库唯一槽位约束冲突。
- 证据报告：`docs/2026-09-04_browser-mockaddress-alignment-audit.md`。当前仍未部署 046/047，Browser 分支尚未完整合入生产主线。

### 2026-09-04 回归修复状态

Browser 候选对齐后发现 v1 客户首页静态 `sendFile` 在候选 worktree 返回 500。已改为安全读取本地 HTML 后响应，提交 `b902e87` 已同步主线。Browser 与 v1 全量测试均 0 失败；生产部署和 Browser 真实付款仍未进行。

### 2026-09-04 部署前体检进展

代码回归已通过；迁移 046/047 仅完成静态审查，未上生产。尝试运行本地 readiness 因 `DATABASE_URL` 未注入而被配置层拒绝，不能据此判断生产状态。生产 release/systemd/DB 仍待现场只读核对。

### 2026-09-04 生产现场体检结果

已通过现有 SSH 会话完成只读核对：生产 release 为 `20260904-funding-recovery-race-4bf84f9`；Web/Worker active，Browser Worker inactive/disabled；live/ready 均 200；数据库最高迁移为 045，046/047 未部署；Provider 读取开启、所有写入关闭。当前具备继续做部署前差异评估的证据，但不代表 Browser 生产付款已验收。

### 2026-09-04 部署状态更新

候选 release `20260904-browser-candidate-32b8a04` 已完成备份/恢复演练、上传、迁移 046/047 和 Web/API Worker 重启；live/ready/客户首页均 200。Browser Worker 仍 disabled/inactive，所有 Provider/卡台/付款写权限保持关闭，Browser 付款尚未验收。

### 2026-09-04 Browser canary 结果

生产 Browser readonly unit 已启动并通过 ExecStartPre，连续 IDLE 后正常停止，最终 inactive/disabled。当前仍是 LOCAL_FIXTURE 配置，仅完成生产运行边界验证，不代表外部 ChatGPT 或真实付款已验收。

### 2026-09-05 Pro 20X 基础准备

用户将“20X”更正为 Pro 20X。当前 V1 仍只启用 Plus；产品字段和路由结构已预留。已记录基础准备方案：在不改变当前 Plus 生产行为的前提下保留 plan_type、产品识别和禁用配置，未来独立验证 Pro 20X 的 Checkout 价格/税费/资格/Provider 合同后再启用。

### 2026-09-05 Pro 20X 流程线索已现场读取

用户本地 Chrome 已打开的文章可现场读取；其流程线索与项目设计一致：PH 出口、先 Plus 再 Pro 20X、同账号确认、付款前重读 Checkout 金额/税费。文章价格仅作线索，Pro 20X 仍未启用或验收。

### 2026-09-05 卡台同步告警 P0 发现

生产现场确认 HNSKJ 卡段/余额快照同步持续在 `parseEnvelope` 失败，任务反复 `RETRY_PENDING`。`provider-snapshot:hnskj` 为单一长期 OPEN 告警，重复 Bark 来自同一事件更新未做边沿/冷却抑制。需将 Provider 解析失败、退避和 Bark 通知去重作为同一 P0 修复，不得只静音通知。

## 2026-09-05｜P0 卡台同步维护与重复通知修复

- 现场根因：HNSKJ 读接口返回 `success=false` 维护消息且无 `data`，导致快照同步失败并进入短周期重试；不是已确认的字段改名。
- 实施修复：维护响应专门分类并采用 5 分钟长退避；Bark 同一 OPEN 事件只通知一次，只有 CANCELLED 后重新打开才允许再次通知。
- 本地回归已通过（v1 528/482/46/0；Browser 113/109/4/0），生产尚未部署。部署前需备份并复核服务状态；不涉及 Provider 写入或付款。

### 2026-09-05 P0 修复生产部署完成

- 已部署 `/opt/pojia/releases/20260905-maintenance-bark-6246cc1`（commit `6246cc1`），部署前备份 `backup_integrity=OK`。
- Web/Worker/catalog-sync/Bark 服务 active，live/ready 均正常；Browser Worker 继续 disabled/inactive。
- Provider 读取开启，全部写权限关闭；未进行任何资金或付款动作。

### 2026-09-05 真实 Browser 订单策略修订

- 真实订单优先走“已有可用卡”分支；不等待卡台开新卡。HNSKJ 维护期间只验证已有卡读取/绑定，开卡与补余额保持停用。
- 若 Checkout 现场税费为 0、总额核对无误，且用户在付款前再次明确确认，才允许进入真实付款；否则在付款按钮前退出并保留证据。

### 2026-09-05 Browser 运营检查分层原则

- 首次接入、代理/Profile 变更、代码部署或连续异常时执行完整 Browser 基线检查。
- 日常订单由系统自动完成轻量健康检查，不要求操作员逐项确认。
- 仅路线切换、Provider/卡台写入、开卡/补余额和真实付款等高风险动作需要人工确认。

### 2026-09-05 Browser 执行器真实缺口纠偏

- 现场代码核对发现生产 Worker 仅实现 Google Chrome control lane；BitBrowser 目前只完成本地 Local API/CDP 手工预检，尚未接入 Worker runtime adapter。
- 后续必须先实现并隔离验证 BitBrowser adapter（open/close/CDP、Profile 绑定、只读 manifest、异常安全退出），再做生产只读接线；不能通过修改 target 或启动 Worker 伪装完成。

### 2026-09-05 闸门对抗式审查与补强

- 现场确认旧闸门不是全链路验证；已补强 `scripts/agent-evidence-gate.sh browser-order`，额外检查本地只读 Worker、SSH DB 隧道、生产 Browser schema 和 heartbeat。
- 本轮实际结果：本地前置依赖 READY；生产 Browser Worker 仍 inactive/disabled、target=LOCAL_FIXTURE；Provider 写权限关闭；最新订单仍 API `WAITING_FOR_CARD`。因此只能进入真实 Browser 订单的准备阶段，不能宣称 Browser 充值已跑通。
- 完整审查记录：`docs/BROWSER_PREFLIGHT_ADVERSARIAL_AUDIT_2026-09-05.md`。

### 2026-09-05 生产默认路线现场纠正（最新）

- 通过生产数据库直接只读核对：`fulfillment_routes` 中 ChatGPT Plus 当前 `BROWSER.accepts_new_orders=1`、`API.accepts_new_orders=0`；`browser_dispatch_enabled=true`，Browser Profile ACTIVE，heartbeat 持续更新。
- 因此后台 Browser 按钮不可点击的原因是它已经是当前默认路线（前端对当前选中项设置 disabled），不是“无法切换”。此前依据旧 API 订单推断当前默认路线为 API 属于错误，已纠正。
- 旧 API 订单保持 API 路线冻结；新提交订单将按 Browser 路线创建。付款写权限仍关闭。

### 2026-09-05 检查脚本收敛

- 按用户决定删除两个容易被误读为“系统已就绪”的汇总闸门：`scripts/agent-evidence-gate.sh`、`browser-mvp/scripts/check-dry-run-readiness.sh`。
- 保留 `scripts/bitbrowser-proxy-health.sh` 与 Browser readonly smoke/test 脚本；它们只做运行健康或测试，不下业务结论。
- 事实核对改回直接读取代码、生产服务、数据库、日志和真实订单证据；不再依赖单一汇总脚本。

### 2026-09-05 卡片同步维护退避修复（代码完成，未部署）

- 已修复维护响应没有真正作用到同步 job 的缺陷：maintenance 按 Provider Retry-After 延迟，且不消耗卡片重试预算；避免 15 秒 timer 快速打满 5 次后误入人工。
- 回归 530/484/46/0。生产仍运行旧 release，当前 Browser 测试订单仍 `WAITING_FOR_CARD`；部署并恢复该订单前不得宣称已修复完成。

### 2026-09-05 卡片同步维护退避生产验收

- release `20260905-card-sync-backoff-fbf789c` 已部署；备份完整性、服务/timer、live/ready 均通过。
- 生产实证：维护失败后的 card sync job 为 `PENDING/attempts=0`，`available_at` 延后 300 秒，修复生效。当前上游仍维护，因此测试订单继续等待，不把“机制已修复”误写成“卡台已恢复”。

### 2026-09-05 Browser 卡前前置检查（当前主线）

- 现场确认当前真实 Browser 订单 `PJV1-lxez72TytHc1O6QZxjNd` 为 `WAITING_FOR_CARD`；卡 `2833` 本地库存状态为 `AVAILABLE/$16`，但卡片与交易证据停留在 2026-09-04 21:00 UTC。HNSKJ 维护导致无法刷新，因此不是“数据库没有卡”。
- 发现正式 Worker 把数据库 executor profile UUID 与 BitBrowser Local API Profile id 当成同一个值；现已拆成 `BROWSER_EXECUTOR_PROFILE_ID` 与 `BITBROWSER_PROFILE_ID` 两个明确配置。
- 新增 `BROWSER_PREFLIGHT`：Browser 订单创建时与 `ASSIGN_CARD` 同事务排队；先做 Session/身份/订阅/Checkout/金额/税费只读观察，不创建 attempt、run、资金预留，不读取卡资料，不付款。
- Browser 正式 `SUBMIT_RECHARGE` 必须等待前置检查 `outcome=PASSED`；填卡或付款前仍执行原有卡片新鲜度与资金检查，不能用前置结果绕过。
- 本地回归：Browser `123 total / 119 passed / 4 skipped / 0 failed`；v1 `531 total / 485 passed / 46 skipped / 0 failed`。生产部署与当前订单前置观察仍在本轮后续执行，未宣称付款跑通。
- 合同：`docs/contracts/2026-09-05_browser-order-preflight-contract.md`。
- 首次真实前置观察发现 ChatGPT 对无活动订阅账号仍可能保留历史 `subscription_plan=chatgptplusplan`，但权威字段 `has_active_subscription=false`。旧解析器要求 plan 名含 `free`，因此把可充值账号误判成 `ACCOUNT_STATUS_UNKNOWN`。已改为以显式活动布尔值为准；没有放宽身份匹配、HTTP 成功或未知 Schema 门槛。

### 当前接续规则（2026-09-05）

卡片存在但交易/余额证据超过 15 分钟时，订单等待 Provider 只读同步；Provider maintenance 使用 `retryAfterMs` 退避，不消耗卡片重试预算。Provider 恢复后自动重试并重新计算资格，客户无需重新提交 Session/CDK；不得绕过新鲜度门槛。

> **2026-09-05 卡台隔离展示修订**：已确认“底层共用卡表、运营上按卡台分池”是目标。卡片状态查询现在读取 `provider_accounts` 来源标识，后台卡片列表按“HNSKJ 卡台/备用卡台/其他来源”分组显示；不把不同卡台数量混成一个运营池。Browser 分配仍由路线卡源映射和优先级决定，历史订单不会被改写。

> **2026-09-05 多备用卡台扩展原则（用户已确认方向）**：备用卡台不是固定的单一“备用”，未来可能增加 2–3 个具有不同能力/用途的卡源，且切换频率可能较高。因此实现不能写死 `primary/backup` 两个分支；应采用可注册的卡源目录 + 路线允许来源 + 优先级/策略模式。普通模式按健康状态和优先级自动选源，运营可在 Browser 卡源控制面一键切换当前优先级；订单分配后冻结卡源，切换只影响新订单；必要时保留受控的单订单卡源例外。每个卡源单独统计和健康检查，API 能力过滤不能被 Browser 备用卡源绕过。

> **2026-09-05 高频切换要求（再次确认）**：用户明确要求系统适配未来高频切换卡台。最终方案不是固定“一个主卡台+一个备用卡台”，而是可注册多卡源目录；Browser 卡源控制面支持自动选择、指定来源优先、暂停来源三类操作。切换采用事务和版本化策略，只影响新订单；订单分配后冻结 `card_source`，不允许执行中漂移。每个来源独立统计、健康检查和能力声明，API 路线按 `supports_api` 过滤。该要求属于正式需求基线，后续实现和审查不得退回写死双卡台模型。

> **2026-09-05 多卡源策略讨论稿已落盘（未最终确认、未实现）**：用户已提出未来可能有原卡台 + 2–3 个不同用途备用卡台且切换频率较高；已落盘讨论稿 `docs/CARD_SOURCE_SWITCHING_POLICY.md`，供继续讨论，暂不视为冻结方案：采用可注册卡源目录、能力声明、健康状态、优先级和策略版本；Browser 支持 AUTO / 指定来源优先 / 暂停来源三种最小模式；API 自动排除无 API 来源；切换只影响新订单，分配后冻结卡源，付款未知禁止换源/重付；后台集中控制并独立统计。下一步先讨论并确认策略边界；在用户最终确认前不实现、不部署、不改变生产路线。

> **2026-09-05 多卡源策略讨论增量（用户已确认部分规则）**：用户明确：指定卡台不可用或出问题时，系统不得自动回退到其他卡台，一切等待运营者处理；同意健康状态由系统检测并允许运营手动暂停；同意付款前允许单订单指定卡台；卡台选择不采用复杂优先级/评分，由运营者直接指定当前使用的卡台。上述为已确认讨论决策，整体方案仍未最终冻结，代码和生产均不变。

> **2026-09-05 多卡源策略讨论增量 2**：用户确认 API 当前卡台在业务上固定为现有具备 API 的卡台；未来无 API 卡台不进入 API 路线。Browser 是统一承载路线，可使用现有 API 卡台或任意具备 Browser 卡资料的卡台。用户同意 API 与 Browser 分别保存当前卡台，当前卡台暂停后保留选择并等待人工切换。第三项“入口位置”采用下述建议，待用户最终确认后再冻结。

> **2026-09-06 充值方式命名已确认**：用户确认采用最终显示名称：`API 充值`（说明为通过卡台 API/协议接口自动完成）与 `浏览器自动化充值`（说明为通过 BitBrowser/浏览器自动化完成）。卡台来源和当前卡台继续独立显示，不与充值方式混淆。代码和后台文案尚未实施改名。

> **2026-09-06 多卡源方案纠偏（待现场核查）**：此前讨论稿未经后台/生产核对，错误引入“切换失败拦截”和“单订单切换”假设。用户已明确：卡台切换应由运营者直接决定，系统只能告知目标卡台的能力/健康/库存风险，不得阻止切换；不把单订单切换作为日常方案。此前入口和流程设计全部退回讨论，后续必须先核对真实后台、代码和生产，再重新设计。

> **2026-09-06 多卡源现场核查完成（只读）**：已核对本地代码与生产 release，证实当前“卡台路线”入口实际切换的是 `fulfillment_routes.accepts_new_orders`（充值/接单路线），后端和前端均以健康条件拦截切换；生产尚无 `fulfillment_route_card_sources` 表，备用卡源策略未上线，API/Browser 当前均绑定 `legacy-primary`。此前关于独立当前卡台和单订单切换的设计均不能视为现状。完整证据：`docs/2026-09-06_card-source-current-system-audit.md`。下一步先基于事实重新讨论入口与切换语义，不实现、不部署。

> **2026-09-06 深查增量**：进一步比对发现本地卡源分配代码已引用 `fulfillment_route_card_sources`，但生产 current release 的 `workflow-repository.js` 尚未包含该引用且生产不含 migration 048；备用卡源能力确实尚未进入生产。生产路线切换服务与本地一致，当前健康拦截仍真实存在。后续必须先基于此差异重新设计，不得只改页面文案。

> **2026-09-06 多卡源讨论错误复盘**：对照真实前端、后端、建单/分卡事务和生产后，新增纠正十项错误判断。最重要修正：为了保证“切换只影响新订单”，Browser 当前卡台必须在订单创建事务中冻结，不能等到异步分卡时才读取；否则切换会错误影响已提交但等待卡片的订单。API 首版固定 HNSKJ，不做对称卡台切换；不做 AUTO/优先级/自动回退/日常单订单切换；健康与库存只告知、不阻止运营选择。完整复盘：`docs/2026-09-06_card-source-discussion-error-review.md`。整体方案仍在讨论，未实现、未部署。

> **2026-09-06 Browser 卡台切换影响范围已确认**：全局切换默认只影响新订单；用户确认增加一个明确的可选动作，可在切换时一次性迁移“尚未真正开始”的等待订单，而不是逐单选择。候选必须无已分配卡、无活动消费预留、无 recharge attempt、无 Browser run/付款动作、无 UNKNOWN 资金状态；确认前显示候选数量，不满足条件的订单保持原卡源。该业务决策已落盘，整体方案仍在讨论，未实现、未部署。

> **2026-09-06 卡台能力与完整快照规则确认**：用户明确备用卡台每次导出均包含该卡台全部卡片，因此导入按“完整快照”处理：本次缺失卡不删除历史，但停止进入新订单分配；若存在活动绑定/attempt/run/UNKNOWN 则保持锁定并核对。用户再次明确浏览器自动化充值可以使用 HNSKJ：HNSKJ 同时服务 API 和 Browser，Browser 也可切换到其他备用卡台；选 HNSKJ 时仍可使用其 API 同步/开卡/补余额能力，选无 API 来源时只使用已导入卡片。整体方案仍在讨论，未实现、未部署。

> **2026-09-06 付款未知范围讨论（未最终冻结）**：用户指出网络延迟可能导致“已付款但未返回”，一笔未知不应暂停整个 Browser 链路。代码核对显示当前 UNKNOWN 主要锁定对应 run/attempt/order/card，其他订单任务仍可领取；但 executor 缺少点击后的有界 `VERIFYING_PAYMENT` 自动观察阶段，诊断 audit 又会把全局 UNKNOWN 列作 blocker，口径需收敛。建议保留同一未决订单不二次点击的局部互斥，同时让其他订单/Profile/卡台继续运行。详见 `docs/2026-09-06_payment-unknown-scope-discussion.md`；尚未实现、未部署。

> **2026-09-06 三方对账现场核查**：生产总览动态计算 4 个“三方对账异常”，但 `reconciliation_cases` 为 0；4 个全部是明确 `FAILED/DEFINITE_FAILURE` 后没有外部充值订单号的 CLOSED/RECHARGE_FAILED 单，属于现有投影误报。另发现对账 SQL仍使用旧 `cards.order_id`，不适配一卡跨订单复用；并硬编码 ZZSHU，不能作为 Browser + HNSKJ/手工卡台的统一证据模型。建议保留真实资金对账核心，删除误报口径，拆分为“付款核实中/证据待同步/需人工核对”，且一单未知不暂停全链路。详见 `docs/2026-09-06_three-way-reconciliation-audit.md`；未实现、未部署。

> **2026-09-06 卡台来源与对账工作线防漂移机制启用**：新增唯一状态表 `docs/CARD_SOURCE_AND_RECONCILIATION_WORKSTREAM.md`，集中记录已确认、待冻结、已否定、生产差距、实现映射和部署验收；专项报告只能提供证据，不能自行改变决策。当前阶段 D1 方案讨论，未达到 D2 冻结前不得开始业务代码实现或生产部署。后续每项必须通过“决策 ID→代码→测试→release→生产证据”闭环，避免新模型从旧文档恢复已否定方案。

> **2026-09-06 卡台运营方案确认并完成对抗审查**：用户确认首页只管充值方式、卡台管理页负责 Browser 当前来源/来源分组/完整快照、切换可选批量接管、安全局部付款核实及分路线对账。审查未推翻方向，但发现本地候选不可直接部署的 6 项：导入器写死单一来源；分卡仍按 enabled/priority 自动混选；完整快照把业务不可用卡误当数据错误；跨来源同 PAN 可重复入库；快照与分卡存在竞态；新增卡资格硬编码 `$16`。详见 `docs/2026-09-06_card-source-operating-design-adversarial-review.md` 和工作线唯一状态表。当前仍未实现/部署。

> **2026-09-06 D2 最终冻结候选稿已形成**：已将确认需求、已否定方案、生产差距及对抗审查修正收敛到 `docs/CARD_SOURCE_AND_RECONCILIATION_FROZEN_SPEC.md` D2-RC1。工作线 D1 已完成，D2 为“候选待终审”；用户确认整份冻结稿前不得进入 D3 业务代码实现或生产部署。冻结稿包含后台职责、建单冻结、批量接管、完整快照、跨来源实体卡去重、付款 VERIFYING、分路线对账、并发、通知、非目标和15项最小验收矩阵。

> **2026-09-06 卡台来源与对账方案 D2 正式冻结**：用户确认 `docs/CARD_SOURCE_AND_RECONCILIATION_FROZEN_SPEC.md` D2-FINAL，无异议。后续实现必须遵守冻结合同；任何方向性偏离须先更新冻结稿并重新确认。当前未修改业务代码、未部署、生产不变。下一阶段为 D3：先建立“决策 ID→migration/后端/前端/测试/生产验收”映射，再一次性实施，禁止从旧报告恢复已否定方案。

> **2026-09-06 D3 本地候选回归最新状态**：卡源目录/完整快照/订单冻结来源/Browser 卡台管理/基础对账实现已完成本地回归；`v1` 540 项测试为 493 通过、47 个隔离数据库套件跳过、0 失败，多来源 MySQL 回归通过；`browser-mvp` 132 项为 128 通过、4 跳过、0 失败。付款未知已改为有界 `VERIFYING_PAYMENT`：短时阶段只读核实，不立即制造人工案例；明确拒绝可安全释放，超时或冲突才升级人工案例。当前未部署、未开卡、未补余额、未启动 Browser 付款。下一块是接入只读核实调度并完成三类路线证据收敛，然后进入 D4 生产差异核对。

> **2026-09-06 D3 付款核实协调器补充**：已新增本地 `browser-payment-verification-service.js` 和 due 查询；`v1` 当前 543 项测试 496 通过、47 跳过、0 失败。协调器尚未接入生产进程，Browser 真实付款仍未验收。

> **2026-09-06 D3 路线化对账补充**：后台订单读取已接入路线化证据判断，Browser 不再依赖 ZZSHU 外部订单号，手工卡源缺交易 API 时显示“证据待同步”而非误报；新增 3 项测试，`v1` 当前 546 项、499 通过、47 跳过、0 失败。仍未部署生产。

### 2026-09-06 备用卡 `$20` Browser 首单付款前通过

订单 `PJV1-AH6M688B3Wfv5_vxISmp` 已冻结备用卡台 A，尾号 `5501` 余额 `$20`。真实 BitBrowser 观察已通过身份/FREE、MockAddress DE、PHP 和零税：`₱1100/税117.86` 重报价为 `₱982.14/税0`，唯一 Subscribe 可用，付款 0 次。页面 drift 候选修复完成并通过 Browser 全量 0 fail；下一步只做单一 commit 发布与生产复核，然后请求一次真实付款确认。

### 2026-09-06 付款前修复发布完成

Stripe 地址 iframe 与 Checkout summary 漂移修复已发布为 `/opt/pojia/releases/20260906-stripe-live-a9e65e3`；全量 manifest、备份、服务健康和 LIVE check 通过。订单/卡/账本保持原付款前边界，Browser run 与 permit 为 0。当前执行顺序：取得唯一真实付款确认 → 短时开启订单绑定付款权限 → 单次点击 → Plus/取消续费/账本/客户状态/通知收口 → 立即关闭付款权限。
