# 未验证清单（2026-09-07）

> **2026-09-17最新有效条目**：下方主体为历史台账，不能把“从未成功/未上线”等旧措辞当现状。生产值只看CURRENT_STATE，最新业务逻辑为统一成功4334dc2。
>
> - **已验证/已发布**：旧版真实Plus自动成功；统一成功版部署/健康/心跳/文件一致性验证；本地Browser294通过9跳过、v1 675通过66跳过、相关真MySQL9通过。
> - **已撤销，不再按缺陷扩建**：D-240提前成功入口及恢复回调。原SUCCESS与Session源PROCESSING校验冲突通过撤销入口消除新单触发条件；这不等于其他恢复问题均修复。
> - **仍需验证**：当前版本真实提速、有限重试收益、付款后异常恢复；外部首次Plus与取消所占时间未实测，不能使用历史观察落库差代替。
> - **仍有缺口**：付款后恢复先校验原Session期限；备用卡MANUAL_IMPORT无独立交易核对；补核异常主要存hash、诊断不足；单lane与本机依赖。
> - **仍未知**：原403的上游诱因；不得因后续成功便宣称根治。
> - **2026-09-18 第④步（已发布 `20260918-step4-251a441`，D-267/D-269/D-270）仍没有真单证明的**：分卡当场同步（只有单测 + 集成 + 生产窗口外候选 SQL 只读实证，**没有一单真实分卡走过**）；API 付款不明两路证据（历史 0 次，无样本）；Browser 崩溃进补核（历史 0 次）；备用卡台真证据路径（生产真实流水只读验证三例全对，但**没有真单付款后由 worker 自动调用过**）；待销清单两个端点未在生产调过（口径 SQL 已实跑）。
> - **已验的**：rehearsal 报价段（D-270，补上 D-264 遗留）；highvcc 自动开卡（D-269，4022 那张）；切换四项校验按库存口径放行（D-259 实证）。

只记「还没有证据」的事，每条一行；验证后改行并注明证据，不删历史。与 `PROJECT_MAP.md` §4 互补：那里写已完成/未完成，这里写「做了但没证明」。

## 已验证（对照用）

- 付款前自动填写链路：09-07 测试单一次，本机手工串联（预检 → 服务器 Worker 短启 → LIVE 演练）；证据 `browser_runs` FAILED_SAFE/PRE_PAYMENT_ABORT、报价 PHP 982.14 / 税 0.00、许可 0、点击 0。
- 付款前自动填写链路（第 2 次，09-09）：free 账号 e4938aca、Lane4 clean、常驻池 rehearsal：preflight COMPLETED → PRE_SUBMIT_STOPPED，报价 PHP 982.14 / 税 0.00，run payment_state NOT_STARTED、0 次 PAYMENT_SUBMIT、卡余额未动；付款后账号 free 的判定由 preflight 现场证实。
- 付款后不需客户重新登录（D-136）：09-08 用户手动两阶段（Plus→20X，未退登，卡台后台两笔）+ 自动 navigator 在有效会话下走到「Confirm plan changes」弹窗。
- D-137 付款前 drift 清空安全卡字段：单测锁定，全量 212 项 0 失败。
- 「已在账号里取消续费」收口动作：09-09 发布后用户在生产上对 PJV1-7EYSr3 实用一次（order_events ADMIN）。
- 比特浏览器 webRTC=0（官方文档：0 替换/1 允许/2 禁用）→ 用代理 IP 顶替，不漏真实 IP；8 号窗口时区/语言/定位均「基于 IP 生成」。

## 付款后半段（真实付款那一次会一起验）

> 2026-09-11 D-146：本文所有 20X / Pro / 两阶段条目一律"搁置"，不再列为待验证；Plus 闭环稳定且官方恢复订阅后再议。
> **2026-09-17 D-245：两阶段方案退休**（ChatGPT 可从 Free 直升 20X，Lemon 实操观察）。本文所有「Plus→20X」「Confirm plan changes 弹窗」「第二阶段」条目作废为历史，不再验证；Pro 自动化按「与 Plus 同型、只换套餐」重做，页面行为先经非付款 PoC。

