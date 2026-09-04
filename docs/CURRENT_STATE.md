# 当前生产状态快照｜2026-09-02 21:42 CST

> 只保留当前有效事实；历史过程查 `HANDOFF_LOG.md`，方向与顺序查 `PROJECT_MAP.md`，全链路和验收细则查 `PROJECT_OPERATING_MODEL.md`。
> 本快照已现场核对生产 release、systemd、Worker 进程环境、数据库 Provider account 和只读 readiness；Browser 主线只读回归证据见 `docs/2026-09-01_browser-main-readonly-regression.md`。
> **2026-09-03 增量**：客户充值页 v2 改版 release 已部署并公网现场渲染验证（见 §1）；本次仅重核客户页 release 与渲染，§2–§5 的业务门禁 / 资金 / 卡片沿用 2026-09-02 00:32 核对基线，未重新现场核对。

## 1. 代码、release 与服务

- 生产当前 release `20260903-customer-redesign-3cef082`（打包 HEAD `3cef082` = 接手审计报告 + 本地预览 gitignore；含客户页 v2 改版 commit `67b1598`）；在前序 release `7bad460`（Browser 访问阻断重试修复、Provider 失败原因透传、后台刷新、卡片异常占用释放、客户充值页重设计、供应规划修复）基础上叠加客户充值页 6 步横向进度/去二次确认/3 步骤条/配色升级改版。
- 生产 `/opt/pojia/current`：`/opt/pojia/releases/20260903-customer-redesign-3cef082`；直接回滚点为 `/opt/pojia/releases/20260901-browser-access-block-7bad460f26d311d8f15103c86933a276cf4b9d14`（`ln -sfn <旧 release> current && systemctl restart pojia-web`）。
- 客户页已完成公网桌面/390px 移动端、教程弹层、真实历史订单查询、CSP、静态资源哈希和 Console 复验；真实成功订单的成功邮箱/时间线仍待下一单验收。详细证据见 `docs/2026-09-01_customer-recharge-redesign-production-candidate.md`。
- 客户页 v2 改版（2026-09-03 部署 `3cef082`）：去二次确认一步建单、6 步横向进度条（大号百分比 + easeOutCubic 平滑动画 + 6 节点依次递进）、3 步骤条（填写资料→开通处理→开通完成）、祖母绿压深 + 香槟金点缀配色；资源版本 `?v=10`。公网 curl 现场核实生产 serve 新版 `customer.css`（32213B，含 `--brand:#0b7d5a`/`--gold:#a9843f`）、`customer.js`（22971B，含 `CANON`/`PROGRESS_PCT`/`animateProgress`/`renderProgress`）、`index.html` 引用 `?v=10`，CSP `style-src/script-src 'self'` 放行同源资源；重建自包含预览走真实前端渲染路径目视确认深色/浅色输入页 + 跟踪进度（PAYING 55%/第 3-6 步/6 节点递进）三态正确。实施与验证记录见 `docs/2026-09-03_customer-page-redesign-v2-implementation.md`。
- `pojia-web.service=active`；`pojia-worker.service=active`。
- `pojia-browser-worker.service=inactive/disabled`（本轮曾短暂启动非付款测试，结束后已停止）。
- `pojia-card-stock-runner.timer`、`pojia-card-funding.timer`、`pojia-card-funding-reconcile.timer` 均 active/enabled；最新 migration 为 `044_operator_alert_actionability`。
- 普通 Worker 的卡片写为 false，但两个独立补给 runner 分别保留开卡/补余额所需的窄范围卡片写；不能用 Worker 环境推断自动补给被关闭。
- 付款前 hold 的临时 drop-in 已移出运行配置，测试订单已正式清理；当前不处于 hold 演练。

## 2. 当前营业与执行门禁

