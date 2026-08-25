# 多窗口工作线协作协议（2026-08-25）

> 非 Browser 统筹入口。竞品和 Browser 已分别迁移到独立 worktree；本文件约束并行修改、交接和集成，不替代 `CLAUDE.md`、`AGENTS.md`、`DECISIONS.md`。

统筹窗口自己的接班入口：`docs/NON_BROWSER_COORDINATOR_HANDOFF_2026-08-25.md`。

## 工作线

| 工作线 | 独立 worktree | 范围 | 当前状态 |
|---|---|---|---|
| 非 Browser 统筹 | `/Users/lemon/.codex/worktrees/nonbrowser/AI充值业务` | release 对账、后台/API/订单/卡片/账本验收和跨线协调 | 线上旧 release 已确认，待候选 release 集成 |
| 竞品研究 | `/Users/lemon/.codex/worktrees/c566/AI充值业务` | 公开竞品证据、能力矩阵和建议 | 尚无正式研究结论 |
| Browser 充值线 | `/Users/lemon/.codex/worktrees/9128/AI充值业务` | Browser Worker、控制面、非付款 PoC、Browser 测试/合同 | 本地 soak 有证据，真实 Session/Checkout/付款未验证 |

## 文件所有权

- 非 Browser：`v1/public/admin/**`、非 Browser 的 `v1/src/**`、订单/卡片/资金/Provider/API 测试和文档。
- Browser：`browser-*` 服务/仓储、Browser 测试、`test-support`、Browser manifests 和 Browser 文档。
- 竞品：`artifacts/competitor-research/**`、`docs/competitor-research/**`。
- `CLAUDE.md`、`AGENTS.md`、`docs/CURRENT_STATE.md`、`docs/DECISIONS.md`、`docs/HANDOFF_LOG.md` 以及订单状态/资金栅栏等共享核心文件必须由统筹窗口协调。

任何窗口不得修改其他工作线的所有权文件；发现需要改共享文件时，先提交影响、理由、验证和冲突范围。

## Git 规则

每次开工先执行：

```bash
git worktree list
git status --short --branch
git log --oneline --decorate -10
```

- 不得 `git reset --hard`、`git checkout --` 或删除他人未提交改动。
- 提交必须精确列文件，禁止 `git add -A`。
- 不得把“代码已验证”“已提交”“已部署”“运行时已验证”混写。
- 研究窗口不修改 `v1/`；Browser 窗口不直接改非 Browser release。

## 交接最小载荷

```text
工作线：
分支/worktree：
本轮目标：
已完成（文件/提交/证据）：
进行中：
下一条动作：
未验证事实：
未提交改动：
测试命令与结果：
是否涉及生产/真实资金/不可逆变更：
需要统筹决定的冲突：
```

不得在交接中保存 Session、PAN、CVV、API Key、Checkout authority 等敏感明文。

## 集成闸门

1. 竞品研究先形成公开证据报告，再由统筹窗口转成需求或决策。
2. Browser 默认只做设计、非付款 PoC、模拟页面和恢复测试；真实开卡/付款/生产 Worker 需要单独确认。
3. 非 Browser 先完成 release 对账，再安排部署和后台现场验收；生产写开关保持关闭。
4. 共享核心改动必须在独立集成 worktree 中合并、测试、检查静态资源指纹后，才可进入 release。

## 可直接转发

竞品窗口：

```text
继续竞品研究，只修改 artifacts/competitor-research 或 docs/competitor-research。不要改 v1、资金逻辑、共享事实源或生产配置。输出公开证据、能力矩阵、可借鉴点、不可借鉴风险、优先级和未验证项；完成后回报 worktree、文件、提交、测试和下一步。不要使用 git add -A。
```

Browser 窗口：

```text
继续 Browser 线，只修改 Browser 所有权范围，先检查独立 worktree 状态。不要回滚或提交非 Browser 改动；共享订单/卡片/资金核心先向统筹窗口提出。不得真实开卡、付款或启动生产 Worker；完成后回报 commit、未提交改动、证据、未验证项和下一步。
```

新接班窗口：

```text
这是多工作线项目。先读取 AGENTS.md、CLAUDE.md、docs/START_HERE.md、docs/CURRENT_STATE.md、docs/HANDOFF_LOG.md 和对应工作线入口；检查 git worktree list/status/log，确认所有权后再行动。不要覆盖未提交改动，交付时分别说明代码已验证、已提交、已部署、运行时已验证和未验证项。
```
