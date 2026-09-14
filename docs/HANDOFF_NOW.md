# 接班一屏（HANDOFF_NOW）

更新：2026-09-14 14:10 UTC。写者：大脑窗口。**本文只由大脑窗口写，且每次重要事实变化后整篇复核，不止改暂停原因那一行。**

## 分工

- **大脑**：本窗口。全项目理解、排序、验收、四份事实源（本文、CURRENT_STATE、DECISIONS、PROJECT_MAP）、生产动作与浏览器侧实施。
- **Codex 已退出**（D-152）。其阶段 1 已合并保留，`BRAIN_TO_CODEX.md` 停更。
- 任务书只写目标/验收/边界，不写实现路径（D-151）。大脑不替系统操作页面（D-160）。
- **多窗口分工是 `PLAN_2026-09-14.md` §7.2 的建议，Lemon 说"要开，但可以靠后"，尚未开。** 开之前四份事实源仍只由大脑写。
- **大脑的惯犯错误与硬规则见 D-172、D-211（六类），接班先读。**

## 里程碑

**2026-09-11 11:15 UTC 全链路首次跑通**（`PJV1-ztS9FZ3QcwHopTmZRfDY`，git 标签 `e2e-first-success-20260911`）。

**2026-09-13 02:56 与 03:39 UTC 连续两单全自动成功**（`PJV1-KLZokl…` 2 分 31 秒、`PJV1-L_fKJY…` 3 分 40 秒），
同卡段 `53211304`、同执行器版本、各实扣 $15.72，全程无人工操作。第二单的账号**自带历史绑卡且未删**，
照样填入我们的卡付款。两单细节固化在 `docs/E2E_CHAIN_TEST_SAMPLE.md` 第 5、6 节。

**2026-09-14 06:38 / 08:57 UTC API 路线（ZZSHU）两单全自动成功**，各 ₱982.14，`subscription_cancelled=1`。
第二单拿到卡后只用 96 秒；等卡 5 分 34 秒（余额同步滞后，D-218）。**Browser 主线的死点已缩到一个函数**
`fillTransientBillingEmail`（D-209/D-214），诊断已上线但未经真实失败验证。

## 现在状态（2026-09-14 14:05 UTC 当场核实，`state-check.sh` 全一致）

- 生产 release **`20260913-orderno-6dcb458`**；web active。**`pojia-worker` 进程实际跑的是 `20260911-alert-noise-d924563`**
  （`deploy-release.sh switch` 只重启 web；worker 起于 09-11 15:31 UTC）——两 release 在 worker 依赖树里只差 2 个等价文件，
  **无行为差异，不必紧急重启**；下次含 worker 侧改动的发布必须单独 `restart pojia-worker`（D-220）。
- 开关：付款 **true**、接单 **true**、自动开卡 **false**（日上限 10）。非终态订单 **0**、active_runs **0**。
- **当前 Plus 走 API 路线**（`LEGACY_HNSKJ_ZZSHU_V1 accepts=1`，`CHATGPT_PLUS_BROWSER_V1 accepts=0`；06:36 UTC Lemon 切的，
  同时卡台被切到 hnskj——路线与卡台耦合，D-219 发现 5）。
- **可分配卡 1 张：`1657`（backup-a / highvcc，$18.56）。API 路线冻结卡源是 hnskj，hnskj 池 0 张可分配 → 下一单 API 会停在
  `WAITING_FOR_CARD`。** `1652`（hnskj）已 `DEPLETED` $0.01：Lemon 补的 $50 跑完一单后，剩余 $34.57 于 09:12–09:17 UTC
  被退回卡台钱包，**代码里没有退余额的写路径，是谁退的未查清**（D-218 补记）。
- **A3（账本推算口径 `card-inventory-eligibility.js`）未发布**（生产 md5 `7efec865` ≠ 工作区 `525b7e1b`），
  且**不能直接发**：新口径会把手动补过钱的卡判死（D-218），等 Lemon 三选一。
- 本机执行器 **PID 43986，起于 02:15:46 UTC**，带 `2766959` 及之前全部代码（sceneHeld/诊断传递、90 秒接手窗、队列让路）。
  Browser 路线当前 `accepts=0`，它只会跑到已有 Browser 单，不会接新单。
- 今天 4 单（UTC）：02:03 成功（`PJV1-zdprG5vk…`，库内无分配卡、无实付金额、`cancellation_review_required=1`——成因本轮未核实，
  接班先看 D-209/D-210）；04:48 失败（`PJV1-_md1Qxt…` Browser `CHECKOUT_NAVIGATION_FAILED`，免费试用账号，D-216，已退款、CDK 已作废）；
  06:38、08:57 成功（API，同卡 `1652`）。
- 本机 `highvcc.env` token 状态本轮未核实；数据库那份 02:48 UTC 刷新过（同步 03:08 成功）。