- `acceptNewOrders=true`。
- `dispatchNewRecharges=true`，模式 `AUTOMATIC`。
- 默认充值方式：API。
- Worker 实际进程环境：
  - `PROVIDER_WRITES_ENABLED=false`
  - `PROVIDER_CARD_WRITES_ENABLED=false`
  - `PROVIDER_RECHARGE_WRITES_ENABLED=true`（已恢复并重启后核对）
- 数据库 recharge Provider account：`read_enabled=1`、`write_enabled=1`、`circuit_state=CLOSED`。
- 数据库 card Provider account：`read_enabled=1`、`write_enabled=0`、`circuit_state=CLOSED`；现行 stock/funding runner 不以该 `write_enabled` 为写门禁，而以各自 systemd 窄范围 gate 为准。这是字段语义不一致，但不是当前补给的实际阻断。
- Worker 进程已具备 API 最终充值能力；数据库 recharge Provider account 同样允许写。
- `/health/ready` 返回 `{"status":"ready"}`；Worker 重启后 active/running，进程环境实际为 `PROVIDER_RECHARGE_WRITES_ENABLED=true`。
- 2026-09-01 15:54 CST 部署后现场核对：默认路线为 API，接单/自动派发/API 最小充值权限、自动开卡和自动补余额均为 true；Browser Worker 仍关闭。只读 preflight `ok=true/blockers=[]`、活动任务 0、UNKNOWN 资金风险 0、开放对账 0，Worker heartbeat 2 秒。尾号 1013 已由用户停用，当前没有 Plus 可直接分配卡。

### 当前结论

生产目前已恢复 API 最小执行权限：业务开关已营业，Worker 具备 API 最终充值能力，生产只读 preflight 无 blocker。该结论只证明系统级执行基线，不证明某个客户 Session 或单笔 Provider 结果。

## 3. “开始营业”当前真实行为

代码会先检查：

1. 默认 API/Browser 路线是否可识别；
2. 所选执行器是否健康且具备真实执行能力；
3. 卡供给是否可直接满足，或能由自动补余额/自动开卡恢复；
4. 自动开卡时 Provider 快照、开卡能力和默认卡段是否就绪。

无 blocker 后才打开接单与自动派发；派发开启失败时补偿关闭接单。该入口不会修改 systemd、Provider account 或资金写权限。

已有跳转：卡台路线、Browser、对账、卡片库存、卡余额充值、刷新 Provider 规则。API 充值进程权限关闭目前只显示文字、没有“去处理”跳转。

该按钮尚未检查独立 funding/stock runner 心跳与它们的窄范围进程 gate、开卡日限额和未决补给任务；且若营业后执行能力漂移，当前代码不会自动关闭已经为 true 的接单/派发。这些是开始营业快照的真实边界。

## 4. 自动补给与卡片规则

- `card_balance_recharge_enabled=true`，独立 funding service/timer 已开启；仅真实订单遇到合格低余额卡时创建精确差额 attempt。空闲零 Provider 写调用已验证，首笔真实补余额闭环尚未验收。
- 自动开卡已开启：真实无卡需求时按当前默认卡段开一张目标余额卡；60 秒 timer 只兜底，无需求时不刷新 Provider。
- 每卡最大成功支付次数全局设置为 3（可在 1–4 调整）；跨订单容量代码已部署，连续真实订单计数/释放/上限仍待验收。
- `4744/1065=PRODUCT_ONLY(claude)`；当前旧失效批次（含 8590）均 `RETIRED`；未来新卡按实时证据接管，不使用永久卡号白名单。
- 15 分钟资料/交易证据要求触发按需只读刷新，不把订单年龄本身当失败。
- 当前可立即分配为 **0 张**：21:40 CST 只读库存投影 `ready=0/available=0`。Provider 卡 `2338`、尾号 `4643` 虽仍为 `active/$16`，但已绑定失败订单 `PJV1-u696SEuwCQqyReHZ_FmP`、库存为 `ASSIGNED`，不得误写成可分配。旧批次均 `RETIRED`，不能进入自动补余额或新订单分配。
- 尾号 `6807` / Provider `1477` 的真实卡可用性是用户确认的运营事实；但当前生产数据为 Provider status=`invalidating`、历史 assignment=`ACTIVE`，因此现行资格 SQL **不会把它分配给新订单**。这是待核对/收敛的历史数据缺口，不得误报为当前可分配。

