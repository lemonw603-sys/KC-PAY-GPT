# Browser 最新一轮运行报告（2026-08-28）

## 状态

- Worktree：`/Users/lemon/.codex/worktrees/9128/AI充值业务`
- 分支：`codex/browser`
- HEAD：`fe3d116`
- 本轮新增代码：无
- 本轮新增提交：无
- 工作区代码：无未提交代码
- 已存在未跟踪产物：`artifacts/browser-checkout-observe/`（本轮未修改）

## 实际运行命令与结果

```bash
git status --short
git rev-parse --short HEAD
git log --oneline --decorate -3
git diff --check
```

结果：HEAD 为 `fe3d116`；仅显示未跟踪 `artifacts/browser-checkout-observe/`；`git diff --check` 通过。

```bash
node --test \
  browser-mvp/test/shared-runtime-integration.test.js \
  browser-mvp/test/upstream-simulation.test.js \
  browser-mvp/test/local-worker-chrome-fixture.test.js
```

结果：**16/16 passed，0 failed**。

覆盖事实：

- 本地 Worker claim/run/lease 与系统 Google Chrome fixture 页面观察；
- dispatch/run 状态链及付款前 `abortBeforePayment()`；
- 页面漂移、route/card drift；
- 租约在动作前和动作中丢失；
- runtime 崩溃；
- Session 无效、账号已有 Plus；
- 重复投递与旧 run 恢复；
- `submitCalls=0`，无重复提交、换卡或资金风险残留。

此前已完成的隔离 MySQL migration 039 dry-run 证据仍有效：共享 `beginAuthorizedAttempt()` 创建 `RESERVED`，安全退出后为 `RELEASED`，活动 permit=0，`PAYMENT_SUBMIT`=0；本轮未重复运行。

## 未验证项

- 未执行真实 MySQL 进程中途重启注入；
- 未连接生产或预生产；
- 未启动生产 Browser Worker；
- 未读取真实 Session/PAN/CVC；
- 未填卡、未付款、未调用卡台写接口；
- 未合并或部署。

## 追加恢复验证（本轮）

- 使用临时隔离 MySQL 8.4，执行 migration 001–039。
- 命令：`TEST_DATABASE_URL=<isolated-mysql> node --test v1/test/browser-recovery-mysql-integration.test.js`
- 结果：**1/1 passed**；验证同一 Browser run 的 Worker 进程重启后 artifact/resource lease 恢复、旧 authority 不外泄，且不产生付款动作。
- 该测试没有在数据库进程运行中途执行 `docker restart`；因此“数据库进程中途重启后同一 job/attempt 的继续/安全收口”仍属于未验证项，不能把本结果写成数据库重启通过。

## 隔离 MySQL 进程重启故障注入（追加验证）

- 先核对并 rebase 到最新主线 `a1d91de`；未删除主线文件。
- 根因：旧 backlog 夹具把订单写成 `SUBMITTING`，与当前 Browser claim 合同要求的 `RECHARGE_PROCESSING` 不一致，导致重启恢复时所有 job 被过滤为 0。已仅修正测试夹具状态，不改库存或运行时规则。
- 命令（临时 MySQL 8.4、migration 001–040、五个写开关均为 false）：
  `TEST_DATABASE_URL=<isolated> MYSQL_CONTAINER=<container> BACKLOG_JOBS=24 node v1/test-support/browser-queue-backlog-db-restart.js`
- 结果：preparedExit=0、recoveryExit=0；pendingBefore=24、claimed=24、duplicate=0、heartbeatOk=24、staleLeaseRejected=true、paymentSubmitOperations=0、residual=0、errors=[]。
- 该结果证明真实 `docker restart` 后同一 backlog 可被恢复领取，旧 lease/token 不能继续 heartbeat，且无付款提交或残留。

定向回归：

```bash
node --test v1/test/browser-dispatch-repository.test.js browser-mvp/test/shared-runtime-integration.test.js
```

结果：**17/17 passed**。
## 2026-08-29 主线同步后的最新复验

