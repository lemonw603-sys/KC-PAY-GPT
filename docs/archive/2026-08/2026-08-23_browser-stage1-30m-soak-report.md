# Browser 阶段 1：30 分钟正常 Node soak（2026-08-23）

## 参数

- 隔离 MySQL `pojia_test`
- 空 dispatch queue 前置检查
- 1800000ms（实际 1800045ms）
- 每轮 10 job、4 worker、3ms 动作间隔、120 秒租约
- 正常 Node（非 `--expose-gc`）

## 结果

```text
created=94790
claimed=94790
missing=0
duplicateClaims=0
heartbeatOk=94790
claimLatencyAvgMs=3.576
claimLatencyMaxMs=172
heartbeatLatencyAvgMs=1.617
heartbeatLatencyMaxMs=156
dbThreadsPeak=5
rssStart=66.9MB
rssPeak=210.6MB
rssEnd=131.2MB
heapStart=8.9MB
heapPeak=84.0MB
heapEnd=20.5MB
externalStart=1.9MB
externalPeak=15.7MB
externalEnd=3.0MB
```

脚本清理与独立查询均确认 Browser dispatch、attempt、订单和 CDK 测试夹具无残留；付款/Checkout 动作为 0。

## 判定

30 分钟正常 Node 控制面功能性和资源回落趋势通过；RSS 峰值没有随窗口线性增长，heap/external 在结束时明显回落。该结果仍不是 24 小时证明，也不能外推真实 Browser、PH cohort 或生产账号风控。