## 5. 已验证与未验证

### Browser 分支最新代码状态（未部署）

- `codex/browser` 已补齐六 Profile 的 macOS 启动形态：单/多 Profile 配置互斥校验、1–6 唯一 Profile、并发上限、默认 `ONCE` 与显式 `CONTINUOUS`。
- Worker heartbeat 已改为进程级默认 10 秒一次，不再由每条空闲 lane 每轮写数据库；1 秒 lane poll 只查询共享任务库，不调用 Provider/卡台 API。
- 本地验证：Browser 普通全量 `140 total / 136 passed / 4 environment-skipped / 0 failed`；全新临时 MySQL 8.4、完整 migrations 001–044 下，原 4 个跳过项已单独实跑 `4/4 passed`；v1 Browser repository `21/21`；shell/JS 语法和 `git diff --check` 通过。
- 以上不改变生产状态：本轮未部署、未启动生产 Browser Worker、未访问真实客户 Session、未调用 Provider/卡台、未点击 Subscribe、未付款。
- 证据：`docs/browser-research/BROWSER_SIX_PROFILE_PRODUCTION_SHAPE_PREPARATION_2026-09-02.md`。

### 最新订单边界

- Browser 非付款测试订单 `PJV1-zffo7WJvbKcPECKcCxzx` 已完成清理：自动开卡扣款预计 `$16.58`，实际卡台余额由 `$36.01` 变为 `$19.43`；订单已 `CLOSED/CANCELLED_PRE_SUBMISSION`，新卡 `2338`/尾号 `4643` **当时**曾释放为 `AVAILABLE`，之后已被 API 失败订单重新绑定，当前状态以上述 21:40 CST 投影为准。Browser 访问阶段返回 `CHATGPT_ACCESS_BLOCKED`，未创建任何 `create_direct` Provider 调用，未点击付款。
- 测试期间发现 Browser Worker 在该错误下会将订单回到 `CARD_READY` 并重复创建 attempt（共 20 次，均 `CLEARED`，无外部付款）；已修复 `7bad460`：访问/Checkout 阻断现在终止为 `RECHARGE_FAILED`，不再重排提交任务。修复已部署并通过定向 Browser 测试。

- 最新订单 `PJV1-412JIT_yfiuBpZeC39_m` 于 2026-09-01 14:01 CST 建立。API Provider 返回明确失败“卡片被拒，请换卡后重提”，外部订单号 `8849`；订单为 `RECHARGE_FAILED`，资金风险已清除、无成功付款。按失败策略，所用卡片暂不恢复为可直接分配。
- 客户页 `parseSessionInput()` 已能将首个完整 JSON 对象解析出来并剥离尾随文本；成功建单只证明 JSON 语法层通过，不证明 Session 身份、账号资格或业务可用性通过。
- 2026-08-31 23:02 CST 只读核对无活动 task、无 ACTIVE/UNKNOWN 资金风险、无 UNKNOWN Provider call；本单没有付款证据。单纯粘贴不会建单，`POST /api/v1/orders` 只在客户表单 submit 处理器中发生。

### 已验证

- 至少两笔历史真实 API 成功订单，并完成取消续费。
- 付款前暂停演练：订单走到 `SUBMITTING`/唯一 attempt/资金栅栏，在外部 `create_direct` 前停止；没有真实付款。
- 演练清理：测试订单为 `RECHARGE_FAILED`，attempt/funds fence 清除，task 保持 DEAD，避免自动重试。
- Worker executor capability 传递缺陷已修复并有测试覆盖。
- 自动补余额空闲安全：无订单时零 Provider 充值写调用。

