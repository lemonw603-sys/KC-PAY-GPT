# 当前生产状态快照｜2026-09-05

> **2026-09-05 订单发现机制纠偏**：曾错误声称“订单提交后没有跨窗口发现机制”。代码和生产数据库现场核对后确认，现有建单事务已写入 `orders`、`order_events` 与 `tasks`，Browser 路线同时写入 `BROWSER_PREFLIGHT`；系统具备持久化任务发现能力。本次客户订单 `PJV1-AH6M688B3Wfv5_vxISmp` 已落库，当前 `WAITING_FOR_CARD`，路线 `CHATGPT_PLUS_BROWSER_V1/BROWSER`，`ASSIGN_CARD` 任务 `PENDING`，最近错误 `CARD_STOCK_EMPTY`。已把包含 Browser 建单任务写入的 order-intake 文件发布到 `/opt/pojia/releases/20260905-order-preflight-130349` 并复验 Web `ready`，同时为该已存在订单幂等补建 `BROWSER_PREFLIGHT` 任务；该任务随后在付款前安全停止，错误为 `CHECKOUT_OBSERVATION_FAILED`，没有付款。误判根因是本执行窗口未使用生产可用的 Node/mysql2 查询方式，却先据此下结论；不是客户提交失败，也不是数据库漏写。后续涉及“有没有新订单”必须先读取生产数据库或已登录后台的原始响应，禁止凭窗口可见性或历史上下文推断。

> **最新代码/生产边界（2026-09-05）**：本地已用两个独立 BitBrowser Profile 完成目标 Session 三项身份匹配后的全新 Checkout 前后对照；两次均从 `PHP ₱1,100（含 12% VAT）` 在填卡、US/DE 地址和 Session 邮箱后重算为 `PHP ₱982.14 / Tax 0`，未点击 Subscribe、未付款。提交 `04e08e6` 已发布为 `/opt/pojia/releases/20260905-browser-zero-tax-04e08e6`，直接回滚点 `/opt/pojia/releases/20260905-session-errors-d24f6d6`；Browser 文件哈希、`npm run check`、生产 Browser `--check=READY`、Web/Worker active、live/ready 均通过。Browser Worker 仍 `inactive/disabled`；发布后 RUNNING task=0、ACTIVE/UNKNOWN 充值资金=0、ACTIVE/UNKNOWN 补款资金=0。本文下方更早的 release 描述只作历史记录，不得覆盖本条。详情见 `docs/browser-research/BITBROWSER_TAX_MULTI_SAMPLE_2026-09-05.md`。

> **2026-09-05 本机 BitBrowser 代理生命周期修复现场证据**：已停止无主 mihomo 进程并交由 `~/Library/LaunchAgents/com.ai充值业务.mihomo.plist` 管理，wrapper 使用目录锁防止重复实例。健康检查已从“端口 LISTEN”升级为单实例、监听归属和真实 HTTPS 出口请求三项检查；当前 `17897` 与 `19097` 均由同一 mihomo PID `45732` 监听，ipify 经代理返回 `38.60.246.34`，检查结果 `READY`。这只修复本机代理生命周期，不代表 ChatGPT Cloudflare challenge 已解决。

> **2026-09-05 单 Profile 只读复核**：在代理修复后，Pilot Profile 完成打开、CDP 接管、访问 `https://chatgpt.com/`、关闭；HTTP `200`，标题正常，未出现 Cloudflare challenge。未注入 Session、未创建订单、未进入 Checkout、未付款。原始证据见 `artifacts/bitbrowser-single-profile-check-20260905/result.json`；这不是客户式充值验收。

> **2026-09-04 只读复验最新事实**：旧卡 `2772/9051=active/$0.01/DEPLETED`；其此前 `$16/AVAILABLE` 快照已过期。随后系统真实自动开出 `2833/5980`，当前生产数据库为 `active/$16/AVAILABLE`，因此当前有 1 张可直接分配 Plus 卡。本文后续凡写“当前无卡”的旧句均不得覆盖这一较新事实。

> **2026-09-04 补给恢复最新增量**：生产 release 为 `/opt/pojia/releases/20260904-funding-recovery-race-4bf84f9`，Web/Worker/只读同步、补款、补款对账和补卡 timer 均 active，`/health/ready=ready`，migration 最新为 045。补款明确失败有界恢复与陈旧卡先同步修复已部署。原测试订单在部署前已因自动开卡而继续，API 外部订单 9440 最终明确失败，无 PURCHASE，卡 5980 已安全释放为 `$16/AVAILABLE`。

> 只保留当前有效事实；历史过程查 `HANDOFF_LOG.md`，方向与顺序查 `PROJECT_MAP.md`，全链路和验收细则查 `PROJECT_OPERATING_MODEL.md`。

> **2026-09-05 代码修复状态**：Browser Checkout 导航已适配当前 ChatGPT Profile 菜单入口，且持久 Context 的 Session 注入会先删除旧 Session cookie 分块再写入本单 cookie；不清理 `__cf_bm` 等非 Session cookie。代码提交 `92fc70e`，Browser 全量回归 `120 pass/4 skipped/0 fail`。生产已切换至 `/opt/pojia/releases/20260905-browser-checkout-92fc70e`，备份完整性 `OK`，live/ready 均正常；Browser Worker 仍 inactive/disabled，付款/Provider/卡台写入均未执行。
> 本快照已现场核对生产 release、systemd、Worker 进程环境、数据库 Provider account 和只读 readiness；Browser 主线只读回归证据见 `docs/2026-09-01_browser-main-readonly-regression.md`。

## 2026-09-05 备用卡台接入开发状态（本地，未部署）

