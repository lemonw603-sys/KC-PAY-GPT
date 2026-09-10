# 接班一屏（HANDOFF_NOW）

> 规则：**每次窗口收尾覆盖重写本文**（不追加）；过程流水在 `HANDOFF_LOG.md`（只追加）。新窗口按 `AGENTS.md` 顺序：先读本文，再读 `PROJECT_MAP.md`、`CURRENT_STATE.md`。本文只写"现在"和"下一步"，不写历史。

**上次更新**：2026-09-10 01:5x UTC（09:5x UTC+8），窗口 Fable 5.1（本窗口，进行中）。上一窗口 `68c73cc7` 实际收尾时间为 2026-09-10 00:12 UTC（提交 `a367bcf`），其原写的"19:05 UTC"是时间标注错误（审查 F-39）。

> **给新窗口**（若本窗口中断，下一窗口仍按此进入）：用户要求接班者**把整个项目了解清楚**，再**审**，用户点头后才动手。已定决策（D-138/139/140）不重开，有异议按"规划是 X、建议 Y、理由 Z"提。同一时间只有一个执行窗口。用户明确要求：**别添油加醋、别边修边试、真单失败一次即人工。**
>
> **深读清单（按序；不读 `docs/archive/`、不读 HANDOFF_LOG 09-06 之前、不读根目录 legacy 文件）**：1 `CLAUDE.md`、`AGENTS.md`；2 本文；3 `docs/PROJECT_MAP.md`；4 `docs/CURRENT_STATE.md` + 跑 `browser-mvp/scripts/state-check.sh`；5 `docs/PRODUCT_SIMPLIFICATION_DISCUSSION.md` 末尾「接班实施基线」；6 `docs/CORE_SPEC_2026-09-07.md`；7 `docs/DECISIONS.md` 全部；8 `docs/UNVERIFIED_LEDGER.md`；9 `docs/PROJECT_OPERATING_MODEL.md`；10 `docs/HANDOFF_LOG.md` 从「2026-09-06」到末尾；11 `docs/reviews/FULL_CHAIN_AUDIT_2026-09-10.md`（§二是真单路径代码地图）；12 `docs/RUNBOOK.md`；13 代码按审计 §二顺序真的打开读（v1：intake → session-validation → task-repository → workflow-handlers → browser-execution-repository；browser-mvp：browser-order-preflight → session-bootstrap → executor → chatgpt-checkout-navigator → live-chatgpt-payment-adapter → payment-executor → chatgpt-post-payment-verifier → shared-runtime-integration → production-live-pool-worker）。读完先交一份"我理解的项目"（六问：给谁做什么；一单从 CDK 到订阅成功经过哪些环节、各在哪个进程；做到哪、哪些已验证、哪些从没在真单跑过；资金安全靠哪几道门；接下来做什么、为什么这个顺序；最大风险）。
>
> **审查**：范围 `docs/reviews/REVIEW_SCOPE_2026-09-10.md`（39 个文件），按 `docs/REVIEW_PROTOCOL.md` 只读审，记录落 `docs/reviews/REVIEW_RECORD.md`，处置落 `docs/reviews/DISPOSITIONS.md`。**批次 1（真单路径）已完成**，第二批（后台五页、迁移与生产 schema、文档一致性）未做。

## 现在的状态

- **系统待命**：付款开关 **false**、本机无 worker、非终态订单 0、active_runs 0、可分配卡 1（7402 $49，够 Plus 不够 20X）。线上 release `20260909-askform-cc3bba0`。`state-check.sh` 本窗口跑过，与状态表一致。
- **本窗口已落地（本机工作区，pool worker 从工作区启动即生效，无需服务器发布）**：
  - `dad5244`（B5 扩展版）：付款后核实 lane 不再重注入订单付款前 token（F-18）；核实完关闭自己开的页面，20X 交接除外（F-24）；UNKNOWN 结果按 `verificationIntervalMs` 退避再查，不再每 tick 重开浏览器（F-24）。browser-mvp 全量 205 通过 0 失败；v1 服务测试 9/9。**只有单测，真库集成用例因本机测试库未开没跑，真单未验。**
  - `1854729`（B6）：`v1/scripts/close-manually-fulfilled-order.mjs` 接 RECHARGE_FAILED 单，重绑仍 AVAILABLE 的 CDK、否则拒绝；PAYMENT_ARMED 不算付款痕迹；该状态拒绝 `--card-used`。生产 dry-run 三例通过（失败单可收、有付款痕迹拒、成功单拒）。**真跑要在生产主机上做，脚本尚未 scp 到 release 目录。**
  - RUNBOOK §1：D-139 硬规则限定"付款点击之前"；③新增"PAYMENT_SUBMIT 落库后 10 分钟内不得 stop-live / kill"（F-26）；打回段补"客户重提同码不更新 Session、换账号 409，唯一兜底是执行者代提交"（F-34/35）；跑单纪律加"不在后台关付款开关"（F-25）。
  - D-140 措辞降级为"候选修复，根因未坐实"（DECISIONS 行末更正、CURRENT_STATE 已知未修①），决策不重开。
