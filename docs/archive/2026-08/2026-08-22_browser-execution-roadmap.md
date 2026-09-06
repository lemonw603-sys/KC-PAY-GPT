# Browser 执行器大阶段推进路线（2026-08-22）

本路线把小测试合并为阶段闸门。阶段内部连续完成，不逐项打断用户；只有进入真实付款、生产、菲律宾出口或改变资金架构时才请求确认。

## 阶段 1：控制面稳定性闸门（当前）

范围：MySQL dispatch/lease、Worker 崩溃接管、连接池重建、Playwright 本地动作中断、资源采样、5–15 分钟 soak、故障注入和残留清理。网络级 `KILL CONNECTION` 已作为独立故障轴注入，但当前 Harness watchdog 失败，不能记为通过。

通过条件：claim/heartbeat 无重复和漏领；旧 owner 不能续租；连接断开可恢复；页面动作失租约立即中断；错误/延迟/内存/连接指标可解释；残留为 0。

## 阶段 2：本地 Browser 执行闸门

接入真实 Playwright BrowserContext，但只访问本地 mock/非付款页面。验证 Context 隔离、页面漂移、导航/iframe 中断、checkpoint、审计和人工冻结接口。

禁止：真实 Session、Checkout、卡片、付款和生产网络。

## 阶段 3：非菲律宾 Session 观察闸门

分两类独立 cohort：`NON_PH_FUNCTIONAL`（无代理功能基线）和 `NON_PH_US`（美国 VPN/出口）。两者都使用已确认的 `__Secure-next-auth.session-token`，只读验证服务器身份和页面事实；US 结果不外推菲律宾价格、支付或风控。

## 阶段 4：菲律宾生产相似输入闸门

获得菲律宾出口后新建 `PH_GENERIC` 或 `PH_STICKY_PRODUCTION_LIKE` manifest/cohort，记录 runtime/profile/network digest；不覆盖 NON_PH 结果。

## 阶段 5：真实充值闸门

只有在前四阶段通过、用户当次明确确认后，才设计受控付款观察；生产 Worker、卡台和真实资金动作另行确认。任何未知结果禁止重付、换卡或换 lane。

## 当前停止点

阶段 1 正在执行；24h detached soak 并行运行。阶段 2 本地 mock/Worker 子闸门已有证据；下一主线为阶段 3 的 `NON_PH_FUNCTIONAL`/`NON_PH_US` 只读观察。当前不接生产、不执行真实付款。
