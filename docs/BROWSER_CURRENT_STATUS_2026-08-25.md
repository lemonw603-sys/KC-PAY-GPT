# Browser 当前状态（2026-08-25）

## 事实快照

| 项目 | 当前事实 |
| --- | --- |
| worktree | `/Users/lemon/.codex/worktrees/9128/AI充值业务` |
| 分支 | `codex/browser` |
| 基线 HEAD | `bd9f05b` |
| 当前交接提交 | `2f9cb70` |
| 跟踪改动 | 无 |
| 未跟踪改动 | `.playwright-cli/`、`artifacts/` |
| Browser MVP 恢复层 | `browser-mvp/` 已包含合同、dispatch、只读 Playwright 执行和 WAL 恢复；共享控制面仍未接入 |
| 生产/真实付款 | 未接入、未执行 |

## 当前阶段

阶段 M3：Browser MVP WAL/恢复已完成。当前不是新版 BRFE 阶段 A/B/C 的完成状态；新版控制面和共享适配器尚未进入本分支。

## 本分支已验证

- 旧 v1 隔离边界、Worker runtime、Provider PoC 定向测试：8/8 通过。
- 全量 v1 测试：75 pass；3 个测试文件因缺少 `express`/`mysql2` 启动失败，结果不能记为全量通过。
- 旧 Browser PoC JSON 产物存在于 `artifacts/browser-poc/`，尚未纳入当前分支追踪。
- `browser-mvp` contract tests：4/4 通过；`node --check`：通过。
- `FileDispatchStore` 并发/租约测试：3/3 通过（总测试 7/7）。
- 本地 Chromium BrowserContext/执行器测试：4/4 通过（总测试 11/11）；漂移、租约丢失、冻结、超时均 fail-closed。
- WAL/重启/reconcile-only 测试：3/3 通过（总测试 14/14）；截断/篡改均阻断恢复。

## 本分支未验证

- 新版 Browser Worker/dispatch/lease/heartbeat；
- WAL、artifact vault、账号/订单/卡片/Checkout 资源租约；
- 本地 BrowserContext Worker 接线和页面漂移 fail-closed；
- `NON_PH_FUNCTIONAL` 只读观察器和新版 Browser 合同；
- 菲律宾 cohort、真实 Session、Checkout、付款、生产 Worker、高可用拓扑。
- M4 10–15 分钟本地/隔离 soak 和 Browser-only 交接。

## 暂停条件

- 不把其他 worktree/分支的 commit 当成本分支事实；
- 不删除或覆盖 `.playwright-cli/`、`artifacts/`；
- 不修改非 Browser 共享核心、生产 release 或共享事实源；
- 不执行真实付款、开卡、卡余额充值或生产 Browser 写入。

## 下一步

进入 M4：在 `browser-mvp/` 内执行本地/隔离 soak 并记录指标；不接共享订单、MySQL 或真实 Browser 写入。
