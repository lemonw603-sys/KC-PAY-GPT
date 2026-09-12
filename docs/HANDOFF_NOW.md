# 接班一屏（HANDOFF_NOW）

更新：2026-09-12 13:15 UTC。写者：大脑窗口。**本文只由大脑窗口写，且每次重要事实变化后整篇复核，不止改暂停原因那一行。**

## 分工

- **大脑**：本窗口。全项目理解、排序、验收、四份事实源（本文、CURRENT_STATE、DECISIONS、PROJECT_MAP）、生产动作与浏览器侧实施。
- **Codex 已退出**（D-152）。其阶段 1 已合并保留，`BRAIN_TO_CODEX.md` 停更。
- 任务书只写目标/验收/边界，不写实现路径（D-151）。大脑不替系统操作页面（D-160）。
- **大脑的三类惯犯错误与硬规则见 D-172，接班先读。**

## 里程碑

**2026-09-11 11:15:15 UTC 全链路首次跑通**：订单 `PJV1-ztS9FZ3QcwHopTmZRfDY` 从客户提交到自动取消续费全自动完成。
固化于 git 标签 `e2e-first-success-20260911`（打在代码 `a544c6b`，标签正文写明可复现的全部运行版本）。
逐步证据与前三次失败记录：`docs/E2E_CHAIN_TEST_SAMPLE.md`。

## 现在状态（2026-09-11 14:41 UTC 当场核实）

- 生产 release **`20260912-customer-page-624487c`**（候光客户页已上线，2026-09-12 12:55 UTC）；web / worker / 快照同步 timer 均 active；迁移仍在 `052_cards_bin`（本次无新迁移）。
- 付款开关 **false**；本机无 worker；非终态订单 0；合格卡 **1 张（3118，$39.24，卡段 53211304）**；可用 CDK 11。
- 本机依赖正常：菲律宾出口 38.60.246.34、SSH 隧道 13306、BitBrowser Local API、窗口 `Plus Browser PH Pilot`（`10f0dc7b…`）。
- **常驻执行器已装**（2026-09-12 13:15 UTC）：LaunchAgent `com.pojia.browser-pool`，开机自启、崩溃自愈（强杀后 30 秒内被 launchd 拉回，实测）。付款开关关着时它只写一行日志然后安静等待，不会拉起 worker。日志 `~/Library/Application Support/pojia-browser-live/supervisor.log`。
  停用：`launchctl unload -w ~/Library/LaunchAgents/com.pojia.browser-pool.plist`。
  **装的时候踩到一个坑**：launchd 默认 PATH 取不到 Homebrew 的 mysql，日志会写「付款开关为 取不到」而不是 false，那样开了开关它也永远不动。plist 已加 `EnvironmentVariables/PATH`。**以后在别的机器上装，装完第一件事是看这行日志。**
- **真实成功率 1/7**（点过付款的运行里系统自动跑完的比例）。随时用 `browser-mvp/scripts/run-stats.sh` 查，无需任何人事先登记。
- 客户账号（mengx612）仍登在 Pilot 窗口——Lemon 决定暂不自动登出（D-165）。

## 今日已上线的改动（按发布顺序）

`resolve-unknown-ui-3d4936d` B1 收口按钮三 bug → `preflight-noupgrade-0396bb8` 预检不点 Upgrade → `cdk-return-fix-bfacbe1` F-48 未扣款退 CDK → `drop-preflight-24bcbde` 取消独立预检、账号检查并入正式流程 → `card-bin-c65727f` 卡段标注（迁移 052）→ `segment-hint-269ba10` 列表加载失败明说 → `sync-throttle-4350210` 卡台降频、默认卡段留空 → `sync-lastfour-11dbf3c` 字段名修正 → `sync-skip-msg-56c5290` 跳过时明说 → `alerts-342ad5f` 通知改造 → `alert-noise-d924563` 中间态不响手机 → `card-stock-alert-69946b0` 缺卡提醒（timer `pojia-operator-watch`，每分钟巡视排队/付款未落定/缺卡）。
browser-mvp 本机代码（不经服务器发布）：人机验证识别与接力（D-155）、结账页无邮箱字段不中止（D-157）、付款后读结账页识别拒付（D-161）。

## 下一可执行项（顺序由 D-167 定）

1. **执行器常驻无人值守**（**常驻已装好，只差开付款开关**）：LaunchAgent 已安装并验证（见上）。
   剩下的一步是把 `browser_payment_writes_enabled` 打开，**这一步要 Lemon 本人在后台点**——
   正式路径是后台接口 `POST /api/v1/admin/operations/browser-payment`，带登录态守卫，
   而 AI 不输入密码做认证。位置：后台首页「浏览器真实付款」那一项，点击会弹确认框
   「开启后浏览器会真实点击付款并扣卡上的钱」。开启后 60 秒内 supervisor 会自动拉起 worker。
2. ~~需要人工时推送到手机~~ **已完成（D-175）**：四条旧通知改写为看得懂并带订单号；新增「客户提交了充值」与「客户卡住了，没人在处理」（服务器侧，排队超 3 分钟即推，覆盖 Mac 睡眠/浏览器关闭/断网）。
3. ~~客户充值页改造~~ **已上线（2026-09-12 12:55 UTC，release `20260912-customer-page-624487c`）**。
   候光七屏全部实现并经 Lemon 逐项拍板；发布前审查查出并修掉一个致命问题——九阶段取证据的 SQL
   引用了不存在的列，生产上必然失效而测试全绿（D-184）。发布后已独立复验：`stage` 字段对真实
   成功单正常返回，卡密校验接口 200 且限流生效，后台未受影响。
   - 演示（给 Lemon 看的那份）：`https://claude.ai/code/artifact/4683407a-cb2f-49e7-a846-0e1e980b7bf7`
   - **发布前必跑** `v1/scripts/customer-sql-probe.sh`（已写进 RUNBOOK 第 5 节）。

4. 与 Lemon 沟通业务场景后，评估四套系统各自要怎么调：运营管理后台 / 客户充值系统 / Browser 充值链路 / API 充值链路。客户充值页面优化与巡检单并入此轮。
4. 待办（不阻塞）：Dqcn 单取消续费；本机会话记录里出现过 `DATABASE_URL`（含密码），建议经 Lemon 确认后轮换；**切到 API 充值链路前先跑一单真实的验九阶段**（见 `docs/design/README.md` 待办，九阶段第 4/5 步在 API 链路下会跳过，跳过本身是对的，但没有真实单验证过）。

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
暂停原因：无。客户页已上线，按 D-167 顺序推进第 1 项（执行器常驻无人值守）（2026-09-12 12:55 UTC）
允许继续：只读核对；browser-mvp/v1 代码与测试；文档落盘；发布
禁止操作：不实施人机验证绕过；开卡/补余额/换卡/提现等资金动作仍需 Lemon 当次确认
恢复第一步：读本文 → 读 D-172（惯犯错误与硬规则）→ `state-check.sh` 比对现场 → `run-stats.sh` 看真实成功率
下一步：D-167 第 1 项——执行器常驻无人值守（装 LaunchAgent 并常开付款开关，Lemon 已同意这一资金策略变更）
```
