# 当前生产状态快照｜2026-09-02 00:32 CST

> **2026-09-04 现场增量（优先于下方 09-02 基线）**：当前生产 release 仍为 `20260903-dark-surface-eba5331`。新卡 `2772/9051` 实际 `active/$16`，但失败订单 9414 的消费账本=`RECONCILIATION`、assignment=ACTIVE，导致 available=0；交易同步仅见开卡充值、无 PURCHASE。自动补卡今日显示 24/5，实为 24 个请求、23 个零开卡预检失败、实际 opened=1。代码修复候选已完成、尚未部署；生产状态仍未收敛。详见 `docs/2026-09-04-card-availability-root-cause-and-fix.md`。

> 只保留当前有效事实；历史过程查 `HANDOFF_LOG.md`，方向与顺序查 `PROJECT_MAP.md`，全链路和验收细则查 `PROJECT_OPERATING_MODEL.md`。
> 本快照已现场核对生产 release、systemd、Worker 进程环境、数据库 Provider account 和只读 readiness；Browser 主线只读回归证据见 `docs/2026-09-01_browser-main-readonly-regression.md`。
> **2026-09-03 增量**：客户充值页 v2 改版 + 夜间配色微调两次 release 已先后部署并公网现场验证（见 §1，当前 release `20260903-dark-surface-eba5331`）；本次仅重核客户页 release 与渲染，§2–§5 的业务门禁 / 资金 / 卡片沿用 2026-09-02 00:32 核对基线，未重新现场核对。

## 1. 代码、release 与服务

- 生产当前 release `20260903-dark-surface-eba5331`（commit `eba5331`：夜间卡片与背景拉开层次——背景压深/卡片提亮/边框加清晰/卡片顶部微光立体边，仅深色态、白天零改动）；其父为客户页 v2 改版 release `20260903-customer-redesign-3cef082`（HEAD `3cef082`，含改版 commit `67b1598`）；再前序 `7bad460`（Browser 访问阻断重试修复、Provider 失败原因透传、后台刷新、卡片异常占用释放、供应规划修复）。
- 生产 `/opt/pojia/current`：`/opt/pojia/releases/20260903-dark-surface-eba5331`；直接回滚点为 `/opt/pojia/releases/20260903-customer-redesign-3cef082`（`ln -sfn <旧 release> current && systemctl restart pojia-web`）。
- 客户页已完成公网桌面/390px 移动端、教程弹层、真实历史订单查询、CSP、静态资源哈希和 Console 复验；真实成功订单的成功邮箱/时间线仍待下一单验收。详细证据见 `docs/2026-09-01_customer-recharge-redesign-production-candidate.md`。
- 客户页 v2 改版（2026-09-03 部署 `3cef082`）：去二次确认一步建单、6 步横向进度条（大号百分比 + easeOutCubic 平滑动画 + 6 节点依次递进）、3 步骤条（填写资料→开通处理→开通完成）、祖母绿压深 + 香槟金点缀配色；资源版本 `?v=10`。公网 curl 现场核实生产 serve 新版 `customer.css`（32213B，含 `--brand:#0b7d5a`/`--gold:#a9843f`）、`customer.js`（22971B，含 `CANON`/`PROGRESS_PCT`/`animateProgress`/`renderProgress`）、`index.html` 引用 `?v=10`，CSP `style-src/script-src 'self'` 放行同源资源；重建自包含预览走真实前端渲染路径目视确认深色/浅色输入页 + 跟踪进度（PAYING 55%/第 3-6 步/6 节点递进）三态正确。实施与验证记录见 `docs/2026-09-03_customer-page-redesign-v2-implementation.md`。
- 客户页夜间配色微调（2026-09-03 部署 `eba5331`，`?v=11`）：深色态卡片与页面背景明度太近、卡片浮不出——已压深背景 `--bg #0a0e0c→#070a08`、压暗顶部光晕 `--bg-glow→#0e1712`、提亮卡片 `--surface #121814→#18211c`（同步抬 `--surface-2/3` 保持"输入框>卡片>背景"阶梯）、`--line/--line-strong` 边框提亮、`.card` 深色态加顶部 `inset` 微光立体边；仅深色、白天零改动。公网 curl 核实生产 `customer.css?v=11`（32787B）含上述 token、`index.html` 引用 `?v=11`、`/health/ready`=ready。绿金强调色本轮未改（一度试改后按用户澄清"指的是卡片/背景"已还原）。
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
- 当前可立即分配为 **1 张**：本轮自动开卡生成 Provider 卡 `2338`、尾号 `4643`，余额 `$16`；测试订单取消后 assignment 已释放、库存为 `AVAILABLE`。旧批次均 `RETIRED`，不能进入自动补余额或新订单分配。
- 尾号 `6807` / Provider `1477` 的真实卡可用性是用户确认的运营事实；但当前生产数据为 Provider status=`invalidating`、历史 assignment=`ACTIVE`，因此现行资格 SQL **不会把它分配给新订单**。这是待核对/收敛的历史数据缺口，不得误报为当前可分配。

## 5. 已验证与未验证

### 最新订单边界

- Browser 非付款测试订单 `PJV1-zffo7WJvbKcPECKcCxzx` 已完成清理：自动开卡扣款预计 `$16.58`，实际卡台余额由 `$36.01` 变为 `$19.43`；订单已 `CLOSED/CANCELLED_PRE_SUBMISSION`，新卡 `2338`/尾号 `4643` 为 `AVAILABLE`。Browser 访问阶段返回 `CHATGPT_ACCESS_BLOCKED`，未创建任何 `create_direct` Provider 调用，未点击付款。
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
2. 生产只读 preflight 已确认 blocker、活动任务和资金风险均为 0；Provider 卡 `2338`、尾号 `4643` 当前为 `active/AVAILABLE/$16`，可直接供下一笔 API 订单使用。
3. 接受下一笔有效 Session 的真实 API 订单，优先验收“自动分配 4643→API 充值→取消续费→交易/余额/对账”；不得给旧 `RETIRED` 卡补钱，也不得重试已失败的 1013。
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
