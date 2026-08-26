# Browser 多连接重建与 Playwright 动作中断报告（2026-08-22）

## 多连接重建

固定脚本：`v1/test-support/browser-pool-multi-reconnect.js`。

四个独立子进程各持有一个 mysql2 pool 连接；父进程同时 `KILL CONNECTION`，随后要求四个进程通过原 pool 再次查询。

结果：

```json
{"scenario":"four-pool-connections-reconnect","killed":4,"reconnected":4}
```

## Playwright 中断

`v1/test/browser-worker-service.test.js`新增本地 HTTP slow page + Playwright Chromium 场景：

- 页面导航响应延迟 5 秒；
- Worker watchdog 在 lease 丢失时触发 AbortSignal；
- 页面关闭请求被触发；
- 导航被中断；
- `submitEvents=0`，未产生任何提交请求。

Browser Worker service 定向测试：5/5 通过；Worker process/service/loop 合计：12/12 通过。

## 结论

多连接同时断开后 pool 可重建；本地 Playwright 导航中途失租约可中断且没有提交事件。真实 Browser runtime、真实网络抖动、资金未知恢复和生产拓扑仍未验证。