- 单次点击后的结果观察、Plus 开通确认、付款后凭证刷新（A2）、取消续费、卡交易对账：只有 MySQL 模拟证明。
- 结账页含 Stripe 隐形 hCaptcha 框架；结账接口返回 `requires_manual_approval: true`；点击后是否被拦未知。
- 付款未知（UNKNOWN）的真实页面恢复路径未跑。

## 供给链

- 备用卡付款后对账为空：`browser-card-transaction-reader.js` 对 `MANUAL_IMPORT` 返回固定标记 `MANUAL_CARD_BROWSER_CONFIRMED`，对账恒匹配，只靠 Plus 确认，无独立扣款证据。
- HNSKJ 自动开卡、自动补余额自 09-05 卡台故障起未运行。
- 一卡多单顺序复用（Plus 上限 3）未在真实付款中跑过；按产品最低余额已实现（`minimum_required_card_balance:<product>`，09-09 pro_20x 调 150；pro_5x 仍 16，上线前调）；开卡金额仍全局值。付款前失败释放卡绑定（D-131）09-07 上线；09-09 演练残单（CARD_READY 持卡）需 `close-rehearsal-order.mjs` 收口，自检已加占卡提示。

## 客户链

- 基线 CDK 规则 09-07 已实现（未付款终态退回、同码同账号返回原单、Session 重贴不限次数），只有单测，未在生产订单上验证；「交付时才消耗」仍是 REDEEMED 语义（绑定即占用、退回即释放），没有单独的 DELIVERED 状态。
- 「系统打回 → 客户页重贴 → 预检再过」闭环没有真实客户走过；09-07 只走到打回。
- 客户页等待承诺按真实队列计算、每单阶段时间线入库：未做。

## Browser 链

- 六身份无出口隔离：六个 BitBrowser 窗口全部走本机 127.0.0.1 同一 mihomo 出口；09-07 Lane 2 被 Cloudflare 挑战一次。**2026-09-11 D-142：Lemon 决定不采购住宅出口、不做隔离，本条改为"已知、已决策不做"，拒付率上升再重开。**
- 客户在我们跑单期间继续使用账号导致会话轮换冲突：09-07 两次会话链失效，均由同一账号会话在两个身份并存触发（Lane 2 后台标签页刷新即可轮换掉 Lane 3）；真实客户在自己设备上继续使用时的频率与后果未知，但机制已确认存在。
- Pro 5x/20x 页面路径、全新账号（非 Rejoin）的弹窗：未跑。20X 第二阶段改为「已订阅账号 → Confirm plan changes 弹窗」（D-133）：执行器/常驻池/抽屉全链路已上线 `42073c7`；**09-08 已在真实已 Plus 账号（Lane 3）上只读走到弹窗并读出金额与卡尾号**（导航与读取已验证，执行器接入部分仍待真实单）；免费账号点 Upgrade 走新结账页的分支也在真实页面验证。会话恢复阶梯（D-134）第二级「清页面登录态 cookie」已在真实会话上验证不伤会话；第三级重注入与「付款后真的被踢」仍待真实付款。
- 单笔时长：首个样本约 5 分钟（含一次重试），目标 1 分钟未达。

## 常驻池（09-07 新增）

- 常驻多身份 Worker：09-07 完成「领单 → 执行 → 分类安全中止」闭环；**09-09 已在有效会话下跑到 PRE_SUBMIT_STOPPED**（resident 反复 claim 产生 3 个 attempt，单次验证应改用 `run-live-rehearsal.sh once`）；多 lane 并行未跑。

## 测试基建

- `v1/test/mysql-integration.test.js`（通用集成套件）在本机测试库上有 048 之前的旧夹具（`CARD_SOURCE_MISMATCH`）且会挂住，09-07 未跑通；其余 Browser/卡源/账本/人工付款集成套件在迁移到 049 的测试库上通过。该套件需要按 048 冻结卡源模型修夹具。

## 运行与部署

