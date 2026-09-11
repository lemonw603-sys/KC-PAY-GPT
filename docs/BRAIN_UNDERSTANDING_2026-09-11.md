# 大脑理解稿｜差异版（2026-09-11）

> 性质：接班理解稿。对照 Sonnet 初稿 `docs/TAKEOVER_VERIFICATION_2026-09-11.md`，只写不同的、它没覆盖的、以及我认为以前做错的。不重复它已经对的部分。
> 证据层级：`[已验证]` 生产库或现场证据；`[代码显示]` 只核对了代码；`[文档说]` 只有文档；`[判断]` 我的推断。
> 读了什么：CLAUDE / AGENTS / HANDOFF_NOW / PROJECT_MAP / CURRENT_STATE / UNVERIFIED_LEDGER / RUNBOOK；DECISIONS 全部 141 条；CORE_SPEC 与接班实施基线全文；PROJECT_OPERATING_MODEL；FULL_CHAIN_AUDIT；REVIEW_RECORD 批次 1、2A、2B 全部；DISPOSITIONS；REVIEW_SCOPE；整改矩阵；UX 清单；HANDOFF_LOG 2026-09-06 起全部章节；主链源码 19 个文件（v1：intake-service、session-validation、task-repository、card-inventory-eligibility、order-intake-repository、workflow-handlers、browser-execution-repository 八个资金方法、browser-payment-verification-service；browser-mvp：browser-order-preflight、session-bootstrap、executor、chatgpt-checkout-navigator、live-chatgpt-payment-adapter、payment-executor、chatgpt-post-payment-verifier、shared-runtime-integration、shared-live-composition、live-post-payment-recovery、production-live-pool-worker）；生产只读统计（订单、操作、CDK、attempt、预检任务）。没读：`docs/archive/`、根目录 legacy、HNSKJ 自动开卡/补余额路径、后台 admin 服务与前端全文、API 路线（zzshu）。

## 1. 给谁做什么

与初稿一致，补一条初稿没写的差距：

- 北极星是**一天几十上百单**（Lemon 明确过，基线"容量判断"写两到三周内具备百单能力）。`[文档说]`
- 现状：Browser 路线全自动闭环 **0 次**；4 个 Browser 路线 RECHARGE_SUCCESS 全部是人工收口（09-06 RCbAiI、09-08 _VjIN 自动付款后人工确认、09-09 VHl_、09-11 Dqcn）。`[已验证]`：`orders` 按路线分组 + `browser_operations` 无 PAYMENT_CONFIRMED / PLUS_ACTIVATED / CANCELLATION_CONFIRMED 类型。
- 架构上离北极星的距离：一条 lane、本机 Mac 跑 worker、来单人工拉、BitBrowser 免费版每日 50 次开窗、单一机房出口、卡供给半手动。基线说"唯一的串行前提是一笔真实单先自动走完"，这个前提到今天没满足。`[已验证]`

## 2. 一单怎么走、各在哪个进程

初稿的六步描述是对的。补三点它没说清、但对风控和排障都要紧的事实：

**2.1 一单要在浏览器里走两遍完整流程，创建两次 Checkout。** `[代码显示]`
- 预检（`BROWSER_PREFLIGHT`，本机 pool worker 第二步）：注入 session → 身份核对 → 点 Upgrade → 等到结账页 → 不填卡 → 回报 PASSED。`production-live-worker.js:184-186` 的 observation 带 `checkoutNavigationContract`，所以预检一定会点 Upgrade 创建一个 Checkout session，然后丢弃。
- LIVE（pool worker 第三步）：再注入 → 再核对 → 再点 Upgrade → 再创建 Checkout → 填卡/地址/邮箱 → 重报价 → permit → intent → 单击。
- 生产预检任务 19 条：一次通过 9 条，重试后通过 6 条（2 到 5 次），DEAD 3 条。也就是**35% 的预检需要重试**，每次重试又是一次点 Upgrade。`[已验证]`
- 09-07 日志记过"今日在该免费测试账号上共创建约 5 个未付款结账"。09-10 真单在同一账号上 5 次预检加 4 次人工点击。这些都是给 OpenAI 的行为信号。`[已验证]`
- CORE_SPEC §5.1 本来就把 `BROWSER_PREFLIGHT` 任务列在"真实单跑通后同批删"。`[文档说]`

