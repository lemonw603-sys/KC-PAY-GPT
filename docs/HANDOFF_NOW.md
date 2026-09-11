# 接班一屏（HANDOFF_NOW）

更新：2026-09-11 00:04 UTC（本地 UTC+8 为同日上午）。写者：大脑窗口（Claude Fable 5.1）。**本文只由大脑窗口写。**

## 分工（2026-09-11 Lemon 定）

- **大脑**：本窗口。全项目理解、排序、任务书、验收、四份事实源（本文、CURRENT_STATE、DECISIONS、PROJECT_MAP）、所有生产动作。
- **Browser 侧**：Codex 已退出（D-152，Lemon 2026-09-11）；大脑直接实施与操作。Codex 分支 `codex/browser-live-20260911` 已合并部分保留，`BRAIN_TO_CODEX.md` 停更。
- **短命窗口**：按需开，worktree 隔离，做完即关。只派边界明确、验收可机器检查、不需全项目上下文的任务。
- 09-11 早上并行的 Sonnet 接班窗口已按 Lemon 要求关闭。其提交 `d76d193`、`9cad431`、`1675b3a` 保留；发现 F-42 到 F-46 待大脑逐条核；其自写处置违反 REVIEW_PROTOCOL 角色分离，处置由大脑重做。

## 现在状态（已验证，UTC）

- 付款开关 false（09-10 22:47 关）；本机无 worker；release **`20260911-resolve-unknown-ui-3d4936d`**（2026-09-11 03:40 UTC 切换，live/ready 200，回滚点 cdcf42e）。
- 订单 `PJV1-DqcnqHF0tPlxDhygTtAA` **已于 2026-09-11 02:38 UTC 人工履约收口 → RECHARGE_SUCCESS**（Lemon 系统外手工充值），7402 已释放并按卡台刷成 $1.08。待 Lemon 点「已在账号里取消续费」。可分配卡 0；`state-check.sh` 在 0 张时误报 1 张（GROUP_CONCAT 空集返回 NULL 被 awk 数成一项），脚本未修。
- **F-42 已由大脑独立核对代码为真**：`BROWSER_SESSION_PROVIDER=EXTENSION` 未接预检，昨天第 5 次"扩展对照"实际仍走 cookie。上号器路径在自动化里从未真正跑过；交接文档相应结论作废。
- **备用卡台快照自动同步已落地并首跑（2026-09-11 02:55 UTC）**：`v1/src/services/highvcc-snapshot-sync-service.js` + `v1/scripts/sync-highvcc-snapshot.mjs`（默认 preview 只读，`--commit` 才写；走 manual-card-import 正式路径；本机跑法=照 `run-live-pool.sh` 拉生产 runtime.env 走隧道）。首跑批次 `211a4ad6`：9839/9354 入库，7402 刷成 $1.08，9 张与卡台一致。可分配卡现为 9839（$50）。**timer 已装并启用（`pojia-highvcc-snapshot-sync.timer`，每 10 分钟；2026-09-11 03:40 UTC）**，首跑批次 `23584a48`；03:49 UTC 定时触发已核实数据未变即重放不写（批次表仍 2 条）；`browser-mvp/scripts/highvcc-card.mjs export` 把分当元写余额的 bug 未修（Codex 地界，已记）。资格 SQL 信任 MANUAL_IMPORT 静态余额的根因未改，同步是补偿手段。

## 下一可执行项

- 大脑：B1 已发布。**Lemon 2026-09-11 04:58 UTC 二次收缩方向（D-146/147）**：Pro 搁置、只做 Plus、不做重；PROJECT_MAP §5 已按此重写。**D-152（2026-09-11 06:31 UTC）Codex 退出，大脑接手：A2 预检改造代码已完成（browser-mvp 238/229 绿、v1 目标 32/32 绿），v1 全套 656/595/0/61 绿；**已发布 `20260911-preflight-noupgrade-0396bb8`，独立核实通过**；接着做 A3 真实订单演练，模式等 Lemon 选。**
- 事故待办：大脑窗口一条 ssh 命令把 `DATABASE_URL`（含 pojia_app 密码）打印进本机会话记录（D-152）；真单结束后经 Lemon 确认轮换密码。

