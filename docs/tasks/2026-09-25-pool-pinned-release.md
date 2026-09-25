# 任务书｜本机常驻付款池改跑固定版本目录（D-376；**2026-09-25 17:45 UTC 已切换，D-383**）

2026-09-25（UTC+8）Lemon 同意方向；与块 6「合 main → 发布 / 重启常驻池」那一次重启合并，不单独多一次重启。

## 目标

常驻池只跑「从单一提交打包、校验过、依赖装在自己目录里」的版本；main 工作区怎么改都不会在池子下次重启时悄悄上线。回滚 = 把 `current` 指回上一版再停池。

## 为什么（现场证据）

- 池 worker PID 91075 的 cwd = `/Users/lemon/code/AI充值业务/browser-mvp`（`lsof -a -p 91075 -d cwd`）；launchd plist `deploy/local/com.pojia.browser-pool.plist:12` 硬写主工作区路径。
- supervisor 每轮按自身位置找 `run-live-pool.sh`，后者 `cd "$ROOT/browser-mvp"` 再 `exec node src/production-live-pool-worker.js`：重启即载入工作区当时的代码，启动那一刻工作区干不干净事后查不到。

## 已做（2026-09-25，未影响在跑的池）

- `scripts/pool-release.sh`（仓库根 `scripts/`，**不改 browser-mvp 任何文件**）：`prepare <commit> [name]` / `verify <name>` / `switch <name>` / `status`。
  - prepare 复用服务器那套：`build-production-release.sh` 打包 → 解到 `$POOL_HOME/releases/<name>` → `verify-production-release.sh` 校验 → `npm ci --omit=dev`（v1、browser-mvp 各一次）→ 自检 playwright / mysql2 / zod / fflate 全部解析在版本目录内 → `node --check` worker 入口 → 写 `POOL_RELEASE`。
  - switch 只原子换 `current` 软链并打印 ROLLBACK；**不停池、不启池**。switch 前自动重跑自检。
- 验证（临时目录 `POOL_HOME=scratchpad`）：prepare 通过（1372 个文件校验 OK）；反例全部拒绝——未 prepare 的目录不许 switch、同名不许重复 prepare、依赖解析到目录外时 verify 与 switch 都拒绝且不建 `current`、依赖缺失时拒绝；status 正确报出现役 worker「不在固定版本目录」。

## 状态文件不搬（已核实与代码位置无关）

WAL `~/Library/Application Support/pojia-browser-live/pool/lane-1.wal`、卡租约 `lane-1-card-leases.json`、`supervisor.log` 都是 `$HOME` 下绝对路径（`run-live-pool.sh:15,39`）；版本目录里不放任何状态。

## 切换那一次怎么做（块 6 演练通过、合 main、服务器发布之后）

前提：服务器已发布同一提交（池直接 import 本地 `v1/src`，与服务器同提交可避免 SQL / schema 不一致）。

1. `scripts/pool-release.sh prepare <服务器 release 的提交>`（不碰在跑的池，可提前做）。
2. 正式路径关付款开关（`admin-operations-service.setBrowserPaymentWrites`）→ 确认无在途付款 → SIGTERM worker（只发给 node PID）→ 确认 worker 已退出。
   **worker 没退出前不许动 launchd**：supervisor 与 worker 同一进程组，launchd `exit timeout = 5`，卸载 job 会连带强杀 worker，付款中就是 SUBMIT_UNKNOWN。
3. `scripts/pool-release.sh switch <name>`。
4. 改 plist 第 12 行为 `/Users/lemon/pojia-pool/current/browser-mvp/scripts/live-pool-supervisor.sh`，拷到 `~/Library/LaunchAgents/`，`launchctl bootout gui/$(id -u)/com.pojia.browser-pool` 再 `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.pojia.browser-pool.plist`。
5. 付款开关开回 → supervisor 拉起 worker → `scripts/pool-release.sh status` 应显示「跑 current」→ `state-check.sh` 的「本机」行按新 cwd 改表。
6. 回滚：`switch <上一版>` + 停 worker；要回到主工作区就把 plist 改回原路径并重载（同样先停 worker）。

以后每次池子换代码：`prepare` → 关付款开关、停 worker → `switch` → 开回（第 4 步只有第一次要做）。

## 验收

- `status` 显示 worker cwd = `current` 解析出的版本目录；`POOL_RELEASE` 的 commit = 服务器 release 的提交。
- 在 main 工作区改一个 browser-mvp 文件（不提交）后停池再起，worker 仍跑版本目录（改动不生效）。
- `state-check.sh` 全绿（「本机」行 cwd 为版本目录）。

## 未堵的口子（要不要堵，Lemon 定）

`go-live.sh:26` 和手工 `run-live-pool.sh run pay` 仍能从 main 拉起一个真付款的池。堵法：两者在 pay 模式且不在 `pojia-pool/releases/` 下时拒绝运行——这是 browser-mvp 改动，按 D-254 走白名单 + 全量测试 + 演练。

## 待 Lemon 确认

1. 版本目录放 `~/pojia-pool`（在 `~/code` 之外，不进任何仓库）。
2. 第 4 步改 LaunchAgent（持久配置），在切换那次当场做。
