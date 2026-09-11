# 未验证清单（2026-09-07）

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
