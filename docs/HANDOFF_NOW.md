# 接班一屏（HANDOFF_NOW）

更新：2026-09-26 01:3x（UTC+8）＝ 09-25 17:3x UTC。执行顺序以 **D-352** 为准，「可离开」第一条以 **D-366** 为准；本窗口 D-376～D-382。

## 现在的状态（17:26 UTC 现查；明细见 CURRENT_STATE.md）

- 生产正常：付款开关 true（17:25:01 UTC 开回），常驻池 PID 42676（17:25:48 UTC 拉起，main 工作区代码），心跳新鲜；「下单查付款池」true。
- 生产 release **`20260924-block7-batch2-0d06f41`**，迁移 061。默认路线 BROWSER（Plus 用 highvcc 卡）。可分配 Plus 卡 1 张（8718）；非终态订单 1（旧的 WAITING_FOR_SESSION，无卡）。highvcc token 有效（08:15 UTC 恢复）。HNSKJ 供卡故障仍在。路线 305/306 关。

## 块 6：Plus 回归演练已通过（D-382），下一步逐项问 Lemon

- 分支 **`block6-pro5x`（`103f7d2`，已推送，未合 main、未发布）**：`b3f1d37` + 等灰按钮（`56fa9e7`）+ 导航失败证据包（`f640f9c`、`103f7d2`）。
- 演练（17:22 UTC，订单 `PJV1-v3tiEHgJecMDAinmycZk`，已收口）：PRE_SUBMIT_STOPPED、PHP 982.14 / 税 0、付款提交 0。点升级→结账页那段由 D-381 实验在同一号上验证。未覆盖：5x 专属、真付款与取消续费。09-25 两次「付款表单加载失败」原因仍未知（证据包上线后再出现会有完整现场）。
- **下一步（每步先问）**：① 合 main；② 服务器发布（含 `3a633f5` 贴 token 当场验证）；③ 常驻池切 `~/pojia-pool` 固定目录 + 改 LaunchAgent（D-377 已批，当场再确认；步骤见 `tasks/2026-09-25-pool-pinned-release.md`，worker 未退出前不许动 launchd）；④ 重开 305（先定 5x 卡从哪来；欠账 1、2）。
- 待批小改：`run-live-rehearsal.sh` 默认租约 60 秒 → 与常驻池一致 900 秒（本次靠运行时环境变量绕过）。
- 演练步骤（RUNBOOK §2）：不跑 preflight；`BROWSER_WORKER_LEASE_SECONDS=900 run-live-rehearsal.sh once <orders.id>` 从分支目录跑；开跑前关 3 号窗口残留 chatgpt.com 标签；演练号优先复用（结账单挂在账号上，换窗口不会变干净）。

## 本窗口做完的

- D-376：state-check 补 6 类检查与陈旧行提醒；事实表逐行对现场；PROJECT_MAP 压一页；`scripts/pool-release.sh`（未启用）。
- D-377：旧工作区清理（存档后删，去向 `archive/INDEX.md` 末尾）；贴 token 当场验证（main `3a633f5`，**未发布**）。
- D-378：演练经过；企业邮箱号欠账（地图欠账 15）。
- D-379～D-382：证据包（放开存储限制）、对照实验 A、证据包首用修 bug、演练通过。

## 已定 / 禁区

- 付款前三件不改（D-254）；browser-mvp 改动走白名单 + 全量测试 + 演练；常驻池重启、发布、开关、LaunchAgent 先问。
- Plus 不加结账页套餐核对（D-375）；企业邮箱号 Business 栏这次不改（D-378）。
- 回复 Lemon：开头给定位、话要短、大白话，结尾一节「要你决定的」列全。

## 未验证边界

- 当前 release 真实付款、取消续费、付款不明恢复、Browser 崩溃补核均无真单样本。
- 09-25 两次「付款表单加载失败」的原因、是否影响真实客户单：未知。
- 事实表「已知未修」行是 09-10 旧清单，未逐项复核。

## 每块收尾

跑 `scripts/wrapup-check.sh`；向 Lemon 交「我理解的决定」清单；重写本文件。
