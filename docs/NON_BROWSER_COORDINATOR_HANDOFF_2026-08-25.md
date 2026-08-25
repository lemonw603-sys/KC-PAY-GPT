# 非 Browser 统筹工作线接班入口（2026-08-25）

> 这是非 Browser **统筹/集成验收 worktree** 的接班入口。业务实现细节继续以 `docs/NON_BROWSER_HANDOFF_2026-08-25.md`、`docs/CURRENT_STATE.md`、`docs/DECISIONS.md` 为准；多窗口规则见 `docs/WORKSTREAM_COORDINATION_2026-08-25.md`。

## 当前 worktree

- 路径：`/Users/lemon/.codex/worktrees/nonbrowser/AI充值业务`
- 分支：`codex/nonbrowser-integration-20260825`
- 最近提交：`663e0ca docs: establish workstream coordination and release reconciliation`
- 工作区：本入口文件提交前应保持只含统筹文件；不得混入竞品或 Browser 改动。

## 当前阶段

非 Browser 生产 release 对账与候选 release 集成准备。

## 已完成

- 已核对竞品和 Browser 两个窗口的实际状态。
- 已将竞品和 Browser 迁移到独立 worktree。
- 已建立文件所有权、交接载荷和集成闸门协议。
- 已完成线上只读静态资源核验：`admin.js`、`admin.css` 与旧 release `7587d44` 精确匹配。
- 已确认线上尚未包含接单/自动充值拆分和窄屏修复。

## 当前事实

- 线上 `/health/ready` 返回 HTTP 200，状态为 `ready`。
- 线上 `/admin` 未登录返回 HTTP 302 到登录页。
- SSH 生产只读连接被远端关闭；systemd、`/opt/pojia/current`、迁移版本和数据库开关仍未验证。
- 当前源码分支 `a08cbac` 已包含非 Browser 拆分、后台优化和窄屏修复提交；这些改动尚未形成新的生产 release。
- 原共享 checkout 的未提交资产已保留在竞品 worktree，尚未提取到本统筹分支。

## 下一条可执行动作

1. 只从竞品 worktree 的变更清单中识别非 Browser 自有改动，禁止整目录复制。
2. 在本 worktree 形成干净候选 release 分支，精确纳入已审查非 Browser 提交。
3. 运行完整测试、`git diff --check`、发布文件清单和静态资源指纹核验。
4. 取得单独部署确认后再发布；发布后重新做后台现场验收。

## 未验证/禁止动作

- 未验证线上数据库开关、systemd 服务、迁移版本和当前运行 commit。
- 未验证后台登录后的两个新开关。
- 未执行开卡、卡余额充值、Plus 付款、退款、提现或任何 Provider 写调用。
- 未经单独确认不得切换生产 release、开启 Provider 写入或执行真实资金操作。

## 交付前必须更新

- 本文件的阶段、最近提交、下一动作和未验证项；
- `docs/2026-08-25_non-browser-release-reconciliation.md` 的 release 证据；
- `docs/HANDOFF_LOG.md` 的统筹交接记录；
- 测试命令、结果和精确提交文件清单。