- `/Users/lemon/Downloads/卡片列表.xls` 已现场解析：文件签名为 OOXML ZIP，17 列表头、2 行数据；导入器按签名和固定表头解析，不依赖扩展名。
- 已新增 `v1/migrations/048_manual_backup_card_import.sql`、`v1/src/services/manual-card-import-service.js` 和后台上传→预览→确认导入入口。数据写入独立 `manual_excel` 卡源，`sync_tier=MANUAL_IMPORT`；不调用 Provider，不进入自动开卡/补余额/卡台同步。
- Browser 卡资格与付款前检查对手工快照走正式分支：不伪造 15 分钟 Provider 交易同步时间，仍保留余额、绑定、消费账本、退款争议、租约和资金栅栏；路线卡源表支持 HNSKJ 优先、手工卡兜底。
- 模板两张卡余额为 `$2`、`$0`，均应为不可分配；完整 PAN/CVC 未写入代码、文档、日志或测试 fixture。
- 验证：v1 定向 105/105 通过，Browser 既有 128/132（4 环境跳过）基线通过，Node 语法检查通过，真实模板解析通过。未执行生产迁移、未导入生产、未启动 Browser Worker、未创建订单或付款。
## 1. 代码、release 与服务

- 生产 `/opt/pojia/current`：`/opt/pojia/releases/20260904-funding-recovery-race-4bf84f9`，直接回滚点 `/opt/pojia/releases/20260904-funding-recovery-0e5a82d`，再前为 `20260904-funding-integer-8caccfb`。
- 客户页已完成公网桌面/390px 移动端、教程弹层、真实历史订单查询、CSP、静态资源哈希和 Console 复验；真实成功订单的成功邮箱/时间线仍待下一单验收。详细证据见 `docs/2026-09-01_customer-recharge-redesign-production-candidate.md`。
- 客户页 v2 改版（2026-09-03 部署 `3cef082`）：去二次确认一步建单、6 步横向进度条（大号百分比 + easeOutCubic 平滑动画 + 6 节点依次递进）、3 步骤条（填写资料→开通处理→开通完成）、祖母绿压深 + 香槟金点缀配色；资源版本 `?v=10`。公网 curl 现场核实生产 serve 新版 `customer.css`（32213B，含 `--brand:#0b7d5a`/`--gold:#a9843f`）、`customer.js`（22971B，含 `CANON`/`PROGRESS_PCT`/`animateProgress`/`renderProgress`）、`index.html` 引用 `?v=10`，CSP `style-src/script-src 'self'` 放行同源资源；重建自包含预览走真实前端渲染路径目视确认深色/浅色输入页 + 跟踪进度（PAYING 55%/第 3-6 步/6 节点递进）三态正确。实施与验证记录见 `docs/2026-09-03_customer-page-redesign-v2-implementation.md`。
- 客户页夜间配色微调（2026-09-03 部署 `eba5331`，`?v=11`）：深色态卡片与页面背景明度太近、卡片浮不出——已压深背景 `--bg #0a0e0c→#070a08`、压暗顶部光晕 `--bg-glow→#0e1712`、提亮卡片 `--surface #121814→#18211c`（同步抬 `--surface-2/3` 保持"输入框>卡片>背景"阶梯）、`--line/--line-strong` 边框提亮、`.card` 深色态加顶部 `inset` 微光立体边；仅深色、白天零改动。公网 curl 核实生产 `customer.css?v=11`（32787B）含上述 token、`index.html` 引用 `?v=11`、`/health/ready`=ready。绿金强调色本轮未改（一度试改后按用户澄清"指的是卡片/背景"已还原）。
- `pojia-web.service=active`；`pojia-worker.service=active`。
- `pojia-browser-worker.service=inactive/disabled`（本轮曾短暂启动非付款测试，结束后已停止）。
- `pojia-card-stock-runner.timer`、`pojia-card-funding.timer`、`pojia-card-funding-reconcile.timer` 均 active/enabled；最新 migration 为 `045_card_sync_priority`。
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
- 当前可立即分配为 **1 张**：Provider 卡 `2833`、尾号 `5980`，`active/AVAILABLE`，余额 `$16`；Provider 明确失败后只读交易无 PURCHASE，assignment 与 ledger 已释放。`2772/9051` 仍为 `DEPLETED/$0.01`。
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
- 自动补余额空闲安全：无订单时零 Provider 充值写调用。首次真实触发已证明明确失败会清除资金风险，但尚未验收到账与原订单继续。

### 尚未验证

- 当前 release/config 恢复 API 常驻最小权限后的下一笔**有效 Session**真实订单；最新已关闭订单不算成功链路验收。
- 低余额卡精确补款→到账→原订单自动继续的生产闭环。
- 无合格卡时唯一自动开卡→订单继续的生产闭环。
- 一卡跨 3 个订单的真实计数和上限停止。
- 当前主线的 Browser 生产非付款闭环与任何真实 Browser 付款。
- 2026-09-01 16:00 CST 已在当前生产 release 重新执行 Browser `production-readonly-worker --check`，结果 `READY`；这只证明生产只读配置可启动，不等于客户式 CDK+Session 页面闭环已经执行。
- 3–5 单连续 API 稳定性、10–20 单并发、恢复演练和 100–300 单/日。

### 2026-09-04 容量边界现场复核

- 生产 `WORKER_CONCURRENCY` 未显式设置，按当前代码默认值实际为 **1**；代码虽支持 1–32，但尚未做生产并发验收。
- 补余额 timer 每 5 秒运行一次、每轮只领取 1 个 `PREPARED` attempt；补余额对账 timer 每 15 秒运行一次、每轮只领取 1 个待对账 attempt。
- 自动开卡 timer 每 60 秒运行一次、每轮只领取 1 个开卡 job；当前 `card_stock_low_threshold=0`，即没有预热库存缓冲，主要靠真实需求触发。
- 因此当前版本不能宣称已经承载峰值 1 单/分钟或 100–300 单/日。若每单都临时开卡/补款，串行补给会成为关键路径；后续应先建立小型可用卡缓冲并做 3–5 单连续、10–20 单并发验收，再调整有限并发。

## 6. 当前唯一下一步

当前唯一立即执行项是：为下一笔真实 Browser 订单完成一次性配置/门禁核对，并在订单到来后按完整清单验收。用户确认本次还要覆盖“无合格 Plus 卡→自动开一张带目标余额的新卡→分配→Browser 付款”；现有 5980 不提现、不销卡，只能在无其他新订单的受控窗口内做可逆运营隔离，测试后恢复。执行前还必须先满足 Provider 的开卡余额合同。自动补余额成功到账留到下一次自然低余额场景；小型库存缓冲与并发放量属于其后的容量阶段。

