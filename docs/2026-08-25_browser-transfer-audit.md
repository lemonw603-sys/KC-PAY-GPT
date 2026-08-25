# Browser commit 转移审计（2026-08-25）

## 结论

当前 `codex/browser` 不能直接 cherry-pick 已整理的新版 Browser 小提交。它们的最早实现前置是 `a84c293`，而该提交是混合检查点，不能在当前协作边界下整批迁移。

## 当前基线

- 当前 worktree：`/Users/lemon/.codex/worktrees/9128/AI充值业务`
- 当前分支基线：`bd9f05b`
- Browser 交接提交：`54ee839`
- 目标 Browser 提交：`5c0a600`、`7ead4d6`、`75e119d`、`2ee2518`、`d394b53`、`acba927`

## 依赖证据

- `5c0a600` 修改 `v1/src/services/browser-worker-service.js`，但该文件在当前基线不存在。
- `7ead4d6` 修改 `v1/src/db/repositories/browser-dispatch-repository.js`，但该文件在当前基线不存在。
- `75e119d`、`2ee2518`、`d394b53` 依赖前述 Browser 控制面和测试目录已经存在。
- 最早的 Browser 控制面检查点是 `a84c293`，一次变更 108 个文件（约 11,568 行），同时包含：
  - Browser PoC、WAL、manifest、Browser Worker、dispatch、artifact vault 和 Browser admin；
  - `recharge_attempts`、`workflow-handlers`、`worker.js`、Provider/卡资金服务等共享核心改动；
  - `package.json`、共享事实源和生产/运营相关文档改动。

## 当前处理

- 未执行 cherry-pick、merge、reset、checkout 覆盖或 `git add -A`。
- 未修改非 Browser 共享核心和生产 release。
- 现有 `.playwright-cli/`、`artifacts/` 保持未跟踪，未删除。

## 安全迁移选项

1. 由统筹窗口先提供一个已冻结的共享核心基线，再把 Browser-only 文件/测试/合同按依赖顺序迁移。
2. 在当前基线建立 Browser-only extraction 分支：逐项提取 `a84c293` 的 Browser 文件，同时单独列出必须由共享核心窗口审核的 schema/repository/worker 接口，不在 Browser 线私自补齐。
3. 暂不迁移，继续在当前旧基线维护交接和阻塞事实。

当前推荐停在选项 1/2 的决策点；直接 cherry-pick `a84c293` 会违反“不修改非 Browser 共享核心”的边界。

## 未验证

在依赖基线未冻结前，当前 worktree 不能验证新版 Browser Worker、dispatch、WAL、artifact vault、资源租约、本地 BrowserContext 接线或新版 PoC 合同。
