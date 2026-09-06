# Browser 阶段 1：15 分钟正常 Node soak（2026-08-23）

## 参数

- 隔离 MySQL `pojia_test`
- 空 dispatch queue 前置检查
- 900000ms（实际 900107ms）
- 每轮 10 job、4 worker、3ms 动作间隔、120 秒租约
- 正常 Node（非 `--expose-gc`）

## 结果

```text
created=46370
claimed=46370
missing=0
duplicateClaims=0
heartbeatOk=46370
claimLatencyAvgMs=3.557
claimLatencyMaxMs=380
heartbeatLatencyAvgMs=1.618
heartbeatLatencyMaxMs=95
dbThreadsPeak=5
rssStart=66.8MB
rssPeak=211.2MB
rssEnd=162.6MB
heapStart=9.3MB
heapPeak=82.8MB
heapEnd=26.4MB
externalStart=1.9MB
externalPeak=9.1MB
externalEnd=2.5MB
```

脚本清理与独立查询均为 0：`browser_dispatch_jobs`、`recharge_attempts`、订单和 CDK 测试夹具无残留。付款/Checkout 动作为 0。

## 判定

15 分钟正常 Node 控制面功能性通过，heap/external 在结束时回落；RSS 仍保留在高于起点的水平，不能直接判定泄漏或冻结生产内存参数。主从/故障转移、真实 Browser、PH cohort 和 24 小时 soak 仍未验证。

注：本轮第一次启动使用了容器重启前的旧 host port，立即得到 `ECONNREFUSED`；按当前动态端口重新执行后才产生以上有效结果。该输入问题不计入 soak 指标，但保留在交接事实中。
