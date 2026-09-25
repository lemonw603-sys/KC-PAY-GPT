# 接班一屏（HANDOFF_NOW）

更新：2026-09-25 15:3x（UTC+8）＝ 07:3x UTC。执行顺序以 **D-352** 为准，「可离开」第一条以 **D-366** 为准。本窗口（acd69d1e）收尾写；Lemon 将开新窗口继续。

## 现在的状态（07:29 UTC 现查；证据与明细见 CURRENT_STATE.md，`state-check.sh` 一致）

- 生产 release **`20260924-block7-batch2-0d06f41`**，迁移最新 061。默认路线 BROWSER，Browser Plus 用 highvcc 卡。可分配 Plus 卡 1 张（正式资格 SQL）；非终态订单 1（WAITING_FOR_SESSION，无卡）。
- 本机常驻池 **PID 91075**（09-25 01:36 UTC 起，PAY/lane-1，跑 main 目录代码＝**不含块 6**）；付款开关 true、下单心跳检查 true、心跳新鲜。
- **⚠ highvcc（备用卡台 A）token 已失效**：告警 `PROVIDER_TOKEN_EXPIRED` OPEN（incident v2，最近更新 09-25 00:14 UTC），告警原文「同步、开卡、付款后的卡台侧核对都停了……请重新贴一次 token」。**要 Lemon 贴新 token**（登录有滑块，系统换不了，D-249）。不贴的话，第一张真实 Plus 单付款后的卡台侧对账会进不来。
- HNSKJ 供卡故障仍在（卡台自身维护，Lemon 告知；HNSKJ Plus 水位 0，D-363）。
- 路线 305（5x）/306（20x）仍关（`accepts_new_orders=0`，09-17 起）。

## 块 6 = Pro 5x（D-370～D-375）——代码完成，差一次演练

- 代码在分支 **`block6-pro5x`（`b3f1d37`，已推送，未合 main、未发布）**，工作树 `.claude/worktrees/block6-pro5x`（node_modules 是软链，别提交）。browser-mvp 全量 312/0、v1 1027/0，每处改动都做过变异验证。
- 内容：5x 与 Plus 同型（付款 → 确认 Pro → 取消续费）；按套餐核对扣款金额；Pro 须亲手选档或结账页上选中档位对得上才付（D-372/373）；导航开头等待修复（D-374）；导航失败记清洗过的原因（D-375，含 `executor.js`，经 Lemon 同意）。
- 未验证：5x 免税后零税（不填卡时页面没有地址栏，D-372）与 5x 付款后账号套餐串——都等第一张 5x 客户单（Lemon：不开卡）。
- **下一步＝Plus 回归演练（D-254 要求）**：Lemon 想做时会先说。流程：正式路径关付款开关（`admin-operations-service.setBrowserPaymentWrites`，不用 `stop-live.sh`——它用只读工具写库）→ SIGTERM 常驻池 → `set-intake-executor-check.mjs off --apply` → Lemon 在客户页用 Lane 3 号（比特窗口 `8f126430…`）建 Plus 单 → `run-browser-preflight.sh once` → **从分支目录**跑 `run-live-rehearsal.sh once <id>` → `close-rehearsal-order.mjs` 收口 → 心跳检查 on → 付款开关 on（supervisor 自动拉池）。注意：等待循环的命令行别含 `production-live-pool-worker` 字样（会被 ready-check 的 `pgrep -f` 当成残留 worker，D-373）。
- 演练过后逐项问 Lemon：合 main → 发布/重启常驻池 → 重开路线 305。

## 其他下一可执行项

1. **「可离开」第一条（D-366）**：等第一张真实客户 Plus 单（Bark 推送 → Lemon 开窗口 → 按 RUNBOOK §1 盯、对照 `contracts/2026-09-18_delivery-criteria-contract.md`），此后数连续 10 单无人介入。**先让 Lemon 贴 highvcc token。**
2. 块 7 删表已完成（D-367）；剩 `checkout_artifacts` / `browser_artifact_secrets` 并入块 6 之后的清理。

## 已定 / 禁区

- KC-PAY-GPT 独立文件夹已封存（D-372，`~/code/PROJECTS.md` 登记；该文件有别人未提交的改动，我的条目也未提交）。
- Plus 不加结账页套餐核对（Lemon 定，D-375）。
- 付款前三件不改（D-254）；browser-mvp 改动走任务书白名单；常驻池重启、发布、开关先问。
- 回复 Lemon：开头给定位、话要短、大白话，结尾一节「要你决定的」列全。

## 未验证边界

- 当前 release 真实付款、取消续费、付款不明恢复、Browser 崩溃补核均无真单样本。
- 生产 7 次 `CHECKOUT_NAVIGATION_FAILED`（09-08～09-14）原因查不回来（当时不存原文；D-375 起分支代码会存）。
- 暂停期间（09-24 17:45～09-25 01:36 UTC）`EXECUTOR_OFFLINE` 告警开着但 `alert_notifications` 0 行，未推送原因未查。
- FB-04：1657 / 3159 / 7402 三张 highvcc 卡 Lemon 尚未销卡（不急）。

## 每块收尾

跑 `scripts/wrapup-check.sh`；向 Lemon 交「我理解的决定」清单；重写本文件。