- `codex/browser` 已同步到最新主线 `a40ccb9`；当前无 Browser 代码差异，之前 Browser 修复已在主线。
- 非付款联调命令：
  `node --test browser-mvp/test/shared-runtime-integration.test.js browser-mvp/test/upstream-simulation.test.js browser-mvp/test/local-worker-chrome-fixture.test.js`
  → **16/16 passed**。
- 隔离 DB restart 命令（临时 MySQL 8.4、migration 001–040、24 jobs、五个写开关 false）：
  `TEST_DATABASE_URL=<isolated> MYSQL_CONTAINER=<container> BACKLOG_JOBS=24 node v1/test-support/browser-queue-backlog-db-restart.js`
  → prepared/recovery exit=0，pendingBefore=24，claimed=24，duplicate=0，heartbeatOk=24，staleLeaseRejected=true，paymentSubmitOperations=0，residual=0，errors=[]。
- 未连接生产、未启动生产 Browser Worker、未读取真实 Session/PAN/CVC、未填卡、未付款、未调用卡台写接口；本轮未合并或部署。

## 2026-08-29 主线生产只读同步后的 Browser 复验

- `codex/browser` 已同步到最新主线 `43fbeb7`；Browser adapter、dispatch、lease 和消费预留代码均无额外分支差异。
- 定向非付款联调与故障注入命令：
  `node --test browser-mvp/test/shared-runtime-integration.test.js browser-mvp/test/upstream-simulation.test.js browser-mvp/test/local-worker-chrome-fixture.test.js v1/test/browser-dispatch-repository.test.js`
  → **24/24 passed**。
- 覆盖本地 Google Chrome 观察、dispatch/run、profile-scoped claim、页面/route/card 漂移、租约丢失、runtime 崩溃、重复投递恢复、safe-abort；未产生付款提交。
- 之前已在同一套已合入主线的 restart harness 上完成临时 MySQL 8.4 + migration 001–040 + 24 jobs 的 `docker restart`：24/24 claim、0 duplicate、旧 lease/token 拒绝、PAYMENT_SUBMIT=0、residual=0。
- 本轮未连接生产、未启动 Browser Worker、未读取真实 Session/PAN/CVC、未填卡、未付款、未调用卡台写接口、未合并或部署。

## 2026-08-29 Browser adapter 最新主线复核

- 当前 `codex/browser` 已同步主线 `43fbeb7`；adapter 接线与共享上游合同无未提交代码差异。
- 定向非付款联调（16 个 shared/runtime/upstream/Chrome 测试）与 dispatch repository 合同测试合计 **24/24 passed**。
- 已确认 adapter 只接受 `RECHARGE_PROCESSING` + `PREPARED/ACTIVE` + Browser route，并要求 migration 039 消费预留 `RESERVED` 且匹配 attempt/order/card；`RECONCILIATION_REQUIRED`、旧 lease/token、页面/route/card 漂移均 fail-closed。
- 本轮未新增运行时代码；未启动生产、未连接生产数据库、未读取真实 Session/PAN/CVC、未填卡、未付款、未调用 Provider/卡台写接口。

## 2026-08-29 attempt/run executor profile 绑定补强

- 发现并修复 adapter 接线缺口：原投影只读取 `browser_runs.executor_profile_id`，未核对 `recharge_attempts.executor_profile_id`。现 adapter 显式读取 attempt profile，并要求与当前 run/profile 完全一致；漂移时 fail-closed。
- 权威 payment snapshot 同样再次核对 run/attempt profile，并把 `executorProfileId` 纳入 snapshot hash；错误码为 `EXECUTOR_PROFILE_CONFLICT`。
- 定向测试：`npm --prefix browser-mvp run check` 通过；adapter/runtime/repository 相关 **46/46 passed**。
- 隔离非付款端到端：五个写开关均 false 的 `npm --prefix browser-mvp run dry-run:shared`，临时 MySQL + migration 001–040 + Chrome 本地观察 **1/1 passed**，安全退出且无付款提交。
- 未连接生产、未启动生产 Browser Worker、未读取真实 Session/PAN/CVC、未填卡、未付款、未调用 Provider/卡台写接口。