最新决策增量：用户改为希望正式注销 5980 后验证真实无卡分支，并要求接入 `mockaddress.com` 免税州账单地址能力。现场代码核对显示 Browser 分支已有账单字段填写、填后税额/总额重读和 LIVE 付款适配器骨架，但当前生产仍是 readonly Worker，主线尚未包含 BitBrowser 分支的最新运行代码，MockAddress 动态来源与后台配置也不存在。因此顺序必须是先把 Browser 分支选择性对齐主线并完成地址来源/后台/非付款回归，再一次性确认余额提取、注销、开新卡和真实付款；不得先注销卡后等待代码开发。

### 2026-09-02 新增真实 API 订单结果（现场核对）

- 客户提交后创建订单 `PJV1-T4ZOp1MpFM0G6sXehOYX`，冻结路线为 API。
- Provider 外部订单号 `9247` 已提交并完成轮询，最终订单状态为 `RECHARGE_FAILED`。
- Provider 返回 `paymentResult.success=false`，失败原文为“开通超时，请稍后查询是否已到账”；系统 `funds_risk_state=CLEARED`，未形成成功付款金额。
- 本轮没有自动换卡、重试或切换 Browser；后续须先人工决定是否继续，不得把该单当作成功链路验收。
- 用户确认重试后创建新订单 `PJV1-u696SEuwCQqyReHZ_FmP`；在重新核对旧单失败、卡余额仍为 `$16` 且无 PURCHASE 后，释放旧单的 `RECONCILIATION` 占用并由新订单重新分配尾号 `4643`。
- 新外部订单 `9255` 从 `processing` 最终再次返回同一失败“开通超时，请稍后查询是否已到账”，订单已 `RECHARGE_FAILED`，attempt=`FAILED/CLEARED`。再次只读核对卡仍为 `active/$16`，交易仍只有开卡充值、没有 PURCHASE；不得第三次盲目重试。
- 重试期间暴露自动开卡阻断：Provider 当前可见卡段均 `maintaining=true`，数据库默认卡段仍为已消失的 `16`，stock runner 返回 `CARD_STOCK_CARD_TYPE_UNAVAILABLE`。本次通过释放并复用现有卡继续，不代表自动开卡闭环成功。

1. 已恢复 Worker 常驻最小 API 充值权限并完成重启/只读核对；hold 关闭，通用 Provider/卡片写与 Browser 付款仍关闭。
2. 生产卡 `2833/5980` 当前为 `active/AVAILABLE/$16`，`2772/9051=active/DEPLETED/$0.01`；无 ACTIVE/UNKNOWN 补款资金风险。
3. 测试订单 `PJV1-tw-hliEBgnOfdEVsxn5r` 已明确失败并终态收敛，不再对其补款或重提。
4. 下一步回到 Browser 真实订单前的一次性配置/门禁核对；自动补余额到账留待下一次自然低余额场景，不人为提现制造测试。

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
- 2026-09-04 现场值：卡台余额 `$18.84`；卡台实时卡段合同返回 `requireMinBalance=1/minBalanceUsdt=25`。这表示**发起开卡前账户余额必须至少为 `$25`**，不是“开卡后仍保留 `$25`”。该值来自 Provider，不是本系统的可调安全阈值，不得本地伪改为 `$18`。
- 因此当前如进入无卡分支，开 `$16` 卡会在 Provider 写入前被余额预检阻止；现有 `2772/9051` 可直接分配，所以无订单时不会触发开卡。剩余开卡额度为 `291`。
- 已保留并验证本地保护修复：同步保留 `maintaining` 字段，遇到未来维护卡段时在付费调用前返回 `CARD_STOCK_CARD_TYPE_UNAVAILABLE`；本次未执行开卡或任何 Provider 写入。

### 2026-09-04 MockAddress 账单地址集成（代码已落盘，未部署）

- 已固定抓取并纳入仓库数据 `browser-mvp/data/mockaddress-us-taxfree-v20260426.json`，来源版本 `taxfree_target_no_source_perstate888`、生成时间 `2026-04-26`，SHA-256 `509dd2b017aaa5caab9d2ad03a371a62d62029664c2f30d052c81b0f4e83b70c`。运行时不访问 `mockaddress.com`。
- 新增 `MockAddressBillingAddressSource`：仅返回姓名、国家、州、城市、街道、邮编；按订单/绑定引用确定性选取，重试不会随机换地址；拒绝错误版本、坏 JSON、缺字段和不支持州。
- HNSKJ JIT card material source 已支持注入该账单来源；Browser LIVE adapter 已有填入账单后重新读取税额/总额的边界（Browser 分支代码尚未部署到生产）。
- 运营后台新增 Browser→账单资料设置接口和页面：启停、州、账单姓名、来源版本/配置状态。迁移 `046_browser_billing_address_settings.sql` 尚未部署。
- 验证：MockAddress 定向测试 `2/2`；v1 全量 `526`（480 通过、46 环境跳过、0 失败）；未启动生产 Browser Worker、未调用 Provider/卡台、未开卡、未付款。

### 2026-09-04 卡台注销规则补充（用户现场确认，待下一次只读合同核对）

- 用户在卡台后台确认：注销卡后预计保留 `$0.01`，其余余额退回卡台账户；当天新开的卡当前不能注销。该规则已作为运营事实记录，不把它误写成已通过 API 合同验证的实现能力。
- 因此 5980 不再为了测试强制注销：若当天不能销卡，则保留并正常使用；任何注销/提现前仍需当次确认并先核对卡台实际可执行状态。

### 2026-09-04 地址复用策略补充

- 用户确认优先保证“一张卡一个账单地址”。已新增地址槽位分配：同一卡片引用始终复用同一地址；不同卡优先占用不同数据行，发生哈希碰撞时自动探测下一个空槽位；地址槽位记录只保存 `binding_ref/state/row_index`，不把完整地址写入账单分配表。
- 生产持久化表为 migration `047_browser_billing_address_assignments.sql`；`MysqlBillingAddressAssignmentStore` 通过唯一键防止并发重复占用。当前尚未部署 migration 047，也未启用生产 Browser 付款。
- 该策略降低地址跨卡重复，但不能证明平台一定免税或一定不触发风控；Checkout 实际税额、AVS/Provider 结果仍是权威证据。

