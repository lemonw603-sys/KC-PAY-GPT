# ZZSHU 三方接口文档摘录：套餐取值与 Pro 正价开通（2026-09-17 抓取）

> 来源：https://card.zzshu.pro/docs（SPA，正文在 `assets/ApiDocsPage-Bl41q-hn.js`）。抓取时间 2026-09-17 ~10:20 UTC，只读，原文未改。用途：D-248 核实「API 路线能否充 Pro」。**本仓库 `对接api.md` 是另一个系统（GPT-KCCatk，gogpt.id88.icu）的文档，不是 ZZSHU 的，此前被当成 ZZSHU 合同引用属误。**
>
> 关键结论（原文见下）：`planType` 取值 `plus` / `pro5` / `pro20` / `plus_to_5x` / `renew_20x`；`plus` / `pro5` / `pro20` 是给**免费账号**正价开通，需银行卡；本仓库 `plan_type` 的 `pro_5x` / `pro_20x` 需映射为 `pro5` / `pro20`。生产至今 `create_direct` 只传过 `plus`（`provider_calls` 10 条 plus、4 条 NULL）。

---

），不代表真实扣次。
- 三方订单不消耗本站卡密次数。
- 套餐取值：
