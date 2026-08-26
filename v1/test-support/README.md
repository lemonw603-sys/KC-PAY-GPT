# Browser 隔离测试夹具

本目录只存 Browser 控制面和恢复测试夹具，不是生产 Worker 入口，也不会由 `npm start` 或 `npm run start:worker` 自动加载。

## 运行边界

- 所有 MySQL 脚本都要求显式 `TEST_DATABASE_URL`，目标应是隔离测试库。
- 默认使用 `pojia-stage1-mysql` 作为容器名；网络故障、pause/unpause、restart 和 `KILL CONNECTION` 脚本可能改变该隔离容器状态。
- 夹具只创建合成 CDK/order/attempt/dispatch 数据，并在结束时清理；付款动作计数保持为 0。
- 不接受真实 Session、卡号、Checkout authority 或 Provider 密钥；不访问外部 Browser 页面。
- 长 soak 使用 `browser-detached-soak-runner.js` 时，日志和 metadata 写入 `artifacts/browser-soak/`，不要把它们当作源码。

## 夹具分组

- 基础租约/连接：`browser-mysql-bounded-soak.js`、`browser-pool-reconnect*.js`、`browser-pool-multi-reconnect.js`、`browser-pool-exhaustion-bounded.js`
- 网络/数据库故障：`browser-db-outage-soak.js`、`browser-network-kill-storm.js`、`browser-repository-network-fault.js`
- 队列积压/重启：`browser-queue-backlog-soak.js`、`browser-queue-backlog-db-restart.js`、`browser-queue-restart-recovery.js`
- Worker 崩溃接管：`browser-worker-mysql-crash-recovery*.js`、`browser-worker-process-child.js`
- detached 长窗口：`browser-detached-soak-runner.js`

## 当前可回放检查

```bash
node --test v1/test/browser-worker-concurrency.test.js \
  v1/test/browser-worker-local-mock-integration.test.js \
  test/browser-nonph-manifest.test.js
```

这些测试只覆盖离线/本地 mock/manifest 约束，不证明真实 Session、菲律宾出口、Checkout、付款或生产容量。
