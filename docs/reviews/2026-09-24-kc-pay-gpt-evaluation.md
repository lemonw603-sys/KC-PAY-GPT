# KC-PAY-GPT 评估｜2026-09-24

执行者：窗口 acd69d1e。Lemon 的问题：①它能不能让我们搭一套「自己的 API 充值」？②能否作为与现有 API 充值并行的路线、最好能用不同卡台的卡、又不被我们系统的条条框框拖累？③继续放独立文件夹还是并进本仓库？
方法：GitHub API 快速筛选 + 本地克隆逐文件核对 + 与本仓库逐字节比对 + 本仓库既有 PoC 证据。**未运行其代码、未真实付款、未调用第三方接口。**

## 0. 最重要的事实：它就是我们自己的起点

- 本仓库 `origin` = `lemonw603-sys/KC-PAY-GPT`，`upstream` = `KC-CatK/KC-PAY-GPT`；上游最新提交 `fb4da76`（含 `5f8bb97` 第三方 API 对接）**已在本仓库历史里**。
- `KC-PAY-GPT-standalone` 的 31 个根目录 JS 文件，与本仓库根目录同名文件 **29 个逐字节相同**；`server.js` 唯一差别是本仓库顶部 8 行「legacy 运行锁」（`12c0f2e`，2026-08-17），另一个是 vitest 配置。
- 本仓库 v1 从 D-041 起把这套根目录代码定为「噪音与定点参考，不整体恢复」（`v1/README.md`：不导入根目录浏览器、Stripe、hCaptcha、代理或旧充值模块）；`browser-mvp/` 是在它基础上重写并加固过的 Browser 路线（D-038、D-042 明确「参考 legacy」）。
- 所以这次不是评估一个陌生外部项目，而是评估**我们自己封存的旧代码**。Codex 在独立文件夹里做的「复用 BitBrowser + session-bootstrap 跑本地路线」（其 `HANDOFF.md`），等于在旧代码里重做一遍 `browser-mvp` 已经做过的事。

## 1. 快速筛选（上游 KC-CatK/KC-PAY-GPT）

| 指标 | 状态 | 证据 |
|---|---|---|
| 维护 | ⚠️ | 2026-08-15 建库，08-16 最后一次提交，此后无更新；无 release |
| 活跃度 | ⚠️ | open issue 1；贡献者 KC-CatK 7 次提交、432539 3 次 |
| 生态 | — | 165 star / 90 fork（fork 比例高，像被拿去做同类生意）；建库 <3 个月，按规则不判 |
| 文档 | ⚠️ | README 引用不存在的 `product_activator.js`；README 与 `对接api.md` 的第三方地址不一致 |
| 许可 | ✅ | MIT |

## 2. 它里面到底有几条「充值路线」

| 路线 | 怎么工作（代码证据） | 是不是「我们自己的 API 充值」 |
|---|---|---|
| **本地路线**（`index.js` → `chatgpt.js` → `payment-retry.js` → `stripe-payment.js`） | Playwright 普通 Chromium 注入 Session；先调 ChatGPT 自己的 `backend-api/payments/checkout` 建结账页（`chatgpt.js:383 openApiCheckout`），失败回退定价页 UI；然后**在浏览器里填 Stripe 卡表**：`stripe-payment.js` 直接调 Stripe 接口 **0 处**、页面操作 **178 处** | **不是**。这是浏览器自动化，和我们的 Browser 路线同一类，而且是它的前身 |
| **第三方路线**（`gpt-api-client.js`） | `POST /pay` 到 `kc.vpss.eu.cc`（文档里又写 `gogpt.id88.icu`），请求体含**完整卡号/CVC（`new_card`）、客户 ChatGPT 登录凭证（`session`）、代理完整地址含账密（`proxy`）、账单地址**；对方排队执行，我们只轮询结果。服务端源码不在仓库里 | **不是**。核心在别人手里，性质等同「另一个 ZZSHU」 |

仓库里**没有**第三条「不经浏览器、自己直连付款」的路。

## 3. 本地路线为什么不值得再捡起来

