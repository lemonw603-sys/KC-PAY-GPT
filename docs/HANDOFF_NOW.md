# 接班一屏（HANDOFF_NOW）

更新：2026-09-17 22:20 UTC+8（14:20 UTC，Fable 5.1 接手窗口收尾）。按 CLAUDE.md 约定维护，接手者从 main 继续，不另起项目。

## 现在是什么
- **V2 方向工作全部完成（D-243 步①②③）**：接手核对（理解文档）→ 清账本五面逐面重问、Lemon 逐面拍板（D-246～D-251）→ 整体连贯审（D-252）。**账本 `docs/V2.0_EXECUTION.md` §3.A 是唯一定稿**：面一卡台与路线 / 面二供卡 / 面三执行与交付 / 面四通知与对账 / 面五展示与控制 + 连贯审补丁 + 落实顺序 8 步；旧 A/B/C/G 全部作废或并入。
- **落实（步④）已开始**：第①步 C2 已跑出结论（D-253：ZZSHU 拒 highvcc 卡 40020，认 BIN；Lemon 定 API 固定 hnskj、不加 BIN；解耦结论 = Browser 任意卡台 / API 固定 hnskj）。**下一件 = 第②步「数据源三件」，任务书 `docs/tasks/2026-09-17-impl-step2-data-sources.md`，开专门落实窗口做。**
- 生产：release `20260916-unified-4334dc2`；Plus 默认路线 API（301=1）；**305/306（Pro）接单位已关**（D-245，方案改完再开）；接单/派单/付款 true；非终态 0；本机 Browser PID 47905 常驻；highvcc token 12:47 UTC 重贴、同步已恢复。具体值只看 CURRENT_STATE。
- 本窗口生产写操作 3 次（均 Lemon 当次同意）：关 305/306（D-245）、两次手动触发 highvcc 快照同步、C2 直调 ZZSHU 一次（被拒、未扣款）。无发布。

## 证据从哪里看
1. `docs/V2.0_EXECUTION.md` §3.A：五面定稿 + 补丁 + 落实顺序（唯一）。
2. `docs/tasks/2026-09-17-ledger-face-{1..5}-*.md` + `2026-09-17-coherence-review.md`：每面讨论稿、Lemon 原话、证据位置。
3. `docs/tasks/2026-09-17-handover-understanding.md`：主线图与接手核对。
4. `docs/DECISIONS.md` D-244～D-253：本窗口全部决定。
5. `docs/contracts/2026-09-17_zzshu-third-party-api-plans-excerpt.md`：ZZSHU 套餐文档摘录（pro5/pro20 支持）。

## 接下来做什么
1. **开落实窗口做第②步**（任务书见上）：T1 highvcc 交易/钱包入库、T2 hnskj 开卡费、T3 账本补记 8 单 + 人工收口写账本。T3 补记 apply 前把 dry-run 摆给 Lemon。
2. 之后按账本「做的顺序」③～⑧逐块开窗口；每块做完放回主线验。
3. 运营侧待 Lemon：每天固定时段贴 highvcc token（D-251）；两批旧卡标终态在第③步一并做。
4. 正常来单仍按 RUNBOOK；当前 Plus 走 API + hnskj（5276 一张，合格窗口每小时 15 分钟，见 CURRENT_STATE）。

## 分支、运行与禁止事项
- main 是接手入口；本窗口只有文档提交与上述 3 次生产写，没有代码改动、没有发布。
- 常驻 Browser 不要当残留杀掉。305/306 在 Pro 落实（顺序第⑦步）前**不重开**。
- 付款未知禁止重付/换卡；开卡/补余额/切路线/发布/账本补记先开口问。
- C2 脚本在 scratchpad（会话级临时目录），Session 文件已删；ZZSHU 对 highvcc BIN 不支持，不再试。

## 暂停/恢复记录
- 本窗口无暂停。highvcc 快照同步 08:38～12:38 因 token 过期失败 4 次，12:47 重贴、12:53 恢复。