### 地址复用策略修订

- 用户将策略从“严格一张卡一个地址”修订为“尽可能一张卡一个地址，不因地址池耗尽阻塞订单”。地址槽位仍优先一对一分配；全部槽位占用时，选择当前使用次数最低的地址复用，并保留卡片到槽位的持久绑定。

- MockAddress 后台设置服务已补充单测：v1 全量现为 `528 total / 482 passed / 46 environment-skipped / 0 failed`。本轮仍未部署 migration 046/047。

### 2026-09-04 Browser 候选回归修复（已同步主线）

- 在 Browser 候选 worktree 对齐最新主线后发现 v1 客户首页 `GET /` 返回 500；现场错误为 Express `sendFile` 的 `NotFoundError`，文件实际存在且可读，属于静态发送路径在该 worktree 中的不稳定行为。
- 修复为读取 `v1/public/index.html` 后以 HTML 响应发送，并保留 `Cache-Control: no-store`；未改变业务 API、资金门禁或 Browser 逻辑。
- 候选 Browser 回归：`156 total / 151 passed / 5 skipped / 0 failed`；v1 全量：`529 total / 483 passed / 46 skipped / 0 failed`。
- 修复提交 `b902e87` 已选择性同步到主线；主线用户未提交的 `docs/DECISIONS.md` 未触碰、未暂存、未覆盖。
- 该修复只证明本地回归通过；未部署生产，未启动 Browser Worker，未执行 Provider/卡台写入或付款。

### 2026-09-04 生产部署前体检进展

- 代码/测试板块已完成：`git diff --check` 通过；v1 与 Browser 全量回归均 0 失败。
- migration 046/047 已现场检查为增量 SQL，默认账单地址开关为关闭；尚未执行生产迁移。
- 本地 `npm --prefix v1 run preflight:readiness` 未能启动，原因是当前 shell 未提供 `DATABASE_URL`（配置校验直接拒绝），这不是 readiness 通过或生产可用的证据；不能用本地缺少凭证替代生产核对。
- 生产 systemd、当前 release、数据库迁移版本和运行开关仍需在有生产连接的执行窗口现场只读核对；在此之前不部署 Browser 候选、不启动 Worker、不做资金动作。

### 2026-09-04 生产只读体检现场结果（SSH 核对）

- 生产主机 `144.34.180.184` 可通过现有 SSH 会话只读核对；当前 release：`/opt/pojia/releases/20260904-funding-recovery-race-4bf84f9`。
- `pojia-web.service`、`pojia-worker.service` 为 `active/enabled`；`pojia-browser-worker.service` 为 `inactive/disabled`。
- `http://127.0.0.1:3100/health/live` 与 `/health/ready` 均 HTTP 200。
- 数据库已执行迁移最高版本为 `045_card_sync_priority`；046/047 尚未部署，符合当前计划边界。
- 生产配置事实：Provider reads=true（provider.env），Provider 通用写=false、卡片写=false、充值写=false；Browser 为 `PRODUCTION_READONLY/LOCAL_FIXTURE/headless`。Funding 与 read-sync timer 均 active/enabled，但 funding unit 的卡片写权限仍为 false，未执行资金写入。
- 本轮只读核对未修改生产、未执行迁移、未启动 Browser Worker、未调用 Provider/卡台写接口、未开卡/补余额/付款。

### 2026-09-04 Browser 候选部署完成（未启用 Browser 付款）

- 已完成生产备份、完整性校验和隔离恢复演练：`restore_test=OK`，恢复 53 张表。
- 已上传并校验候选归档（SHA-256 `f31e59a6f282907f2832fd4c9a2b8381948d52175f903ba19a0f19248ec07eb1`），当前 release 已切换为 `/opt/pojia/releases/20260904-browser-candidate-32b8a04`。
- 使用独立迁移账号执行 046/047；第二次执行全部报告 `already applied`。数据库最高迁移为 `047_browser_billing_address_assignments`。
- Web/API Worker 已重启并 active，库存 runner timer 已恢复 active；Browser Worker 仍 `inactive/disabled`。
- 生产 `/health/live`、`/health/ready` 和客户首页均 HTTP 200。
- Provider reads=true；通用写、卡片写、充值写均 false。未启动 Browser Worker，未执行 Provider/卡台写入、开卡、补余额或付款。

### 2026-09-04 Browser production-readonly canary

- 已在生产启动 Browser readonly systemd canary；ExecStartPre 检查成功，Worker 连续多轮返回 `status=IDLE`，随后正常停止。
- 当前生产配置目标仍为 `LOCAL_FIXTURE`，不是外部 ChatGPT/真实 Session；因此本次只证明生产 unit、Node 运行时、配置校验、启动/停止和安全空队列循环正常，不等于真实 ChatGPT 访问或付款能力验收。
- canary 结束后已确认 `pojia-browser-worker.service=inactive/disabled`；未创建订单、未读取 Session/PAN/CVC、未调用 Provider/卡台写接口、未付款。

### 2026-09-05 Pro 20X 复核

- 已将用户所说“20X”按既有命名核对为 `Pro 20X`，不是 Plus 的 USD 20 月费价格。
- 当前代码仍是 Plus-only；Pro 20X 仅有产品字段/数据库扩展预留，未进入 CDK PLAN_TYPES、Provider 路由或生产付款。
- 已落盘基础准备记录 `docs/2026-09-05_pro20x-readiness-note.md`：本次真实 Plus Browser 测试只复核产品字段可扩展性，不提前启用 Pro 20X。

### 2026-09-05 Pro 20X 文章现场复核

- 已通过用户本地 Chrome 当前打开的 X Article 现场读取内容，确认其核心顺序为：菲律宾出口稳定 → 先 Plus → 同账号确认 Plus 生效 → 再升级 Pro 20X；每次以实际 Checkout 金额/税费为准。
- 文章中的约 145.15 USD 是个人案例，不是生产定价结论；项目仅吸收顺序、地址候选和付款前重读原则，不复制其卡片方案。

