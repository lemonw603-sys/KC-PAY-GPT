# Browser 阶段 1：10 分钟有效 Soak 报告（2026-08-22）

## 前置条件

harness 启动前检查 `browser_dispatch_jobs=0`；本次通过空队列检查后启动。结束后独立查询 dispatch/order/attempt 均为 0。

## 结果

- 时间：600.007 秒；
- created/claimed：30,850/30,850；
- missing/duplicate：0/0；
- heartbeat：30,850；
- Worker：4；leaseSeconds：600；
- Threads_connected 峰值：5；
- claim 延迟均值/最大：3.60ms / 234ms；
- heartbeat 延迟均值/最大：1.56ms / 134ms；
- RSS：66.9MB→208.3MB 峰值→174.6MB 结束；
- heapUsed：9.5MB→84.7MB 峰值→19.4MB 结束；
- external：1.99MB→16.49MB 峰值→2.35MB 结束；
- 脚本清理残留：0/0/0/0；独立查询 dispatch/order/attempt：0/0/0。

## 结论

10 分钟空队列正常 Node 控制面通过：无漏领、重复、未处理错误或残留。heapUsed/external 结束接近起点，RSS 仍偏高，结合 GC/old-space 对照，暂按 V8 保留容量观察，不冻结生产参数。网络级故障、连接池耗尽、主从切换和 24 小时仍未验证。
