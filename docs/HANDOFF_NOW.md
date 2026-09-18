# 接班一屏（HANDOFF_NOW）

更新：2026-09-18 14:4x UTC+8（2026-09-18 06:4x UTC，第④步已发布、apply 已做，演练与池重启待做）。按 CLAUDE.md 约定维护，接手者从 main 继续，不另起项目。

## 现在是什么

- **V2 落实 8 步：①②③④已上生产**（第④步 release `20260918-step4-251a441`，2026-09-18 06:26:47 UTC 切换，迁移 054），⑤任务书已写（`docs/tasks/2026-09-18-impl-step5-notification-whitelist-daily-reconciliation.md`）。
- **第④步做了什么（D-267/D-269）**：分卡时候选卡过期 → 当场同步再按同一条资格规则判；定时同步 AVAILABLE 卡 3 小时、不再排 highvcc 卡；待销清单派生查询 + 两端点；取消续费超时不卡单（照常成功 + 提醒 + 卡进待销）；API 付款不明两路证据自动收口 / 交人带证据 / 后台 RESOLVE；Browser 崩溃后进补核、叫人带证据、备用卡台走 `card_transactions` 真证据（**常驻池重启后才生效**）。
- **已 apply**：hnskj 12 张 + highvcc 8 张 + 3336（Lemon 手动付 20X）共 21 张 RETIRED；`card_sync_jobs` 307 条归档。
- **现场事件（06:27 UTC）**：Lemon 充值后调度器自动开 highvcc **4022**（$50，可分配）；**第二张 `HG3c6ea2…`（尾号 8718）卡台已开出、$50、钱已扣（钱包 41.49），库里没入（`HIGHVCC_RECONCILE_NOT_READY`）→ 103 FAULT、调度器停开、`CARD_SUPPLY_OPEN_FAILED` OPEN。补记等 Lemon 一句：`ssh … node scripts/reconcile-highvcc-card.mjs HG3c6ea2018a0444659e947ea5e7161eca`。**
- 生产：接单 / 派单 / 付款开关 true；Plus 走 API；hnskj 2 张（窗口外由分卡当场同步）；非终态 0；常驻 Browser 池本机 PID 74272（**旧代码、旧 5 分钟窗口**，未重启）。具体值只看 `CURRENT_STATE`。

## 证据从哪里看

1. `docs/V2.0_EXECUTION.md` **§6 第④步那节**：五项前置核查、A/B/C 逐块证据、与任务书不同的 5 处、范围外发现 6 条、待 Lemon 定 5 件。
2. `docs/DECISIONS.md` **D-267 / D-268**。
3. 三张契约表：`docs/contracts/2026-09-18_{delivery-criteria,payment-unknown-reconciliation,human-intervention-points}-contract.md`。
4. `docs/RUNBOOK.md` **§2.6**：待销清单怎么看/登记、API 付款不明怎么收口、按需同步怎么看。

## 接下来做什么（顺序）

1. **补记第二张 highvcc 卡**（Lemon 一句）：服务器 `reconcile-highvcc-card.mjs HG3c6ea2018a0444659e947ea5e7161eca`；补记后新连接核实 cards 多一张 8718、103 `supply_fault_state` 回 OK、`CARD_SUPPLY_OPEN_FAILED` 关。
2. **rehearsal 演练**（browser-mvp 动了）：要 Lemon 给一个无试用资格 free 号的**新鲜** Session + 一张 CDK。流程同 D-264：切 BROWSER → `stop-live.sh` → 建单 → `run-live-rehearsal.sh once` → `close-rehearsal-order.mjs` 收口 → 切回 API → 开回付款开关（supervisor 自动拉起的新池即带新代码 + 30 分钟窗口 = 第 4 步一并完成）。
3. 发布后用一张窗口外 hnskj 卡 + 一单验「分卡不再等卡」（`provider_calls` 出现 `order-demand-sync:` 两条读）。
4. 然后开第⑤步窗口。

## 已定不做 / 别再重开的

- 资格规则不改（D-266 a）；水位口径库存口径（D-259）；卡台↔支付方式解耦已定（D-253）。
- 待销清单不建表（缝 c）；自动销卡推 V3（D-232）。
- `CANCELLATION_REVIEW_REQUIRED` 不再由自动路径产生；枚举保留给历史单。
- ZZSHU 零原因失败「停单不退码」本块没做，与队列一起归第⑤/⑥块。
- 免费试用号走 API（D-265）归第⑤块；放弃并放卡按钮归第⑥块。

## 未验证边界（别说成已完成）

- **第④步代码已在生产但无真单样本**：分卡当场同步、API 付款不明、Browser 崩溃进补核都没有真单走过；待销端点未在生产调过（口径 SQL 已实跑）。
- highvcc 卡「卡台扣款」真证据一路：代码已在 main + 服务器，但**常驻池 PID 74272 仍是旧代码**，重启前仍是旧 marker 恒匹配。
- rehearsal 报价段仍未验（第③步遗留）；highvcc 自动开卡未跑过；故障转台未发生过；集成测试既有失败（D-258，本块本机基线 15 条、改后名单见账本）。

## 分支、运行与禁止事项

- main 是接手入口；本窗口提交已推送。本机临时 MySQL 容器已删；隧道 13306 保留。发布包 `artifacts/release-candidate-20260918-step4-*` 两份在本机（git 忽略）。
- 常驻 Browser 池 PID 74272 不要当残留杀掉。
- 付款未知禁止重付/换卡；开卡 / 补余额 / 切路线 / 发布 / apply / 改开关 / 重启 worker **先开口问**；范围外发现只报不改（D-254）。

## 暂停/恢复记录

- 本窗口「先问再动」停顿：①白名单外一行（工厂注入）→ 停，D-268；②发布/apply/rehearsal 全部留给 Lemon 批。无生产写操作。
