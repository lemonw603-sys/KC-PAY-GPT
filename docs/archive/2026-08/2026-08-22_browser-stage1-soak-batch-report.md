# Browser 阶段 1 稳定性批次报告（2026-08-22）

## 90 秒主批次（正常 Node）

- 4590 created / 4590 claimed
- missing 0 / duplicate 0 / heartbeat 4590
- MySQL Threads_connected 峰值 7
- claim 延迟均值 3.64ms、最大 157ms
- heartbeat 延迟均值 1.59ms、最大 176ms
- RSS 64.8MB→207.9MB 峰值/199.0MB 结束
- heapUsed 8.5MB→87.4MB 峰值/24.7MB 结束
- external 1.99MB→18.95MB 峰值/5.21MB 结束
- 残留 dispatch/attempt/order/cdk：0/0/0/0

## 60 秒诊断对照（`node --expose-gc`）

- 2970 created / 2970 claimed
- missing 0 / duplicate 0 / heartbeat 2970
- MySQL Threads_connected 峰值 5
- claim 延迟均值 3.39ms、最大 118ms
- heartbeat 延迟均值 1.45ms、最大 21ms
- RSS 65.8MB→80.4MB 峰值/74.8MB 结束
- heapUsed 8.4MB→15.6MB 峰值/11.1MB 结束
- external 1.99MB→2.19MB 峰值/2.20MB 结束
- 残留 dispatch/attempt/order/cdk：0/0/0/0

## 阶段判断

控制面 claim/lease/heartbeat 在两种批次均无漏领、重复或残留。显式 GC 对照显著降低 RSS/heap 峰值，说明 90 秒主批次的高 RSS 更可能包含 V8 保留/回收时机和短期外部缓冲，尚不能判定为业务泄漏；但正常 Node 长窗口仍需继续观察，阶段 1 暂不宣布最终通过。
