# NON_PH_FUNCTIONAL 只读观察前置核验（2026-08-23）

## 已验证

`browser-poc/manifests/non-ph-functional-baseline-2026-08-22.json` 只读约束测试通过：

- `scope=AUTH_READ_ONLY`；
- 临时 BrowserContext，无云 Profile/同步；
- 不允许创建 Checkout；
- 不允许 payment writes；
- 不具备菲律宾或付款晋级资格；
- 网络变化要求新 manifest/cohort。

定向测试：`node --test test/browser-nonph-manifest.test.js v1/test/browser-worker-local-mock-integration.test.js`，6/6 通过；覆盖两个只读 manifest、导航/漂移 fail-closed、租约丢失中止、多页面人工冻结，mock submit 为 0。

运行环境：本地 mock/Playwright；不使用真实 Session、外部页面、Checkout、卡片或付款。

## 未开始事实

真实非 PH Session 观察仍未在本批启动：需要仓库外 `0600` Session 文件和只读观察网络输入；不会从聊天上下文重建或输出 Session。页面 403/挑战只能记为观察事实，不能写成封控、付款或成功。

## 下一步

在输入到位后，使用一次性临时 Context 做服务器身份 probe 和只读页面观察；保存脱敏摘要/哈希，不创建 Checkout，不进入付款或菲律宾晋级。当前主线不启动 `NON_PH_US`；菲律宾 VPN 到位后直接新建 PH manifest/cohort。

## 运行中对抗式复核

- 不能因 6/6 本地测试通过而宣称真实 Session 或外部页面可用；
- 不能把页面 403/挑战解释成封控或付款失败；
- 没有 `0600` 输入时不启动真实观察器；
- manifest、网络、runtime 或 Session policy 改变必须新建 cohort。