### 2026-09-05 Bark 重复“卡台信息暂时无法更新”现场核对

- 生产 `operator_alerts` 中 `dedupe_key=provider-snapshot:hnskj` 只有一条 `PROVIDER_SNAPSHOT_STALE`，状态长期为 `OPEN`（创建 2026-08-24），最近更新时间 2026-09-04 21:16；说明不是每次失败都创建了新告警记录。
- 生产日志显示 card-catalog-sync 周期性调用 HNSKJ `cardTypes/accountBalance` 时在 `parseEnvelope` 失败，随后任务以 `RETRY_PENDING` 反复重试；因此底层 Provider 快照同步确实持续失败。
- 截图中的重复 Bark 通知不是简单的“多条告警”问题：同一长期 OPEN 事件被重复触发通知，且告警仅被 acknowledge 而未 resolved。现有通知去重没有把“同一 OPEN 事件的更新”与“新故障边沿”区分开。
- 该问题属于 P0 机制问题：需先修复 Provider 响应解析/失败分类和退避，再让 Bark 仅在 OPEN 边沿或明确状态变化时通知，并增加冷却/last-notified 约束；不能只关闭通知声音而保留底层失败循环。

### 2026-09-05 Provider 维护响应与 Bark 去重修复（本地已验证，待部署）

- 生产现场响应已确认：HNSKJ `/account/balance` 与 `/card-types` 返回 HTTP 200 但 `success=false`、无 `data`，消息为“内测结束，正式版本9.5日20：00后推出”。根因是 Provider 主动维护，不是字段漂移。
- 代码将该类响应分类为 `ProviderError.kind=maintenance`、`retryable=true`、`retryAfterMs=300000`，不会进入资金写入或未知付款状态。
- Bark outbox 修复为：同一 OPEN 事件更新不重新入队，仅在告警已 CANCELLED 后重新打开时通知；移除 acknowledge 触发重发路径。
- 验证：v1 全量 `528 total / 482 passed / 46 skipped / 0 failed`；Browser `113 total / 109 passed / 4 skipped / 0 failed`；维护分类与 Bark 定向测试通过。
- 当前仅本地代码变更，尚未部署生产；生产 Provider 写权限、Browser Worker、付款均保持关闭。

### 2026-09-05 P0 修复已部署生产

- 发布：`/opt/pojia/releases/20260905-maintenance-bark-6246cc1`，由提交 `6246cc1` 的已审查代码构成；部署前备份完整性校验通过。
- Web、API Worker、卡台目录同步 timer、Bark 通知服务重启后均 `active`；`/health/live`=`ok`、`/health/ready`=`ready`。
- 生产文件 SHA-256 与本地提交一致；Browser Worker 仍 `inactive/disabled`。
- Provider reads=true；Provider 通用写、卡片写、充值写均 false。未执行开卡、补余额、Provider 写入或付款。

### 2026-09-05 真实 Browser 订单测试边界修订

- 用户确认：若 Checkout 现场确认税费为 0 且金额正确，可在最终确认后执行真实付款；否则必须付款前退出。
- 本次优先使用已存在且已验证可用的卡，不依赖开新卡。卡台当前维护响应导致“开新卡/补余额”不可验证，不得因此阻断已有卡的只读核对。
- 付款前硬门槛：订单/路线/Session/卡绑定一致，卡状态与余额有新鲜证据，账单地址已注入，Checkout 税费与总额现场读取，且用户再次明确确认付款；任一条件不满足即安全退出。

### 2026-09-05 就绪声明纠偏

- 复核发现此前把“本地 BitBrowser 公开首页预检通过”过度表述为“生产真实 Browser 已准备好”；实际生产 Browser Worker 仍 disabled，target 仍为 `LOCAL_FIXTURE`。
- 已建立证据门禁：以后必须分别报告代码测试、只读预检、真实订单可执行和付款验收，不得混称。

### 2026-09-05 执行方式与全层对齐审查

- 代码层：默认充值方式按钮明确写明“只影响切换后新建订单”，Browser 切换服务要求 Browser dispatch 开启、ACTIVE Profile 和 60 秒内 heartbeat；订单创建后路线冻结，API 订单不会静默改成 Browser。
- 生产层：当前真实订单证据为 API 路线；生产 Browser Worker disabled、target=LOCAL_FIXTURE，因此不能消费真实 Browser 订单。
- 文案/后台层：当前按钮与后端门禁基本一致；问题不在“API 订单被错误改成 Browser”，而在执行前没有完成路线核对，且我错误地把本地预检表述为生产就绪。
- 流程层新增硬门禁：提交前必须现场读取默认路线；提交后必须读取订单 executor_kind、Browser job/run；三者未一致不得继续。

### 2026-09-05 Browser 执行器架构复核

- 启动对齐工作后现场查代码确认：生产 readonly Worker 当前只接 `GoogleChromeControlRuntimeAdapter`，配置 target 仅控制 `LOCAL_FIXTURE/EXTERNAL_READONLY`，没有 BitBrowser Local API/CDP adapter。
- 本地 BitBrowser 预检是独立手工控制面验证，不等于生产 Worker 已接入 BitBrowser。不能只改环境变量就宣称 Browser 真实订单可执行。
- 因此真实 Browser 订单前的实际缺口是“BitBrowser runtime adapter + 执行器/DB 租约接线”，而不是简单开启 Worker；当前不切换生产路线、不启动付款。

### 2026-09-05 BitBrowser 接入 readonly Worker（代码完成，未部署）

- `BitBrowserControlRuntimeAdapter` 已接入 `production-readonly-worker.js`，新增 `BITBROWSER_READONLY` target 和独立精确确认词。
- ChatGPT account/Checkout 只读 harness 可与 BitBrowser + shared encrypted Session 组合；付款和 Provider 写开关仍必须全部为 false。
- Browser 全量：`118 total / 114 passed / 4 skipped / 0 failed`；跳过项均要求隔离 MySQL。
- 尚未完成：本地 Worker 连接共享数据库的集成演练、断线/租约测试、生产形态配置和部署。不得据此创建真实订单。