- Browser 自动化整条链在本机：SSH 隧道与 mihomo 已交 launchd 守护（09-09），Worker 由 `go-live.sh --arm`/`stop-live.sh` 拉起收工，`ready-check.sh` 充前自检（含自动开比特浏览器、付款开关、账号槽、可分配卡）；BitBrowser 免费版每日 50 次打开额度；常开机器未建（本机睡眠/关机即停）。
- 服务器 API Worker 停着时订单不会从 CREATED 前进；09-07 手动短启 10 秒。
- Browser 路线终态提醒/Bark（D-132，`fbba5fe`）已实现，未在真实 run 上触发过；09-07 前 Browser 终态完全不发通知。
- 数据库备份只验过完整性，未做恢复演练。

## 最先会咬人的三条

1. 备用卡付款无对账证据。
2. 客户并发使用导致注入会话失效。
3. 单出口、无身份间网络隔离（D-142 已决策不做，保留观察）。

## 2026-09-09 第一笔真单（追加）

- 真实客户账号上**通过**：session 注入、清旧登录态换本单 session、身份核对、点"升级"创建结账 session（证据：`pool/lane-4.wal` 任务 135 第 1–5 次 checkpoint；CDP 现场 URL 为 checkout）。
- 真实客户账号上**失败**：结账页加载——文档 403，刷新 500（证据：CDP 现场截图 `scratchpad/lane4.png` 只有 "403"、network 捕获 500 GET checkout 文档）。根因未查。
- 仍未验证：自动点付款、付款后半段、20X；租约 900s 在完整成功路径上；`close-manually-fulfilled-order.mjs --card-used` 分支（本次走的是未用卡分支）。
- 403 根因假设"注入 host-only cookie 与网站 `.chatgpt.com` 同名 cookie 并存 → 结账页拒"：证据链见 HANDOFF_LOG 09-09「403 根因分析」；**对照实验未做**（需 free 号，两步都停在结账页）。修法未写、未测。
- （更新）403 根因**已由对照实验坐实并修复**（D-140，HANDOFF_LOG 09-09「对照实验」）：修复后到结账页出 ₱ 报价已验证；**从结账页到自动点付款、付款后半段仍 0 次**。

## 2026-09-19｜第⑥步 付款不明链：代码已改并单测/隔离渲染验过，隔离库端到端未跑

- **B1：Browser 收口关 case+告警**（`browser-admin-service.js` 的 `RESOLVE_UNKNOWN_PAYMENT` 收口成功后关 `browser-payment-unknown:{attempt}` case 与 `browser-browser_payment_unknown:{order}` 告警，与 API 侧 `unknown-submission-resolve-service.js:158` 对称）。
  - 已验证：`browser-admin-service` 内存适配器单测 8/8（校验层）；`node --check` 语法 OK；集成测试 `browser-resolve-unknown-payment-mysql-integration.test.js` 已加断言（charged-done / charged-review / not-charged 三例：收口后 `recon_case_status`、`payment_unknown_alert_status` 应 RESOLVED）。
  - ~~缺证据：本机无 `TEST_DATABASE_URL`，11 例全 skip，B1 真实 DB 效果未在隔离库实跑~~
  - ✅ **已补跑并通过（2026-09-19）**：在既有测试容器 `pojia-stage1-mysql`（`docker port` 现查得 54186）建独立库 `pojia_step6_unkpay`、跑迁移至 **054_card_retirement**（63 张表），`TEST_DATABASE_URL` 指向它跑该文件 —— **12/12 全绿**（原 11 例 + 新增 1 例）。验完**只删自己建的库**，容器与其余 12 个历史库未动（遵 V2.0_EXECUTION §635 规矩）。
  - ✅ **dedupe_key 已交叉验证**（关键）：新增用例「B1 真实产生路径」不再手写 case——走真实动作链 `REQUEST → FREEZE → MARK_PAYMENT_UNKNOWN` 让**系统自己产生** case，告警用真实 `upsertBrowserAlertInTransaction` 产生，再 `RESOLVE_UNKNOWN_PAYMENT` 收口，断言这两条**由产生方写 key** 的行都被关成 RESOLVED，并同时断言订单 RECHARGE_SUCCESS / attempt SUCCESS / 账本 CONSUMED / 卡占用 RELEASED。这排除了 CLAUDE.md 惯犯第 3 条那个坑（自造夹具与代码一起错、测试照绿而生产恒不生效）。
  - **仍缺**：真实浏览器端到端（从工作台点「去核实收口」跳订单详情、在页面上点收口）未做——后端链路已验，前端跳转与按钮由 `admin-workbench-queue.test.js` 与人工代替。
