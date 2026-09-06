# Browser 路线补充：NON_PH_US 输入层（2026-08-23）

## 为什么补改

当前没有菲律宾出口，但美国 VPN 可以用于继续验证 Browser 的非付款功能、身份 probe 和页面事实。它不能代替菲律宾价格、支付、页面分流或账号风险验证，因此新增独立输入层而不是覆盖原 `NON_PH_FUNCTIONAL` 或提前晋级 PH。

## 修订后的大阶段

1. 阶段 1：控制面稳定性；不变。
2. 阶段 2：本地 Browser mock 执行；不变。
3. 阶段 3：非 PH 只读观察，分为：
   - `NON_PH_FUNCTIONAL`：无代理功能基线；
   - `NON_PH_US`：美国 VPN/出口的独立只读 cohort。
4. 阶段 4：菲律宾生产相似输入，新增 `PH_GENERIC` 或 `PH_STICKY_PRODUCTION_LIKE` manifest/cohort；不覆盖 US 结果。
5. 阶段 5：真实充值闸门；仍需用户当次确认。

## NON_PH_US 放行范围

允许服务器身份 probe、只读页面事实、Session Loader、临时 Context、页面签名和异常停止验证；禁止 Checkout 创建、卡片、付款、价格结论、菲律宾晋级和真实容量结论。

## 变更顺序

先落盘 manifest/合同和测试，再接只读观察器；Session 只从仓库外 `0600` 输入读取，普通证据只保存哈希/脱敏摘要。

美国 VPN 是可选观察输入，不是默认履约主链路依赖。订单、资金栅栏、付款未知锁定和审计不因代理存在增加分支；代理失败只冻结该 cohort/网络租约，不自动换路或重付。