### 2026-09-05 BitBrowser 真实 adapter 只读联调结果

- 使用新 adapter 连接本地 `Plus Browser PH Pilot` Profile，Local API open/CDP/单 Context/close 均成功。
- 导航 ChatGPT 时最终 URL 带 `__cf_chl_rt_tk`，页面标题为空，属于当前 Cloudflare challenge/未完成页面，不能视为正常 ChatGPT 可达。
- 该结果推翻“公开首页已稳定可达”的旧结论：BitBrowser 控制链已接通，但当前 Profile/出口访问不稳定；未注入 Session、未创建订单、未进入 Checkout、未付款。

### 2026-09-05 BitBrowser 代理/配额复核

- BitBrowser `/health` 与 `/browser/list` 仍正常；Pilot Profile `status=1`，代理为 `http://127.0.0.1`，lastIp `38.60.246.34`，未提供 country/city 元数据。
- 第二次 adapter open 在 15 秒内超时；未重复重试以避免触发 BitBrowser 开窗配额/锁死。该结果确认 Profile 生命周期/开窗稳定性尚未通过。
- 未访问 Session、未创建订单、未进入 Checkout、未付款。

### 2026-09-05 BitBrowser 开窗失败根因已确认

- BitBrowser 日志显示失败不是订单、Session 或项目代码：打开 Profile 前的代理探测连接 `127.0.0.1:17897` 被拒绝，BitBrowser 明确记录“网络不通已停止打开浏览器”。
- 该端口是本机 mihomo mixed-port；现场存在两个 mihomo 进程（PID 4541、7152），只有一个监听 17897，说明代理进程生命周期/重复启动存在风险。
- 当前端口已恢复监听，代理请求 `https://api.ipify.org` 返回 `38.60.246.34`；此前 Profile 记录的 IP 为同一地址，BitBrowser 日志缓存地理信息为 PH/Tagum，但仍需稳定性复核。
- 结论：本次打不开的直接根因是本地代理进程瞬时不可用/重复实例，不是生产代码与 BitBrowser adapter 未对齐；ChatGPT challenge 是后续独立问题。

### 2026-09-05 Browser 闸门对抗式审查（现场）

- 原前置闸门检查范围不足，不能证明真实 Browser 订单可执行；已在提交 `bceabdd` 中补强：要求本地 readonly Worker、SSH 数据库隧道，并输出生产 Browser schema、最新迁移和 heartbeat。
- 本轮现场：本地依赖 READY；生产 Browser Worker 仍 inactive/disabled、target=LOCAL_FIXTURE；Provider 写权限关闭；最新订单仍为 API `WAITING_FOR_CARD`。未创建 Browser 订单、未读取 Session、未付款。
- v1 回归 529/483/0（46 skipped），Browser 118/114/0（4 skipped）；跳过项为隔离 MySQL 集成，不能等同真实链路通过。
- 详见 `docs/BROWSER_PREFLIGHT_ADVERSARIAL_AUDIT_2026-09-05.md`。

### 2026-09-05 Browser 卡前检查与 Profile 命名空间修复（代码完成）

- 当前生产 release 现场为 `/opt/pojia/releases/20260905-card-sync-claimkey-8fb9ea4`；Web/API Worker/read-sync timer active，远程 Browser systemd inactive/disabled。本机 PID 59113 的只读 Worker与 PID 59089 的 MySQL 隧道仍在。
- 生产数据库现场：订单 `PJV1-lxez72TytHc1O6QZxjNd` 冻结为 Browser、状态 `WAITING_FOR_CARD`、无 attempt/job/run；卡 `2833` 为 `active/AVAILABLE/$16`、无活动消费预留，但卡片和交易证据过期，上游维护无法刷新。
- 代码修复数据库 executor UUID 与 BitBrowser Profile id 混用；新增 Browser order-scoped `BROWSER_PREFLIGHT` 任务及正式 Browser submit 的完成依赖。
- 前置检查不创建资金 attempt/run/permit，不读取卡资料；正式付款前卡片新鲜度检查保持不变。
- 本地测试：Browser 123/119/4/0，v1 531/485/46/0；跳过项仍是缺隔离 `TEST_DATABASE_URL` 的 MySQL 集成，不得当作真实付款验收。
- 下一动作：提交本轮代码与文档，部署 v1 创建任务逻辑/领取依赖；为当前订单幂等补建一次 preflight task；用本机 BitBrowser 只读 Worker跑到 Checkout 后停止。付款写权限继续为 false。
- 部署后首次运行：Profile 标识拆分已生效，Session 注入成功，`/api/auth/session` 与账号检查均 HTTP 200。现场安全摘要显示 `has_active_subscription=false`、`subscription_plan=chatgptplusplan`；旧解析条件将其误判为未知。已修正为显式 `has_active_subscription=false => FREE`，Schema 缺字段仍为未知并失败关闭。

### 2026-09-05 默认路线现场纠正

- 最新生产数据库只读核对显示 ChatGPT Plus 当前默认路线已是 Browser：`BROWSER.accepts_new_orders=1`、`API.accepts_new_orders=0`；Browser dispatch=true、Profile ACTIVE、heartbeat 持续更新。
- 后台 Browser 按钮不可点击是因为当前已经选中 Browser，前端按设计禁用当前选中项；不是切换失败。
- 之前看到的最新订单为旧 API 订单，不能代表当前默认路线；该订单路线冻结不变。新订单应按 Browser 创建，付款写权限仍关闭。

### 2026-09-05 检查脚本收敛

- 已删除 `scripts/agent-evidence-gate.sh` 与 `browser-mvp/scripts/check-dry-run-readiness.sh`，并从 Browser npm scripts 移除 readiness 包装命令。
- 保留代理健康与只读 smoke/test 工具；生产运行代码未改动。
- `AGENTS.md` 已改为要求直接核对代码、release、服务/进程、数据库、请求/日志，不把脚本输出当作全链路结论。