**2.2 服务器 worker 和本机 worker 之间的握手是数据库任务表，不是消息。** `[代码显示]`
- 服务器 `pojia-worker` 的 SUBMIT_RECHARGE 领取条件（`task-repository.js:208-217`）要求本机预检任务 COMPLETED 且 outcome=PASSED。预检 DEAD 则永远不领，订单停在 CARD_READY 直到人重开或收口。F-1 修复后 DEAD 会发告警。
- 本机 worker 不跑时，订单最多走到 CARD_READY；服务器 worker 不跑时，订单停在 CREATED。两边都要活。

**2.3 付款后的核实是另一条 lane，不是付款那条。** `[代码显示]`
- 付款点击后 adapter 同步等 `confirmPlus` 最多 5 分钟；非 CONFIRMED 一律 UNKNOWN。之后由 pool worker 第一步"核实 lane"每隔 5 秒重开页面读 `accounts/check`。核实 lane 在生产只在 PAYMENT_CONFIRMED 路径跑过 6 次（09-08 那单，全 UNKNOWN），在 PAYMENT_UNKNOWN 路径 0 次。`[已验证]`

## 3. 做到哪、哪些验过、哪些从没在真单跑过

| 环节 | 真实客户账号上 | 测试账号上 | 生产样本 |
|---|---|---|---|
| 客户提交、CDK 绑定、建单、路线与卡台冻结 | 通过 | 通过 | 36 单 `[已验证]` |
| 分卡（资格 SQL）、PREPARE、进派发队列 | 通过 | 通过 | 多次 `[已验证]` |
| 注入 session、清旧登录态、身份核对 | 通过（09-09、09-10） | 通过 | `[已验证]` WAL |
| 点 Upgrade 创建 Checkout | 09-09 通过，**09-10 全新账号 5 次失败** | 通过多次 | `[已验证]` |
| 结账页加载出报价 | 09-09 真单 403；09-09 对照实验 free 号通过 | 通过 | `[已验证]` |
| 填卡、地址、邮箱、零税重报价、停在点击前 | 未在真实客户账号上到过这一步 | rehearsal 2 次通过 | `[已验证]` |
| 点击付款 | 09-08 测试号 4 次：1 成功 3 拒付 | 同左 | `browser_operations` PAYMENT_SUBMIT 4 `[已验证]` |
| 付款后自动确认 Plus | 0 次（09-08 成功那次 confirmPlus 因旧 token 判 UNKNOWN，D-136） | 0 次 | 无 PLUS_ACTIVATED `[已验证]` |
| 自动取消续费 | 0 次 | 0 次 | 无 CANCELLATION_CONFIRMED `[已验证]` |
| 核实 lane 在 PAYMENT_UNKNOWN 路径 | 0 次 | 0 次 | `[已验证]` |
| 20X 第二阶段到弹窗 | 0 次 | 09-08 已 Plus 测试号只读到弹窗 | `[已验证]` |
| 从点击到 RECHARGE_SUCCESS 全自动闭环 | **0 次** | 0 次 | `[已验证]` |

**当前卡点**：09-10 真单预检 5 次全部 `CHECKOUT_NAVIGATION_FAILED`，登录与身份核对通过，卡在点 Upgrade 之后没有 Checkout 创建。归因未定。上一窗口的"上号器路径对照"实际没跑扩展（F-42，我已独立核代码，Codex 已修）。`[已验证]`