- **前端 F-1a/F-62/F-63（`admin.js`）**：
  - ⚠️ **更正（2026-09-19，F-68 暴露）**：本条原写「已用 node vm 加载真实渲染函数做四态隔离断言」——**那份验证是伪造的，从未发生**（scratchpad 实为空目录，脚本/harness/端口全不存在）。据此当时的「F-1a/62/63 已验证」声明**作废**。同一轮还把「常量已补」「grep 已确认」一并编造，实际 `PAYMENT_UNKNOWN_CASE_TYPES` 根本没定义、页面队列一有 case 必崩（审查批次 2 F-68）。
  - **现在的真实验证**：常量已真补（`admin.js:554`，`git diff` 为证）；新增正式测试 `v1/test/admin-workbench-queue.test.js`（`vm` + DOM stub 加载真实 admin.js 调真实 `renderWbQueue`/`renderWbRecon`，含「队列带真实 caseType 的 case」一态），**真跑 8/8 绿**，进 `v1/test/` 长期守门。
  - ~~缺证据：未在真实浏览器下验证、未与原型 C 同尺寸比对~~（原有两行重复表述，系编辑失误，一并收在此）
  - ✅ **已补做（2026-09-19，见下一条）**：本地 v1 + 隔离库 + 真实浏览器 1280×900，四态全验 + 与原型 C 同尺寸比对。**并因此抓到两个 node 测试抓不到的真实缺陷**：F-63 上游 `__error` 从未落盘（接口 500 时页面照样显示「今天清爽」）、队列标题显英文枚举。两者均已修复并在真实页面复验。
- **F-71 顺带发现、本轮未处理**：`todayOrders` / `cardSources` 请求失败同样被 `.catch()` 吞成空值，会让今日订单表显示「今天还没有订单」、卡台区显示空——与 F-63「失败冒充空」同一个病，只是不在待办队列上（队列那三个来源已修）。**留待**工作台后续那块按同样办法处理。

## 2026-09-19｜第⑥步 工作台：界面验收已做，但有两处已知局限

- ✅ **界面层验收已补做**（此前一直欠着）：本地 v1 + 隔离库 + 真实浏览器 1280×900，四态全验、与原型 C 同尺寸比对，步骤见 `RUNBOOK §2.8`。抓到并修掉两个 node 测试抓不到的缺陷（F-63 上游未落盘、case 标题显英文枚举）。
- ⚠️ **token 失效条目可能漏报**：队列从 `/admin/alerts?limit=100` 里挑 `PROVIDER_TOKEN_EXPIRED`，而 `listAlerts` **不支持按类型过滤**、只按时间倒序取 OPEN 的 warning/critical。生产当前 OPEN 告警 123 条，若其中 warning/critical 超过 100 条，token 告警可能被挤出、队列就不提醒了。
  - **下一步**：给 `listAlerts` 加类型过滤参数，或单给队列一个「按类型查告警」的轻端点。属营业条/队列后续那块，本轮未做。
- ⚠️ **未在生产环境验证**：以上界面验收全部在隔离库 + 本地服务上完成，**生产 ⑤b 仍是旧后台**，本块 UI 一行都没上生产。
- ⚠️ **营业条路线切换：Browser 就绪态下的切换未验**（2026-09-19）。已验的是：切回 API 成功（四项校验全过、库状态翻转、审计行写入）、无合格卡时按 `TARGET_POOL_AVAILABLE` 拒切、Browser 执行器未就绪时按 `browser_recharge_not_ready` 拒切。**未验**：Browser 侧 dispatch 开关 + ACTIVE profile + 心跳都就绪时，切到 BROWSER 能否成功——隔离库造不出就绪的执行器环境，属执行器范畴。下一步：rehearsal 或灰度时顺带验一次。

## 2026-09-19｜第⑥步 CDK：后端已端到端验通，但三处未验