### 2026-09-05 Browser 真实订单首段结果（付款前）

- 新订单 `PJV1-lxez72TytHc1O6QZxjNd` 已现场创建并冻结为 Browser（route `CHATGPT_PLUS_BROWSER_V1`）。
- 订单当前 `WAITING_FOR_CARD`，尚未创建 `recharge_attempt`、Browser job 或 Browser run。
- 现场卡台快照显示存在一张 `$16`、`active/AVAILABLE` 卡，但其 `last_synced_at` / `last_transaction_synced_at` 已超过新鲜度窗口，因此资格计算按规则拒绝分配；这不是“没有卡”的事实，而是“没有满足新鲜证据条件的可分配卡”。
- 本次真实 Browser 测试已在卡资格门停住；未读取 Session、未进入 ChatGPT、未调用 Provider/卡台写入、未付款。不得重复提交或强行绕过新鲜度门槛。

### 2026-09-05 卡片同步维护退避修复（本地，待部署）

- 现场确认新 Browser 订单停在 `WAITING_FOR_CARD` 的直接原因是卡 `2833` 的交易证据超过 15 分钟，而 HNSKJ 明确处于维护，刷新任务失败。
- 修复 `failCardSyncJob`：Provider maintenance 现在让任务自身遵守 `retryAfterMs`（当前 300 秒），不再被 15 秒 timer 反复领取；维护不消耗单卡重试预算，不会因上游维护错误进入 `REVIEW_REQUIRED`。
- runner 日志改为使用数据库实际失败处置结果和实际退避秒数，避免日志声称 REVIEW 而数据库仍为 PENDING。
- v1 全量：530 total / 484 passed / 46 environment-skipped / 0 failed。尚未部署；既有已耗尽的 REVIEW_REQUIRED 任务和当前等待订单尚未自动迁移或恢复。

### 2026-09-05 卡片同步维护退避修复已部署

- 已创建并校验生产加密备份 `/var/backups/pojia/pojia-20260905T031548Z.sql.gz.enc`，`backup_integrity=OK`。
- 当前 release：`/opt/pojia/releases/20260905-card-sync-backoff-fbf789c`；Web/Worker 与四个卡片相关 timer active，live/ready 正常。
- 已通过正式同步服务为卡 `2833` 新建一项只读同步任务。HNSKJ 仍明确返回 maintenance；新代码将任务保持 `PENDING`、`attempts=0`、下次执行时间延后 300 秒，证明不再被 15 秒 timer 消耗重试预算或误送人工。
- Browser 测试订单 `PJV1-lxez72TytHc1O6QZxjNd` 仍 `WAITING_FOR_CARD`，等待上游恢复后取得新鲜证据；未读取 Session、未开卡/补余额、未付款。

### 2026-09-05｜新鲜度与 Provider 退避接续点

生产已核对 `retryAfterMs` 维护退避修复生效；15 分钟证据门槛保持不变。当前 Browser 订单等待的直接原因是 Provider 只读同步不可用，非 Session 或路由错误。Provider 恢复后应由同步任务自动刷新并重新评估卡资格，无需客户重复提交；禁止绕过新鲜度或伪造同步时间。

### 2026-09-05｜动态零税报价校验基础实现

新增 `browser-mvp/src/billing-quote-readiness.js`：不固定商品价格，以当次 Checkout 小计为基准，要求税额为零且总额与小计在最小货币单位容差内一致；新增 3 个单元测试，全部通过。当前尚未接入执行器、尚未部署，付款仍关闭。

### 卡台隔离展示（本地已完成，未部署）

- 卡片状态查询已读取 `provider_accounts.provider_code/account_code`，并给每张卡返回来源标签；后台卡片列表按卡台分组显示和计数。
- 这不是复制多套卡表：底层仍共用卡片、消费账本和审计；分配由 `fulfillment_route_card_sources` 控制，统计和切换不再把不同卡台视觉上混为一池。

### 多备用卡台扩展原则（设计已确认，尚未实现）

- 未来备用卡台可能增加 2–3 个，且各自承担不同用途，切换频率会较高。
- 因此不能把代码和后台写死为“主卡台/一个备用卡台”；目标模型是可注册的卡源目录，每个来源声明能力、健康状态、优先级和适用路线。
- Browser 卡源切换应集中在一个策略控制面：自动优先、指定来源优先或指定来源禁用；仅影响新订单，订单分配后冻结来源。API 仍按能力过滤，只允许具备 API 的卡源。
- 本条是设计决策，当前尚未新增多个真实卡源，也尚未部署新的卡源策略控制面。

### 高频卡台切换需求（正式确认）

- 用户要求未来可高频在多个卡台之间切换；卡台数量可能为原卡台加 2–3 个不同用途的备用卡台。
- 已确认方案：卡源目录化、能力声明化、策略版本化；Browser 控制面提供自动、指定优先、暂停来源；切换为事务操作，仅影响新订单，已分配订单冻结来源。
- 每个卡台独立统计和健康状态；API 不得选择无 API 来源。该需求与方案已落盘，当前尚未开发策略控制面或部署生产。

### 2026-09-05｜多卡源高频切换策略讨论稿已落盘（尚未冻结、代码未实现）

用户同意先按提议方向整理，但尚未完成策略讨论与最终冻结。已新增 `docs/CARD_SOURCE_SWITCHING_POLICY.md`，定义可注册卡源目录与 Browser/API 能力边界、AUTO/PREFER_SOURCE/DISABLE_SOURCE 三种最小策略、订单/卡源冻结、UNKNOWN 付款锁定、故障恢复、后台集中控制和验收标准。该方案复用现有订单/卡片/账本/审计，不复制第二套业务系统，也不把“卡台路线”与“充值路径”混为一谈。

当前事实：文档已落盘，尚未新增策略表/选择器/后台入口，尚未部署或改变生产默认路线；现有备用卡导入和来源分组代码保持原状。下一步应继续讨论策略取舍并取得最终确认；确认前不做代码实现、部署或生产路线变更。

### 2026-09-05｜多卡源策略讨论增量

