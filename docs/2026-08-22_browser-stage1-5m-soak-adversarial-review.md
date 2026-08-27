# Browser 阶段 1：5 分钟 Soak 对抗式审查（2026-08-22）

## 通过

- 300.056 秒内 16,360/16,360 claim；0 missing、0 duplicate；16,360 heartbeat。
- claim/heartbeat 延迟最大分别为 136ms/93ms；数据库连接峰值 7。
- 测试残留四类均为 0；无页面、Session、卡片或付款动作。

## 未通过/未关闭

### P1：正常 Node 资源结束值偏高

RSS 63.8MB→210.4MB 峰值→174.0MB 结束；heapUsed 8.4MB→83.0MB 峰值→74.1MB 结束。GC 对照曾显示明显较低的峰值，但生产不能依赖强制 GC。当前需要继续拆分 V8 heap、mysql2 外部缓冲、连接池和每分钟趋势。

### P1：没有网络抖动/持久重连组合

连接 KILL 重建已单独通过，但尚未在持续队列期间注入数据库短暂不可用并测量退避、恢复和积压。

## 结论

阶段 1 的数据库控制面功能性通过；阶段 1 的资源稳定性和故障组合仍未关闭。阶段 2 本地 Browser 执行闸门暂不启动。

## 追加诊断

30 秒 `--trace-gc` 观察到 old-space 回收后 heap 降低但 V8 保留 capacity；30 秒 `--max-old-space-size=64` 对照 RSS 峰值约 105MB、结束约 74MB，且 1020/1020 claim、0 duplicate、残留 0。该结果缩小了内存来源范围，但不等于生产可以直接固定 64MB；仍需独立 Worker/接近生产负载复验。

### 新增 P1：soak 队列污染

一次 10 分钟运行混入 3 个上次中止残留 job，导致 claimed 比 created 多 3；该结果作废。harness 已增加空队列前置检查，120 秒复验 6250/6250、0 duplicate、残留 0。长 soak 必须从空队列开始。
