# 处置记录（DISPOSITIONS）

> 按 `docs/REVIEW_PROTOCOL.md` §4 由执行者写，只追加。逐条对应 `REVIEW_RECORD.md` 与 `FULL_CHAIN_AUDIT_2026-09-10.md` 的发现编号。

## 批次 1 处置｜2026-09-10｜执行者：本窗口（Fable 5.1）｜用户 09-10 确认"按建议推进"

### P1（逐条）

| 编号 | 处置 | 理由 | 关联 |
|---|---|---|---|
| F-24 核实 lane 开标签不关、无退避 | 接受，已修 | 与 B5 同一文件同一函数；真单进核实态即触发 | `dad5244`（关闭自开页面，20X 交接除外；UNKNOWN 按 `verificationIntervalMs` 退避） |
| F-18 核实 lane 重注入旧 token | 接受，已修（B5） | 上一轮 P1 | `dad5244` |
| F-25 中途关付款开关判失败 | 接受，分两步 | 真单前只定纪律（RUNBOOK 跑单纪律：真单期间不在后台关开关，收工只用 stop-live）；代码改动（该 code 归入回 CARD_READY 类）放真单后，避免真单前扩改动面 | RUNBOOK §1；代码待办 |
| F-26 点击后 kill 无核实排程 | 接受，分两步 | 真单前只改 RUNBOOK ③（PAYMENT_SUBMIT 落库后 10 分钟内不 stop-live）；`recoverExpiredRun` 对 PAYMENT_SUBMITTING 设核实排程放真单后 | RUNBOOK §1；代码待办 |
| F-34 重提同码丢 Session | 接受，真单后 | 需发布 v1 release；与 F-5 同批，否则表单修好后"重新提交"仍丢 Session | 真单后第一批：F-5 + F-34 + F-35 |
| F-35 换账号重提 409 | 接受，真单后 | 同上 | 同上 |

### P2 / P3（批量）

- F-27 D-140 因果反例：接受措辞降级。本轮改 D-140 行末追加更正、CURRENT_STATE「已知未修①」、HANDOFF_NOW 措辞为"候选修复，真单待验"；不重开决策；真单再 403 按 D-139 转人工，不在 D-140 方向继续查。
- F-28 点击后求值失败即 UNKNOWN、F-29 session 租约 60s、F-30 卡材料租约 5 分钟、F-31 核实 lane 首步注入旧 token、F-32 单块 token 未验：待验证，本次真单作为样本；真单后按 F-24 → F-16 的顺序一并处理。
- F-33 A1 验不到 900s 租约：接受，HANDOFF_NOW A1 目标已改。
- F-36 B6 需重绑 CDK：接受，已实现（`close-manually-fulfilled-order.mjs` 对 RECHARGE_FAILED 单重绑 CDK，非 AVAILABLE 即拒；`--card-used` 对该状态拒绝）。
- F-37 自检脚本资格 SQL 少条件：接受，真单后改为调用 `eligibleInventoryCardSql` 同口径。
- F-38 go-live/stop-live 直写库：待用户裁决（改走后台接口，或在 CLAUDE.md 明文豁免）。
- F-39 时间标注错误：接受，本轮收尾时按提交时间戳改正 HANDOFF_NOW/HANDOFF_LOG。

### 上一轮审计（FULL_CHAIN_AUDIT）P0/P1 的处置沿用 HANDOFF_NOW 既定顺序

真单前不做：F-10、F-4、F-6、F-7、F-8（未做）。已完成且脱离"真单前不做"名单：F-5+F-34+F-35（已发布 `20260910-highvcc-open-session-resubmit-0b5639c`）、F-1（`23c70e3`，本机代码）、F-24（`dad5244`）、F-25/F-26（本机代码即生效）、**F-16+F-3**（`487b51a`，后台能力已实现并真库测试，管理界面按钮和部署未做，见下）——这些均不涉及真单支付本身，接受两天期限内提前做。剩余顺序：F-10 → F-4/F-7/F-8 → P2。

### F-16+F-3 处置详情

| 编号 | 处置 | 关联 |
|---|---|---|
| F-16 付款结果不明/升级人工无正式收口 | 已修（新 controlRun 动作 `RESOLVE_UNKNOWN_PAYMENT`，人工核对账号后二选一 CHARGED/NOT_CHARGED，见下） | `487b51a`，真库集成 5/5 三轮无 flake；**未接管理界面按钮、未部署** |
| F-3 补充（Plus 已开续费未关无提醒；核实 lane 从未在生产真正跑过） | 已修（CHARGED 分支不带 `renewalCancelled` 时走 `CANCELLATION_REVIEW_REQUIRED`，接现有 `confirmManualCancellation`，不再"没有任何提醒"） | 同上 |
- F-40 后台静态断言版本号不同步（既有失败）：待用户定；不影响真单，建议真单后随 F-5 那次发布一起改。

### 批次 1 处置更新｜2026-09-10 04:xx UTC（用户定两天内完成，第一天项已开始）

| 编号 | 处置 | 关联 |
|---|---|---|
| F-5 客户页重贴表单永远隐藏 | 已修（remaining 为 null 显示表单；customer.js v=12；静态断言） | `22ca2d5`，已发布 `20260910-highvcc-open-session-resubmit-0b5639c` |
| F-34 重提同码丢 Session | 已修（打回态订单收到同码即当作重贴，写库逻辑抽为 `session-replacement-repository.js`，公开重贴接口共用） | `03c82ce`，已发布 `20260910-highvcc-open-session-resubmit-0b5639c` |
| F-35 换账号重提 409 | 已修（同上，换账号也接受，记 accountChanged） | `03c82ce`，已发布 `20260910-highvcc-open-session-resubmit-0b5639c` |
| F-25 中途关付款开关判失败 | 已修（`BROWSER_PAYMENT_WRITES_DISABLED` 归为回 CARD_READY 等待） | `ec75676`，本机 worker 即生效 |
| F-26 点击后丢 worker 无核实 | 已修（重新领到 PAYMENT_SUBMITTING 的 run 直接 `markPaymentUnknown` 交核实 lane，不再空转） | `d35960c`，本机 worker 即生效；真库集成 7/7 |
| F-1 预检租约丢失计次、耗尽无告警 | 已修（租约丢失不计次；5 次用尽写 `BROWSER_HUMAN_REQUIRED` 告警；新增 `reopen-browser-preflight.mjs` 重开 DEAD 预检，守卫付款痕迹） | `23c70e3`，browser-mvp 本机代码，pool worker 下次启动即生效；单测 8/8 |
| F-41 取消等卡单不关预检任务 | 待做（P3，随 F-16 那次一起） | |

### 接班核对处置登记｜2026-09-10 23:33 UTC

本次为接班者自行核查与登记，不冒充独立双人复审。

| 编号 | 处置 | 依据与边界 |
|---|---|---|
| F-42 | 接受接线事实；修复待批准 | 对应历史提交 + 真实 factory 离线实例化结果均为 Cookie；撤回“扩展已完成失败对照”的证据归因，不判扩展有效/无效。只改交接事实，不改业务。 |
| F-43 | 接受离线控制流缺口；真实影响待验证、修复待批准 | 旧材料 3600s/299s 对照证明浏览器探测前被挡；25 项定向与全量 224 通过不覆盖这条组合；不修改凭证验证守卫。 |
| F-16/F-3 | 更正部署说明；UI/完整收口仍待验证 | 生产 cdcf42e release 文件已含后端分支，不能继续称未部署；不把文件存在当实际资金动作验收。 |
