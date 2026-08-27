# Browser 工作区整理清单（2026-08-24）

## 目的

本清单只做归属和提交边界整理，不删除、移动或覆盖任何文件。它把当前工作区分成“已提交基线、待审实现、证据/文档、非 Browser 或生成产物”四类，供下一次 Browser commit 和交接使用。

## 基线

- 当前分支：`codex/competitor-recharge-research-20260824`
- Browser 最近安全提交：`5c0a600 fix(browser): abort timed out actions and finalize soak evidence`
- 该提交包含：Worker 超时 fail-closed、超时测试、24h soak 完成报告。
- 当前清单生成时，`git diff --check` 通过。

## A. 已提交、可作为当前 Browser 基线

- `v1/src/services/browser-worker-service.js`
- `v1/test/browser-worker-timeout.test.js`
- `docs/2026-08-24_browser-stage1-24h-soak-completion-report.md`

后续整理提交：`7ead4d6`（dispatch ambiguous claim 修正）、`75e119d`（隔离夹具）、`2ee2518`（阶段证据/交接）、`d394b53`（当前状态/Worker evidence）。

## B. 已完成审查并提交的 Browser 实现/测试

这一批原先在共享工作区未提交，现已完成边界审查并单独固化：

- `v1/src/db/repositories/browser-dispatch-repository.js`
- `v1/test/browser-dispatch-repository.test.js`
- `v1/test/browser-worker-service.test.js`

审查结论与修正见 `docs/2026-08-24_browser-dispatch-ambiguous-claim-review.md`。`claim()` 不再重试 ambiguous timeout/connection loss；`enqueue()`/`complete()`/heartbeat 的安全重试边界保留。对应提交：`7ead4d6`、`d394b53`。

## C. 已跟踪的 Browser 测试夹具与运行脚本

以下内容已在 `75e119d` 中跟踪，保留在原路径且不视为生产入口：

- `v1/test-support/browser-*.js`
- `v1/test/browser-worker-concurrency.test.js`
- `v1/test/browser-worker-local-mock-integration.test.js`
- `test/browser-nonph-manifest.test.js`
- `browser-poc/manifests/non-ph-us-readonly-2026-08-23.json`

当前不得注册为生产 Worker、不得接真实付款。

## D. 已跟踪的 Browser 证据、报告和交接文档

以下内容已在 `2ee2518`、`d394b53` 中跟踪，是历史或当前阶段证据，不应混入运行时代码：

- `docs/2026-08-22_browser-*.md`
- `docs/2026-08-23_browser-*.md`
- `docs/2026-08-23_nonph-*.md`
- `docs/2026-08-22_nonph-observation-adversarial-review.md`
- `docs/2026-08-22_session-cookie-family-ab-evidence.md`
- `docs/BRFE_HANDOFF_2026-08-22.md`
- `docs/BROWSER_AUTOMATION_HANDOFF_2026-08-23.md`
- `artifacts/browser-soak/*`

本轮已核验的 24h 日志和独立查询见 `docs/2026-08-24_browser-stage1-24h-soak-completion-report.md`。旧元数据曾保持 `RUNNING`，不能单独作为完成证据；后续 runner 已修复完成回写。

## E. Browser 状态事实源中的共享未提交改动

这些文件同时包含其他窗口的项目状态变更，本次只确认 Browser 口径已补充，未尝试拆分提交：

- `docs/BROWSER_CURRENT_STATUS_2026-08-22.md`
- `docs/CURRENT_STATE.md`
- `docs/DECISIONS.md`
- `docs/HANDOFF_LOG.md`
- `docs/ROADMAP.md`
- `docs/2026-08-23_browser-master-plan.md`
- `docs/2026-08-23_browser-stage1-24h-soak-run.md`

下一动作：先完成 B/C/D 类文件的归属确认，再用分块 staging 方式提交，避免把非 Browser 改动混入 Browser commit。

## F. 非 Browser 或生成产物

当前工作区还包含 `CLAUDE.md`、`docs/AI_AGENT_ROLE_AND_READING_GUIDE_2026-08-21.md`、`docs/08-handoff/`、`docs/competitor-research/`、`output/`、`dogfood-output/`、`tools/` 和其他 `artifacts/` 内容。这些不属于本 Browser 整理范围，保持原状。

## 当前清洁判定

- “Browser 源码、隔离夹具、Browser 证据和 soak artifact 是否 clean”：是，已分批提交并通过对应定向测试。
- “整个工作树是否 clean”：否，E 类跨项目事实源和 F 类非 Browser/生成产物仍未提交或未跟踪。
- “是否可以安全执行 `git clean`/`git reset`”：否，会破坏 E/F 类未确认的共享改动或生成证据。

## 后续唯一整理顺序

1. 由非 Browser 负责人决定 E 类跨项目事实源的提交边界，不在 Browser commit 中混入。
2. F 类 release/竞品/工具产物按各自工作线处理；不使用破坏性清理命令。
3. Browser 后续每个阶段只提交对应源码、测试、证据和本清单更新。
4. 运行 `git status --short`、`git diff --check`、`cd v1 && npm test` 和 `npm run test:browser-poc`，再更新本清单。
