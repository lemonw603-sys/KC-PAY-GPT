# 契约表三 · 人工兜底点唯一清单（2026-09-18，面三④ / D-248，第④步落地）

> 这张表是面五「需要我处理」队列（第⑥块）与面四推送判据（第⑤块）的**输入**。
> 列出每一个人要介入的点：触发条件、系统自己做到哪、人要做什么、后台哪个入口、告警类型。**不在表里的情形不叫人。**
> 勾选来自 Lemon（D-248）：A 必须叫 / B 系统自己解决 / C 不该出现（已改成系统自决 + 定不了才叫）。

| # | 情形 | 勾 | 触发（系统状态） | 系统自己做到哪 | 人要做什么 | 后台入口 | 告警（推手机看第⑤块白名单） |
|---|---|---|---|---|---|---|---|
| 1 | Session 无效 / 剩余不足 30 分钟 | B | `orders.status=WAITING_FOR_SESSION`，`customer_action_code=SESSION_INVALID` | 打回客户换 Session；到期自动关单退码（`session-repair-expiry-service`） | 不叫 | — | 无（客户页提示，第⑤/⑥块） |
| 2 | 账号已是 Plus | B | 同上，`ACCOUNT_ALREADY_PLUS` | 打回客户换号 | 不叫 | — | 无 |
| 3 | 付款前填表失败、现场保留 | A | `browser_runs.status=FAILED_SAFE, payment_state=PAYMENT_ARMED`（等接手窗口） | 保留浏览器现场 90s 等接手；不接判失败退码 | 接手看现场 / 放弃 | 后台 run 控制 REQUEST/TRANSFER；放弃并放卡按钮 → 第⑥块（在那之前 `close-rehearsal-order.mjs`） | `BROWSER_ORDER_FAILED` |
| 4 | 结账页人机验证 | A | run `PAYMENT_UNKNOWN` + `humanVerification` | 停手、锁死、等人点 | 打开窗口勾「I am human」 | 浏览器窗口 | `BROWSER_HUMAN_VERIFICATION`（critical） |
| 5 | 付款不明（API） | C→定不了才叫 | `orders.status=RECONCILIATION_REQUIRED` + `reconciliation_cases API_PAYMENT_UNKNOWN OPEN` | 两路证据自动收口（表二）；30 分钟窗口 | 看账号是否 Plus + 卡台有无扣款，点 CHARGED / NOT_CHARGED | `POST /admin/orders/:publicNo/resolve-unknown-submission` | `ORDER_PAYMENT_UNKNOWN_REVIEW`（critical，**带两路证据**） |
| 6 | 付款不明（Browser） | C→定不了才叫 | `browser_runs.status=HUMAN_REQUIRED, verification_state=HUMAN_REQUIRED` | 两路证据自动收口（表二）；deadline 内每 5s 只读复核 | 同上，点「确认核实结果」 | run 控制 `RESOLVE_UNKNOWN_PAYMENT`（CHARGED / NOT_CHARGED） | `BROWSER_HUMAN_REQUIRED`（critical，**带两路证据**） |
| 7 | 取消续费未确认 | C→不卡单 | `orders.status=RECHARGE_SUCCESS AND cancellation_review_required=1 AND subscription_cancelled=0` | 订单照常交付；卡进待销清单 | 到存活期在卡台删卡，删完点「已销卡」；若想补取消也可在账号里手动关并点「已在账号里取消续费」 | `GET /admin/card-retirement/candidates`、`POST /admin/card-retirement/confirm`；`POST /admin/orders/:publicNo/cancellation-confirmed` | `ORDER_CANCELLATION_UNCONFIRMED`（warning） |
| 8 | Browser 崩溃 / 租约丢失 | B | `recoverExpiredRun` → `RECONCILE_ONLY + VERIFYING_PAYMENT` | 重启后自动进补核（表二） | 不叫（补核定不了才走 #6） | — | `BROWSER_PAYMENT_UNKNOWN`（静音） |
| 9 | 缺卡 | A（开不出才叫） | `WAITING_FOR_CARD` + 调度器开卡失败 / 钱包预检不过 | 分卡时当场同步过期候选（本块）；水位调度自动开（第③步） | 充值钱包 / 贴 token / 看开卡失败原因 | RUNBOOK §2.5 | `CARD_SUPPLY_WALLET_LOW` / `CARD_SUPPLY_OPEN_FAILED` / `CARD_STOCK_LOW` / `ORDER_WAITING_FOR_CARD` |
| 10 | 卡台 token 过期 / 卡台故障 | A | highvcc `HIGHVCC_TOKEN_EXPIRED`；`provider_accounts.supply_fault_state=FAULT` | 转另一台顶（Browser）；API 不转 | 贴 token / 看卡台 | 后台备用卡台 token 入口 | `HIGHVCC_TOKEN_EXPIRED`（第⑤块坐实推送）、`CARD_SUPPLY_OPEN_FAILED` |
| 11 | ZZSHU 零原因失败 | A（b：停单不退码） | `PROVIDER_CONFIRMED_FAILURE` 且 ZZSHU 无原因 | **现状仍是判失败退码**（`commitRechargeFailure`），「停单等看」**本块未改**（面三④待办，归第⑤/⑥块与队列一起做） | 看原始响应再定 | — | — |
| 12 | 待销清单到期 | 手动（D-232） | `card-retirement-service.list().due` 非空 | 派生清单 + 存活期 + 事后同步确认（`sourcePresent`） | 去卡台删，回来点「已销卡」 | 上文 #7 入口 | **不单推**；到期张数并进每日对账那一条汇总（`DAILY_RECONCILIATION_SUMMARY`，Lemon 2026-09-18 定，D-272） |

## 缝 j（人工收口写账本）核对

- Browser `CONFIRM_MANUAL_PAYMENT` / `RESOLVE_UNKNOWN_PAYMENT CHARGED`：`browser-admin-service` 走 `transitionCardConsumptionInTransaction → CONSUMED`（第②步 T3 已证明）。
- API `resolve-unknown-submission CHARGED/NOT_CHARGED`（本块新）：`CONSUMED` / `RELEASED`，单测锁住。
- `cancellation-confirmed`（已在账号里取消续费）：只改订单事实，不涉资金，不写账本——正确。
- `close-manually-fulfilled-order.mjs --card-used`：第②步已修。

## 不在表里、所以不叫人的

`BROWSER_PAYMENT_UNKNOWN`（中间态，静音）、`BROWSER_PAYMENT_CONFIRMED`（与 COMPLETED 重复）、`PROVIDER_BALANCE_CHANGED`（D-228 要推——归第⑤块白名单资金类，不是人工兜底点）、`CARD_STOCK_EMPTY`（`operator-watch` 全局那条，与按台×产品的 `CARD_STOCK_LOW` 重叠，第③步发现 1，第⑤块已归白名单外）。

## 第⑤块（D-271/D-272）对这张表的落地

推手机的判据不再散在各处，只有一张表：`v1/src/domain/alert-push-policy.js`。上表第 A 项对应其中的
`HUMAN` 类；不推的类型在同一文件的 `NON_PUSH_REASONS` 里逐条写了理由。**新增告警类型时，要么进白名单、要么进理由表，不留空白。**

本块新补的两个产生点（以前只改状态、不叫人）：#10 的 `PROVIDER_TOKEN_EXPIRED`（token 失效）与
`CARD_SUPPLY_FAULT`（卡台故障）。另补 `CARD_CHARGEBACK`（拒付必推，以前一条都没推过）。

**#11 ZZSHU 零原因失败仍未做**（现状仍是判失败退码），与「需要我处理」队列一起归第⑥块。
