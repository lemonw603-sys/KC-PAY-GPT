# ZZSHU 三方接口：与 09-17 摘录相比的变化（2026-09-26 抓取）

> 来源：https://card.zzshu.pro/docs（Chrome 只读打开，页面正文，2026-09-26 20:1x UTC）。对照 `2026-09-17_zzshu-third-party-api-plans-excerpt.md`。只记与本项目现有对接（`v1/src/providers/zzshu-recharge.js`，只用 `orderType=direct`、默认 `plus`）相关的差异。**文档是对方的说法；下面第 1 条已用真实响应坐实，其余未验。**

1. **计费改了（已坐实）**：`X-API-Key` 默认必须是本站「卡密管理 / API管理」发放的卡密，未登记返回 `40107`（HTTP 401）；开通成功按套餐扣点（默认各 1 点），创建时预占，失败 / 取消不扣；点数不足等返回 `40306`。09-17 时是「任意非空字符串、不校验、不扣次」。
   - 真实响应：2026-09-26 20:1x UTC 在生产服务器用生产 release 的 `ZzshuRechargeProvider` 以生产 `ZZSHU_API_KEY`（64 字符自定义串）只读调 `GET /third-party/user` → **HTTP 401 `{"code":40107,"message":"卡密无效或不存在"}`**。
   - 购买入口（站点公告）：`https://fk.zzshu.pro`。
2. **新套餐**：`go`、`to_20x`（Plus / 5X 升 20X）、`codex`（Codex 点数）；原有 `plus` / `pro5` / `pro20` / `plus_to_5x` / `renew_20x` 仍在。
3. **新参数 `region`**：PH（默认，PHP）/ US / EG / CL；显式传必须该套餐已开放，否则 `40020`。本项目不传 → 仍为 PH。
4. **新字段 `verification`（状态查询）**：`cs_live_` 需要人工安全验证时返回 Stripe `client_secret` + `publishable_key`，要求对接方在**自己的页面**用 Stripe.js `handleNextAction` 完成，120 秒过期后订单记失败。本项目没有这一环 → 遇到验证的单会在 120 秒后失败。
5. **新接口**：`POST /third-party/orders/history`（按 Key 查历史）、`POST /third-party/credits/recharge`（把卡密点数充进 API Key）。
6. **`card_key` 模式**（用它的平台卡库）仍可下单，但文档写「仅作存量兼容，请勿基于 card_key 开展新的接口对接」。
7. 无幂等键（与 09-17 相同）：重复提交可能产生多笔订单，下游自己防重。
8. 09-17 C2 的卡头白名单拒绝（`40020`「该卡头暂不支持提交」，D-253）在现文档的 `40020` 消息清单里没有列出；**是否仍按卡头拒卡未知**。
