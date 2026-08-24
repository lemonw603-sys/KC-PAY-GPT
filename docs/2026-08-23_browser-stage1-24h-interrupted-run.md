# Browser 阶段 1：24 小时 soak 中断记录（2026-08-23）

## 事实

- 首轮 24 小时命令由当前交互终端直接承载。
- 终端窗口中断后，Node 进程不存在；数据库留下 4 个本轮 `soak-job-*` 夹具。
- 已人工清理这 4 个 dispatch/attempt/order/CDK 夹具，清理后 dispatch queue 为 0。
- 该轮没有最终 created/claimed/heartbeat/资源汇总，判定为 `INVALID_INTERRUPTED`，不能计入 24 小时证据。

## 修订

新增 `v1/test-support/browser-detached-soak-runner.js`：以 detached 子进程、0600 输出日志和元数据启动低速长 soak（约 360 个合成 job/日），不再依赖当前聊天终端保持打开。24 小时结果仍必须读取完整日志并做独立残留查询；后台运行本身不代表通过。
