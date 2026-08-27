# Browser 阶段 1：24 小时 soak 运行记录（2026-08-23）

## 当前状态

`COMPLETED（A1 窄范围）`。detached 子进程已完成 24 小时窗口；完整指标和独立残留核验见 `docs/2026-08-24_browser-stage1-24h-soak-completion-report.md`。这不关闭 A1 其余网络级故障轴，也不代表 A2 高可用或生产可用。

## 参数

- 隔离 MySQL：`pojia_test`
- 启动前要求 dispatch queue 为空
- 目标窗口：86400000ms（24 小时）
- 当前 detached runner 参数：1 个循环 job、2 worker、240000ms 动作间隔、600 秒租约；约 360 个合成 job/日
- 正常 Node；该低速窗口用于跨聊天会话保活，不等同于生产并发容量
- 付款、Checkout、真实 Session、卡片和生产网络均关闭

## 完成判据

必须同时满足：created=claimed、missing=0、duplicateClaims=0、heartbeatOk=claimed；脚本 cleanup 与独立 MySQL 查询的 dispatch/attempt/order/CDK 残留均为 0；并记录 RSS/heap/external/Threads_connected/延迟峰值。任一异常都按失败或未完成处理，不得用部分窗口替代 24 小时结论。

## 下一接班动作

2026-08-24 核验：日志记录 `created=360`、`claimed=360`、`missing=0`、`duplicateClaims=0`、`heartbeatOk=360`，RSS/heap/external/连接/延迟指标齐全；日志 cleanup 和独立 MySQL 查询的 dispatch/attempt/order/CDK 残留均为 0。旧元数据 JSON 因 runner 缺少完成回写仍显示 `RUNNING`，已在后续 runner 修复；本轮以日志和独立查询为准。运行期间未启动真实 Browser 或付款。
