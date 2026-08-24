# Browser Worker 崩溃 + 数据库暂停同刻故障发现（2026-08-22）

## 场景

在子进程已 claim 后，同时 pause 隔离 MySQL 2 秒并 `SIGKILL` 子进程；恢复数据库后等待新 Worker 接管同一 job。

## 结果

本次恢复侧超过预期窗口无输出，父进程被人工中止；没有付款动作。隔离测试数据已清理。

## 结论

这是未通过的 P1 发现：当前 repository 的瞬时错误重试能处理已返回的连接错误，但数据库暂停期间可能出现无界等待，不能保证 Worker 在恢复路径上及时失败关闭或重新 claim。

## 必须整改

1. 为 claim/heartbeat/关键数据库事务设置明确 query/action deadline；
2. 超时后销毁/释放坏连接，避免连接池永久占用；
3. 记录 timeout、retry、reconnect、queue backlog 指标；
4. 只有确认 lease/资金状态后才能恢复，不能把超时当作可付款状态；
5. 重新运行同刻 crash+DB pause 场景，必须在有界窗口内得到接管或明确安全失败。

## 首次整改结果

已在事务 acquire/执行/commit 路径加入 5 秒 deadline、超时销毁连接并纳入 3 次重试；普通单元测试 6/6 通过。但同刻故障重跑仍超过 30 秒无输出，说明连接池 acquire/清理或子进程恢复路径仍存在未覆盖的等待点；不能宣布修复完成。

随后定位并修复两个恢复竞态：恢复时不再复用 pause 期间的旧 pool，且子进程 exit listener 在 SIGKILL 前注册。重跑同刻场景已在 13.266 秒内成功接管同一 job，旧 token 仍被拒绝。
