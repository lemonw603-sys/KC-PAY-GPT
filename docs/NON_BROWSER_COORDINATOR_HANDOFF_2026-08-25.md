# 非 Browser 统筹工作线接班入口（2026-08-25）

> 这是非 Browser **统筹/集成验收 worktree** 的接班入口。业务实现细节继续以 `docs/NON_BROWSER_HANDOFF_2026-08-25.md`、`docs/CURRENT_STATE.md`、`docs/DECISIONS.md` 为准；多窗口规则见 `docs/WORKSTREAM_COORDINATION_2026-08-25.md`。

## 当前 worktree

- 路径：`/Users/lemon/.codex/worktrees/nonbrowser/AI充值业务`
- 分支：`codex/nonbrowser-integration-20260825`
- 最近提交：`e32a6fd docs(non-browser): correct candidate file count`
- 工作区：候选已部署；交接文档更新不得混入竞品或 Browser 改动。

## 当前阶段

非 Browser 候选 release 已部署，正在进行部署后运行时和后台只读验收。

## 已完成

- 已核对竞品和 Browser 两个窗口的实际状态。
- 已将竞品和 Browser 迁移到独立 worktree。
- 已建立文件所有权、交接载荷和集成闸门协议。
- 已完成线上只读静态资源核验：`admin.js`、`admin.css` 与旧 release `7587d44` 精确匹配。
- 已确认线上尚未包含接单/自动充值拆分和窄屏修复。
- 已提取并提交三项安全修复：`CARD_READY -> CLOSED`、HNSKJ `502/503` 保持同键可重试且结果不确定、卡余额准备强制调用方提供稳定幂等键。
- 候选提交：`f3bbe93`；`v1` 当前 242 个 Git 跟踪文件。
- 候选静态资源指纹已记录在 release reconciliation 文档。
- 已部署 `/opt/pojia/releases/20260825-nonbrowser-e32a6fd-fixed`；服务端 242/242 manifest 校验通过，迁移 001–037 均已应用。
- 部署后 Web/Worker active，公网 live/ready 均 200；接单、派发、Provider 写入仍关闭。

## 当前事实

- 线上 `/health/ready` 返回 HTTP 200，状态为 `ready`。
- 线上 `/admin` 未登录返回 HTTP 302 到登录页。
- 当前运行 `/opt/pojia/current` 已指向候选 release；systemd、迁移版本和数据库开关已现场只读核验。
- 当前源码分支 `e32a6fd` 已包含非 Browser 拆分、后台优化、窄屏修复和本轮安全修复；已部署 release 与候选提交一致。
- 原共享 checkout 的未提交资产仍保留在竞品 worktree；本轮只提取了明确属于非 Browser 的 6 个文件。

## 下一条可执行动作

1. 在有管理员会话后逐页验收后台：接单与自动充值必须显示为两个独立控制项和路由。
2. 继续保持接单、派发和 Provider 写入关闭；不执行真实开卡、充值或付款。
3. 处理或明确保留 task 22、历史 intake batch 和历史异常，不能在部署验收中顺手清理。

## 未验证/禁止动作

- 未验证线上数据库开关、systemd 服务、迁移版本和当前运行 commit。
- 未验证后台登录后的两个新开关。
- 未执行开卡、卡余额充值、Plus 付款、退款、提现或任何 Provider 写调用。
- 已获得本次部署确认并完成 release 切换；仍不得开启 Provider 写入或执行真实资金操作。
- 全量测试受环境限制：`369 pass / 34 skipped / 3 fail`；失败为当前 Unicode worktree 下 customer 静态页 500，以及两个需要 `playwright` 的 Browser 集成测试缺包。三项本次安全修复的定向回归为 `36/36 pass`。

## 交付前必须更新

- 本文件的阶段、最近提交、下一动作和未验证项；
- `docs/2026-08-25_non-browser-release-reconciliation.md` 的 release 证据；
- `docs/HANDOFF_LOG.md` 的统筹交接记录；
- 测试命令、结果和精确提交文件清单。
