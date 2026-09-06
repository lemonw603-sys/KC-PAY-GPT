# Browser dispatch 队列积压 soak（2026-08-23）

## 运行参数

- 隔离 MySQL `pojia_test`
- 预先入队 240 个 Browser job
- 6 个 Worker，单 job 动作间隔 15ms
- 租约 120 秒；故障和付款均关闭

## 结果

```text
claimed=240
missing=0
duplicate=0
heartbeatOk=240
queuePeak=236
claimLatencyAvgMs=8.404
claimLatencyMaxMs=21
residualDispatch=0
```

队列积压从 240 个 job 开始，Worker 持续排空；没有漏领、重复 claim 或残留。该结果只证明短窗口控制面吞吐和租约续期，不代表每日数百单生产容量、账号安全风险或真实付款成功率。
