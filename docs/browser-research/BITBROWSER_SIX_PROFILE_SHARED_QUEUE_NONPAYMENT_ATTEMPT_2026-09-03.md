# BitBrowser 六 Profile 共享队列非付款闭环尝试（2026-09-03）

## 目标与隔离边界

使用一次性 MySQL 8.4 容器、完整 migrations、六条合成订单/attempt/消费预留/Browser dispatch job、真实本地 BitBrowser 六 Profile 和生产只读 Worker 编排，验证“共享队列领取→六槽运行→页面观察→付款前安全收敛”。

本轮目标页面是本地 `data:text/html` fixture；没有客户 Session、没有真实卡资料、没有 ChatGPT Checkout、没有 Provider/卡台调用，也没有付款能力。所有付款和 Provider 写开关均为 `false`，付款执行器为 `MOCK`。

## 第一次实跑发现的问题

第一次实跑中，六条 Worker lane 先领取共享队列任务并创建数据库运行租约，随后才等待六个 BitBrowser Profile 顺序冷启动。由于物理窗口启动总耗时可能超过后排任务租约，出现：

```text
sourceCode=ACTION_TIMEOUT
safe-abort cause=LEASE_EXPIRED
```

这是生产时序缺陷，不是通过提高租约时间就应掩盖的问题。一次性数据库容器已销毁，所有 BitBrowser Profile 已关闭；没有外部付款或生产状态残留。

## 修正

1. `BitBrowserProfilePoolRuntimeAdapter` 新增 `warmup()`：先顺序物理启动所需 Profile，清理客户状态并保持窗口常驻。
2. `runProductionReadonlyBrowserWorker()` 在启动队列 lane 前执行 warmup；只有所有所需窗口就绪后才开始领取订单，因此冷启动时间不进入订单运行租约。
3. Local API 返回每日额度等账户级启动错误后，当前池立即阻断剩余排队启动，不再对六个 Profile 重复发送同类失败请求。
4. 新增真实六 Profile + 隔离 MySQL 集成测试入口；Worker 提前失败会立即结束测试，不再让数据库轮询等待到超时。

## 第二次实跑边界

修正后的第二次实跑在 warmup 的第一个窗口即收到 BitBrowser：

```text
BITBROWSER_DAILY_OPEN_LIMIT
```

这证明新时序在领取共享队列任务前先执行 Profile 准备，并按账户级错误停止；但由于当天窗口打开额度已经被前述多轮 1→3→6 验收消耗，无法在本日完成修正后的六路共享队列终态验证。不得把本轮写成集成闭环已经通过。

## 当前代码验证

- Profile 池定向测试：`17 passed / 0 failed`，另有本集成项因缺现场环境默认跳过。
- Browser 全量：`143 total / 138 passed / 5 environment-skipped / 0 failed`。
- 账户级启动拒绝测试确认六路 warmup 只调用一次 Local API，而不是失败后再试其余五个。
- 六个真实 Profile 当前均已关闭；一次性 MySQL 容器已停止并删除。

## 下一步

BitBrowser 每日打开额度恢复后，只重跑同一个集成测试，不创建新业务订单、不改变生产路线。通过标准为六条合成 dispatch job 全部 `CANCELLED/FAILED_SAFE`、attempt/funds 全部 `CLEARED`、付款 permit/submit operation/未释放资源租约全部为 0。