用户已确认四项关键取舍：指定卡台故障/无卡时不自动回退；健康状态由系统检测且允许运营手动暂停；允许付款前的单订单卡台例外；不采用复杂优先级评分，由运营者直接指定当前卡台。讨论稿已同步调整为“指定来源不可用则等待人工处理”，整体方案仍未最终冻结，未实现、未部署。

### 2026-09-05｜API/Browser 当前卡台边界进一步明确

用户确认：API 业务上固定使用当前具备 API 的卡台；未来仅提供卡和账单资料的卡台不进入 API 路线。Browser 作为统一承载路线，可使用现有 API 卡台或其他 Browser 卡源。API 与 Browser 分别保存当前卡台；当前卡台暂停后不自动清空或回退，保留选择并等待运营处理。入口位置仍在讨论，未实现、未部署。

### 2026-09-06｜充值方式命名确认

已确认后台统一使用两种充值方式名称：`API 充值` 与 `浏览器自动化充值`。必要说明分别为“通过卡台 API/协议接口自动完成”和“通过 BitBrowser/浏览器自动化完成”。卡台来源（HNSKJ、备用卡台等）和当前卡台选择保持独立概念。当前仅完成文档确认，尚未修改生产代码、后台文案或部署。

### 2026-09-06｜多卡源方案退回现场核查

用户指出此前入口、切换失败条件和单订单切换方案主要来自推测，未核对真实后台、代码和生产。已明确纠偏：运营者想切换到哪个卡台都应能切换；系统只能做告知性提醒，不得因健康、库存或能力状态阻止保存；不把单订单切换作为日常设计。原讨论稿相关流程不再视为有效方案，下一步必须先做全层现场核查再继续讨论。

### 2026-09-06｜多卡源/卡台切换全层现场核查

已完成本地代码 + 生产 release/服务/数据库只读核对，报告见 `docs/2026-09-06_card-source-current-system-audit.md`。真实现状：后台“Plus 卡台路线”切换的是 `fulfillment_routes` 的接单/充值路线；前后端均在目标不健康时阻止切换；生产仅有 API 与 Browser 两条路线，且都绑定 `legacy-primary`，尚无 `fulfillment_route_card_sources` 表。备用卡台策略未进入生产。之前提出的“当前卡台独立入口”和“单订单切换”属于未核实设计，已撤回。当前不实现、不部署，等待基于现场事实重新讨论。

### 2026-09-06｜本地/生产差异补充

深查确认：本地卡源分配实现已使用 `fulfillment_route_card_sources`，但生产 current release 仍是旧版分配代码且没有 migration 048；备用卡源导入/分配尚未生产化。生产路线切换服务与本地一致，健康状态拦截仍真实生效。仅修改前端入口无法解决卡源切换，需先重新讨论并设计生产可用的最小模型。

### 2026-09-06｜多卡源讨论错误判断已系统纠正

已依据真实代码和生产证据复盘此前方案，报告为 `docs/2026-09-06_card-source-discussion-error-review.md`。除用户指出的三项外，确认此前还错误地对称设计 API/Browser 当前卡台、引入 AUTO/优先级、过早引入策略版本、虚构统一健康机制和后台字段，并把卡源冻结点放晚了。当前正确基线是：API 固定 HNSKJ；Browser 由运营直接选卡台；提醒不拦截、不自动回退；不做逐单切换；Browser 卡源在建单事务中冻结。未实现、未部署。

### 2026-09-06｜Browser 卡台切换与等待订单接管规则确认

用户确认：切换 Browser 当前卡台时默认只影响新订单，同时提供一次性的“迁移尚未真正开始的等待订单”选项。它不是逐单切换；仅无卡分配、无活动消费预留、无充值 attempt、无 Browser run/付款动作、无 UNKNOWN 资金状态的订单可迁移，切换确认前展示数量并写审计。当前仅完成需求确认，未实现、未部署。

### 2026-09-06｜备用卡完整快照与 HNSKJ 双能力确认

用户确认备用卡台导出文件每次都是全量卡片清单，后续导入应按来源完整快照提交：缺失卡停止新分配但不删除历史，活动/未知资金卡保持锁定。HNSKJ 同时可用于 API 充值和浏览器自动化充值；API 首版固定 HNSKJ，Browser 可在 HNSKJ 与备用卡台间人工选择。当前 migration 048 的导入仍是逐行 upsert，尚未实现完整快照缺失卡收敛；未部署。

### 2026-09-06｜付款结果未知的停止范围待收敛

用户明确反对一笔付款未知导致整个链路停机。当前代码实查：Browser UNKNOWN 会锁对应 run/attempt/order/card并建对账案例，任务领取不会因此自动阻止所有其他订单；但付款执行器在点击后异常时直接进入 UNKNOWN，尚无 `VERIFYING_PAYMENT` 有界自动核验阶段，诊断 audit 与开始营业摘要对全局 UNKNOWN 的口径也不一致。推荐方向是局部锁定未决订单并继续自动核验，其他订单照常；同一未决订单不二次点击。整体仍在讨论，未改代码/生产。

### 2026-09-06｜三方对账与付款 UNKNOWN 核查

生产现场：20 单中总览 SQL显示 4 个“三方对账异常”，实际 `reconciliation_cases` 为空；4 个均为 ZZSHU 明确失败后没有 `recharge_order_no`，属于误报。代码同时存在旧 `cards.order_id` 关联不适配一卡复用、ZZSHU 硬编码不适配 Browser、动态异常与案例队列口径分裂。对账核心仍应保留用于真实未知/冲突，但当前统一“三方异常”投影需收敛。报告：`docs/2026-09-06_three-way-reconciliation-audit.md`。未改代码/生产。

### 2026-09-06｜卡台来源与对账工作线建立唯一状态表

已建立 `docs/CARD_SOURCE_AND_RECONCILIATION_WORKSTREAM.md`，把当前确认项、待冻结项、已否定方案、生产差距和未来实现/验收矩阵集中管理。当前为 D1 讨论中；业务代码、migration 048 和生产均未因此改变。后续实现与部署必须逐项回填决策 ID、代码、测试、release 和生产证据，不能靠聊天记忆或单篇旧报告接手。