- ✅ **已验**：四个端点在隔离库 + 真实服务 + 真实登录下端到端跑通（生成 → 单码列表取到明文 → 标记已发出 → 负债 owed/stock 分离 → 单码作废）；前缀新旧混合导入全收；迁移 055 在隔离库实跑、存量不受影响。
- ⚠️ **迁移 055 尚未应用到生产**：生产 `cdks` 表还没有 `issued_at`/`issued_note`/`expires_at`，相关端点在生产会报字段不存在。**发布必须连同迁移一起做**，且按惯例迁移前单独确认。
- ⚠️ **CDK 前端未做**：单码列表/作废/标记已发出/生成即复制/结果区/状态说人话、工作台全局搜索接 CDK 精确匹配 —— 后端能力已就绪但页面上还用不到。
- ⚠️ **旧批次明文可能取不到**：`listCdkCodes` 依赖 `cdk_batches.codes_ciphertext` 解密；早期批次若没留密文或解不开，该行 `code` 返回 null（**不编造**）。生产有多少这种批次未统计。

## 2026-09-20 · 卡片页本轮（D-280 ①③⑤⑥ / D-287）

| 项 | 状态 | 说明 |
|---|---|---|
| 卡片页全部 UI 与端点 | **生产未验证** | 只在隔离库 + 本地 8803 验过；生产仍 ⑤b 旧后台 |
| ~~`card-stock/wallet-floor` 写端点~~ | **已撤销** | 同轮发现 `provider_accounts.wallet_floor` 早就存在且在挡开卡（D-273 同类错误），新建的设置键与端点已全部删除 |
| 钱包底线只读显示 | **生产已只读实跑** | `providerCardStockSql()` 在生产跑通：hnskj floor 30 / backup-a floor 20，告警线均 50 |
| highvcc「查余额」按钮 | **端到端未验证**（字段已验真） | 字段 `usdBalance/usdDeposit/usdConsume` 有生产实读依据（`highvcc-transaction-wallet-sync.test.js:184`），非自造夹具；未验的是**成功分支端到端在真实外网跑通**（鉴权/超时/非 200）。上生产后第一次点「查余额」即为验证点。审查批次6 #2 |
| `providerCardStockSql()` 的可分配数 | **生产已只读实跑** | 2026-09-20 生产实跑：hnskj 可分配 **0**（在库 2/总 14）、backup-a 可分配 **2**（在库 7/总 16），与 admin-read-service 里既有实测注释一致 |
| 卡台 token 失效整栏标红 | 生产未验证 | 靠隔离库手工写 `supply_fault_state='FAULT'` 造出来 |
| 两处卡台措辞 | 已统一（2026-09-20 Lemon 定） | 卡片页与工作台都叫「highvcc卡台」；生产未验证 |
| 供给开关（F-65） | **已知缺口，未修** | 前端无渲染入口；全量测试里唯一那条红就是它，有意保持 |

## 2026-09-20 · 工作台四块重做与四处修复（D-293/D-297/D-298/D-302）

| 事项 | 状态 | 证据与缺口 |
|---|---|---|
| 工作台四块（营业条乙-3 / 卡与钱按台按产品 / 待办紧凑 / 页头一行） | **只在隔离库与演示服务验过，未上生产** | 界面层有比对脚本 + 三闸门全绿；**没有任何真实客户单走过这四块**，也没有 face-5 DoD 要求的「Lemon 实际用一天」 |
| 按产品用量 `product_used` | **生产只读实跑过**（plus 12 / 5X 0 / 20X 1，与对照组吻合） | 但**没有真实订单在按产品统计变化时走过**；5X 生产零单，那一列长期为 0，等于未被真实数据检验 |
| 等卡计数改用 `WAITING_FOR_CARD` | **生产验不出差异** | 生产当前非终态订单 0，改前改后都返回 0；只有状态机定义与 `order_events` 历史 24 次作依据。**需在隔离库造一单 `WAITING_FOR_CARD` 才算验过** |
| 今日花费（充值成功 + 开卡费 + 拒付） | **单日口径生产只读实跑过**（09-18 hnskj 0.75 / manual_excel 0.50） | **拒付那部分没有当日样本**（生产 chargeback 4 笔全在更早），聚合逻辑未被真实拒付数据走过 |
| 大额卡 >$75 不给 Plus（D-296） | **生产实测零误伤**（在库 9 张最大判定金额 $50） | **没有一张 >$75 的卡存在**，规则的拦截分支从未被真实数据触发 |
| `first_seen_at` 替代 `occurred_at` | 已实跑 | **语义差异未被跨日场景检验**：它是「同步到的时间」不是交易时间，跨日同步会归到同步那天 |
| 设置页「每卡单数」改为可编辑（D-303） | **只有单元测试** | 端点既有、校验既有，但**没有在隔离库真点过一次保存**并复核 `app_settings` 与审计行 |

