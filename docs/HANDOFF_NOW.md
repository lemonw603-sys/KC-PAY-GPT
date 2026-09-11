# 接班一屏（HANDOFF_NOW）

更新：2026-09-11 15:18 UTC。写者：大脑窗口。**本文只由大脑窗口写，且每次重要事实变化后整篇复核，不止改暂停原因那一行。**

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

- 生产 release **`20260911-sync-skip-msg-56c5290`**；web / worker / 快照同步 timer 均 active；迁移到 `052_cards_bin`。
- 付款开关 **false**；本机无 worker；非终态订单 0；合格卡 **1 张（3118，$39.24，卡段 53211304）**；可用 CDK 11。
- 本机依赖正常：菲律宾出口 38.60.246.34、SSH 隧道 13306、BitBrowser Local API、窗口 `Plus Browser PH Pilot`（`10f0dc7b…`）。
- **真实成功率 1/7**（点过付款的运行里系统自动跑完的比例）。随时用 `browser-mvp/scripts/run-stats.sh` 查，无需任何人事先登记。
- 客户账号（mengx612）仍登在 Pilot 窗口——Lemon 决定暂不自动登出（D-165）。

## 今日已上线的改动（按发布顺序）

`resolve-unknown-ui-3d4936d` B1 收口按钮三 bug → `preflight-noupgrade-0396bb8` 预检不点 Upgrade → `cdk-return-fix-bfacbe1` F-48 未扣款退 CDK → `drop-preflight-24bcbde` 取消独立预检、账号检查并入正式流程 → `card-bin-c65727f` 卡段标注（迁移 052）→ `segment-hint-269ba10` 列表加载失败明说 → `sync-throttle-4350210` 卡台降频、默认卡段留空 → `sync-lastfour-11dbf3c` 字段名修正 → `sync-skip-msg-56c5290` 跳过时明说。
browser-mvp 本机代码（不经服务器发布）：人机验证识别与接力（D-155）、结账页无邮箱字段不中止（D-157）、付款后读结账页识别拒付（D-161）。

## 下一可执行项（顺序由 D-167 定）

1. **执行器常驻无人值守**（进行中）：做成后台服务，**付款开关常开**，客户任意时间兑换即自动处理。Lemon 已同意这一资金策略变更。
2. ~~需要人工时推送到手机~~ **已完成（D-175）**：四条旧通知改写为看得懂并带订单号；新增「客户提交了充值」与「客户卡住了，没人在处理」（服务器侧，排队超 3 分钟即推，覆盖 Mac 睡眠/浏览器关闭/断网）。
3. 与 Lemon 沟通业务场景后，评估四套系统各自要怎么调：运营管理后台 / 客户充值系统 / Browser 充值链路 / API 充值链路。客户充值页面优化与巡检单并入此轮。
4. 待办（不阻塞）：Dqcn 单取消续费；本机会话记录里出现过 `DATABASE_URL`（含密码），建议经 Lemon 确认后轮换。

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
暂停原因：无。按 D-167 顺序推进第 2 项（执行器常驻无人值守）（2026-09-11 14:41 UTC）
允许继续：只读核对；browser-mvp/v1 代码与测试；文档落盘；发布
禁止操作：不实施人机验证绕过；开卡/补余额/换卡/提现等资金动作仍需 Lemon 当次确认
恢复第一步：读本文 → 读 D-172（惯犯错误与硬规则）→ `state-check.sh` 比对现场 → `run-stats.sh` 看真实成功率
```
