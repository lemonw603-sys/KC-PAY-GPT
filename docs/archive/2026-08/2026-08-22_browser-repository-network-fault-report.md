# Browser repository-only 网络故障验证（2026-08-22）

## 运行范围

- 隔离 MySQL `pojia_test`，预先串行创建 80 个 Browser dispatch job。
- 故障窗口只执行 repository `claim` 与 `heartbeat`，不写入夹具、不执行页面动作、不付款。
- 4 个 Worker，连接池上限 4；约 20 秒窗口内每 250ms 注入最多 2 个 `KILL CONNECTION`。
- 故障后关闭旧路径，使用全新 pool 清理夹具。

## 结果

```text
created=80
claimed=80
heartbeats=80
injections=28
killed=56
errors=0
residualDispatch=0
```

控制面在该窄范围真实连接级断开下完成了全部 claim/heartbeat，且清理为 0；没有 Checkout 或付款动作。

## 未关闭项

独立连接池耗尽测试随后改为显式 `waitForConnections:false` 的 Browser 控制面测试池：2 个连接占满后调用 `claim` 在 1ms 内得到规范化 `DB_POOL_EXHAUSTED`，释放连接后 `SELECT 1` 恢复。该结果证明“拒绝排队、快速失败、释放后恢复”的策略可行，但不等价于现有共享生产池已经采用该配置；共享池配置仍需单独决策和复验。
