# 接班一屏（HANDOFF_NOW）

更新：2026-09-26 03:4x（UTC+8）＝ 09-25 19:4x UTC。执行顺序以 **D-352** 为准，「可离开」第一条以 **D-366** 为准；本窗口 D-376～D-388。

## P0 已止血（D-387）

常驻池付款后核实窗口已由 LaunchAgent 环境变量设为 300000（池 85147 实测），真付款单不再会在填卡前报错。代码层修（池配置上限与核实器对齐、启动校验、`run-live-pool.sh` 默认值、跨模块测试）在批 B。

## 现在的状态（17:46 UTC 现查；明细见 CURRENT_STATE.md，`state-check.sh` 一致）

- 生产 release **`20260925-customer-batchA-ac6e857`**（`ac6e8578`，客户页批 A，D-388；无新迁移）。回滚点 `20260925-block6-pro5x-f748bb6`（无迁移，直接回滚）。
- **本机常驻池跑固定版本目录**：PID 52721（supervisor 52141），cwd `~/pojia-pool/releases/20260925-block6-pro5x-f748bb6/browser-mvp`，与服务器同一提交；LaunchAgent 指向 `~/pojia-pool/current`。main 工作区改动不再影响常驻池。换代码 / 回滚步骤见 RUNBOOK §5「本机常驻池换代码」。
- 付款开关 true、下单查付款池 true、心跳新鲜。默认路线 BROWSER（Plus 用 highvcc 卡），可分配 Plus 卡 1 张（8718）；非终态订单 1（旧 WAITING_FOR_SESSION，无卡）。highvcc token 有效。HNSKJ 供卡故障仍在。hnskj Plus 水位 1（Lemon 18:02 UTC **有意**改的）：维护一结束调度器会自动开一张 $50 卡。**路线 305/306 仍关**。

## 这一轮做完的（D-376～D-383）

- 接班机制：state-check 补 6 类检查 + 陈旧行提醒；事实表逐行对现场；PROJECT_MAP 压一页；旧工作区存档后清理。
- 贴 token 当场验证（已上线）：贴完即用新 token 查钱包，认了就关失效告警。
- 块 6 Pro 5x + 等灰按钮 + **导航失败证据包**（本机 `~/Library/Application Support/pojia-browser-live/evidence/`，完整 trace，D-380 不限制存什么、卡号/CVV 结构性排除）——Plus 回归演练通过（D-382，₱982.14 / 税 0）后已发布。
- 常驻池切固定目录（D-383）；演练脚本默认租约 900 秒。

## 下一可执行项

1. **等首张真实客户 Plus 单**（可离开第一条，D-366）：Bark 来单 → 按 RUNBOOK §1 盯、对照交付判据合同。若导航失败，先看证据目录（`evidenceRef` 在 fail-closed 事件里），重点看 `POST /backend-api/payments/checkout` 的返回（成功基准 200，D-381）。
2. **重开 305（5x）**：Lemon「以后再说」。重开前先定 5x 卡从哪来（两台 pro_5x 水位 0；欠账 1、2）。
3. 块 7 余项：`checkout_artifacts` / `browser_artifact_secrets` 两张空表——**Lemon 定暂不删**，下次本来要改付款链路、本来要演练时顺手做（D-385）。
4. `go-live.sh` / `stop-live.sh` 已退役（一运行就停下并提示，D-385；main 已改，`~/pojia-pool` 里的旧副本随下次池发布更新）。RUNBOOK §1 已改为常驻池现实。块 6 工作树已删。

## 客户页 / 提速盘点（D-386）→ 批 A 已上线（D-388）

报告 `reviews/2026-09-26-customer-ux-speed-audit/report.md`：P1 四个客户会看到错结论的问题（卡密查到旧失败单、判未扣款后永远「正在核对」、换号后先显示「遇到点问题」、执行器失败后仍显示处理中）；P2 体验问题与四态只做一半；P3 提速候选。批 A 已上线（D-388，遗留三项见该条）；批 B（browser-mvp：P0 代码修 + 提速，一次演练 + 池发布）待做。

## 已定 / 禁区

- 付款前三件不改（D-254）；browser-mvp 改动走白名单 + 全量测试 + 演练；常驻池重启、发布、开关、LaunchAgent 先问。
- Plus 不加结账页套餐核对（D-375）；企业邮箱号 Business 栏不改（D-378，欠账 15）。
- 演练：不跑 preflight；租约 900；开跑前关 3 号窗口残留 chatgpt.com 标签；尽量复用演练号（结账单挂在账号上，换窗口不会变干净）；Session 不经 AI（Lemon 在客户页提交）。
- 回复 Lemon：开头给定位、话要短、大白话，结尾一节「要你决定的」列全。

## 未验证边界

- 当前 release 真实付款、取消续费、付款不明恢复、Browser 崩溃补核均无真单样本；5x 专属逻辑无样本（无 5x 卡）。
- 09-25 两次「付款表单加载失败」原因未知（候选：那个号、执行器完整路径、当时 ChatGPT 侧）；证据包上线后再现会有现场。
- 事实表「已知未修」行是 09-10 旧清单，未逐项复核。

## 每块收尾

跑 `scripts/wrapup-check.sh`；向 Lemon 交「我理解的决定」清单；重写本文件。
