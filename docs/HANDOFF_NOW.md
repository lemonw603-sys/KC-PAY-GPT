# 接班一屏（HANDOFF_NOW）

> 规则：**每次窗口收尾覆盖重写本文**（不追加）；过程流水在 `HANDOFF_LOG.md`（只追加）。新窗口按 `AGENTS.md` 顺序：先读本文，再读 `PROJECT_MAP.md`、`CURRENT_STATE.md`。本文只写"现在"和"下一步"，不写历史。

**上次收尾**：2026-09-10 19:05 UTC（03:05 UTC+8 09-11），窗口 `68c73cc7`（该窗口历经 Opus 4.8→Opus 5.1→Fable 5.1 多次换模型，已收尾退出）。

> **给新窗口**：用户计划开一个只用 Fable 5.1 的新窗口，要求它**把整个项目了解清楚**，再**审**本窗口留下的审计与清单，用户点头后才动手。已定决策（D-138/139/140）不重开，有异议按"规划是 X、建议 Y、理由 Z"提。同一时间只有一个执行窗口。用户明确要求：**别添油加醋、别边修边试、真单失败一次即人工。**
>
> **深读清单（按序，全部读完再开口；不读 `docs/archive/`、不读 HANDOFF_LOG 09-06 之前、不读根目录 legacy 文件 README 下半/progress.md/DEPLOY.md）**：
> 1. `CLAUDE.md`、`AGENTS.md` —— 规矩与入口
> 2. 本文 —— 现在
> 3. `docs/PROJECT_MAP.md` —— 目标、里程碑、唯一执行顺序
> 4. `docs/CURRENT_STATE.md` + 跑 `browser-mvp/scripts/state-check.sh` —— 事实，且自己对一遍现场
> 5. `docs/PRODUCT_SIMPLIFICATION_DISCUSSION.md` 末尾「接班实施基线」—— 方向（用户确认过的）
> 6. `docs/CORE_SPEC_2026-09-07.md` —— 订单生命周期、执行流程形状、五个决定
> 7. `docs/DECISIONS.md` 全部 —— 140 条，为什么是现在这样；D-131 起尤其重要
> 8. `docs/UNVERIFIED_LEDGER.md` —— 做了但没证明的
> 9. `docs/PROJECT_OPERATING_MODEL.md` —— 全链路与状态机总册（长，按目录挑与订单/资金/Browser 相关的章节）
> 10. `docs/HANDOFF_LOG.md` 从「2026-09-06」章节读到末尾 —— 最近一周每天发生了什么、踩了什么坑
> 11. `docs/reviews/FULL_CHAIN_AUDIT_2026-09-10.md` —— 两轮审计；§二 同时是真单路径的**代码地图**（每一段对应哪个文件、哪几行）
> 12. `docs/RUNBOOK.md` —— 怎么操作、失败怎么办
> 13. 代码：按审计 §二 的顺序把对应文件真的打开读一遍（v1：intake → session-validation → task-repository → workflow-handlers → browser-execution-repository 的付款后部分；browser-mvp：browser-order-preflight → session-bootstrap → executor → chatgpt-checkout-navigator → live-chatgpt-payment-adapter → payment-executor → chatgpt-post-payment-verifier → shared-runtime-integration → production-live-pool-worker）
>
> **读完先交一份"我理解的项目"**（用自己的话，不抄文档）：①这系统给谁做什么；②一笔单从 CDK 到订阅成功经过哪些环节、每个环节在哪个进程/机器上跑；③现在做到哪、哪些已验证、哪些从没在真单上跑过；④资金安全靠哪几道门；⑤接下来该做什么、为什么是这个顺序；⑥你认为最大的风险是什么。用户看完这份再让你审计划。

## 现在的状态

- **第一笔 Browser 真单自动付款失败，用户手动完成**。`PJV1-VHl_hgWctg78JwDajOVR`（Plus，14:51 UTC 创建，卡 7402）：预检 3 次因租约 120s 到期重来（真实客户账号要清旧登录态+换 session+核身份，超 120s）→ 改 900s 后 2 次到**结账页被 OpenAI 拒**（文档 403，刷新 500「Application Error」；登录、身份核对、点升级建结账都正常）→ 任务 DEAD。~15:15 UTC 用户用上号器手动充好；15:24 UTC 以 `v1/scripts/close-manually-fulfilled-order.mjs` 收口：RECHARGE_SUCCESS、7402 按"未用"释放、CDK 保持已用、**取消续费待用户点「已在账号里取消续费」**。系统未付一分钱。
- 系统待命：付款开关 **false**、无 worker、非终态订单 0、active_runs 0、可分配卡 1（7402 $49）。
- **D-139**：真单自动化失败一次即转人工。**403 根因已定位并修复（D-140）**：注入的 session cookie 曾是 host-only，与网站 `.chatgpt.com` 的同名 cookie 并存；对照实验（用户给的 free 测试号、同窗口同出口、不付款）复现 + 修复后结账页打开出 ₱ 报价。代码已改（`session-bootstrap.js`）+ 单测通过，**真单未验证**。下一笔真单可按自动化跑（D-139 兜底），上不上由用户定。

