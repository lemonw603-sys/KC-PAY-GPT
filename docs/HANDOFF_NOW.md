# 接班一屏（HANDOFF_NOW）

更新：2026-09-18 14:xx UTC+8（2026-09-18 06:xx UTC，落实第④步窗口收尾）。按 CLAUDE.md 约定维护，接手者从 main 继续，不另起项目。

## 现在是什么

- **V2 落实 8 步：①②③已上生产，④代码完成在 main、未发布，⑤任务书已写**（`docs/tasks/2026-09-18-impl-step5-notification-whitelist-daily-reconciliation.md`）。
- **生产 release 仍是 `20260918-step3-supply-ba28273`**（第③步）。main 上未发布的：第④步全部（D-267）+ D-265 第 3 条接单/派单审计（`765e971`）+ 迁移 **054**（只加一个设置键 `card_min_retire_age_hours=6`）。
- **第④步做了什么（D-267）**：分卡时候选卡过期 → 当场同步这一张再按同一条资格规则判（资格规则未改，D-266 a）；定时同步 AVAILABLE 卡降到每 3 小时、不再排 highvcc 卡；待销清单派生查询 + 两端点 + 标终态脚本；三张契约表落 `docs/contracts/2026-09-18_*`：取消续费超时不卡单（照常成功 + 提醒 + 卡进待销）、API 付款不明两路证据自动收口/交人带证据/后台 RESOLVE 入口、Browser 崩溃后进补核、叫人带两路证据。
- **调度器/生产此刻**：与第③步收尾一致（接单/派单/付款开关 true；Plus 走 API；hnskj 2 张可分配、highvcc 等充值 ≥ $76；非终态 0；常驻 Browser 池本机 PID 74272）。具体值只看 `CURRENT_STATE`。

## 证据从哪里看

1. `docs/V2.0_EXECUTION.md` **§6 第④步那节**：五项前置核查、A/B/C 逐块证据、与任务书不同的 5 处、范围外发现 6 条、待 Lemon 定 5 件。
2. `docs/DECISIONS.md` **D-267 / D-268**。
3. 三张契约表：`docs/contracts/2026-09-18_{delivery-criteria,payment-unknown-reconciliation,human-intervention-points}-contract.md`。
4. `docs/RUNBOOK.md` **§2.6**：待销清单怎么看/登记、API 付款不明怎么收口、按需同步怎么看。

## 接下来做什么（顺序）

1. **Lemon 定 D-268 三件**：①`production-live-worker.js` 工厂注入 `ledgerSource` 那一行（白名单外）批不批；②Browser 核实窗口用环境变量放长与否（改了要重启常驻 worker，先问）；③highvcc HELD 8 张里哪几张是注销的。
2. **发布第④步**（含 054 迁移 + D-265 第 3 条）：`deploy-release.sh prepare <commit> 20260918-step4-<sha>` → 贴 054 结果 → `migrate` → `switch`；发布前问。发布后：`state-check`；用一张窗口外的 hnskj 卡 + 一单演练验「分卡不再因 15 分钟窗口等卡」（`provider_calls` 应出现 `order-demand-sync:` 前缀的两条读）。
3. **browser-mvp 动了 → 一次 rehearsal**（切 BROWSER、停池、关付款开关、建单、`run-live-rehearsal.sh once`、收口、切回）：每步先问。
4. **两批旧卡 apply**：`retire-legacy-cards.mjs --batch hnskj-voided --apply`；highvcc 按勾选 `--batch highvcc-cancelled --last4 … --apply`；apply 后新连接核实 `inventory_status='RETIRED'` 与 `card_state_events`。
5. 然后开第⑤步窗口。

## 已定不做 / 别再重开的

- 资格规则不改（D-266 a）；水位口径库存口径（D-259）；卡台↔支付方式解耦已定（D-253）。
- 待销清单不建表（缝 c）；自动销卡推 V3（D-232）。
- `CANCELLATION_REVIEW_REQUIRED` 不再由自动路径产生；枚举保留给历史单。
- ZZSHU 零原因失败「停单不退码」本块没做，与队列一起归第⑤/⑥块。
- 免费试用号走 API（D-265）归第⑤块；放弃并放卡按钮归第⑥块。

## 未验证边界（别说成已完成）

- **第④步全部代码生产未验**：分卡当场同步只有单测/集成 + 生产窗口外候选 SQL 只读实证；API 付款不明（历史 0 次）与 Browser 崩溃进补核（历史 0 次）无样本；待销端点未在生产调过。
- highvcc 卡「卡台扣款」真证据一路要 D-268 ① 批了才在生产生效，否则仍是旧 marker 恒匹配。
- rehearsal 报价段仍未验（第③步遗留）；highvcc 自动开卡未跑过；故障转台未发生过；集成测试既有失败（D-258，本块本机基线 15 条、改后名单见账本）。

## 分支、运行与禁止事项

- main 是接手入口；本窗口提交已推送。本机临时 MySQL 容器 `pojia-step4-mysql`（13307）收尾已删；隧道 13306 保留。
- 常驻 Browser 池 PID 74272 不要当残留杀掉。
- 付款未知禁止重付/换卡；开卡 / 补余额 / 切路线 / 发布 / apply / 改开关 / 重启 worker **先开口问**；范围外发现只报不改（D-254）。

## 暂停/恢复记录

- 本窗口「先问再动」停顿：①白名单外一行（工厂注入）→ 停，D-268；②发布/apply/rehearsal 全部留给 Lemon 批。无生产写操作。