### 尚未验证

- 当前 release/config 恢复 API 常驻最小权限后的下一笔**有效 Session**真实订单；最新已关闭订单不算成功链路验收。
- 低余额卡精确补款→到账→原订单自动继续的生产闭环。
- 无合格卡时唯一自动开卡→订单继续的生产闭环。
- 一卡跨 3 个订单的真实计数和上限停止。
- 当前主线的 Browser 生产非付款闭环与任何真实 Browser 付款。
- 2026-09-01 16:00 CST 已在当前生产 release 重新执行 Browser `production-readonly-worker --check`，结果 `READY`；这只证明生产只读配置可启动，不等于客户式 CDK+Session 页面闭环已经执行。
- 3–5 单连续 API 稳定性、10–20 单并发、恢复演练和 100–300 单/日。

## 6. 当前唯一下一步

### 2026-09-02 新增真实 API 订单结果（现场核对）

- 客户提交后创建订单 `PJV1-T4ZOp1MpFM0G6sXehOYX`，冻结路线为 API。
- Provider 外部订单号 `9247` 已提交并完成轮询，最终订单状态为 `RECHARGE_FAILED`。
- Provider 返回 `paymentResult.success=false`，失败原文为“开通超时，请稍后查询是否已到账”；系统 `funds_risk_state=CLEARED`，未形成成功付款金额。
- 本轮没有自动换卡、重试或切换 Browser；后续须先人工决定是否继续，不得把该单当作成功链路验收。
- 用户确认重试后创建新订单 `PJV1-u696SEuwCQqyReHZ_FmP`；在重新核对旧单失败、卡余额仍为 `$16` 且无 PURCHASE 后，释放旧单的 `RECONCILIATION` 占用并由新订单重新分配尾号 `4643`。
- 新外部订单 `9255` 从 `processing` 最终再次返回同一失败“开通超时，请稍后查询是否已到账”，订单已 `RECHARGE_FAILED`，attempt=`FAILED/CLEARED`。再次只读核对卡仍为 `active/$16`，交易仍只有开卡充值、没有 PURCHASE；不得第三次盲目重试。
- 重试期间暴露自动开卡阻断：Provider 当前可见卡段均 `maintaining=true`，数据库默认卡段仍为已消失的 `16`，stock runner 返回 `CARD_STOCK_CARD_TYPE_UNAVAILABLE`。本次通过释放并复用现有卡继续，不代表自动开卡闭环成功。

1. 已恢复 Worker 常驻最小 API 充值权限并完成重启/只读核对；hold 关闭，通用 Provider/卡片写与 Browser 付款仍关闭。
2. 2026-09-02 21:42 CST 生产只读 preflight 已确认 `ok=true/blockers=[]`、活动任务和资金风险均为 0；库存投影同时确认 `ready=0/available=0`，卡 `2338` 仍为 `ASSIGNED`，不可供下一笔订单使用。
3. 下一笔有效 API 订单将进入“无合格卡→自动开卡”，但卡台余额 `$19.43` 低于当前卡段要求的最低账户余额 `$25`；来单前需先由运营补足卡台账户余额，否则不能把自动开卡写成可成功。
4. 通过后进入 3–5 单连续 API 验收，观察一卡多单、余额不足后的精确补款及下一次无卡自动开卡。Browser 下一步不是重复建单，而是先解决/确认 `CHATGPT_ACCESS_BLOCKED` 的可访问网络环境，再重新执行到付款按钮前的非付款观察。

## 7. 2026-09-01 最新失败单的现场复核（订单 8849）