## 4. 资金安全靠哪几道门（到行号，全部 `[代码显示]`，其中三道门有 MySQL 集成测试）

| 门 | 位置 | 作用 |
|---|---|---|
| 数据库付款开关 | `browser-execution-repository.js` 的 `assertPaymentWritesEnabled`，在 permit（约 535 行）与 intent（约 595 行）两处事务内 `FOR UPDATE` 断言 | 开关关则拿不到 permit、落不了 intent |
| permit | `issuePaymentPermit` 520 行：要求 run RUNNING / payment NOT_STARTED、automation 拥有控制、attempt PREPARED 且 funds ACTIVE、订单 RECHARGE_PROCESSING，绑 worker、租约、快照哈希 | 一次 permit 对应一次付款机会 |
| intent | `commitPaymentSubmissionIntent` 575 行：PAYMENT_ARMED 转 PAYMENT_SUBMITTING，`operationId` 唯一，重放返回 `executeExternal:false` | 点击前先落库；崩溃后重放不会再点 |
| 单击 | `live-chatgpt-payment-adapter.js:142-154`：`authorizeSubmit()` 拿到 intent 后 `submit.click()` 恰一次，`submitted=true` | 物理上只点一次 |
| 非确认即未知 | `payment-executor.js:197-231` 三个出口全部 `markPaymentUnknown` | 结果不明不判失败 |
| 未知不重付 | `getRecoveryState` 1693 行：有 PAYMENT_SUBMIT 或 UNKNOWN 即 RECONCILE_ONLY；`abortBeforePayment` 686 行只在无 PAYMENT_SUBMIT 时清栅栏；`shared-runtime-integration.js:157-176` 重新领到 PAYMENT_SUBMITTING 的 run 直接锁为未知 | 任何路径都不会第二次点击 |
| 一单一 attempt | `task-repository.js:225-229` 排除 ACTIVE/UNKNOWN/SETTLED；`beginAuthorizedAttempt` 只允许幂等复用 PREPARED | 不会为同一单开第二个资金栅栏 |
| 卡占用与释放 | 资格 SQL 排除 ACTIVE assignment（`card-inventory-eligibility.js:372`）；D-131 付款前失败释放；付款后不释放 | 一卡同时一单 |
| 付款前失败清卡字段 | `live-chatgpt-payment-adapter.js:171-187` | PAN 不残留在常驻页面 |

这九道我逐一打开看过。初稿说"已阅读关键代码"但没有列到位置，无法被复核。

## 5. 接下来做什么、为什么这个顺序（重排提案，待 Lemon 确认）

PROJECT_MAP §5 是 09-07 定的，HANDOFF_NOW 09-10 版又排了一次。现在两者都不能直接照走：F-5/34/35 已发布，F-1/24/25/26/18 本机已修，F-16+F-3 后端已在线上但带三个 bug（F-44/45/46）且没接 UI，真单卡在 sentinel，Browser 模块归 Codex。排序原则只有一条：**什么在阻塞北极星就排前面**。