- **审查批次 1 结论**（`docs/reviews/REVIEW_RECORD.md`）：新增 F-24 到 F-39，其中 P1 五条（F-24/25/26 已按上面处理或定纪律；F-34/35 真单后与 F-5 同批发布）。对照上一窗口审计：结论一致，漏判 9 条，无误判，D-140 一处降级。核实 lane、自动确认 Plus、自动取消续费、核实到期转人工在生产各 0 次成功样本。

## 下一可执行项（用户 09-10 定：今天再做一次真单；已按审查建议推进到此）

**真单前**
- **A1 演练（需要用户）**：用户用测试号 e4938aca（free，首页显示 "Rejoin Plus"）+ 一张 Plus CDK 在客户页提交演练单，把单号给执行者。执行者：`ready-check.sh rehearsal` → `BITBROWSER_PROFILE_ID=51e915e3298b4a02bbd7468b39749c9e browser-mvp/scripts/run-browser-preflight.sh once` → 等服务器 worker 推到派发 → `browser-mvp/scripts/run-live-rehearsal.sh once <orderId>` 到零税报价停 → `close-rehearsal-order.mjs` 收口释放卡。目的：在 worker 真跑的路径上验 D-140 域放置与 Rejoin Plus 入口。预检 900s 租约这条路验不到（`run-browser-preflight.sh` 写死 120s，F-33），真单首次验。
- A2 失败应对见 RUNBOOK §1（三段 + 打回兜底 + 跑单纪律，本窗口已更新）。
- A3 跑单纪律：客户不用账号；不登进 6 号窗口；**不在后台关付款开关**；**点击付款后 10 分钟内不 stop-live**。
- A4 `ready-check.sh pay`；Plus 用 7402（$49）；20X 需先充到 ≥150 且第二阶段人工 Pay now。
- B5、B6 已做（见上）。真单前**不做**：F-5/F-34/F-35（需发布）、F-1、F-16、F-10、F-25/F-26 代码、其余。

**真单后**：F-5 + F-34 + F-35（一次 v1 发布）→ F-1（告警 + 重开预检 + 租约超时不计次）→ F-16 + F-3（"人工核实后收口"动作）→ F-25/F-26 代码（关开关回 CARD_READY；PAYMENT_SUBMITTING 的 run 设核实排程）→ **Free 直购 20X（D-141，PROJECT_MAP §5 6b：只读观察 → 改四处 → 演练 → 真单）** → F-10 → F-4/F-7/F-8 → 审查第二批 → P2。把真单证据写入 UNVERIFIED_LEDGER「付款后半段」。

**其他待办**：上一单 `PJV1-VHl_` 若已在账号里关了续费 → 后台点「已在账号里取消续费」。Lane4 窗口现在留着测试号 e4938aca 的登录态，来单时执行器会自动清掉换成客户的。F-38（go-live/stop-live 直写库）待用户裁决。

## 已定不做 / 已定保留

- 不做：Plus→20X 升级自动化（D-138）；常驻 worker；住宅 IP（现无）；A2 抓新 session；真单上边修边试（D-139）。
- 保留：付款后 session 恢复阶梯第 1、2 级（探测、清页面登录 cookie 后刷新）；第 3 级"重注入旧 token"已在付款路径（`96ac467`）与核实路径（`dad5244`）都删除。

## 已验证 / 未验证的边界（详见 UNVERIFIED_LEDGER 与 REVIEW_RECORD 批次 1）

- 真实客户账号上已验证通过：session 注入、清旧登录态换 session、身份核对、点升级创建结账（09-09 真单）。
- 真实客户账号上失败：结账页加载（403/500）。D-140 修复只在 free 测试号对照实验验到结账页出报价；本机 WAL 显示 09-07/09-08 有 7 次同样并存却成功，"并存即 403"不成立（F-27）。真单再 403 → 转人工，不沿此方向再查。
- 仍 0 次：从点击到 RECHARGE_SUCCESS 的自动闭环、自动确认 Plus、自动取消续费、核实到期转人工、20X 闭环。09-08 有 4 次自动点击（1 成功 3 拒付），成功那次付款后是人工收口。
- 本窗口改动（dad5244、1854729）：只有单测与生产 dry-run，真单未验。

## 暂停 / 恢复记录

```text
暂停原因：等用户提交 A1 演练单；真单是否上由用户定
允许继续：A1 演练全流程（不付款）；只读查证
禁止操作：未经用户放行不 go-live --arm；付款结果不明不重付不换卡；跑单期间不关付款开关；点击后 10 分钟内不 kill worker
恢复后的第一步：ready-check.sh rehearsal → A1；真单前 ready-check.sh pay
```
