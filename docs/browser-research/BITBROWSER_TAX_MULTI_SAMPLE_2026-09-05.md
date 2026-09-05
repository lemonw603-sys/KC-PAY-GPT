# BitBrowser 多样本税额对照（2026-09-05）

## 现场样本

- 新 Profile `Plus Browser PH Lane 2`：新 Session、Checkout；未填卡时显示 `PHP / ₱982.14 / Tax 0% / ₱0.00 / Due ₱982.14`。
- 新 Profile `AI Recharge Browser Lane 4`：注入同一测试 Session，先从套餐页新建 Checkout；初始报价 `₱982.14 + VAT 12% ₱117.86 = ₱1,100`。随后在同一 Checkout 填入一组新的测试卡字段、US/DE 账单地址和 Session 邮箱，页面更新为 `Tax (0%) / ₱0.00 / Due ₱982.14`。

## 关键差异

同一代理地区和同一 Session 并不能保证初始报价一致；样本 B 证明填写支付卡 + US/DE 地址 + 邮箱后可触发零税报价刷新。样本 A 证明无卡也可能在 Checkout 初始化时直接得到零税，说明税务报价还受 Checkout/账号上下文或初始化时序影响。

## 边界

本轮未点击 Subscribe、未付款。尚不能证明某个单一变量“永远”导致零税；能固化的是：自动填写完整账单资料，等待服务端报价刷新，并只在 PHP、税额 0、总额与小计一致时继续。
