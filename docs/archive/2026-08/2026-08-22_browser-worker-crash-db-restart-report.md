# Browser Worker 崩溃、租约接管与 MySQL 重启报告（2026-08-22）

## 场景

使用仓库内固定脚本 `v1/test-support/browser-worker-mysql-crash-recovery.js`，隔离 Docker MySQL 8.4，创建一个合成 Browser dispatch job：

1. 子进程真实 claim，租约 10 秒；
2. 子进程被 `SIGKILL`，不执行 heartbeat、不执行页面动作；
3. 等待租约过期；
4. 新 Worker claim 同一 job；
5. 使用旧 owner/token 尝试 heartbeat，必须被拒绝。

数据库容器随后执行一次 restart；端口因测试容器映射重建为 `56392`，重启后连接验证和 bounded claim 测试重新通过。

## 结果

| 验收 | 结果 |
|---|---|
| 子进程退出 | `SIGKILL` |
| 原 claim job | 1079 |
| 接管 job | 1079 |
| 过期租约接管 | 通过 |
| 旧 owner heartbeat | `LEASE_NOT_OWNED` |
| 付款动作 | 0 |
| MySQL restart 后连接 | `SELECT 1` 通过 |
| restart 后 bounded claim | 20/20、0 漏领、0 重复、20 heartbeat、四类残留 0 |

## 结论

跨进程崩溃不会制造第二个 job 或允许旧 owner 继续续租；租约过期后可由新 Worker 接管。MySQL 容器重启后连接和 Browser dispatch 控制面恢复通过。

## 边界与未验证项

- 这是隔离 MySQL 单容器重启，不是生产拓扑或主从切换演练。
- 未注入 Browser 页面动作中的中途断连；真实付款仍未启动。
- 连续长时间 soak、数据库网络抖动、连接池重建指标仍待补充。