- `PJV1-412JIT_yfiuBpZeC39_m` 的 ZZSHU 外部订单 `8849` 已通过创建接口受理，随后最终状态为 `failed`；原始只读状态的唯一失败详情为“卡片被拒，请换卡后重提”，`paymentResult.success=false`，支付金额 `982.14 PHP`。
- 同一状态响应中的目标账号套餐为 `free`，因此本次不是已是 Plus 的 `40030` 分支；创建、轮询均有明确响应，不是超时或 `SUBMIT_UNKNOWN`。
- HNSKJ 只读复验：卡 `1839`/尾号 `1013` 为 `active`、余额 `$16.00`、资料完整；交易仅有 `$16.00 CARD_RECHARGE SUCCESS`，没有对应 `PURCHASE`。这证明卡台侧就绪不等于 ZZSHU/商户侧消费一定获批，但没有证据证明已扣款。
- 结论边界：已确认是上游支付处理方拒绝该卡；上游未提供更细 decline code，不能擅自归因于余额、3DS、CVV、BIN、地区或银行规则。详见 `docs/2026-09-01_order-412JIT-card-decline-investigation.md`。
- 后台失败原因透传已部署：历史订单 `PJV1-412JIT_yfiuBpZeC39_m` 经生产代码和数据库只读调用实际返回“卡片被拒，请换卡后重提”，来源为 `PROVIDER_ATTEMPT`；未来轮询确认失败时也会把脱敏后的 Provider 原文写入订单主表。
- 用户随后在卡台删除/停用该卡。现场复查 HNSKJ 显示 `1839/1013=invalidating`、余额 `$0.01`；本地原快照曾滞后为 `active/$16`，已执行一次只读同步更新本地快照。因失败订单仍有 ACTIVE assignment，本地 `inventory_status=ASSIGNED` 继续保留审计关联，资格计算不会分配该卡。
- 口径更正：未绑定的旧卡（`203/261/314/315/316/317/332/333/334/335/444/451/493/612/616/617/917`）不是“余额不足等待补款”，而是因同批服务器更换已确认永久不可用，均有 `card_operational_overrides.allocation_policy=RETIRED`，不得进入自动补余额或新订单分配。`1065/4744` 为 Claude 专用，不属于 Plus 库存。后续只有新接管且通过实时证据的卡才可进入补给/分配流程。

## 8. 2026-09-02 卡段开卡只读复核（更正）

- 第一次卡段读取结果与随后直接读取结果不一致；已按最新原始 Provider 响应复核，当前 7 个卡段（ID 16–22）均 `maintaining=false`、`purchaseEnabled=true`，卡段维护不是当前阻断。
- 当前卡台余额为 `$19.43`；卡段要求 `minBalanceUsdt=25`，开 `$16` 卡的预计费用为 `$16.58`，开卡后余额将低于 Provider 要求的最低余额。
- 因此当前仍不能安全开 `$16` 卡，真实阻断是**卡台账户余额不足**，不是卡段维护。剩余开卡额度为 `291`。
- 已保留并验证本地保护修复：同步保留 `maintaining` 字段，遇到未来维护卡段时在付费调用前返回 `CARD_STOCK_CARD_TYPE_UNAVAILABLE`；本次未执行开卡或任何 Provider 写入。

## 8. 2026-09-02 Browser 六 Profile 代码状态（非生产）

- `codex/browser` 已基于 `main@0624f2a` 实现 1–6 BitBrowser Profile 常驻池、并发 lane、订单间页面/Cookie/storage 清理和故障槽隔离。
- 付款前代码时序已改为：卡片/账单地址准备→读取最终税费与总额→预算判断→Checkout 摘要绑定权威 permit/submit intent→最终复核；仍未接生产 LIVE 付款。
- Browser 全量 `138 total / 134 passed / 4 skipped / 0 failed`；v1 repository 定向 `21/21`。需 `TEST_DATABASE_URL` 的隔离 MySQL 项保持未执行。
- 这不改变本文件前述生产事实：生产 release 未变，Browser Worker 仍 `inactive/disabled`，默认路线仍为 API，未执行 Subscribe/付款/Provider 写入。
- 详细证据：`docs/browser-research/BROWSER_SIX_PROFILE_POOL_IMPLEMENTATION_2026-09-02.md`。

