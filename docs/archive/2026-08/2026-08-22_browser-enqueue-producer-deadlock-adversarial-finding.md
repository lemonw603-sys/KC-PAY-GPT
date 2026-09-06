# Browser 入队生产者并发死锁对抗式审查（2026-08-22）

## 触发

在把 bounded soak 固化为 `v1/test-support/browser-mysql-bounded-soak.js` 后，首次按并发生产者方式创建每轮合成 fixture（同一轮 `Promise.all(createJob)`）时，隔离 MySQL 8.4 返回 `ER_LOCK_DEADLOCK`，失败发生在 `browser_dispatch_jobs` 入队前后的订单/attempt/dispatch 关联写入窗口。该运行没有页面、Session、卡片或付款动作。

## 影响判断

- 这是当前表结构、外键/索引和并发 fixture 写入顺序下的真实数据库行为，不应被吞掉或误报为 Worker claim 成功。
- 该证据**不能单独证明生产入队一定死锁**：生产入口是否并发、事务边界和批量写入顺序可能不同；但它证明入队生产者需要明确的并发策略和死锁重试/退避验收。
- 失败运行产生的部分测试行已清理；随后按 suffix 查询确认 `orders=0`、孤儿 `cdks=0`、`recharge_attempts=0`、`browser_dispatch_jobs=0`。

## 当前处理

已补充有界数据库事务重试，验证见 `docs/archive/2026-08/2026-08-22_browser-enqueue-deadlock-retry-report.md`。该修复仅覆盖入队数据库写，不覆盖付款或未知结果。

1. bounded soak harness 将 fixture 生产改为串行，明确只测 claim/lease/heartbeat 并发，不把 fixture producer 竞态混进主指标。
2. 清理阶段增加残留计数并在任一残留时以非零退出；输出 `residualDispatch/residualAttempts/residualOrders/residualCdks`。
3. 未对生产入队逻辑添加未经验证的自动重试，也未宣称该死锁已解决。

## 后续闸门

在任何生产或高并发灰度前，必须单独设计并验证入队 producer 场景：固定事务边界、唯一键冲突处理、MySQL deadlock/lock-wait retry 上限、幂等恢复和残留清理；验证失败则保持 Browser 派发关闭。
