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