## 9. 2026-09-03 Browser 单 Profile Delaware 非付款复验

- 单个 BitBrowser 菲律宾 Profile 已完成一次生命周期内的 Session 注入、身份/FREE 核对、真实 ChatGPT Plus Checkout、卡片与 Delaware 账单地址填写、最终金额稳定读取和清理。
- 地址填写后金额仍为 `PHP 982.14 + VAT 117.86 = PHP 1100.00`；Subscribe 控件存在且启用，但未点击，`submitCalls=0`，没有付款或 Provider/卡台写入。
- 敏感输入经仓库外 `0600` 临时文件读取后立即删除；结束时清空字段、Cookie/storage 并关闭 Profile。生产 release、默认 API 路线和 Browser Worker 状态未改变。
- 单 Profile 完成后曾推进 3 Profile 非付款同开/隔离验证；其现场结果和当前阻塞以第 10 节为准。真实付款与部署仍未确认。
- 证据：`docs/browser-research/BITBROWSER_DELAWARE_NONPAYMENT_TAX_OBSERVATION_2026-09-03.md`。

## 9.1 2026-09-04 美国出口 Delaware 非付款对照

- 独立 BitBrowser Profile 现场确认美国出口和 ChatGPT HTTP 200；测试 Session 身份匹配且为 FREE。
- 常规升级入口进入 `US/USD` Checkout：填卡/地址前为 `USD 20.00 + 2.40 tax = 22.40`，填写 `US/DE` 后为 `USD 20.00 + 0.00 tax = 20.00`。
- pricing config 与 Checkout create 均指向 `US/USD`；地址后 snapshot 返回 204，但当次未观察到 request body，不宣称 snapshot 内部地区字段已证实。
- Subscribe 可用但未点击，`submitCalls=0`；字段、Cookie/storage、一次性敏感文件和 Profile 均已清理。
- 本次未复现 `PHP 982.14`；只证明常规入口在美国出口下切到 US/USD 轨道。生产 Browser 菲律宾出口决策未变。
- 本轮修正冷 Profile UI hydration 等待、中文金额标签和证据安全扫描误报；Browser 全量 `153 total / 148 passed / 5 environment-skipped / 0 failed`。
- 旧显式 `PH/PHP + custom` 探针两次得到 HTTP 400 `unusual activity`，但复查确认该探针使用附件旧 token 裸调 API，绕过当前官方前端实际携带的 Sentinel、设备和目标路由请求头；因此不能据此判定账号被禁或该地区组合被有效拒绝。已删除该裸调路径。后续实测证明在 Sentinel 生成后改 POST body 仍返回 HTTP 400；再改为前置选择官方 PH pricing config 后，官方前端生成 `US/PHP`，因不满足 `PH/PHP` 合同已在本机 abort，Checkout 上游请求为 0。PH config 已现场读到 `plus.month=1100 inclusive` 和 `psp_override=982.14 exclusive`；后续已转入菲律宾官方 UI PSP route 实测，结果见 9.2，不继续把 400 解释成账号封禁。
- 证据：`docs/browser-research/US_EXIT_DELAWARE_TAX_AB_NONPAYMENT_2026-09-04.md`。

## 9.2 2026-09-04 菲律宾官方 UI PSP 路由非付款观察