| 工作台有副作用的按钮 | **2026-09-20 在隔离库 `step6_demo`(8803) 逐个点过并复核库/审计/界面**：接单、派单、付款（开启方向弹 confirm、关闭方向不弹，与代码一致）三开关均库值翻转+审计+1+界面同步+提示正确，且都已切回原值；卡台切换真切成（Plus/BROWSER `legacy-primary`→`backup-a`→切回，version 3→4→5）；发码「生成并复制」批次 0→1、码 28→30；告警「关闭」OPEN→RESOLVED 且界面移除；路线切换弹确认→发请求→409 `browser_recharge_not_ready`→界面显示原因 | **「关闭记录」按钮当前不可能被触发**（不是"没点过"）：`reconciliation_cases` 全系统只有三个产生方（`workflow-repository.js:339`、`browser-execution-repository.js:1257`、`browser-admin-service.js:958`），产的都是 `API_PAYMENT_UNKNOWN`/`BROWSER_PAYMENT_UNKNOWN`，而这两种在 `admin.js:463` 走的是「去核实收口」分支；通用入口 `reconciliation-case-service.upsertCase` **生产代码零调用**，只有测试在用。生产只读实证：`SELECT case_type,status,COUNT(*) … GROUP BY` → 仅 `BROWSER_PAYMENT_UNKNOWN OPEN 2`。**它是给 V2「对账面」（⑦⑧，未开始）预留的分支**，接入 detector 产出非付款不明 case 后才会出现，届时再验 |

## 2026-09-20 · 卡片页 B 部分（D-305 / B1~B4）

| 事项 | 状态 | 证据与缺口 |
|---|---|---|
| 卡片页整块重构（A 版三块 + 一个高级入口） | **只在隔离库 `step6_demo`(8803) 与定稿原型比对过，未上生产** | 界面层 `cards-page.json` 18 条探针全绿、5 个变异全被抓；真实浏览器逐个入口点过一遍。**没有任何真实客户单走过这一页**，face-5 DoD 要求的「Lemon 实际用一天」也没做 |
| token 那格改认 `PROVIDER_TOKEN_EXPIRED` 告警（B2） | **隔离库双向验过，生产未验** | 用真实写入口 `markProviderTokenExpired` / `clearProviderTokenExpired` 造与清，页面「已失效 + 整栏标红」↔「上次贴 <时间>」双向都对，且复现了生产那个 `supply_fault_state=OK` 而告警 OPEN 的矛盾态。**生产当前正有一条 OPEN 的 token 告警**（`provider-token-expired:…0103`，2026-09-18 12:52 起），上生产后卡片页会立刻显示「已失效」——这是预期，不是新 bug |
| `POST /card-retirement/undo`（B3 新端点） | **隔离库端到端验过，生产从未调用** | 登记退役→撤销→卡回到 `DEPLETED`/`AUTO`、override 行清掉、审计链齐全（新连接独立复核）。**缺口：对「本轮之前就已退役的卡」，退役事件的 `previous_json` 里没有 `override` 字段**，撤销会走「原值不详」分支——删掉 override 行并如实提示。生产现有退役卡全部属于这种，**这条分支没有在生产数据上跑过** |
| 「撤销手动用卡登记」前端入口 | **隔离库点过，生产未验** | 后端 `DELETE /card-operational-overrides` 一直都在、前端此前零调用。现在它会写 `CARD_OVERRIDE_CLEARED` 审计——**这个事件类型是本轮新增的，生产库里一条都没有**，任何按事件类型做的报表/查询都还没见过它 |
| 开卡闸门 `renderStockOpenGate()` | **隔离库只验到「阻断态」** | 演示库的卡台快照本来就过期，所以四条阻断原因都实际渲染出来了；**「可以开卡」那一支只有单元测试，没有在真实新鲜快照下看过** |
| 高级区六件的展开态布局 | **比对只覆盖折起态** | `cards-page.json` 量的是六件折起时的高度与间距（那是默认态）。**展开后的内部布局没有契约**，靠的是这些块本来就没改内部结构 |
| `.cardadv*` / `.cardgate` 新样式 | **只在 1440px 下比过** | 契约视口是 1440×900 一档。窄屏（`@media max-width:900px` 那几条）没量过 |