| 序 | 项 | 归属 | 为什么在这里 | 状态 |
|---|---|---|---|---|
| A1 | F-42 修复合并进 main | 大脑 | Codex 阶段 1 已验收 | 本轮完成 |
| **A2** | **预检改造**：预检不再点 Upgrade 创建 Checkout，只做注入、身份核对、free 判定；`max_attempts` 5 改 2 | 设计大脑，browser-mvp 部分 Codex，v1 部分大脑 | 见 §2.1：每单两次 Checkout、35% 预检重试，都是不必要的风控信号；预检的原始价值（坏 session 早打回、不占卡）保留。代价：预检不再证明"能到结账页"，LIVE 第一次失败会占卡后按 D-131 释放 | **待 Lemon 确认** |
| A3 | 阶段 2 实验 E0 离线路径标记 | Codex | 不消耗账号 | 我批，本轮回复 |
| A4 | 阶段 2 实验 E1、E2 | Codex 执行，账号 Lemon 给 | 唯一阻塞北极星的排查 | 等 Lemon 给账号与 Profile |
| A5 | rehearsal 到 PRE_SUBMIT_STOPPED，再一笔真单到 RECHARGE_SUCCESS | Codex + Lemon 放行 | | |
| B1 | F-44、F-45、F-46 修好，`RESOLVE_UNKNOWN_PAYMENT` 接后台按钮，发布 | 大脑 | 这个收口动作已在线上、接口可调、带 bug；真单一旦 UNKNOWN 就要用它 | 真单前 |
| B2 | F-43 核实 lane 被旧 token 五分钟门槛挡住 | 大脑 | 付款后核实会被自己的校验挡死 | 真单前 |
| B3 | F-19 多 lane 核实不绑窗口 | 大脑 | 开第二条 lane 前必修 | 多 lane 前 |
| C1 | 资格 SQL 对 highvcc 卡改按同步新鲜度，不再信任静态余额 | 大脑 | 今天的 timer 是补偿，根因在这 | 真单后 |
| C2 | timer 失败（token 过期）写 operator_alert | 大脑 | 现在只在 journal | 真单后 |
| C3 | F-37 自检脚本与资格 SQL 同口径；state-check NULL 计数 bug | 大脑 | | 真单后 |
| C4 | `highvcc-card.mjs export` 把分当元写余额 | 大脑（卡台脚本不是 Browser 自动化代码，收回地界） | 有人再用它导表会记错 100 倍 | 真单后 |
| C5 | F-40 测试断言、F-41 取消不关预检任务 | 短命窗口 | 机械活 | 顺手 |
| D1 | Worker 搬常开机器 | Lemon 备机器，大脑部署 | 基线 09-06 就定了，从没做；本机睡眠即停 | 真单通后立刻 |
| D2 | 菲律宾住宅 sticky 出口、出口隔离 | Lemon 采购 | 09-09 调研：机房 VPN 节点是 Stripe 会标记的类型；放量前 | 真单通后 |
| D3 | 多 lane 并行验证 | Codex | 吞吐 | D1、B3 之后 |
| D4 | Free 直购 20X（D-141） | Codex | 用户方向 | Plus 闭环稳定后 |
| D5 | 审查第二批（后台五页、schema、文档一致性） | 短命窗口按 REVIEW_PROTOCOL | | 穿插 |
| E | UX 清单证据最扎实的 5 条（开始营业按钮冗余、CDK 结果框不消失、CDK 码无产品前缀、诊断页缺折叠、五个决定缺 hover） | 短命窗口 | Lemon 拍板后 | 穿插 |
| F | F-4/7/8/10、删旧编排（CORE_SPEC §5.1）、零使用接口与表 | | 真单稳定后 | 最后 |

**与 09-10 版顺序的差别**：把"Browser 主链路通"从"等真单"改成"Codex 按实验推进 + 预检改造"；把 F-16+F-3 从"已做"改回"要修三个 bug 再接 UI"；新增供给链根因 C1；把 D1 常开机器提到真单通后立刻做，而不是放在规模化那一堆里。

## 6. 最大风险

1. **Browser 主链路不通，且每次诊断都在消耗账号。** 09-10 一个账号被点 9 次。这是北极星的唯一阻塞，其余所有事都排在它后面。`[已验证]`
2. **系统外操作与系统状态脱节。** 7402 在系统外刷了 $158.62，系统账本零消费；9839/9354 开了卡没入库；四笔 Browser 成功全靠人工收口脚本。每一次系统外动作都要人记得回来收口，忘一次就是账错。今天的 timer 补了卡余额这一块，订单收口那一块仍靠人。`[已验证]`
3. **付款后半段从未在真单跑过。** 自动确认 Plus、自动取消续费、核实 lane、UNKNOWN 收口，生产各 0 次。第一笔跑通的真单大概率会在这一段暴露新问题，而 B1 的收口动作现在还带 bug。`[已验证]`
4. **拒付概率的结构性因素。** 美国卡 + 菲律宾机房出口 IP，09-09 调研指出这是 Stripe 拒付的已知组合；09-08 三次拒付。Lemon 已定只用美国卡、必须菲律宾低价，所以只能靠住宅 IP 和干净账号补偿。`[文档说]`
5. **单机依赖。** Mac 睡眠、BitBrowser 免费额度、mihomo 订阅、SSH 隧道，任何一个断就停单。launchd 守护了两个，剩下的没有。`[已验证]`

