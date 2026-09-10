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

真单前不做：F-5、F-1、F-16、F-10、F-3、F-4、F-6、F-7、F-8。真单后顺序：F-5+F-34+F-35（一次发布）→ F-1 → F-24 已修 → F-16+F-3 → F-10 → F-4/F-7/F-8 → F-25/F-26 代码 → P2。
- F-40 后台静态断言版本号不同步（既有失败）：待用户定；不影响真单，建议真单后随 F-5 那次发布一起改。
