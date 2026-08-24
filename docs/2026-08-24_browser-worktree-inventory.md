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

## B. 已修改但尚未提交的 Browser 实现/测试

这些文件在本次整理前已存在共享工作区改动；本轮已完成边界审查，并将这一批 dispatch 实现与测试单独固化：

- `v1/src/db/repositories/browser-dispatch-repository.js`
- `v1/test/browser-dispatch-repository.test.js`
- `v1/test/browser-worker-service.test.js`

审查结论与修正见 `docs/2026-08-24_browser-dispatch-ambiguous-claim-review.md`。`claim()` 不再重试 ambiguous timeout/connection loss；`enqueue()`/`complete()`/heartbeat 的安全重试边界保留。Worker service 测试仍单独保留，不混入该 commit。

## C. 未跟踪的 Browser 测试夹具与运行脚本

以下内容保留在原路径，不视为生产入口：

- `v1/test-support/browser-*.js`
- `v1/test/browser-worker-concurrency.test.js`
- `v1/test/browser-worker-local-mock-integration.test.js`
- `test/browser-nonph-manifest.test.js`
- `browser-poc/manifests/non-ph-us-readonly-2026-08-23.json`

这些文件的下一步是逐个确认“测试夹具/本地 mock/历史实验”属性后再提交；当前不得注册为生产 Worker、不得接真实付款。

## D. Browser 证据、报告和交接文档

以下内容是历史或当前阶段证据，不应混入运行时代码：

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

- “最近 Browser 基线 commit 内部是否自洽”：是，已通过对应定向测试。
- “整个工作树是否 clean”：否，B-E 类仍有共享未提交或未跟踪内容。
- “是否可以安全执行 `git clean`/`git reset`”：否，会破坏未确认的实现或历史证据。

## 后续唯一整理顺序

1. 审查 B 类 dispatch/Worker 测试 diff并单独提交或明确延期。
2. 审查 C 类测试夹具，确认只属于本地/隔离测试后单独提交。
3. 将 D 类证据与 E 类事实源按阶段节点分批提交。
4. 运行 `git status --short`、`git diff --check`、`cd v1 && npm test` 和 `npm run test:browser-poc`，再更新本清单。
