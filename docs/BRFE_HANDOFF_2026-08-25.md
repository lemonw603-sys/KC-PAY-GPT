# BRFE 接班入口（Browser 线，2026-08-25）

## 当前 worktree 与提交

- Worktree：`/Users/lemon/.codex/worktrees/9128/AI充值业务`
- 分支：`codex/browser`
- 基线 HEAD：`bd9f05b4949f86b9ec095c16abaf7ab6f01f277e`；当前交接提交：`368bcb1`
- 当前跟踪文件无修改；未跟踪：`.playwright-cli/`、`artifacts/`
- 本入口只维护 Browser 线，不覆盖非 Browser 共享事实源。

## 当前阶段

阶段 M5（共享合同只读兼容层）已完成；`browser-mvp/` 已接入当前分支，但尚未接入新版 BRFE 控制面或共享核心写路径。不能把其他 worktree/分支中的 Browser 提交视为本分支已完成。

## M0 已完成与验证

- 四个可替换 Port：`BrowserExecutionPort`、`DispatchStore`、`EvidenceSink`、`RuntimeAdapter`。
- 合成 `LOCAL_MOCK` / `NON_PH_FUNCTIONAL` manifest、job envelope 和 evidence fixture。
- 运行时拒绝 Session、卡号、CVV、Checkout authority、密钥等敏感字段；默认 Port 未实现时 fail-closed。
- `npm --prefix browser-mvp test`：4/4 通过。
- `npm --prefix browser-mvp run check`：通过。

## M1 已完成与验证

- `FileDispatchStore`：原子 JSON 持久化、幂等 enqueue、claim、lease heartbeat、complete、过期 recover。
- 8 个并发 mock worker 处理 240 个合成 job：240 次唯一 claim、0 漏领、0 非完成残留。
- 旧 lease token 在接管后无法 heartbeat 或 complete；rename 结果不明时不自动重放 claim。
- M1 测试总计 7/7 通过（含 M0 合同测试）。

## M2 已完成与验证

- `LocalPlaywrightRuntimeAdapter` 打开隔离 headless Chromium BrowserContext，仅允许 `LOCAL_MOCK` 且 `allowWrites=false`。
- `BrowserExecutionService` 做页面 URL/title/marker 检查并记录 frame count；不暴露 submit/payment 写接口。
- 页面漂移、租约丢失、人工冻结、导航超时均 fail-closed；本地集成测试和 `submitCalls=0` 断言通过。
- M2 测试总计 11/11 通过；`npm --prefix browser-mvp run check` 通过。

## M3 已完成与验证

- `AppendOnlyWal` / `WalEvidenceSink`：单写者追加、序列和 SHA-256 哈希链；重启校验通过。
- WAL 截断/篡改均抛 `WalIntegrityError`，恢复不会继续执行。
- `reconcileIncompleteJobs` 将无终态证据的 RUNNING job 置为 `RECONCILE_ONLY`，不自动重放。
- M3 测试总计 14/14 通过；`npm --prefix browser-mvp run check` 通过。

## M4 已完成与验证

- 10 分钟本地/隔离 soak：实际 601439ms，8 workers，100ms 间隔。
- 5328/5328 job 完成，唯一 claim 5328，重复 0，错误 0，残留 0。
- WAL 15984 条、6,520,982 bytes；soak 内校验通过；Chromium preflight `submitCalls=0`。
- 报告：`/var/folders/vv/y6273_2s7n98r55m2rc96p_w0000gn/T/browser-mvp-soak-SOtfzq/report.json`。
- 最终 `npm --prefix browser-mvp test` 14/14，`npm --prefix browser-mvp run check` 和 `git diff --check` 均通过。

## M5 已完成与验证

- `ReadOnlySharedContractAdapter` 只接受规范化 order/attempt/profile projection，输出 Browser job 引用。
- order 仅允许 `CARD_READY`/`RECONCILIATION_REQUIRED`；attempt 仅允许 `PENDING`/`OBSERVING`；资金只允许 `NOT_REQUESTED`。
- active permit、Session/卡凭据/Checkout authority/API key 等源字段直接拒绝。
- 当前 v1 没有已冻结的 `recharge_attempts` 表合同，适配器不会从 tasks/provider calls 猜测。
- Browser MVP 测试总计 17/17；`npm --prefix browser-mvp run check` 通过。

## 当前分支已验证

- 旧版 v1 的隔离边界、Worker runtime、Provider PoC 定向测试：8/8 通过。
- 全量 `v1 npm test` 已启动；78 tests 中 75 pass、3 个测试文件因当前 worktree 未安装 `express`/`mysql2` 启动失败。
- 已存在旧 Browser 运行产物：`artifacts/browser-poc/*.json`；它们是未跟踪历史证据，不是当前运行时配置。

## 已完成但尚未进入本分支的 Browser 工作

以下内容在其他 Browser worktree/分支提交中存在，但当前 `codex/browser` 尚未包含：

- Browser Worker control shell、loop、process wrapper；
- dispatch queue、claim/lease/heartbeat、ambiguous claim 修正；
- WAL-backed 编排、artifact vault、资源租约恢复；
- 本地 BrowserContext mock 接线、NON_PH manifest/PoC 合同；
- 阶段 soak 报告、BRFE 当前状态和 Browser 交接文档。

相关提交对象可见但未合并到当前分支：`5c0a600`、`7ead4d6`、`75e119d`、`2ee2518`、`d394b53`、`acba927`。

## 未验证事实

- 当前分支没有新版 Browser Worker/dispatch/WAL/artifact vault 实现，因此不能在本 worktree 宣称这些能力已验证。
- 真实 Session、菲律宾出口、Checkout、付款、生产 Worker、生产高可用均未在本分支验证。
- 当前 worktree 的依赖缺失导致完整 v1 测试未能全绿；需在不改变共享核心的前提下补齐依赖后重跑。

## 迁移审计结果

直接迁移已整理 Browser 小提交被依赖审计阻塞：最早前置 `a84c293` 是包含 108 个文件的混合检查点，含共享资金/Provider/Worker/生产相关改动，不能整批 cherry-pick。详见 `docs/2026-08-25_browser-transfer-audit.md`。

## 下一步唯一动作

由统筹窗口评审 `docs/2026-08-25_browser-shared-contract-compat.md` 的未决合同；未冻结前不进入共享写路径、真实 Session、Checkout、卡片、付款、Provider 写入或生产 release；不 cherry-pick 混合检查点，不使用 `git add -A`，不清理 `.playwright-cli/`/`artifacts/`。

## 共享事实源边界

本次未修改 `docs/CURRENT_STATE.md`、`docs/DECISIONS.md`、`docs/HANDOFF_LOG.md`。需要跨线更新时，先向非 Browser 统筹窗口提出。
