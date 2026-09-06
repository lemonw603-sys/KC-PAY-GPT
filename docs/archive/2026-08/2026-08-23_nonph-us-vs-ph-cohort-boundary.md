# NON_PH_US 与 PH cohort 边界（2026-08-23）

## 结论

美国 VPN 不会阻塞 BRFE 的功能主线。它可以作为 `NON_PH_US` 独立 cohort，用于非付款身份/页面观察和 Worker 接线；但它不是菲律宾环境的替代品。

## 可继续验证

- Session Loader 与临时 BrowserContext 生命周期；
- 服务器身份 probe 和只读页面事实；
- 页面签名、导航/iframe、租约、人工冻结和审计；
- 订单、attempt、dispatch、资金未知锁定和恢复接口。

## 不可外推

- 菲律宾价格、税费、币种或最终金额；
- 支付方式/3DS 可用性；
- 菲律宾出口下的页面分流或风控行为；
- 美国账号或美国 IP 的结果对菲律宾账号/IP 的封控概率。

价格可能同时受账号地区、计费国家、支付工具、币种、税费和服务端策略影响；在禁止 Checkout/付款的当前阶段，不把任何单一 US VPN 观察写成价格结论。

## 执行规则

美国网络新建 `NON_PH_US` manifest/cohort，不覆盖 `NON_PH_FUNCTIONAL` 基线；菲律宾出口到位后新增 `PH_GENERIC` 或 `PH_STICKY_PRODUCTION_LIKE` manifest/cohort，分开记录 runtime/profile/network digest 和证据。