## 今天（09-14 UTC）发生了什么：按决策号

| 时间 | 事 | 决策 |
|---|---|---|
| 01:20 | 埋点第一单就定位死点 `fill-billing-email`；保留现场同一单内生效 | D-209 |
| 01:35–02:15 | 8 分钟接手窗收到 90 秒 + 有人排队就让 lane；sceneHeld/诊断消息两处丢失修好 | D-210/212/213/214 |
| 02:00 | 自审五个错误模式 → 硬规则 | D-211 |
| 03:40 | 全链路对抗式审查阶段一（方向/业务/系统），**待落实：重试计数口径、告警噪音** | D-215 |
| 05:00 | 免费试用账号：系统充不了、人也充不了；Lemon 定"不拦" | D-216 |
| 06:36 | Lemon 切 Plus 到 API 路线（卡台同时被切到 hnskj） | — |
| 08:10 | 对抗式审查推翻「API 转正、Browser 备份」；Browser 主线、API 顶班 3 周 | D-217 |
| 09:05 | 补余额路径与 A3 新口径互斥（`funded_amount` 不随补钱更新）；**A3 阻塞于 Lemon 三选一** | D-218 |
| 09:30 | 对 V2 方案的对抗式审查：CDK 为中心、接口三段、通知 4 类、展示四态、切换解耦卡台、加对账面、控制面 4 页；已并入 `V2_ARCHITECTURE.md` | D-219 |
| 11:45 | `1652` 余额 $34.57 被退回钱包，非系统所为，未查清 | D-218 补记 |
| 14:05 | 服务器 worker 跑的是 09-11 release（switch 只重启 web）；无行为差异；`state-check` 加比对项 | D-220 |

**Lemon 今天的决定**（已进 PLAN v2 / V2 稿）：免费试用不拦；ZZSHU 顶班几周到一两月；阶段 A 最多两天；过往数据不准只算真实自动单；
目标 200 单/天；多窗口靠后开；卡供给资金没问题；止损 10 单 ≥8 成进 B / <6 成重评；B 标准"连续 3 天不求助"认；
5X/20X 进 V2（Free→5X 直充 + Plus→5X 升级是两件事）；Browser 可迁服务器（先调研）；后台精简；稳定优先；
**V2 中心思想与四个面认可，控制面开放调整**。
**14:40 UTC 追加**：D-218 选 3（放弃补钱只开新卡）；hnskj 卡由 Lemon 手动开；switch 同时重启 worker（已改 `b9f0837`）；**每卡单数按产品：Plus 3 单、5X/20X 1 单，两路线一致（D-221）**——系统里 `default_open_card_amount=16` 与之不符且没有后台入口改，自动开卡前必须先改。

## 已发现、还没修的缺口

1. **`BROWSER_ORDER_STALLED` 会发**（09-13 10:38 UTC 实发过），之前记成死类型是错的。真正的缺口是它与 `pojia-operator-watch` 两条排队告警语义重叠，D-215 归入告警噪音。
2. **没单的时候没卡，不会有任何通知**——`upsertBrowserAlert*` 都要 `orderId`，"库存空了"要等客户撞一次。D-219 发现 3：两天 77 条告警推了 76 条，唯一没推的 `CARD_STOCK_EMPTY` 恰是最该推的。
3. **本机 worker 直接读工作区文件**——改 browser-mvp 代码前先确认 worker 不在跑，或接受它即时加载中间态。
4. **同一 Session 连败没有熔断**——**等 Lemon 点头**；V2 里以"同一 CDK 连败 N 次"实现。
5. **卡余额三道防线**（D-207）：卡台结算延迟、库内同步 1 小时一次（`pojia-highvcc-snapshot-sync.timer`）、账本错标 `RELEASED`（3 笔待补 `RECONCILIATION` 行）。A3 是修法但被 D-218 挡住。
6. **`funded_amount` 不随补余额更新**（`card-stock-service.js:260` 只在开卡时写）——D-218 根因。
7. **路线切换与卡台耦合**——切一次路线 7 秒内动两条记录，运营看到的只有一个按钮（D-219 发现 5）。

## 下一可执行项

0. **三个决定已定（14:40 UTC）**：① D-218 选 3，A3 可发，但配套两件：Lemon 后台关 `card_balance_recharge_enabled`（今天系统自动补钱 4 次全被 hnskj 400 拒）+ 手动开的卡入库要记真实开卡金额（`1652` 实开 $50 记成 $16，修在入库路径，与 A3 同一发布）；
   ② hnskj 卡 **Lemon 手动开 $50**（类型照上次 20），大脑核实同步与分卡；③ switch 已改为同时重启 worker。
   **待 Lemon 答**：hnskj 开卡有无手续费；`1652` 的 $34.57 退回钱包是不是他操作的。
