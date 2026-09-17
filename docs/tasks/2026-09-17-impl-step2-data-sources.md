# 任务书：落实第②步「数据源三件」（面四②，D-249/D-252）

> 开专门落实窗口做。第一句读 `AGENTS.md` 四份顺序 + `docs/V2.0_EXECUTION.md` §3.A 面四② + 本任务书。**只做本块，做完放回主线验；不碰付款路径、不碰路线/卡台选择、不删表。** 落实第①步 C2 已有结论（D-253：API 固定 hnskj），本步不依赖它。

## 目标（三件，各自可独立验收）

**T1 · highvcc 交易与钱包入库**
- 交易：`createHighvccCardProvider().allTransactions()`（`v1/src/providers/highvcc-card.js:202-227`，账户级流水，单条含 `cardAuthId / amount(分) / cardId / lastFour / tradeTimeEpochMs / status / merchantAmount / merchantCurrency / merchantCountry`）→ 按 `cardId` 归到 `cards.external_card_id`（103 账户）→ 写 `card_transactions`（复用 `commitCardTransactionsForCard`，`card-transaction-repository.js:161`；行形状对齐 `normalizeHnskjTransaction` 的输出：id/type/status/amount/currency/fee/tradeTime/merchant*，`hnskj-card.js:192-243`）。`amount` 分→元；`tradeTimeEpochMs` 已是 UTC 毫秒，**不做时区平移**（provider 注释有血泪史）。
- 钱包：`wallet()`（:109）→ `recordProviderBalanceSnapshot(pool, { providerAccountId: 103, currency, availableBalance, ... })`（`provider-balance-snapshot-service.js:130`）。
- 挂载点：并入 `highvcc-snapshot-sync-service.js` 那趟（D-251 每日时段模式：timer 保持现状每小时也可，token 失效即整趟失败、按面四①叫一次；时段模式的 timer 改动归第③步）。token 失效错误码 `HIGHVCC_TOKEN_EXPIRED` 已有。
- 边界：只读卡台、只写这两张表；不改 `cards` 余额逻辑（那是 manual-card-import 的活）；hnskj 不动。

**T2 · hnskj 开卡费记 fee**
- 现状 `card_transactions.fee` 对 `card_recharge` 全 0（生产 15 笔）。找到 hnskj 交易 normalize 里 fee 的来源（`hnskj-card.js:192-243` `fee` 字段）与卡台真实响应是否带开卡费（**先对一次真实响应核实，不看夹具**——D-172 惯犯 3）；若卡台不返回，按 D-229 费率（开卡 $0.5）在开卡成功时写一条 `card_transactions` 费用行（type 用现有分类，见 `domain/card-transaction-classification.js`）。
- 边界：只影响新开卡；历史不补。

**T3 · 消费账本补记 + 人工收口写账本**
- 人工收口写账本：后台 `CONFIRM_MANUAL_PAYMENT`（`browser-admin-service.js:661`）与 `RESOLVE_UNKNOWN_PAYMENT=CHARGED`（:767 附近已有一处 `transitionCardConsumptionInTransaction`，**先读清哪条分支写了、哪条没写**）→ 两条都必须把该单的账本行置 `CONSUMED`（`transitionCardConsumptionInTransaction(connection,{orderId,targetStatus:'CONSUMED',allowedCurrentStatuses:['RESERVED','RECONCILIATION','RELEASED'],requireActive:false,evidence:{source:'manual_closeout',...}})`，`card-consumption-ledger-service.js:94`）。同时核 `close-manually-fulfilled-order.mjs --card-used` 分支是否也漏。
- 历史补记 8 单（生产实查 2026-09-17）：

| 订单 | 路线 | 现账本 | 卡 |
|---|---|---|---|
| PJV1-FqFnMiSKBtLGN14GyP7W | API | 无行 | 6807 hnskj |
| PJV1-VHl_hgWctg78JwDajOVR | Browser | RELEASED | 7402 |
| PJV1-DqcnqHF0tPlxDhygTtAA | Browser | RELEASED | 7402 |
| PJV1-pom5NfWiskFl9u4Aspdm | Browser | RELEASED | 3159 |
| PJV1-NnL3DWl9sCCHWsT2krMy | Browser | RELEASED | 5371 |
| PJV1-BUGAhkA9dYVdLiD6WQac | Browser | RELEASED | 5371 |
| PJV1-G3Ni4WrwJERVUOg5tl3x | Browser | RELEASED | 1657 |
| PJV1-zdprG5vkLzo7UKs8XEe1 | Browser | RELEASED | 1657 |

  正式脚本（走连接池、`--dry-run`、每单一条审计 `order_events` ADMIN reason `ledger backfill D-249`、金额用 `orders.actual_payment_amount` 或该产品单价；FqFn 那单无账本行要 INSERT 而非 transition）。**跑前 dry-run 输出摆给 Lemon，他确认再 apply**（可能让 1657/5371 立即「用满 3 单」进待销——Lemon 已同意，D-249）。
- 边界：只动这 8 单；不动 RELEASED 的失败单（那些是真没用）。

## 验收（D-222 口径：测试 + 脚本 + 生产只读复验，不靠自述）
- T1：单测用**真实响应夹具**（从 provider 注释的合同形状来，不自造）；生产跑一次后 `card_transactions` 与 `provider_balance_snapshots` 对 103 账户非 0；抽一张卡（如 1657）流水合计与卡台后台一致（Lemon 看一眼）。
- T2：一次真实开卡响应留证（不真开卡就用最近一次 `provider_calls` 的 `purchase_card` 响应摘要）；新开卡后 fee 非 0。
- T3：单测两条人工收口分支都置 CONSUMED；补记脚本 dry-run 输出 + 8 条审计行 + 补记后 `npm run audit:card-consumption` 对 hnskj 卡差异归零（highvcc 卡需 T1 到位）；`eligibleInventoryCardSql` 对 1657/5371 的用量数变化符合预期。
- 通用：`state-check.sh` 一致；`wrapup-check.sh` 全绿；收尾更新 `CURRENT_STATE`（新入库计数）、`V2.0_EXECUTION` §6 登记本块证据、`HANDOFF_NOW`。

## 边界
- 不改路线/卡台选择、不改付款、不删表、不动通知白名单（那是第⑤步）。
- hnskj 限流：T1 不碰 hnskj；T2/T3 不发请求。
- 生产写：只有 T3 补记脚本一次（Lemon 当次确认）；T1 是 timer 自然写入。

## 涉及文件
`v1/src/providers/highvcc-card.js` · `v1/src/services/highvcc-snapshot-sync-service.js` · `v1/src/db/repositories/card-transaction-repository.js` · `v1/src/services/provider-balance-snapshot-service.js` · `v1/src/providers/hnskj-card.js` · `v1/src/domain/card-transaction-classification.js` · `v1/src/services/browser-admin-service.js` · `v1/src/services/card-consumption-ledger-service.js` · `v1/scripts/close-manually-fulfilled-order.mjs` · `v1/scripts/card-consumption-audit.js` · 新增 `v1/scripts/backfill-consumption-ledger-d249.mjs`。
