# Browser repository-only 网络故障对抗式审查（2026-08-22）

## 通过证据

- 连接级 `KILL CONNECTION` 不再与 fixture producer/cleanup 同时运行。
- 80/80 job claim、80 heartbeat、56 次连接断开注入、0 repository error、0 dispatch 残留。

## 反证与边界

1. 连接断开恢复通过的是窄范围 claim/heartbeat，不代表主从切换、网络分区或 24 小时稳定性。
2. 显式拒绝排队的控制面测试池在耗尽时返回 `DB_POOL_EXHAUSTED` 并可恢复；共享生产池仍是 `waitForConnections` 语义，不能把该窄测试外推为生产配置已冻结。
3. 没有页面、Session、Checkout、卡片或付款动作，不能外推履约成功率。
4. 未知结果仍必须停手并进入 reconcile-only，任何测试修复不得增加自动重付。

## 结论

网络级连接断开子闸门通过；连接池耗尽的“快速失败”策略在显式非排队测试池通过，但共享池配置和主从切换仍未关闭，阶段 1 继续保持未关闭。
