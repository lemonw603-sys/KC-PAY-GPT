# 接班一屏（HANDOFF_NOW）

更新：2026-09-25 16:2x（UTC+8）＝ 08:2x UTC。执行顺序以 **D-352** 为准，「可离开」第一条以 **D-366** 为准；本窗口 D-376。

## 现在的状态（08:15 UTC 现查；明细见 CURRENT_STATE.md，`state-check.sh` 一致）

- 生产 release **`20260924-block7-batch2-0d06f41`**，迁移最新 061。默认路线 BROWSER，Browser Plus 用 highvcc 卡。可分配 Plus 卡 1 张（8718，正式资格 SQL）；非终态订单 1（WAITING_FOR_SESSION，无卡）。
- 本机常驻池 **PID 91075**（supervisor 61962），cwd = main 工作区 `browser-mvp`＝**不含块 6**；付款开关 true、下单心跳检查 true。
- **highvcc token 已恢复**：Lemon 07:25:58 UTC 重贴，08:15:24 UTC 同步 `tokenAlert: RESOLVED`，告警已关。注意：贴 token 不会马上关告警，要等下一轮每小时同步（D-376 第 5 条）。
- HNSKJ 供卡故障仍在（卡台维护，D-363；水位 0）。路线 305（5x）/306（20x）关着。

## 块 6 = Pro 5x（D-370～D-375）——代码完成，差一次演练

- 分支 **`block6-pro5x`（`b3f1d37`，已推送，未合 main、未发布）**，工作树 `.claude/worktrees/block6-pro5x`（node_modules 是软链，别提交）。
- **下一步＝Plus 回归演练（D-254）**，Lemon 想做时会先说。流程：正式路径关付款开关（`admin-operations-service.setBrowserPaymentWrites`，不用 `stop-live.sh`）→ SIGTERM 常驻池 worker → `set-intake-executor-check.mjs off --apply` → Lemon 在客户页用 Lane 3 号（比特窗口 `8f126430…`）建 Plus 单 → `run-browser-preflight.sh once` → **从分支目录**跑 `run-live-rehearsal.sh once <id>` → `close-rehearsal-order.mjs` 收口 → 心跳检查 on → 付款开关 on。等待循环的命令行别含 `production-live-pool-worker`（D-373）。
- 演练过后逐项问：合 main → 服务器发布 → **常驻池切到固定版本目录**（与这次重启合并，步骤见 `tasks/2026-09-25-pool-pinned-release.md`）→ 重开路线 305。重开前要定 5x 卡从哪来（两台 pro_5x 水位 0、Lemon 定过先不开卡；欠账 1、2，调度器会不会替等卡单自动开尚未核实）。

## 本窗口做完的（D-376）

- `state-check.sh` 补 token 告警 / 每卡上限 / bark release / worker 写开关 / 本机池 PID 与 cwd；脚本不查、超过 7 天的行列 `[陈旧]`；结尾写明覆盖范围。wrapup-check 接提醒。事实表逐行对现场重写。
- PROJECT_MAP 压一页（统一「块」编号）。
- `scripts/pool-release.sh`（prepare / verify / switch / status）在临时目录验过；**在跑的池与 LaunchAgent 都没动**。
- 旧工作区只读盘点：清单在 D-376 第 4 条，**清理等 Lemon 批**。

## 等 Lemon 的

1. 块 6 Plus 回归演练：他说开始才做。
2. 池固定目录：目录放 `~/pojia-pool`、切换那次改 LaunchAgent——都未确认。
3. 旧工作区：5 个可安全删（2 个先搬发布包）；4 处有未合提交、c566 有约 66M 未提交内容，要他定存档还是放弃。
4. 贴 token 后是否让系统立刻验一次并关告警（v1 小改动，未做）。

## 已定 / 禁区

- 付款前三件不改（D-254）；browser-mvp 改动走白名单 + 全量测试 + 演练；常驻池重启、发布、开关、LaunchAgent 先问。
- Plus 不加结账页套餐核对（D-375）。KC-PAY-GPT 已封存（D-372）。
- 回复 Lemon：开头给定位、话要短、大白话，结尾一节「要你决定的」列全。

## 未验证边界

- 当前 release 真实付款、取消续费、付款不明恢复、Browser 崩溃补核均无真单样本。
- 7 次 `CHECKOUT_NAVIGATION_FAILED`（09-08～09-14）原因查不回来（D-375 起分支代码会存）。
- 暂停期间 `EXECUTOR_OFFLINE` 告警未推送的原因未查。事实表「已知未修」行是 09-10 旧清单，未逐项复核。
- FB-04：1657 / 3159 / 7402 三张 highvcc 卡 Lemon 尚未销卡（不急）。

## 每块收尾

跑 `scripts/wrapup-check.sh`；向 Lemon 交「我理解的决定」清单；重写本文件。
