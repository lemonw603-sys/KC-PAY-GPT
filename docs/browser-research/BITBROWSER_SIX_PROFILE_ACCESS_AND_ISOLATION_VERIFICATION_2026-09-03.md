# BitBrowser 六 Profile 访问与隔离验证（2026-09-03）

## 目标与边界

把已通过的三个本地 BitBrowser Profile 扩为六个，验证六个真实独立浏览器进程能否同时访问 ChatGPT，并核对 Cookie、localStorage、运行时指纹摘要和出口一致性。全程不注入 Session、不进入客户 Checkout、不填卡、不点击 Subscribe、不连接生产队列，也不调用 Provider/卡台写接口。

## 执行过程

1. 先重新启动原三个 Profile。结果继续为 ChatGPT HTTP 200 `3/3`、Cookie 隔离 `3/3`、localStorage 隔离 `3/3`，证明此前保留 Profile 运行 Cookie 的修复在关闭并重新启动后仍有效。
2. 通过 BitBrowser loopback Local API 创建另外三个本地 Profile；不复制账号、Session、Cookie、localStorage、IndexedDB、支付地址或客户材料。六个 opaque Profile ID 仅保存在 Git 忽略、调用者持有的本机 `0600` 配置中。
3. 第一轮用六个并发 `/browser/open` 请求启动时，Local API 在已部分启动窗口后拒绝了其中一个请求。这不是 ChatGPT 页面失败，但会形成部分成功的中间状态。已关闭全部窗口并确认六个 Profile 均恢复关闭状态。
4. 验证器因此改为**顺序启动 Profile、并行执行页面验证**，并记录每一个已成功启动的 ID，以便任一阶段失败时完整关闭。本次改动不改变 Worker 的六 lane 并发模型，只避免向 BitBrowser Local API 瞬间并发发送六个启动请求。

## 最终现场结果

顺序启动完成后，六个 Profile 并行验证结果：

```text
profileCount=6
chatgptHttp200Count=6
isolatedCookieCount=6
isolatedStorageCount=6
uniqueRuntimeFingerprintDigestCount=6
exitLocationSet=PH
uniqueExitDigestCount=1
sessionInjected=false
cardFieldsWritten=0
submitCalls=0
```

运行时指纹摘要只使用非敏感浏览器属性、插件列表、Canvas、WebGL 和字体可用性生成哈希；不记录原始 Profile ID、出口 IP 或客户材料。六个摘要均不相同，证明本轮采集维度下六个运行环境不是同一摘要；这不等于已经证明所有反风控维度、长期稳定性或付款成功率。

六路当前共用同一个菲律宾公网出口。用户已确认现阶段先共用一个出口；因此网络出口隔离不是当前晋级阻断，但不能把它写成已具备六个独立 IP。

## 代码与测试

- 新增 `browser-mvp/scripts/verify-bitbrowser-profile-pool-nonpayment.js`，接受 1–6 个本机 Profile，输出只有聚合计数和哈希去重数。
- `browser-mvp/package.json` 的语法检查纳入该脚本。
- Browser 全量测试：`141 total / 137 passed / 4 environment-skipped / 0 failed`。
- 所有 Profile 在验证结束后关闭；生产 release、默认 API 路线和 Browser Worker 状态未改变。

## 准确结论与下一步

六 Profile 的**真实同开访问、Cookie/localStorage 隔离、运行时指纹摘要差异和关闭清理**已经通过。尚未验证的是：六个真实 Profile 接入共享订单队列后的任务领取/租约恢复、长时间常驻、真实客户订单付款和付款后对账。

下一步使用当前六 Profile 配置执行一次生产形态但仍不付款的本地 Worker/共享队列闭环；通过后，才为首笔真实 Browser 付款单独取得确认。