- 恢复本地 mihomo 后实测 Cloudflare trace 为 `loc=PH/colo=MNL`；先前 BitBrowser “网络不通”是本地代理进程未运行，不是 Checkout 代码故障。
- 独立税费观察脚本与生产 runtime 不一致，曾误清 Cloudflare/设备运行 Cookie 导致 account-check 403；已修正为严格五项 allowlist，Session/Auth/未知 Cookie 仍不保留。
- CDP 现场取证确认官方前端原生 Checkout create 为 `PH/PHP`、HTTP 200、`automatic_tax_enabled=true`、processor entity=`openai_llc`。
- 金额在填卡前、填卡后、页面回读 `US/DE` 后始终是 `PHP 982.14 + VAT 117.86 = PHP 1100.00`；未观察到 `/backend-api/payments/checkout/snapshot`。
- Subscribe 可用但未点击，`submitCalls=0`；7 个字段、Session/Cookie/storage 和临时输入已清理，Profile 已关闭。
- 当前 HNSKJ 测试卡组合不会选中 `psp_override=982.14`；官方选择条件仍未知。下一步只做不同 BIN/发卡路由测试卡的单变量 A/B，不再重复同卡。
- 证据：`docs/browser-research/PH_OFFICIAL_UI_PSP_ROUTE_NONPAYMENT_2026-09-04.md`。

## 10. 2026-09-03 Browser 三 Profile 访问与隔离闸门

- BitBrowser 本地已由 1 个扩为 3 个候选 Profile；两个新 Profile 禁止账号/Session/Cookie/storage/支付地址同步，opaque ID 只存在本机 `0600` Git 忽略配置。
- 用户在三个独立 headed Profile 打开 ChatGPT 后，现场确认 3 个 PID、3 个 CDP 端口、每个 1 个 BrowserContext；新 Profile 取得各自 Cloudflare 运行 Cookie，没有 Session cookie。
- 查明并修复此前 403 的直接机制问题：客户隔离原先清掉全部 ChatGPT/OpenAI Cookie，也误删 Profile 的 Cloudflare clearance。现在仅恢复五类 Profile 运行 Cookie，Session/Auth/未知 Cookie 全部删除，storage 和客户页面仍清空。
- 修正后真实三路同时验证：ChatGPT HTTP 200=`3/3`，Cookie 隔离=`3/3`，localStorage 隔离=`3/3`，Session/卡/submit 均为 0。
- 三路当前共用同一个菲律宾出口；粗粒度指纹属性摘要相同，完整指纹差异和网络隔离尚未证明。下一步先验完整指纹与重启稳定性，再进入 6 Profile。
- 无 Session、卡片、Checkout、Provider/卡台写入或付款；生产状态未改变。证据：`docs/browser-research/BITBROWSER_THREE_PROFILE_ACCESS_AND_ISOLATION_ATTEMPT_2026-09-03.md`。

## 11. 2026-09-03 Browser 六 Profile 访问与隔离闸门

- 原三个 Profile 关闭后重新启动，仍为 ChatGPT HTTP 200 `3/3`、Cookie/localStorage 隔离 `3/3`，此前 Profile 运行 Cookie 保留修复通过重启复验。
- 本地已新增三个不承载客户材料的 Profile，形成六槽配置；opaque ID 只在 Git 忽略的本机 `0600` 文件中。
- 第一轮六个并发 Local API 启动请求出现部分启动后单请求被拒；所有窗口已关闭并确认收敛。生产 Profile 池和验证器均已改为物理窗口顺序启动、页面任务并行，并对实时槽位状态和失败清理负责。
- 最终真实六路结果：ChatGPT HTTP 200 `6/6`、Cookie 隔离 `6/6`、localStorage 隔离 `6/6`、本轮运行时指纹摘要 `6/6` 不同；菲律宾出口摘要只有 `1` 个。
- 用户已确认现阶段六 Profile 可共用一个菲律宾出口；这不是六个独立出口，也尚未证明长时常驻或高并发付款风控。
- 修正后的生产池复验中，第 4 个 Profile 曾有一次页面未正常到达；单槽一次复验恢复 HTTP 200，随后完整六路再次 `6/6` 通过，当前没有固定坏槽证据。
- Session 注入、卡字段写入、submit、Provider/卡台写入均为 0；Browser 全量 `141 total / 137 passed / 4 environment-skipped / 0 failed`。生产 Browser Worker仍未部署/启用。
- 下一步是六 Profile 接入生产形态但仍不付款的本地 Worker/共享队列闭环，再单独确认首笔真实 Browser 付款。证据：`docs/browser-research/BITBROWSER_SIX_PROFILE_ACCESS_AND_ISOLATION_VERIFICATION_2026-09-03.md`。