## 下一可执行项（用户 09-10 定：今天再做一次真单测试；下面这份"真单前/后"清单已给用户，**待用户点头**）

**全链路审计两轮已出**（`docs/reviews/FULL_CHAIN_AUDIT_2026-09-10.md`）：P0——F-5 客户页永远不让重贴 Session（一行 bug，线上同源）、F-1 预检 DEAD 无重开入口无告警、F-10 等待期 session 失效→打回→撞 F-5；P1——F-16 付款不明/升级人工后无正式收口（只能手工 SQL）、F-18 核实 lane 仍重注入旧 token（96ac467 只删了付款路径）、F-3/F-4/F-6/F-7/F-8；P2 若干。修复顺序见报告 §五末尾。

**真单前（只验 + 定规矩 + 两处可退的小改动）**
- A1 用测试号（e4938aca，free，首页显示 "Rejoin Plus"）走真单同路径演练：客户页提交 → `run-browser-preflight.sh once` → `run-live-rehearsal.sh once <orderId>` 到零税报价停 → `close-rehearsal-order.mjs` 收口。目的：在 worker 真跑的路径上验 D-140 域修复、900s 租约、Rejoin Plus 入口——昨天的洞就是"演练走的路和真单不一样"。
- A2 三段失败应对已写进 RUNBOOK §1（预检失败 / 付款前失败 / 点击后绝不手动重付 / 客户打回的接口兜底 / 跑单纪律）。
- A3 跑单纪律：客户不用账号；不登进 6 号窗口。
- A4 `ready-check.sh pay`；Plus 用 7402（$49）；20X 需先充到 ≥150 且第二阶段人工 Pay now。
- B5（待点头）F-18：删 `browser-mvp/src/live-post-payment-recovery.js:77-84` 的 `reinjectSession`，跑全套测试。纯删除。
- B6（待点头）`close-manually-fulfilled-order.mjs` 增加对 RECHARGE_FAILED（付款前终态、无付款证据）单的收口。只改脚本。
- 真单前**不做**：F-5（需发布；兜底见 RUNBOOK）、F-1 代码、F-16、F-10、其余。

**真单后**：F-5 发布（一行）→ F-1（告警 + 重开预检 + 租约超时不计次）→ F-16+F-3（"人工核实后收口"动作）→ F-10（贴码即验）→ F-4/F-7/F-8 → P2；把真单证据写入 UNVERIFIED_LEDGER「付款后半段」。

**其他待办**：上一单 `PJV1-VHl_` 若已在账号里关了续费 → 后台点「已在账号里取消续费」。租约 900s 与 ready-check 改动已提交、未在成功路径验证。Lane4 窗口现在留着测试号 e4938aca 的登录态，来单时执行器会自动清掉换成客户的。

## 已定不做 / 已定保留

- 不做：Plus→20X 升级自动化（D-138）；常驻 worker；住宅 IP（现无）；A2 抓新 session。
- 新增不做：真单上边修边试（D-139）。
- 保留：付款后 session 恢复阶梯第 2 级。

## 已验证 / 未验证的边界（详见 UNVERIFIED_LEDGER）

- 真实客户账号上已验证通过：session 注入、清旧登录态换 session、身份核对、点升级创建结账（都在 09-09 真单上跑过）。
- 真实客户账号上失败：结账页加载（403/500）。
- 仍 0 次：自动点付款 + 付款后半段 + 20X 闭环。rehearsal（free 账号）到零税报价 2 次是另一回事，不能当真单证据。

## 暂停 / 恢复记录

```text
暂停原因：真单自动付款在结账页被拒（403/500），根因未清
允许继续：人工来单流程；只读查根因（CDP 看 Lane4 页面、比对用户手动路径）
禁止操作：未查清前不 go-live --arm 真单；付款结果不明不重付不换卡
恢复后的第一步：ready-check；先问用户手动路径细节再动
```