1. **它的核心捷径在 Plus 上被挡**：直接调 `payments/checkout` 买 Plus，2026-09-07 两个窗口两个账号都返回 400「Our systems have detected unusual activity」（`artifacts/poc-checkout-api-20260907/result*.json`，`docs/browser-research/IDENTITY_STRATEGY_RESEARCH_2026-09-07.md` 第 2 条）；**今天 Codex 再跑一次仍是 400**（`artifacts/poc-checkout-api-20260924/result.json`）。Pro 5X/20X 裸调当时是 200。我们的 Browser 路线正是因此改走「定价弹窗点按钮」。
2. **普通 Chromium 页面级 403**：Codex 今天复测，服务端认 Session（200），但真实页面导航 403（其 `HANDOFF.md`，证据 `artifacts/browser-poc/codex-mvp-cookie-only.json`）。我们换比特浏览器就是为此。
3. **我们已有的都比它新**：取消续费用的是同一个接口（`browser-mvp/src/chatgpt-post-payment-verifier.js:9` 与 KC `subscription-check.js:9` 都是 `backend-api/subscriptions/cancel`），且我们是付款后自动取消，KC 只是给用户的手动按钮；付款后核实、付款不明补核、Session 注入修正（D-140）、菲律宾 sticky 出口都是后来加固的。
4. **资金与数据问题**：付款记录表存**完整卡号明文**（`payment-retry.js` `createBillingRecord({ card_number })`）；按报错文字关键词判「被拒」后自动换下一张卡（只在明确被拒时，其它失败转人工——这一点是安全的）。
5. **人机验证**：该路径遇到即放弃转人工；仓库另有调用本机 Python 模型自动过 hCaptcha 的模块（`hcaptcha-solver.js`）。这部分**不评估、不建议启用**——绕过支付方的人机与风控检测，我不参与设计；我们现在的做法是验证码交给人（契约表三 #4）。

## 4. 第三方路线：能不能作为并行 API 路线

- **能用不同卡台的卡**：协议上 `new_card` 可以传任意卡资料，所以 highvcc 的卡理论上也能用——这正是 ZZSHU 做不到的（ZZSHU 只认 hnskj 卡 BIN，D-253）。这是它唯一对我们有增量的点。
- **代价**：卡号+CVC、客户账号登录凭证、我们的代理账密全部交给一个身份不明的运营方；两个地址不一致；服务端不可见；需要买它的 API Key（按 credits 计费）；没有一次真实调用证据（今天公开入口 200，`/plans`、`/balance` 无凭据 401）。
- **与 ZZSHU 的关系**：我们现有 API 路线本来就是「把卡交给第三方代充」的模式，所以信任模型并不比现状更差；区别在于 ZZSHU 已经跑过真单、KC 第三方完全没验证过。
- **「别被条条框框拖累」**：真正不能省的只有三条资金底线——①结果不明时不重付、不换卡（KC 客户端把轮询超时当失败并释放卡，`server.js:3359-3382`，照搬会重复扣款）；②一张卡同一时刻只给一个在途单；③留下「哪张卡、多少钱、哪个单、对方单号」的记录。其余（后台页面、诊断、复杂审计、文档）都可以不给它套。

## 5. 放哪做（执行者判断）

- **本地路线：不再单独做。** 它就是我们根目录的旧代码，`browser-mvp` 是它加固后的版本；在独立文件夹再做一遍是重复劳动（这也是 Codex 效果差的根因）。
- **第三方路线：如果 Lemon 决定试，先在独立文件夹做最小验证**——只用 `gpt-api-client.js` 写一个一次性脚本，用 Lemon 自己的号 + 一张小额 highvcc 卡跑一单，看成功率、耗时、是否接受 highvcc 卡；不接生产库、不碰客户数据。
- **验证通过、要给客户用时：接进本仓库**，做成和 ZZSHU 并列的一个执行器适配器（D-360 已定「薄 Adapter」）。理由：客户、CDK、客户页、卡都在本仓库；另起一套独立系统等于再养一套后台、CDK、客户页。适配器只守上面三条资金底线，不套别的。
- 独立文件夹未在 `~/code/PROJECTS.md` 登记，定下用途后补登。

## 6. 顺带发现

- 今天 Codex 用的比特浏览器窗口（编号摘要 `9d7445ff…`，即 09-07 研究里的 Lane 3「免费测试账号」）**仍登录着一个免费版、无订阅的账号**（`/api/auth/session` 200、`plan=free`、`hasActive=false`，2026-09-24 06:59 UTC）。Lemon 说手里没有 free 号——这个号可能可以用于块 6 的非付款 PoC 或演练，**需 Lemon 确认后才用**。
