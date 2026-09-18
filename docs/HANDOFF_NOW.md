# 接班一屏（HANDOFF_NOW）

更新：2026-09-18 15:2x UTC+8（2026-09-18 07:2x UTC，第④步全部完成：发布 + apply + 演练 + 池重启）。按 CLAUDE.md 约定维护，接手者从 main 继续，不另起项目。

## 现在是什么

- **V2 落实 8 步：①②③④已上生产并验完**（第④步 release `20260918-step4-251a441`，06:26:47 UTC 切换，迁移 054），⑤任务书已写（`docs/tasks/2026-09-18-impl-step5-notification-whitelist-daily-reconciliation.md`）。
- **第④步做了什么（D-267/D-269/D-270）**：分卡时候选卡过期 → 当场同步再按同一条资格规则判；定时同步 AVAILABLE 卡 3 小时、不再排 highvcc 卡；待销清单派生查询 + 两端点；取消续费超时不卡单；API 付款不明两路证据自动收口 / 交人带证据 / 后台 RESOLVE；Browser 崩溃后进补核、叫人带证据；**备用卡台的「卡台侧扣款」改读 `card_transactions` 真证据、假 marker 已删**。
- **已 apply**：hnskj 12 张 + highvcc 8 张 + 3336 共 21 张 RETIRED；`card_sync_jobs` 307 条归档。
- **rehearsal 报价段跑通**（D-270，补上 D-264 遗留）：`PRE_SUBMIT_STOPPED`，PHP 982.14 / 税 0.00，付款提交 0 次，演练单已收口。
- **highvcc 自动开卡首次生产实跑**：4022（调度器自动开）+ 8718（卡台已开出、人工补记 + 新脚本结清 job）。
- 生产：接单 / 派单 / 付款开关 true；Plus 走 API；可分配 4 张（hnskj 2 + highvcc 2）；非终态 0；常驻 Browser 池 **PID 67131**（新代码 + 30 分钟核实窗口）。具体值只看 `CURRENT_STATE`。

## 证据从哪里看

1. `docs/V2.0_EXECUTION.md` **§6 第④步那节**：五项前置核查、A/B/C 逐块证据、与任务书不同的 5 处、范围外发现 6 条、待 Lemon 定 5 件。
2. `docs/DECISIONS.md` **D-267 / D-268**。
3. 三张契约表：`docs/contracts/2026-09-18_{delivery-criteria,payment-unknown-reconciliation,human-intervention-points}-contract.md`。
4. `docs/RUNBOOK.md` **§2.6**：待销清单怎么看/登记、API 付款不明怎么收口、按需同步怎么看。

## 接下来做什么（顺序）

1. **开第⑤步窗口**：任务书已写（推送白名单 + 日对账，先坐实 D-176 静音根因）。它还带着第③④步归过来的发现，任务书里列了。
2. 真单来时顺手看两件（都还没有样本）：分卡当场同步在 `provider_calls` 留下 `order-demand-sync:` 前缀的两条读；付款后备用卡台真证据路径被 worker 自动调用。
3. Lemon 侧运营：highvcc token 过期了（本机那份，06:5x 实测），下次要用 `browser-mvp/scripts/highvcc-card.mjs` 前先贴。

## 已定不做 / 别再重开的

- 资格规则不改（D-266 a）；水位口径库存口径（D-259）；卡台↔支付方式解耦已定（D-253）。
- 待销清单不建表（缝 c）；自动销卡推 V3（D-232）。
- `CANCELLATION_REVIEW_REQUIRED` 不再由自动路径产生；枚举保留给历史单。
- ZZSHU 零原因失败「停单不退码」本块没做，与队列一起归第⑤/⑥块。
- 免费试用号走 API（D-265）归第⑤块；放弃并放卡按钮归第⑥块。

## 未验证边界（别说成已完成）

- **第④步代码已在生产但无真单样本**：分卡当场同步、API 付款不明、Browser 崩溃进补核、备用卡台真证据被 worker 自动调用，四件都没有真单走过；待销清单两个端点未在生产调过（口径 SQL 已实跑，真证据路径另做过生产流水只读验证三例）。
- `plausiblePlusAmount` 只认 Plus 价位，Pro 单扣款会被判成不匹配（第⑦块处理，D-270 发现 8）。
- rehearsal 报价段仍未验（第③步遗留）；highvcc 自动开卡未跑过；故障转台未发生过；集成测试既有失败（D-258，本块本机基线 15 条、改后名单见账本）。

## 分支、运行与禁止事项

- main 是接手入口；本窗口提交已推送。本机临时 MySQL 容器已删；隧道 13306 保留。发布包 `artifacts/release-candidate-20260918-step4-*` 两份在本机（git 忽略）。
- 常驻 Browser 池 PID 74272 不要当残留杀掉。
- 付款未知禁止重付/换卡；开卡 / 补余额 / 切路线 / 发布 / apply / 改开关 / 重启 worker **先开口问**；范围外发现只报不改（D-254）。

## 暂停/恢复记录

- 本窗口「先问再动」停顿：①白名单外一行（工厂注入）→ 停，D-268；②发布/apply/rehearsal 全部留给 Lemon 批。无生产写操作。
