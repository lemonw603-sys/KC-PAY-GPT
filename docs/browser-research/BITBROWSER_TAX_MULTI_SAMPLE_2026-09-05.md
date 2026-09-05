# BitBrowser 税额多样本核验（2026-09-05）

## 有效样本

- Profile `Plus Browser PH Lane 2`：注入测试 Session 后，`/api/auth/session` 现场复核 email/user/account 三项摘要均匹配；Checkout 显示 `PHP / ₱982.14 / Tax 0% / ₱0.00 / Due ₱982.14`。未付款。

## 作废样本

- Profile `AI Recharge Browser Lane 4` 曾观察到新 Checkout 初始 12% VAT、填写 US/DE 地址后变为 0%。但随后对同一 Checkout 调用 `/api/auth/session` 复核，email/user/account 三项均与目标 Session 不匹配。该持久 Profile 同时存在旧账号页面；因此该样本不能用于证明“同一 Session 地址前后税额变化”，此前结论作废。

## 当前结论

目前只有一笔身份已核验的零税 Checkout 样本；尚不足以证明所有订单稳定零税。后续每个样本必须先关闭旧 ChatGPT 页面、注入 Session、通过 email/user/account 摘要三重匹配，再创建新 Checkout，记录初始报价与 US/DE 地址后的报价。身份不匹配样本不得计入规律。
