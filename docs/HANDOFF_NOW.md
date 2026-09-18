# 接班一屏（HANDOFF_NOW）

更新：2026-09-18 09:5x UTC+8（2026-09-18 01:5x UTC，落实第③步窗口收尾）。按 CLAUDE.md 约定维护，接手者从 main 继续，不另起项目。

## 现在是什么

- **V2 落实 8 步：①②③已完成，下一块是第④步**（任务书 `docs/tasks/2026-09-18-impl-step4-on-demand-sync-retire-contracts.md`）。
- **第③步「卡台选择表 + 供卡调度」已上生产**：release `20260918-step3-supply-ba28273`（2026-09-18 00:11:53 UTC 切换，迁移 053 只加不删）。
  - 「产品 × 执行器 → 卡台」选择表 `card_source_selections` 是唯一真相（六行：API 三行固定 101 锁定，Browser 三行 103）；intake 只读它；切路线 / 切卡台前四项校验（生产已实证两次：切 BROWSER、切回 API 都四项全过）。
  - **供卡调度已上线**：`pojia-card-stock-runner.timer` 60s 一轮 + 总闸 `card_auto_replenishment_enabled=true`（00:50 UTC 开）。策略 `card_supply_policies`：Plus 每台水位 2 / $50、Pro 0 / $100 与 $150、每台日限 20；底线 hnskj 30 / highvcc 20；水位统计用**库存口径**（资格规则去掉 15 分钟新鲜度，D-259）。
  - 965 条旧残留已归档 `ARCHIVED_LEGACY`（D-260）；hnskj 真开一张 5622（$50，成本观察 $0.75，T2 首个真实样本，D-262）。
  - worker 的 PURCHASE_CARD/VERIFY_CARD 死线已删；browser-mvp 只改白名单两处（按 `sync_tier` 判交易读取器，为什么不按账户能力位见 D-261）。
- **调度器此刻的判断**（01:0x UTC 那轮）：hnskj plus 2/2 不缺；**highvcc plus 1/2 缺 1 但钱包 $23.65 过不了预检（要 ≥ $76）→ 不开、告警 `CARD_SUPPLY_WALLET_LOW` + `PROVIDER_WALLET_LOW` 开着**。Lemon 充值到 ≥ $76 并在时段内贴 token 后，调度器下一轮自己开，不用叫人。
- 生产：接单 / 派单 / 付款开关 true；Plus 默认路线 API（301=1）；305/306 仍关（D-245）；非终态 0；常驻 Browser 池本机 PID 74272（01:44 UTC 起）。具体值只看 `CURRENT_STATE`。

## 证据从哪里看

1. `docs/V2.0_EXECUTION.md` **§6 第③步那节**：A/B/C/D/E 逐块证据、与任务书不同的 6 处、范围外发现 12 条。
2. `docs/DECISIONS.md` **D-259 ~ D-265**：水位口径 / 归档 / sync_tier 判定理由 / 开卡样本 / 调度上线首轮 / 演练两次。
3. `docs/RUNBOOK.md` **§2.5 供卡**：怎么看水位、怎么人工开一张、开卡失败会怎样、归档脚本。
4. 提交：`19ee0b8`（主体）· `4bb3dae`（053 注释修正）· `ba28273`（库存口径）· `ac4f8ab`（收口脚本扩形态）· 文档 `16617fc`/`e4d7d04`/`2b018e6`/`9149dac`。

## 接下来做什么

1. **开第④步窗口**：任务书已写（按需同步 / 待销清单 / 三张契约表）。先做任务书「先做这个」五项前置核查。
2. **Lemon 侧运营**：highvcc 钱包充到 ≥ $76 + 时段内贴 token（调度器自开那张，同时验 highvcc 的 T2 样本）；有无试用资格的 free 号时补一次 rehearsal（报价段未验）。
3. 已立项未排期：数据库集成测试既有 19 失败（D-258，本块对照证明未新增）。
4. **main 上有一处未发布的小改**（D-265 第 3 条，接单/派单开关补审计行）：随第④步发布，不单独发版。

## 已定不做 / 别再重开的

- 卡台↔支付方式解耦：**结论已定**（Browser 任意卡台 / API 固定 hnskj，D-253），选择表 API 行锁定。
- 水位口径：**库存口径**（D-259），不要改回资格 SQL；分卡那侧的 15 分钟窗口归第④步面二⑨。
- 后台「能不能开卡补钱」按钮**别用**（会连补余额开关一起开），用 `set-supply-scheduler-flag.mjs`。
- 免费试用账号：方向已定（D-265：Lemon 说这种号可走 API，Browser 遇到 offer 页 → 该单改走 API），落地归第⑤块（要先落页面特征坐实、换卡走正式路径），第④块不做。

## 未验证边界（别说成已完成）

- **rehearsal 报价段未验**：两次演练都停在付款前（一次 Session 复用、一次免费试用 offer 页），browser-mvp 那两行（付款后交易读取器）只有单测（303/294/0）证明，真单付款后核对才算生产验证。
- **highvcc 自动开卡未跑过**：调度器只在预检处拒过，`openCardForSupply` 生产未执行过；NO_PAN 自动补记只有单测。
- **故障转台生产未发生过**：只有单测；两台 `supply_fault_state` 至今 OK。
- **新开 hnskj 卡 `sync_tier` 落库是 `AVAILABLE`** 不是 `INVENTORY`（5276、5622 都是），被谁改写未查。
- 集成测试既有 19 失败（D-258）。

## 分支、运行与禁止事项

- main 是接手入口；本窗口提交已全部推送。本机临时 MySQL 容器已删、基线 worktree 已删；Session 临时副本服务器与本机均已删。
- 常驻 Browser 池 PID 74272 不要当残留杀掉；supervisor 的「残留 worker」判据会被含 `production-live-pool-worker` 字样的瞬时命令误触发一轮（自愈）。
- 演练用的 Lane 3 窗口停在免费试用 offer 页现场，未关，可关。
- 付款未知禁止重付/换卡；开卡 / 补余额 / 切路线 / 发布 / 归档 / 改开关 **先开口问**；范围外发现只报不改（D-254）。

## 暂停/恢复记录

- 本窗口两次「先问再动」停顿：C 放行前 Lemon 问水位口径（答后改 D-259）；E 停常驻池与切路线前问（批后做，顺序按心跳修正）。无遗留暂停。
