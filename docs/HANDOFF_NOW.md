# 接班一屏（HANDOFF_NOW）

更新：2026-09-13 06:40 UTC。写者：大脑窗口。**本文只由大脑窗口写，且每次重要事实变化后整篇复核，不止改暂停原因那一行。**

## 分工

- **大脑**：本窗口。全项目理解、排序、验收、四份事实源（本文、CURRENT_STATE、DECISIONS、PROJECT_MAP）、生产动作与浏览器侧实施。
- **Codex 已退出**（D-152）。其阶段 1 已合并保留，`BRAIN_TO_CODEX.md` 停更。
- 任务书只写目标/验收/边界，不写实现路径（D-151）。大脑不替系统操作页面（D-160）。
- **大脑的三类惯犯错误与硬规则见 D-172，接班先读。**

## 里程碑

**2026-09-11 11:15 UTC 全链路首次跑通**（`PJV1-ztS9FZ3QcwHopTmZRfDY`，git 标签 `e2e-first-success-20260911`）。

**2026-09-13 02:56 与 03:39 UTC 连续两单全自动成功**（`PJV1-KLZokl…` 2 分 31 秒、`PJV1-L_fKJY…` 3 分 40 秒），
同卡段 `53211304`、同执行器版本、各实扣 $15.72，全程无人工操作。第二单的账号**自带历史绑卡且未删**，
照样填入我们的卡付款 —— 回答了"客户账号已有绑卡时系统能不能填我们的卡"这个悬着的问题。
两单的全部细节与可复现前置检查固化在 `docs/E2E_CHAIN_TEST_SAMPLE.md` 第 5、6 节。

## 现在状态（2026-09-13 04:34–04:45 UTC 当场核实，`state-check.sh` 全一致）

- 生产 release **`20260913-customer-ux-4ccb8c7`**；web / worker 均 active；迁移 `052_cards_bin`。回滚点 `20260913-captcha-alert-6797fdc`。
- 付款开关 **true**、接单开关 **true**；非终态订单 **0**、active_runs **0**。
- **可分配卡 1 张：last4 `3159`，卡段 `53211304`，$50.00，有效期 07/28**。2026-09-13 05:18 UTC
  经 Lemon 确认后走 `highvcc-card-service.js` 的 `openCard()` 正式路径开出（vid=710，费用 $50.50
  = 开卡费 $0.50 + 充值 $50，服务费 0%）。消费账本 0 笔，**单卡上限 3 单**
  （`card_max_successful_payments=3`），按实耗 $15.72 估够 3 单。
- **卡 3118（同卡段，$7.77）用量已 3/3，补钱也不再合格** —— 上限是资格条件之一，不是只看余额。
- **别被库里那 5 张幽灵卡骗了**：9839 显示 $50、2911/3241/7428/9354 各显示 $1，但
  `source_present=0`、`source_operational_status=MISSING_FROM_SNAPSHOT` —— 卡台快照里已经没有
  这些卡，余额是它们最后一次出现时的读数。系统按 `HELD_FOR_REVIEW` 扣下
  （`manual-card-import-service.js:229-233`），**不要手动放出来**。
  hnskj 账号 11 张共 $0.40（卡段从未成功过）。highvcc 钱包开卡后 $271.73。
- **执行器在跑**：supervisor 在开卡后 65 秒（05:19:32 UTC）自己拉起了 worker，符合 60 秒轮询。
  **系统现在能接单**：付款开关 true、接单 true、可分配卡 1 张、非终态订单 0、active_runs 0。
- **客户此刻提单不会静默卡住**（代码已核对 + 生产开关已核对）：提交时推一条"客户提交了充值"；
  分卡找不到合格卡 → 订单进 `WAITING_FOR_CARD` → 推一条 **critical「订单正在等待卡片」响手机**。
  三条"自愈"分支（刷新余额/自动补余额/自动开卡）在当前配置下全不成立：卡 3118 属 `manual_excel`
  账号，`supports_auto_funding=0`、`supports_auto_open=0`，且刷新候选明确排除 `MANUAL_IMPORT`
  （`workflow-repository.js:233`）。所以告警不会被压掉。
- **真实成功率 27%（3/11）**，当场重查（`run-stats.sh`：总运行 49、付款前中止 36、点过付款 11、系统自动成功 3、已自动退订 3）。
- **点过付款后未成功的原因分布：人机验证 `HUMAN_VERIFIED_NOT_CHARGED` 4、`CARD_DECLINED` 3、无记录 1。**
  人机验证已是第一失败原因（8 次未成功里占 4），这是今天那次通知改造要解决的问题。
