# 接班一屏（HANDOFF_NOW）

更新：2026-09-12 14:28 UTC。写者：大脑窗口。**本文只由大脑窗口写，且每次重要事实变化后整篇复核，不止改暂停原因那一行。**

## 分工

- **大脑**：本窗口。全项目理解、排序、验收、四份事实源（本文、CURRENT_STATE、DECISIONS、PROJECT_MAP）、生产动作与浏览器侧实施。
- **Codex 已退出**（D-152）。其阶段 1 已合并保留，`BRAIN_TO_CODEX.md` 停更。
- 任务书只写目标/验收/边界，不写实现路径（D-151）。大脑不替系统操作页面（D-160）。
- **大脑的三类惯犯错误与硬规则见 D-172，接班先读。**

## 里程碑

**2026-09-11 11:15:15 UTC 全链路首次跑通**：订单 `PJV1-ztS9FZ3QcwHopTmZRfDY` 从客户提交到自动取消续费全自动完成。
固化于 git 标签 `e2e-first-success-20260911`（打在代码 `a544c6b`，标签正文写明可复现的全部运行版本）。
逐步证据与前三次失败记录：`docs/E2E_CHAIN_TEST_SAMPLE.md`。

## 现在状态（2026-09-12 14:26 UTC 当场核实，`state-check.sh` 全一致）

- 生产 release **`20260912-failed-retry-03b926c`**（2026-09-12 10:55 UTC 切换）；web / worker / 快照同步 timer 均 active；迁移仍在 `052_cards_bin`（本次无新迁移）。回滚点 `20260912-session-replace-04d311b`。
- 付款开关 **true**，接单开关 **true**（无人值守生效中）；**非终态订单 0、active_runs 0**；合格卡 **1 张（卡段 `53211304`，$39.24）**。
- 本机常驻执行器：supervisor PID 23949、worker PID 24745（2026-09-12 09:57:33 UTC 拉起）。菲律宾出口 38.60.246.34、SSH 隧道 13306、BitBrowser Local API 均正常。
- **真实成功率 1/7（14%）**，当场重查确认（总运行 39、点过付款 7、系统自动成功 1）。**这个分母有问题，别按 14% 规划**：7 次里 6 次用的是已知坏卡段 `51398996`，唯一成功的那次用的是 `53211304`（D-185）。先用好卡段跑几单，才有可用的成功率。
- 点过付款后未成功的原因分布：`CARD_DECLINED` 3、`HUMAN_VERIFIED_NOT_CHARGED` 2、无记录 1。
- **今天连跑四单真单，全部付款前失败，资金每次都已核实安全**（`PAYMENT_SUBMIT` 0、
  `funds_risk_state` CLEARED、卡与账本 RELEASED、CDK 回 AVAILABLE）。四个原因互不相同，见 D-190：
  ①窗口里是上个客户的登录态（D-187 已修，并首次拿到 `replacedCookieCount` 直接证据）；
  ②同一份 Session 重复使用、刷新令牌耗尽（**运营口径：失败后必须让客户重新导出，不能重复贴同一份**）；
  ③④账号有免费试用资格，定价页只给「Claim free offer」，**没有结账流程可走**；该号手动走结账
  同样被 ChatGPT 后端拒（Stripe 接受卡、`confirm` 400），Lemon 判定属特殊账号、本例作废。
- **待 Lemon 判断（阻塞下一步设计）**：客户账号有免费试用资格时算怎么回事——客户自己能白领一个月、
  我们收钱只能替他点免费按钮算不算交付、要不要在兑换入口就检测。D-190 第五节，未实施任何改动。
- **失败单客户有自助出路了**（D-188，2026-09-12 10:55 UTC 上线）：付款前中止的单，页面直说「卡密可以直接重新兑换」并给按钮；点过付款、结果不明的仍走「联系客服」。生产已复验——真实失败单 `PJV1--wEBaAETWx_pKBpTZVp9` 的状态接口返回 `canRetry: true`。
- 客户账号（mengx612）仍登在 Pilot 窗口——Lemon 决定暂不自动登出（D-165）。**注意**：自 D-187 起执行器每次运行都会把窗口里的登录态整个替换成当单客户的 Session，不再保留常驻登录。

## 今日已上线的改动（按发布顺序）

`resolve-unknown-ui-3d4936d` B1 收口按钮三 bug → `preflight-noupgrade-0396bb8` 预检不点 Upgrade → `cdk-return-fix-bfacbe1` F-48 未扣款退 CDK → `drop-preflight-24bcbde` 取消独立预检、账号检查并入正式流程 → `card-bin-c65727f` 卡段标注（迁移 052）→ `segment-hint-269ba10` 列表加载失败明说 → `sync-throttle-4350210` 卡台降频、默认卡段留空 → `sync-lastfour-11dbf3c` 字段名修正 → `sync-skip-msg-56c5290` 跳过时明说 → `alerts-342ad5f` 通知改造 → `alert-noise-d924563` 中间态不响手机 → `card-stock-alert-69946b0` 缺卡提醒（timer `pojia-operator-watch`，每分钟巡视排队/付款未落定/缺卡）。
→ `customer-page-624487c` 候光客户充值页（九阶段、卡密先验、四步流程）→ `session-replace-04d311b` 执行器首次注入即替换窗口登录态、删除永不执行的替换重试路径，九阶段与后台补事件名 `page-reload-after-inject`（D-187）→ `failed-retry-03b926c` 失败单返回 `canRetry`、页面给「重新兑换」入口（D-188）。
browser-mvp 本机代码（不经服务器发布）：人机验证识别与接力（D-155）、结账页无邮箱字段不中止（D-157）、付款后读结账页识别拒付（D-161）。

