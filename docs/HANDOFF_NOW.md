# 接班一屏（HANDOFF_NOW）

更新：2026-09-11 09:30 UTC。写者：大脑窗口（Claude Opus 5）。**本文只由大脑窗口写。**

## 分工（Lemon 2026-09-11 定）

- **大脑**：本窗口。全项目理解、排序、验收、四份事实源（本文、CURRENT_STATE、DECISIONS、PROJECT_MAP）、全部生产动作与浏览器侧实施。
- **Codex 已退出**（D-152）。`BRAIN_TO_CODEX.md` 停更；其已合并的阶段 1（`2aad60d`）保留，未开始的阶段 2 作废。
- **短命窗口**：按需开，worktree 隔离；只派边界明确、验收可机器检查的任务。
- 任务书只写目标/验收/边界，不写实现路径（D-151）。

## 现在状态（已验证，UTC）

- release **`20260911-cdk-return-fix-bfacbe1`**（回滚 `20260911-preflight-noupgrade-0396bb8`）；web/worker/快照同步 timer 均 active；`pojia-worker` 本日已重启两次（发布不自动重启它，改 worker 侧代码需手动重启）。
- 付款开关 **false**；本机无 worker；非终态订单 0；可用 CDK 12；合格卡 1 张（9839，$50）；出口 38.60.246.34、隧道、BitBrowser API 正常。
- **真单 `PJV1-9TN0gGX-I5rRdhXxLrq7` 已收口**（CLOSED / HUMAN_VERIFIED_NOT_CHARGED，卡与 CDK 均已退回）。结论：预检改造有效（不建 Checkout、一次过）、sentinel 未拦、结账页与零税报价正常、付款点击一次后**被 hCaptcha 拦住**，未扣款。证据见 HANDOFF_LOG 2026-09-11 07:5x/08:0x 两节。
- 已实现未在真单验证：**半自动人机验证接力**（D-155，browser-mvp 本机代码，不经服务器发布）。`BROWSER_HUMAN_VERIFICATION_WAIT_MS` 默认 300000，pool 脚本已带。
- 已修复并发布：**F-48**（人工核实未扣款后 CDK 必须退回，D-156）。

## 下一可执行项

1. **第二单（等 Lemon 提交）**：账号 B（从未入过项目的 free 号），其余条件全不变。目的：验证 hCaptcha 是否每次都弹，以及人勾选后自动化能否跑完付款→确认 Plus→取消续费。流程见下节。
2. Dqcn 单取消续费（库存 Session 仍有效，大脑可用同款函数执行后用「已在账号里取消续费」收口）。
3. 事故待办：本机会话记录里出现过 `DATABASE_URL`（含 pojia_app 密码）；建议轮换，需 Lemon 确认后由大脑执行并重启服务。
4. 真单跑通后的集中整治（D-144）：UX 巡检单、F-37/F-41/F-43/F-47、state-check NULL、highvcc 资格新鲜度、F-38 走后台 API 等。

## 真单执行序列（2026-09-11 10:21 UTC 起；D-158 无预检，D-160 大脑不代操作）

1. 收到单号 → `browser-mvp/scripts/prod-query.sh "SELECT public_no,status FROM orders WHERE public_no='<单号>'"`，等到 CARD_READY。
2. **不清窗口、不关标签、不手工校验 Session**——系统自己处理（D-160）。
3. 直接开：`BROWSER_POOL_LANES=lane-1=10f0dc7b534844c083165796447d5893 bash browser-mvp/scripts/go-live.sh --arm`（D-159：提交即授权，不再逐次询问；**开关开启后立即向 Lemon 汇报**）。
   - 自检若报「有残留 worker」，先确认是不是自己的监控命令行含该进程名被 `pgrep -f` 自匹配（真实 worker 用 `pgrep -f 'node src/production-live'` 数）。**监控命令不要包含该进程名。**
4. 只读观察 `go-live-*.log` 与 `browser_runs`/`browser_run_events`，逐步记入 `docs/E2E_CHAIN_TEST_SAMPLE.md`。
5. 日志出现 `需要人工验证` 时**立刻在对话里叫 Lemon 去勾选**（本机同时弹通知）；他勾完自动化自行继续，大脑不介入页面。
6. 终态后 `bash browser-mvp/scripts/stop-live.sh`。**付款点击后 10 分钟内不得停 worker。**
7. 失败收口按 RUNBOOK §2 前「测试账号单失败后的收口」；付款未知用 `v1/scripts/resolve-unknown-payment.mjs`（先 --dry-run）。

## 已定不做

- 成单后自动登出客户账号：Lemon 决定暂不做（D-165）；缺口已核实并记录，未来重开此事从 D-165 读起。

- **不实施任何绕过/自动完成人机验证的方案**（D-153/D-154），包括打码服务与降低风控评分的指纹伪装。此条不因重复要求而改变。
- Pro 5X/20X 全部搁置（D-146）；不买住宅出口（D-142）；不调研商用/分销/礼品码渠道（D-154，Lemon 指示）；不做大而全（D-147）。

## 暂停 / 恢复

```text
暂停原因：无（按 D-167 顺序推进：①卡段标注 ②常驻无人值守 ③人工介入推送 ④业务场景对齐评审）（2026-09-11 12:48 UTC）
允许继续：只读核对；browser-mvp/v1 代码与测试；rehearsal 模式；文档落盘
禁止操作：未经 Lemon 当次确认不 go-live --arm、不消耗真实账号
恢复第一步：读本文 → state-check.sh 比对现场 → 读 HANDOFF_LOG 最后三节看真单原始证据
```
