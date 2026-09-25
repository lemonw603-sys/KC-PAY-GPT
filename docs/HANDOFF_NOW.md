# 接班一屏（HANDOFF_NOW）

更新：2026-09-25 23:5x（UTC+8）＝ 15:5x UTC。执行顺序以 **D-352** 为准，「可离开」第一条以 **D-366** 为准；本窗口 D-376、D-377、D-378。

## 现在的状态（15:48 UTC 现查；明细见 CURRENT_STATE.md）

- **生产已恢复**（Lemon 批）：付款开关 15:45:31 UTC 开回，常驻池 PID 13942 15:48:08 UTC 拉起（main 工作区代码），心跳新鲜；「下单查付款池」true。
- 生产 release **`20260924-block7-batch2-0d06f41`**，迁移 061。默认路线 BROWSER（Plus 用 highvcc 卡）。可分配 Plus 卡 1 张（8718）；非终态订单 1（旧的 WAITING_FOR_SESSION，无卡）。highvcc token 有效（08:15 UTC 恢复）。HNSKJ 供卡故障仍在。路线 305/306 关。

## 块 6 Plus 回归演练：未通过（D-378）

- 分支 **`block6-pro5x`（`56fa9e7`，已推送，未合 main、未发布）**：在 `b3f1d37` 上加了「升级按钮是灰的就等它变可点」（最多 10 秒、只点一次、绝不点灰按钮）。
- 演练三张单都没付款、都已收口。卡住的地方：点到「Upgrade to Plus」后，ChatGPT 页面显示 **「Configure your plan — Unable to load payment form」**，网址不变（没到 `/checkout/`），连续两次；经同一菲律宾出口 curl Stripe 正常。**原因未知**。真实客户 Plus 单是否也这样：未验证。
- 下一步候选（等 Lemon 选）：只读查付款表单为什么加载不出来（3 号窗口点页面上的 Retry 看报错、换常驻池那个窗口对比）；或先恢复生产、改天再演练。
- 演练步骤（RUNBOOK §2 已改）：**不要先跑 preflight**；`run-live-rehearsal.sh once <orders.id>` 要从分支目录跑；3 号窗口开跑前把残留的 chatgpt.com 标签页关掉（开着多个会 `PROFILE_PAGE_AMBIGUOUS`）；演练号用普通邮箱注册的免费号（企业邮箱号价格框默认 Business 栏，D-378 不改）。
- 通过之后仍逐项问：合 main → 服务器发布（并入「贴 token 当场验证」`3a633f5`，D-377）→ 常驻池切 `~/pojia-pool` 固定目录并改 LaunchAgent（D-377 已批，当场再确认）→ 重开 305（先定 5x 卡从哪来）。

## 本窗口做完的

- D-376：state-check 补 6 类检查与陈旧行提醒；事实表逐行对现场；PROJECT_MAP 压一页；`scripts/pool-release.sh`（未启用）。
- D-377：旧工作区清理（存档后删，去向 `archive/INDEX.md` 末尾）；贴 token 当场验证（main `3a633f5`，**未发布**）。
- D-378：演练经过；企业邮箱号欠账（地图欠账 15）。

## 已定 / 禁区

- 付款前三件不改（D-254）；browser-mvp 改动走白名单 + 全量测试 + 演练；常驻池重启、发布、开关、LaunchAgent 先问。
- Plus 不加结账页套餐核对（D-375）；企业邮箱号 Business 栏这次不改（D-378）。
- 回复 Lemon：开头给定位、话要短、大白话，结尾一节「要你决定的」列全。

## 未验证边界

- 当前 release 真实付款、取消续费、付款不明恢复、Browser 崩溃补核均无真单样本。
- 「付款表单加载失败」的原因、是否影响真实客户单：未知。
- 事实表「已知未修」行是 09-10 旧清单，未逐项复核。

## 每块收尾

跑 `scripts/wrapup-check.sh`；向 Lemon 交「我理解的决定」清单；重写本文件。
