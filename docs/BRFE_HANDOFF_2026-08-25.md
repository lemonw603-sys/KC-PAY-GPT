# BRFE 接班入口（Browser 线，2026-08-25）

## 当前 worktree 与提交

- Worktree：`/Users/lemon/.codex/worktrees/9128/AI充值业务`
- 分支：`codex/browser`
- HEAD：`bd9f05b4949f86b9ec095c16abaf7ab6f01f277e`（与当前 `main` 相同）
- 当前跟踪文件无修改；未跟踪：`.playwright-cli/`、`artifacts/`
- 本入口只维护 Browser 线，不覆盖非 Browser 共享事实源。

## 当前阶段

当前 worktree 仍是旧 Browser 基线，尚未接入新版 BRFE 控制面。不能把其他 worktree/分支中的 Browser 提交视为本分支已完成。

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

## 下一步唯一动作

先与 Browser 线统筹窗口确认将哪些已审查 Browser commit 转移到 `codex/browser`，再按 commit 粒度迁移；迁移前不使用 `git add -A`、不清理 `.playwright-cli/`/`artifacts/`、不修改非 Browser 共享核心或生产 release。

## 共享事实源边界

本次未修改 `docs/CURRENT_STATE.md`、`docs/DECISIONS.md`、`docs/HANDOFF_LOG.md`。需要跨线更新时，先向非 Browser 统筹窗口提出。
