# Browser 容量运行时体检｜2026-09-05

## 现场证据

- `agent-evidence-gate.sh browser-order`：BitBrowser API READY；mihomo 单实例；代理真实出口请求成功。
- 生产 release：`/opt/pojia/releases/20260905-maintenance-bark-6246cc1`。
- 生产服务：Web/普通 Worker active；Browser Worker inactive/disabled。
- 生产 Browser 配置：`BROWSER_WORKER_TARGET=LOCAL_FIXTURE`，`browser_dispatch_enabled=false`，付款写权限 false。
- 生产数据库：`executor_profiles` 只有 1 个 ACTIVE/BROWSER profile；`fulfillment_routes` 中 API 路线 `accepts_new_orders=1`，Browser 路线 `accepts_new_orders=0`。
- 生产最新订单仍为 API 路线，Browser jobs/runs 为 0。
- 生产普通 Worker 未设置 `WORKER_CONCURRENCY`，代码默认值为 `1`；代码允许 1–32，但没有生产并发验收。
- `production-readonly-worker.js` 的 Browser 循环每次只调用一个 `runOnce()`，按顺序处理；当前没有 Profile 池调度或多任务并发控制。
- 本机 BitBrowser Local API 列出 7 个 Profile，其中 6 个是 Browser lane；它们目前只是本地 Profile 资源，不等于生产已注册、已租约化或已通过并发验收。

## 结论

当前不能宣称“已经能承接每天几百单”。已修复的是代理生命周期和单 Profile 开窗稳定性，不是 Browser 吞吐系统。当前真实瓶颈是：生产 Browser Worker 未启用、Browser 路线不接新单、生产只有一个 Browser executor profile、运行时单循环、没有六 Profile 租约池、没有并发/恢复/长时验收。

## 放量前顺序

1. 单 Profile 客户式只读 Session/Checkout；
2. 3 Profile 受控并发，验证租约、Session 隔离、异常回收；
3. 6 Profile 受控并发，验证代理/页面/卡片/队列与资金状态；
4. 3–5 单连续、10–20 单并发、恢复演练；
5. 通过后才调整有限并发并逐步放量到 100–300 单/日。

本次只读体检未启用生产 Browser、未切换路线、未创建订单、未读取 Session、未执行 Provider/卡台写入、未付款。