- 本机链路：菲律宾出口 38.60.246.34、SSH 隧道 13306、BitBrowser Local API 均正常。
- 客户账号（mengx612）仍登在 Pilot 窗口 —— Lemon 决定暂不自动登出（D-165）。**注意**：自 D-187 起
  执行器每次运行都会把窗口登录态整个替换成当单客户的 Session，不再保留常驻登录。

## 今日（09-13）上线

`captcha-alert-6797fdc` **人机验证在检测到的那一刻就推手机**：原先 notify 钩子只弹本机 macOS 桌面通知
（`local-operator-notify.js` 走 `osascript`，人不在电脑前收不到），现在同时写 `operator_alerts` 走 Bark；
并把 `BROWSER_HUMAN_VERIFICATION` 补进 `BROWSER_ALERT_TYPES`（此前只有调用点没有类型，会抛
`unknown browser alert type`，等于告警根本写不进去）。测试加了一条断言守住"人机验证不得进
`PHONE_SILENT_TYPES`"。**写告警失败不影响付款流程。**

09-12 的 8 次发布见 CURRENT_STATE 与 `docs/HANDOFF_LOG.md`。

## 今日第二次上线（06:37 UTC）

`customer-ux-4ccb8c7` 客户页四处返工（Lemon 提的）+ 一个他没提、我查出来的真 bug：

- **付款成功的那几秒，客户看到的是橙色「遇到点问题」** —— `SUBMIT_UNKNOWN` 原本和
  `RECONCILIATION_REQUIRED` 一起映射成 `REVIEWING`（warn / 30 秒轮询），而它是**每一单
  必经的一步**（今天两单各停 8~9 秒）。改映射到新客户态 `VERIFYING`（正常色、3 秒轮询、
  「支付已提交,正在和 ChatGPT 核对开通结果」）；超过 3 分钟仍在确认才按停留时长降级成
  warn + 30 秒，真卡住照样告诉客户。`CONFIRMING` 轮询 6→3 秒。
- **进度环不跳**：跳点只有两处（阶段 4 实际 18 秒、阶段 7 实际 8.8 秒，都远短于段长常数
  90 秒；阶段 8 三个操作同事务提交、零停留，所以 77% 直接跳 100%）。没去猜每段该多长，
  改成换段逐帧追差距 12%、跑完 700ms 滑到 100，以后耗时怎么变都吸收得住。
- **去掉查询码，只留卡密**：查询码行、等待屏订单号行、「复制查询码」按钮全去掉。
  **限制**：状态接口不回传 CDK（凭证不该回传），所以成功页那行只能删不能换成 CDK。
  客服不受影响，后台搜索与 `find-order-by-cdk.mjs` 按 CDK 都能查到单。
- **订阅方案显示 `Plus`**：三处改走已有的 `productShortName()`；后端 label 仍是全名。

**还剩约 105 秒延迟是真实的**（点付款 → 标记成功之间确认付款结果 97 秒 + 核实 Plus 与
取消续费 8 秒）。不能靠提前标成功消除——那会破坏「付款结果不明确必须锁定」。见 D-192。

## 已发现、还没修的缺口

1. **`BROWSER_ORDER_STALLED` 是死类型** —— 在 `BROWSER_ALERT_TYPES` 里有定义（`critical`），
   但全项目没有任何地方发出它。D-175 要的第二个节点"客户卡在队列里没人处理"实际没接上。
   排队超时那条通知走的是服务器侧 timer `pojia-operator-watch`，与这个类型无关。
2. **没单的时候没卡，不会有任何通知** —— 缺卡只写进本机 supervisor 日志（而且同一原因只写一次）。
   所有 `upsertBrowserAlert*` 都强制要 `orderId`（`browser-alert-repository.js:25`），
   告警体系是订单驱动的，所以"库存空了"必须等客户来撞一次才有人知道。客户那次会白等。
3. **本机 worker 直接读工作区文件** —— 2026-09-12 17:58 的 6 次 `LANE_FAILURE
   (humanVerification is not defined)` 就是正在跑的 worker 加载了我改到一半的文件。
   当前代码已无此引用问题（`payment-executor.js:221` 用可选链、repository 侧是参数解构），
   但**改 browser-mvp/v1 代码前要先确认 worker 不在跑**，或接受它会即时加载中间态。