## 下一可执行项（顺序由 D-167 定）

1. ~~执行器常驻无人值守~~ **已完成（2026-09-12 13:25 UTC+8）**。LaunchAgent `com.pojia.browser-pool`
   开机自启、崩溃自愈（强杀后 30 秒内被拉回，实测）；Lemon 于 04:47:58 UTC 在后台开启付款开关，
   常驻在 04:49:00 自动拉起 worker（62 秒，符合 60 秒轮询），心跳持续推进、无报错。
   **系统现在是无人值守的：客户任意时间兑换都会自动走到真实付款。**
   两级停止：后台关付款开关（常驻退回只等不跑，订单停在付款前）；
   或 `launchctl unload -w ~/Library/LaunchAgents/com.pojia.browser-pool.plist`（整个常驻停掉）。
   **第一单真实客户单已跑过并失败**（`SAFE_ABORTED` / `CHATGPT_ACCESS_BLOCKED`，资金与卡密均已核实安全：
   无 `PAYMENT_SUBMIT`、资金证据 0、CDK 已退回 `AVAILABLE`）。根因**仍未确定**；D-187 只消除了
   「首次注入保留旧登录态、多打一次 ChatGPT」这一个变量，不等于故障已修复。
   **接下来要盯**：用好卡段 `53211304` 跑下一单，看失败是否复现；连续多单不重启的稳定性。

2. ~~需要人工时推送到手机~~ **已完成（D-175）**：四条旧通知改写为看得懂并带订单号；新增「客户提交了充值」与「客户卡住了，没人在处理」（服务器侧，排队超 3 分钟即推，覆盖 Mac 睡眠/浏览器关闭/断网）。
3. ~~客户充值页改造~~ **已上线（2026-09-12 04:55 UTC，release `20260912-customer-page-624487c`）**。
   候光七屏全部实现并经 Lemon 逐项拍板；发布前审查查出并修掉一个致命问题——九阶段取证据的 SQL
   引用了不存在的列，生产上必然失效而测试全绿（D-184）。发布后已独立复验：`stage` 字段对真实
   成功单正常返回，卡密校验接口 200 且限流生效，后台未受影响。
   - 演示（给 Lemon 看的那份）：`https://claude.ai/code/artifact/4683407a-cb2f-49e7-a846-0e1e980b7bf7`
   - **发布前必跑** `v1/scripts/customer-sql-probe.sh`（已写进 RUNBOOK 第 5 节）。

5. 与 Lemon 沟通业务场景后，评估四套系统各自要怎么调：运营管理后台 / 客户充值系统 / Browser 充值链路 / API 充值链路。客户充值页面优化与巡检单并入此轮。
6. 待办（不阻塞）：Dqcn 单取消续费；本机会话记录里出现过 `DATABASE_URL`（含密码），建议经 Lemon 确认后轮换；**切到 API 充值链路前先跑一单真实的验九阶段**（见 `docs/design/README.md` 待办，九阶段第 4/5 步在 API 链路下会跳过，跳过本身是对的，但没有真实单验证过）。

## 已定不做

- **不实施任何绕过或自动完成人机验证的方案**（D-153/D-154），不做设备身份轮换（D-165）。此条不因重复要求而改变。
- 成单后自动登出客户账号：Lemon 决定暂不做（D-165）。
- Pro 5X/20X 全部搁置（D-146）；不买住宅出口（D-142）；不调研商用/分销/礼品码渠道（D-154）；不做大而全（D-147）。
- 卡段拒付标注中，尝试次数 < 3 只标「样本少」，不下结论（D-169）。

## 跑一单（Lemon 可自助，无需大脑在场）

```bash
browser-mvp/scripts/prod-query.sh "SELECT public_no,status FROM orders WHERE public_no='<单号>'"   # 等到 CARD_READY
BROWSER_POOL_LANES=lane-1=10f0dc7b534844c083165796447d5893 bash browser-mvp/scripts/go-live.sh --arm
tail -f "$HOME/Library/Application Support/pojia-browser-live/go-live-"*.log
bash browser-mvp/scripts/stop-live.sh     # 看到终态、且距离点付款超过 10 分钟后
browser-mvp/scripts/run-stats.sh          # 随时看累计成功率
```
日志出现 `需要人工验证` → 去 Pilot 窗口勾选，自动化自行继续。**监控命令不要包含 `production-live-pool-worker` 字样**，会被 `pgrep -f` 自匹配成"残留 worker"。

## 收尾自检（说"做完了"之前必须跑）

```bash
scripts/wrapup-check.sh                      # 工作区/推送/现场一致/接班一屏是否过期
browser-mvp/scripts/contract-probe.mjs       # 卡台字段契约（改动涉及卡台时跑）
```

## 暂停 / 恢复

```text
暂停原因：无。D-187、D-188 均已发布并生效（当前 release `20260912-failed-retry-03b926c`）。
允许继续：只读核对；browser-mvp/v1 代码与测试；文档落盘；发布
禁止操作：不实施人机验证绕过；开卡/补余额/换卡/提现等资金动作仍需 Lemon 当次确认
恢复第一步：读本文 → 读 D-172（惯犯错误与硬规则）→ `state-check.sh` 比对现场 → `run-stats.sh` 看真实成功率
下一步：**先定免费试用 offer 的业务口径**（D-190 第五节），它决定客户页和执行器要不要改。
        之后才是路线图第一段——用好卡段 `53211304` 量真实成功率；注意今天四单都没走到付款，
        成功率分母没有增加。验证付费链路要用**没有免费试用资格**的账号，干净新号多半不行。
        合格卡当前 1 张、余额 $39.24，约够 2 单；补货认准 `53211304`，避开 `51398996`。
```
