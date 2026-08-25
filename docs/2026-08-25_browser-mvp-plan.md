# Browser MVP 落地计划（2026-08-25）

## 目标

在当前 `codex/browser` worktree 先落地一个具备核心控制能力的 Browser MVP：

`合成订单引用 → durable dispatch → lease/heartbeat → 本地 BrowserContext → 页面检查点 → fail-closed 停止 → WAL/脱敏证据 → 重启恢复`

MVP 不执行真实 Session、Checkout、卡片、付款、Provider 写入或生产 Worker；后续通过适配器接入共享订单、`recharge_attempts`、资金栅栏和审计，不建立第二套业务系统。

## 不变量

1. 任何运行时只接受订单/attempt/profile 引用，不接受卡号、Session 原文、Checkout authority 或明文密钥。
2. lease 丢失、页面漂移、人工冻结、动作超时、状态未知时立即停止；不重付、不换卡、不换 lane。
3. 外部动作前必须先写 intent/checkpoint；MVP 仅允许本地 mock gateway，提交计数必须为 0。
4. WAL 只保存引用、哈希、状态和脱敏摘要；敏感字段进入 WAL 必须拒绝。
5. Browser MVP 的持久化接口通过 ports 定义，未来可替换为 MySQL，不在本轮修改非 Browser 共享核心。

## 阶段与退出条件

### M0：基线冻结与目录隔离（已完成）

交付：

- `browser-mvp/` 独立目录和 README；
- `BrowserExecutionPort`、`DispatchStore`、`EvidenceSink`、`RuntimeAdapter` 四个最小接口；
- 合成订单/attempt/profile fixture；
- 当前 worktree/commit/未跟踪产物记录。

退出条件：不依赖混合 `a84c293`，不修改非 Browser 共享核心；`node --check` 和最小 contract test 通过。

完成证据（2026-08-25）：`browser-mvp/` 已建立，四个 Port、合成 job/manifest/evidence fixture 和 4 条 Node contract tests 已提交；`npm test` 为 4/4，通过 `npm run check`。M0 未连接共享订单、MySQL、真实 Session、Checkout、卡片或付款。

### M1：控制面 MVP（已完成）

交付：

- enqueue/claim/heartbeat/complete/recover；
- lease token、过期接管、幂等 job key；
- `RUNNING`、`FROZEN`、`RECONCILE_ONLY`、`COMPLETED` 等最小状态；
- bounded retry 只覆盖明确可重试的存储错误；ambiguous claim 不自动重试。

退出条件：8 个并发 mock worker 对 240 个合成 job 无重复、无漏领；旧 token 不能续租。

完成证据（2026-08-25）：`FileDispatchStore` 使用本地 JSON + 临时文件原子 rename，已覆盖幂等 enqueue、claim、heartbeat、complete、过期 recover；rename 结果不明时抛出 `AmbiguousStorageError`，不自动重放 claim。`npm --prefix browser-mvp test` 为 7/7（含 8 worker/240 job 并发场景）。

### M2：本地 Browser 执行（已完成）

交付：

- 临时 Playwright BrowserContext；
- 导航、页面签名检查、popup/iframe 发现；
- 页面漂移、lease 丢失、动作超时、人工冻结均触发 Abort/fail-closed；
- mock gateway 明确记录 `submitCalls=0`。

退出条件：本地 BrowserContext 集成测试通过，任何敏感动作被拦截时提交计数为 0。

完成证据（2026-08-25）：`LocalPlaywrightRuntimeAdapter` 使用隔离 headless Chromium context；`BrowserExecutionService` 完成导航、URL/title/marker 检查、iframe 计数、租约和人工冻结检查。页面漂移、租约丢失、人工冻结、导航超时均记录脱敏 freeze 事件并 fail-closed；11/11 测试通过，观察结果 `submitCalls=0`。

### M3：WAL、证据与恢复（已完成）

交付：

- append-only WAL、序列/哈希链、单写者锁；
- intent→checkpoint→completion 事件；
- 脱敏 run timeline、运行指标和恢复原因；
- Worker crash、WAL 截断/篡改、重启接管测试。

退出条件：重启后可恢复未完成 job；未知状态只能进入 reconcile-only；WAL 中不存在 Session、卡号、CVV、Checkout authority。

完成证据（2026-08-25）：`AppendOnlyWal`/`WalEvidenceSink` 已实现单写者追加、序列和 SHA-256 哈希链；新实例可验证链，截断/篡改直接抛 `WalIntegrityError`。重启时无终态的 RUNNING job 只进入 `RECONCILE_ONLY`，不自动重放。14/14 测试通过。

### M4：MVP soak 与交接

交付：

- 10–15 分钟本地/隔离 soak；
- 资源、延迟、残留和重复计数；
- Browser MVP 合同、当前状态、交接记录和回放命令；
- 独立 Git commit。

退出条件：soak 残留为 0，`npm run test:browser-mvp` 全绿，Browser-only worktree 路径无未提交源码改动。

## 未来升级预留

- `RuntimeAdapter` 预留真实 Playwright runtime，但默认只允许 `LOCAL_MOCK` manifest。
- `DispatchStore` 预留 MySQL 实现；不把本地 JSON/WAL 当作生产资金账本。
- `BrowserExecutionPort` 预留共享订单/attempt/资金栅栏适配，不在 MVP 内复制订单状态机。
- `EvidenceSink` 预留加密 artifact vault 和后台追溯映射；MVP 只保存脱敏引用/哈希。
- `CohortManifest` 预留 `NON_PH_FUNCTIONAL`、PH cohort、runtime/profile/network digest；不在 MVP 内接真实网络。

## 明确不做

- 不 cherry-pick 混合 `a84c293`；
- 不修改 `orders`、`recharge_attempts`、资金 permit、Provider adapter、生产 worker 或共享迁移；
- 不接真实 Session、菲律宾出口、Checkout、卡片、付款、退款、提现或生产 release；
- 不把旧 worktree 的 Browser 证据外推为当前分支已验证能力。

## 当前唯一下一步

进入 M4：进行 10–15 分钟本地/隔离 soak，统计 lease、残留、延迟、重复和 WAL 增长，随后完成 Browser-only 交接；不接真实 Session、Checkout 或付款。每个阶段结束都更新 `BRFE_HANDOFF_2026-08-25.md`、`BROWSER_CURRENT_STATUS_2026-08-25.md` 和本计划的证据链接。
