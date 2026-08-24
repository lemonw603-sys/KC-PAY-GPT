# Browser 阶段 A1：24 小时 detached soak 完成核验（2026-08-24）

## 结论

这轮隔离控制面长窗口已完成，满足 A1 的本轮窄目标；不关闭 A2，也不把结果外推为生产高可用、真实 Browser 或资金安全证明。

## 证据

- 日志：`artifacts/browser-soak/24h-2026-08-22T18-45-39-769Z.log`
- 运行时长：`86423008ms`（目标 `86400000ms`）
- `created=360`、`claimed=360`、`missing=0`、`duplicateClaims=0`、`heartbeatOk=360`
- 资源：RSS `66928640→68517888→27574272` bytes；heap `9491648→17987648→16135480` bytes；external `1985853→2513480→2425973` bytes；`Threads_connected` 峰值 4
- 延迟：claim 平均 `7.9167ms`、最大 `178ms`；heartbeat 平均 `3.1583ms`、最大 `26ms`
- 日志尾部 cleanup：`residualDispatch=0`、`residualAttempts=0`、`residualOrders=0`、`residualCdks=0`
- 独立 MySQL 查询（`pojia_test`，2026-08-24）：`soak-job-*`/`stage1-*` dispatch、attempt、order、CDK 均为 0

## 发现与修正

旧 detached 元数据 JSON 仍保留 `status=RUNNING`，而日志已完成；同时 harness 在清空内存 fixture 后才判断 `rows.length`，残留查询可能被跳过。已修正：

- `browser-mysql-bounded-soak.js` 始终按本轮唯一 suffix 查询四类残留，并把最终状态/指标/cleanup 写入可选 `BROWSER_SOAK_METADATA_PATH`；失败或残留非零时写 `FAILED`。
- `browser-detached-soak-runner.js` 将元数据路径传给子进程，后续 detached 运行结束后元数据会从 `RUNNING` 更新为 `COMPLETED`/`FAILED`。

## 边界

- 这是单 MySQL 8.4 隔离拓扑的 A1 控制面证据；A2 主从/故障转移仍为 `NOT_AVAILABLE_IN_TEST_TOPOLOGY`。
- 未接入真实 Session、外部页面、Checkout、卡片、付款或生产 Worker。
- 旧一轮元数据的陈旧状态不覆盖日志和独立查询，但说明旧 runner 证据状态不可单独采信。

## 回放与验证

```bash
docker exec pojia-stage1-mysql mysql -uroot -proot -D pojia_test -NBe \
  "SELECT COUNT(*) FROM browser_dispatch_jobs WHERE job_key LIKE 'soak-job-%' OR job_key LIKE 'stage1-%';"

TEST_DATABASE_URL='mysql://root:root@127.0.0.1:54741/pojia_test' \
  BROWSER_SOAK_METADATA_PATH=/tmp/browser-soak-metadata.json \
  node v1/test-support/browser-mysql-bounded-soak.js \
  --duration-ms=1000 --jobs=1 --workers=1 --delay-ms=1 --lease-seconds=60
```

后一命令在本轮得到 `4/4 claim`、`0 duplicate`、`4 heartbeat`、四类残留均为 0，且元数据最终状态为 `COMPLETED`。