## 下一可执行项

1. ~~补卡货~~ **已完成（2026-09-13 05:18 UTC）**：开出 3159（$50，卡段 `53211304`），
   supervisor 65 秒后自动拉起执行器。这张够 3 单，用完再开需 Lemon 当次确认。
   **下一单就是用新卡段那张卡量成功率** —— 目前 27%（3/11），其中人机验证占失败的一半。
2. **免费试用 offer 的业务口径**（D-190 第五节，**在 Lemon 手上**）：客户账号有免费试用资格时算怎么回事 ——
   客户自己能白领一个月、我们收钱只能替他点免费按钮算不算交付、要不要在兑换入口就检测。
   它阻塞客户页与执行器的设计，未实施任何改动。
3. **报错单自动处置第二步**（第一步已完成）：把卡台交易证据接进验证 lane + 补判定矩阵 + 节流。
   见 ROADMAP。样本够了之后由大脑主动找 Lemon 拍板。
4. 上面三条缺口按 1 → 2 → 3 的价值排序修；缺卡提前通知（缺口 2）最直接影响客户体验。
5. 操作入口统一（`docs/UX_PUNCHLIST_2026-09-10.md` 第 6 节）、飞书机器人远程处理后台按钮
   （`docs/ROADMAP.md`）—— 均已记录，未排期。
6. 待办（不阻塞）：Dqcn 单取消续费；本机会话记录里出现过 `DATABASE_URL`（含密码），建议经 Lemon 确认后轮换。

## 已定不做

- **不实施任何绕过或自动完成人机验证的方案**（D-153/D-154），不做设备身份轮换（D-165）。此条不因重复要求而改变。
- 成单后自动登出客户账号：Lemon 决定暂不做（D-165）。
- Pro 5X/20X 全部搁置（D-146）；不买住宅出口（D-142）；不调研商用/分销/礼品码渠道（D-154）；不做大而全（D-147）。
- 卡段拒付标注中，尝试次数 < 3 只标「样本少」，不下结论（D-169）。

## 运营自助（无需大脑在场）

```bash
bash browser-mvp/scripts/ready-check.sh pay         # 现在能不能接单，一屏看完
bash browser-mvp/scripts/run-stats.sh               # 真实成功率
node v1/scripts/verify-and-return-cdk.mjs <CDK>     # 核实没扣款后退回卡密；加 --apply 才真退
node v1/scripts/check-card-charge.mjs <订单号>       # 单独查卡台有没有扣款
```
执行器是常驻的，客户任意时间兑换都会自动走到真实付款。两级停止：后台关付款开关（订单停在付款前）；
或 `launchctl unload -w ~/Library/LaunchAgents/com.pojia.browser-pool.plist`（整个常驻停掉）。
手机收到「充值需要人工验证」→ 去 Pilot 窗口点掉那个验证，自动化自己继续。

## 收尾自检（说"做完了"之前必须跑）

```bash
scripts/wrapup-check.sh                      # 工作区/推送/现场一致/接班一屏是否过期
browser-mvp/scripts/contract-probe.mjs       # 卡台字段契约（改动涉及卡台时跑）
```

## 暂停 / 恢复

```text
暂停原因：无。可分配卡 1 张（3159，$50，卡段 53211304），执行器在跑，现场干净（非终态 0、槽 0）。
         这张卡按单卡上限够 3 单；用完要再开卡（花钱，需当次确认）。
当前 release `20260913-captcha-alert-6797fdc`，现场干净（非终态 0、槽 0）。
**两个决定在 Lemon 手上**：①免费试用 offer 算不算交付（D-190 第五节），决定客户页与执行器怎么改；
②报错单自动处置第二步要不要做（ROADMAP），第一步已完成。
允许继续：只读核对；browser-mvp/v1 代码与测试；文档落盘；发布
禁止操作：不实施人机验证绕过；开卡/补余额/换卡/提现等资金动作仍需 Lemon 当次确认
恢复第一步：读本文 → 读 D-172（惯犯错误与硬规则）→ `ready-check.sh pay` 看能不能接单 → `run-stats.sh` 看成功率
下一步：可以接单了 → 定免费试用 offer 口径 → 修"没单时缺卡无通知"这个缺口
```