## 已定不做

- 半自动不是目标（Lemon 2026-09-11）；D-138/139/140 不重开；**Pro 5X/20X 全部搁置（D-146）**；**精简原则（D-147）：主线只有 Browser 通；F-43 已移出（D-148），其余真单后按需**。

## 暂停 / 恢复

```text
暂停原因：模式 2 已选；排查完成（见 HANDOFF_LOG 2026-09-11 06:58 UTC）；等 Lemon 提交账号 A 订单并发单号
允许继续：只读核对；browser-mvp/v1 代码与测试；rehearsal 模式；发布 A2
禁止操作：未经 Lemon 当次确认不 go-live --arm、不消耗真实账号；快照同步可随时跑（Lemon 09-11 授权自动化），仍先 preview 再 --commit
恢复第一步：读本文 → 读 BRAIN_UNDERSTANDING §5 看 Lemon 确认了哪些 → 读 CODEX_PROGRESS.md 看有无 [需要大脑]
```

## 真单执行序列（2026-09-11 07:15 UTC 写定；换模型/换窗口接手可直接照做，每步一条命令，本机在仓库根目录）

前提已满足：release `0396bb8` 在线、pojia-worker 已重启、开关 accept/dispatch=true、payment=false、合格卡 9839、Pilot 窗口已关闭、三条路径 check READY。模式 2（直接真付，Lemon 选定）。账号 A 由 Lemon 像客户一样提交 CDK+Session。

1. 收到单号 → 只读确认到卡已备好：`browser-mvp/scripts/prod-query.sh "SELECT public_no,status,assigned_card_id IS NOT NULL card FROM orders WHERE public_no='<单号>'"`（期望 CARD_READY、card=1；未到则等服务器 worker，最多几分钟）。
2. 清 Pilot 登录态（保留设备/CF cookie）：`cd browser-mvp && BITBROWSER_PROFILE_ID=10f0dc7b534844c083165796447d5893 node scripts/clear-lane-session.mjs && cd ..`
3. 预检一次（不点 Upgrade）：`BITBROWSER_PROFILE_ID=10f0dc7b534844c083165796447d5893 bash browser-mvp/scripts/run-browser-preflight.sh once`；核实：`prod-query.sh "SELECT status,attempts,last_error_code,JSON_EXTRACT(payload_json,'$.outcome') FROM tasks WHERE task_type='BROWSER_PREFLIGHT' AND order_id=(SELECT id FROM orders WHERE public_no='<单号>')"` 期望 COMPLETED/PASSED。失败 → 停，按 RUNBOOK §1 末"预检 DEAD"收口（后台取消），不重试。
4. **向 Lemon 当次确认"开付款开关"**，得到肯定后：`BROWSER_POOL_LANES=lane-1=10f0dc7b534844c083165796447d5893 bash browser-mvp/scripts/go-live.sh --arm`
5. 观察：`tail -f "$HOME/Library/Application Support/pojia-browser-live/go-live-"*.log`；库：`prod-query.sh "SELECT status,payment_state,post_payment_state,last_error_code FROM browser_runs ORDER BY created_at DESC LIMIT 1"`、`"SELECT status,failure_code,subscription_cancelled,cancellation_review_required FROM orders WHERE public_no='<单号>'"`。
6. 终态（RECHARGE_SUCCESS / RECHARGE_FAILED / SUBMIT_UNKNOWN）→ 等 worker 自行收尾 → `bash browser-mvp/scripts/stop-live.sh`（核实开关回 false）。付款点击之后 10 分钟内不得 stop/kill（RUNBOOK §1 ③）。
7. 失败收口按 RUNBOOK §1 末"测试账号单失败后的收口"三条路径；成功则核对取消续费字段，需复核时由大脑用 Dqcn 同法处理。
8. 事后：CURRENT_STATE（最近真实单、卡、release 行）、HANDOFF_LOG 记录原始观察；Dqcn 取消续费；密码轮换（Lemon 确认后）。