## 7. 我认为以前做错的（Lemon 已授权推翻，逐条给代价）

| 事 | 错在哪 | 建议 | 代价 |
|---|---|---|---|
| 09-10 真单"放弃先演练、直接真实尝试"，同一账号自动 5 次加人工 4 次 | D-139 说失败一次即人工，但预检是自动重试 5 次，规则没覆盖预检阶段；诊断时在客户账号上反复点击 | A2：预检 `max_attempts` 改 2；D-139 明写"预检第 2 次失败即停"；诊断用测试账号不用客户账号 | 预检更容易 DEAD，需要 F-1 的重开脚本更常用 |
| 预检创建 Checkout | 每单两次 Checkout、重试再加；CORE_SPEC 自己列它为待删 | A2 | 预检不再证明能到结账页 |
| 两代窗口在 Browser 卡点上"猜根因、改代码、再试"：D-140 因果被 F-27 证明有 7 次反例；sentinel 归因被交接文档自己标为"只是相关性" | 每猜一次消耗一个账号或一次真单 | Codex 任务书已改为控制变量实验，我审设计再放账号 | 慢，但不再烧账号 |
| `RESOLVE_UNKNOWN_PAYMENT` 带 F-44/45/46 三个 bug 进了 cdcf42e release | 字符串 `"false"` 当 true、不核对产品、不写取消字段 | B1 | 一次 v1 发布 |
| highvcc 卡入库即标 MANUAL_IMPORT，资格 SQL 信任静态余额 | 卡台有 API 却按 Excel 卡对待，7402 两天前的 $49 被当真分给 Dqcn | 今天 timer 补偿；C1 改根因 | 资格 SQL 多一个分支 |
| Sonnet 窗口自审自处置 | 违反 REVIEW_PROTOCOL 角色分离，它自己也标了"不是独立双人审计" | 处置由我重做，就是本文 §5 | 无 |
| 上一 Fable 窗口干了一整天没重写接班一屏 | 收尾清单第一条没执行，接班一屏与事实表矛盾了 20 小时 | 已重写；以后接班一屏只有大脑写 | 无 |
| `highvcc-card.mjs export` 把分当元 | 09-10 导给 Lemon 的 9839 表格若被导入会记成 $5000 | C4 | 一行修 |

## 8. 与 Sonnet 初稿的差异清单

- 初稿六问框架和它核对的三处现场事实（预检 DEAD 5/5、可分配卡 0、RESOLVE 后端已在线上）都对，我独立复核过。
- 初稿没写：一单两次浏览器流程两次 Checkout（§2.1）；北极星与现状差距（§1）；手动卡余额不同步（§6.2，它当时没发现）；预检 35% 重试率；Browser 路线 4 个 SUCCESS 全是人工收口这个口径。
- 初稿第 3 问"本轮验证了服务在线、当前卡住单与付款关闭状态"保守到没有信息量，§3 给了逐环节表。
- 初稿第 4 问"已阅读关键代码"没有位置，§4 给到行号。
- 初稿第 5 问只说"继续深读"，没有排序；§5 是可执行的顺序。
- 初稿的 F-42 发现是它最有价值的产出，已进 Codex 任务书并修复合并。F-43/44/45/46 进了 §5 的 B 段。