## 12. 2026-09-03 Browser 六 Profile 共享队列闭环尝试

- 一次性 MySQL 8.4、完整 migrations 和六条合成 dispatch job 已用于真实六 Profile 生产 Worker 形态测试；无客户 Session、真实卡资料、ChatGPT Checkout、Provider/卡台调用或付款。
- 第一轮发现生产时序缺陷：Worker 先领取六个任务再等待 Profile 顺序冷启动，后排任务可能在窗口就绪前租约过期，最终出现 `ACTION_TIMEOUT` 后 safe-abort 又遇到 `LEASE_EXPIRED`。
- 代码已改为 Worker 启动时先 warmup 所需 Profile，全部就绪后才启动队列 lane；账户级启动错误只调用一次 Local API并阻断剩余排队启动。
- 修正后的第二轮在 warmup 第一个窗口收到 `BITBROWSER_DAILY_OPEN_LIMIT`，发生在队列领取之前；当天额度已用完，因此不能宣称共享队列闭环已通过。
- 当前 Browser 全量 `143 total / 138 passed / 5 environment-skipped / 0 failed`；六个真实 Profile 均关闭，一次性数据库已删除。
- 唯一下一步：每日额度恢复后原样重跑隔离集成项，验收六 job 全部安全收敛且付款 permit/submit/活动租约为 0。证据：`docs/browser-research/BITBROWSER_SIX_PROFILE_SHARED_QUEUE_NONPAYMENT_ATTEMPT_2026-09-03.md`。

## 13. 2026-09-03 菲律宾 Browser 税费口径纠正

- 运营方确认近期已有多笔订单以 `PHP 982.14` 实际成交；仓库内 2026-08-18 独立成功 PoC 和 2026-08-29 第二笔真实 API 成功订单也记录 `982.14 PHP`，并有卡台 PURCHASE 证据。
- 当前 BitBrowser 的 `982.14 + VAT 117.86 = 1100.00 PHP` 只证明现有菲律宾 Profile、账号、网络与支付定位信号组合会加税，不能推导成菲律宾所有充值都必须支付 `1100.00`。
- Delaware 地址单变量已经证明不足以去除 VAT；下一阶段需要保持零付款，用受控 A/B 分离账号地区、Checkout 创建路径和支付/账单定位信号，并读取地址填写后的最终稳定总额。
- 运营方进一步确认生产出口保持菲律宾；美国出口不进入生产实施矩阵。2026-09-04 美国出口仅在单次明确允许下作了诊断对照；生产方向未变。
- 该成本机制必须在首笔真实 Browser 付款前确认；证据和实验矩阵见 `docs/browser-research/PHILIPPINES_VAT_ROUTE_DIFFERENTIAL_2026-09-03.md`。

## 14. 2026-09-03 菲律宾 Checkout 税费观察器已补强（代码验证，未现场重跑）

- 已对白名单网络证据、Checkout 创建、billing snapshot、pricing config、Stripe path 脱敏和三段金额时间线完成实现。
- 公开菲律宾账单证明 `982.14` 可只是未税净价，最终应付仍可能为 `1100.00`；社区可复现免税组合使用美国出口，与本项目菲律宾固定出口约束冲突，不能照搬。
- 当前最先要验证的是 Delaware 地址是否真正进入 `/backend-api/payments/checkout/snapshot` 以及 snapshot 前后金额是否变化，不再继续随机换地址。
- Browser 全量 `150 total / 145 passed / 5 environment-skipped / 0 failed`；本轮没有打开 Profile、读取敏感输入、创建 Checkout、付款或改生产。
- 证据：`docs/browser-research/PHILIPPINES_CHECKOUT_TAX_OBSERVER_ENHANCEMENT_2026-09-03.md`。