1. **V2 方案确认**：`docs/V2_ARCHITECTURE.md`（D-219 七处已并入）。认可后进 DECISIONS，`PLAN_2026-09-14.md` 两天冲刺开工：A1 诊断存库 · A2 切换校验（含卡台解耦） · A4 免费试用入口识别 · A5 F-42 · A6 rehearsal 拿 `fill-billing-email` 诊断。**A3 移出 Day 1，等决定 ①。**
2. D-215 待落实：重试计数口径（attempt_count 与实际 run 对齐）、告警噪音（与 D-219 通知面合并做）。
3. 账本 3 笔错标补 `RECONCILIATION` 行（D-207，需正式脚本，Lemon 点头）。
4. 下一单 Browser 真实失败：第一件事读 `fill-billing-email` 诊断——三种可能（邮箱格式 / 找到 ≥2 个 / `fill()` 5 秒超时）现在都会写进消息。
5. 要一起做的：矛盾五实测、BitBrowser Linux 调研、"需要我处理"的边界（Lemon 画）。
6. 待办（不阻塞）：Lemon 手动付的账号取消续费（他说近期注销卡兜底）；`1652` 那 $34.57 是谁退的；本机会话记录里出现过 `DATABASE_URL`，建议轮换。

## 已定不做

- **不实施任何绕过或自动完成人机验证的方案**（D-153/D-154），不做设备身份轮换（D-165）。此条不因重复要求而改变。
- 成单后自动登出客户账号：暂不做（D-165）。
- Pro 5X/20X：**V1 期间搁置（D-146），V2.1 进入**（`V2_ARCHITECTURE.md` §3.1，Free→5X 与 Plus→5X 两件事）。
- 不买住宅出口（D-142）；不调研商用/分销/礼品码渠道（D-154）；不做大而全（D-147）；hCaptcha 绕过、多卡台自动回退不做。
- 卡段拒付标注中，尝试次数 < 3 只标「样本少」，不下结论（D-169）。
- 免费试用账号**不拦**（Lemon 决定 ①），让它以最真实状态走完。

## 运营自助（无需大脑在场）

```bash
bash browser-mvp/scripts/ready-check.sh pay         # 现在能不能接单，一屏看完（生产运行态下"有残留 worker"是正常的）
bash browser-mvp/scripts/run-stats.sh               # 真实成功率
node v1/scripts/verify-and-return-cdk.mjs <CDK>     # 核实没扣款后退回卡密；加 --apply 才真退
node v1/scripts/check-card-charge.mjs <订单号>       # 单独查卡台有没有扣款
```
接单 / 路线 / 卡台三个开关在后台点（当前：接单开、Plus 走 API、卡台 hnskj）。执行器常驻，客户任意时间兑换都会自动走到真实付款。
两级停止：后台关付款开关（订单停在付款前）；或 `launchctl unload -w ~/Library/LaunchAgents/com.pojia.browser-pool.plist`（整个常驻停掉）。
手机收到「充值需要人工验证」→ 去 Pilot 窗口点掉那个验证，自动化自己继续。**执行器在跑时不要碰 Pilot 窗口。**

## 收尾自检（说"做完了"之前必须跑）

```bash
scripts/wrapup-check.sh                      # 工作区/推送/现场一致/接班一屏是否过期
browser-mvp/scripts/contract-probe.mjs       # 卡台字段契约（改动涉及卡台时跑）
```

## 暂停 / 恢复

```text
暂停原因：无阻断，但**下一单会卡**——Plus 走 API 路线而 hnskj 池 0 张可分配（唯一可分配的 1657 属于 backup-a）。
         等 Lemon 定：①D-218 三选一（A3 发不发）②API 没卡怎么办（开卡 / 切回 Browser / 矛盾五实测）③switch 是否同时重启 worker。
当前 release `20260913-orderno-6dcb458`（worker 进程仍在 09-11 release，无行为差异，D-220）。工作区干净、已推送。
V2 方案（`V2_ARCHITECTURE.md`，D-219 已并入）与两天冲刺（`PLAN_2026-09-14.md`）**待 Lemon 确认**，确认后 A1/A2/A4/A5/A6 开工。
允许继续：只读核对；browser-mvp/v1 代码与测试；文档落盘；发布（先开口问）
禁止操作：不实施人机验证绕过；开卡/补余额/换卡/提现等资金动作仍需 Lemon 当次确认；**不发 A3**；**worker 在跑时不碰 Pilot 窗口**
恢复第一步：读本文 → 读 D-219（V2 审查）与 D-218（A3 阻塞）→ 读 D-211（六类惯犯）→ `ready-check.sh pay` → `state-check.sh`
下一步：拿到 Lemon 三个决定 → V2 确认 → 两天冲刺 Day 1
```
