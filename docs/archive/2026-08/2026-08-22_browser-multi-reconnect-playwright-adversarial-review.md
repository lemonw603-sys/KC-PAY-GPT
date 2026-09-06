# Browser 多连接重建与 Playwright 中断对抗式审查（2026-08-22）

## 通过项

1. 四个并发 mysql2 连接同时被 kill，四个 pool 查询均重建成功。
2. 本地 Playwright Chromium slow navigation 在 lease 丢失时触发 abort/关闭请求。
3. 中断场景没有 `/submit` 请求，付款动作计数为 0。

## 盲区

### P1：连接恢复没有长时间积压

四连接场景只验证一次断开/重建，没有持续断开、连接池耗尽、队列积压或延迟指标。

### P1：Playwright 场景是本地 HTTP slow page

它证明控制壳与 Playwright promise 的中断边界，不证明真实站点导航、iframe、下载或浏览器进程崩溃时的所有行为。

### P1：未知资金恢复未进入该场景

本轮没有付款动作；任何真实付款未知仍必须进入 `RECONCILE_ONLY`，不得依赖连接重建自动重试。

## 判定

多连接重建和本地 Playwright 动作中断通过；长时间 soak、真实网络/浏览器故障和资金未知恢复仍未关闭。