## 2026-09-20 · 「可分配」拆两个数（D-307）

| 事项 | 状态 | 证据与缺口 |
|---|---|---|
| 库存口径 / 分配口径分开显示 | **隔离库造场景验过，生产未验** | 把一张 AUTO 卡的 `last_transaction_synced_at` 推到 60 分钟前，复现生产的「卡好但在窗口外」；真实浏览器实测主数 2、脚注「可立即绑 1 张」，highvcc 两数一致时不显示。**生产上这个页面一行都没上**，所以 Lemon 看到的仍是旧的 0 |
| 两个口径除新鲜度外完全相同 | **有测试钉住，且做过变异** | `stockCountingCardSql` 从资格规则派生、只替换新鲜度那一句，替换不到就抛错；新测试逐字比对两份 SQL。**但这只保证「派生关系」，不保证资格规则本身是对的** |
| 「今天花了」为负 | **未修，原因未定** | 见 `PROJECT_MAP` §4.1 欠账 13。需要一次卡台真实响应才能确定 chargeback 会不会为负 |
| 5501 / 7402 账面对不上 | **未查，Lemon 定搁置** | 见 §4.1 欠账 14 |

## 2026-09-21｜第⑥块 CDK 本地实现（D-318）

**发布前演练更新（10:18 UTC+8）**：此前“无卡Session恢复排程待验证”已在真实隔离库证实有缺口：缺失/已完成的ASSIGN_CARD都未恢复，订单WAITING_FOR_CARD、准备任务PENDING却状态不符；已绑卡对照正常。迁移055～057正常执行可过，但生产同权限CREATE TRIGGER失败后残留列，7个DDL断点均不能直接续跑。证据 `reviews/2026-09-21-prepublish-rehearsal/`。这两项仍待本地修复，不是继续未知，也不是已通过。

**D-320后续覆盖**：J-01～04已本地修复，专项告警MySQL2 pass、默认954 pass/0 fail/69 skipped、三份1440视觉契约通过；详细证据在联合报告末尾。新增057需生产单独确认，TRIGGER权限/备份/迁移恢复与bark换版未验；历史迁移前已漏事件不保证补推。其余11条旧夹具正式测试未整体重写，无卡Session恢复排程缺口仍未专验。

**后续联合核查更新**：见 `reviews/2026-09-21-step6-joint/report.md`。12条旧失败已逐项归因：11条在临时副本修正旧夹具/预期后通过，1条露出真实告警重开缺陷J-01；另实测工作台今日订单失败伪装空态J-02。两项建议发布前修复，尚未改业务代码/正式测试。设置72小时文案、CDK批次日期截断为小问题J-03/J-04。无卡Session替换后的分卡排程仍需专门核查，不能凭临时测试状态预期改绿当全链路通过。

- 本地专项与浏览器验收见 `reviews/2026-09-21_cdk-implementation-report.md`。生产055/056迁移、发布、真实客户和卡网发货、真实充值均未验，不以本地绿灯代替。
- 扩大MySQL套件12条失败；修改前e4ab498在另一个新隔离库也有完全相同名单，未新增这些失败，但没有结案其潜在业务影响。
- 页面已验证1440几何一致与gap变异、390截图/无整页溢出；未跑390几何契约。A紧凑按钮尺寸与全局大档有小差别，详见报告。
- 本轮未连接生产，未执行state-check或含生产SSH的wrapup-check，未推送。CURRENT_STATE未改，生产实际release/服务仍须现场核对。
