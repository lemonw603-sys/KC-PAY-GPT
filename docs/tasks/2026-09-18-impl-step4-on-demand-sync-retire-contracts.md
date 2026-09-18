# 任务书：落实第④步「按需同步 + 待销清单 + 三张契约表」（面二⑨⑩ + 面三②③④，D-247/D-248/D-252）

> 开专门落实窗口做。第一句读 `AGENTS.md` 四份顺序 + `docs/V2.0_EXECUTION.md` §3.A 面二/面三 + 「整体连贯审补丁」+ 「browser-mvp 改动纪律」+ 本任务书。
> **只做本块，做完放回主线验。** 第③步已上生产（release `20260918-step3-supply-ba28273`，D-259~D-262）。
> 本任务书写于 2026-09-18 00:4x UTC；**里面的行号和数字是当时现场，动手前当场重查**。

## 为什么是这一步

第③步把「谁该用哪个卡台」和「卡怎么补」做了，但分卡还卡在两件事上：hnskj 卡每小时只有 15 分钟合格（面二⑨），用满的卡还挂着占钱（面二⑩）。面三②③④是交付/付款不明/人工兜底点的契约表，第⑤步通知白名单和第⑥步「需要我处理」队列都要拿它当输入，所以排在它们前面。

## 目标

**A · 分卡按需同步**（面二⑨）
- 分卡时候选卡同步过期 → **当场同步这一张再判**（1～2 次请求），不再「排 job → 等 15s runner → 等下次分卡重试」。去掉「每小时一次、15 分钟合格」的抖动对分卡的影响。
- 定时全量同步降频（每卡每小时 → 每卡 3 小时，或只同步 ASSIGNED/RECHARGE_PROCESSING 的）；限流预算：按需 ≤2/单 + 开卡 ≤3/张，写进 `docs/CURRENT_STATE.md` 的 hnskj 行。
- 第③步已把水位/切换校验改成不看新鲜度的库存口径（D-259）；本块动的是分卡那一侧，**资格规则 `eligibleInventoryCardSql` 本身怎么改由 Lemon 定**（选项：a. 规则不变、分卡前先同步；b. 规则里新鲜度改成「同步过 3 小时内」）。

**B · 待销清单**（面二⑩，资金效率主杠杆）
- 口径：不再服务新单（用满 N / DEPLETED / RETIRED）**或取消续费未确认**（打架 4）+ 开卡时间 + 最短存活期已到 → 进待销清单 → 进「需要我处理」（第⑥步做页面；本块先做数据与端点）→ 两台手动删 → 事后同步确认（hnskj 用 catalog-sync，highvcc 用快照）。**D-232 范围内不自动删。**
- 两批旧卡标终态（第③步没做）：hnskj 12 张 $0 卡（卡台已作废，D-247）、highvcc 5 张 HELD_FOR_REVIEW（Lemon 已注销、余额已回钱包）。正式脚本、dry-run、审计。
- 最短存活期是多少天：**问 Lemon**（两台卡台规则可能不同）。

**C · 三张契约表落 `docs/contracts/` + 测试**（面三②③④）
- 表一 交付判据：目标套餐确认 + 取消续费确认 → `RECHARGE_SUCCESS`；两路线测试断言同条件。**API 单取消续费超时不再阻塞交付**：去 `CANCELLATION_REVIEW_REQUIRED` 卡单 → 照常成功 + 推手机 + 卡进待销清单。
- 表二 付款不明：两路证据（账号状态 + 卡台侧扣款记录）自动定、窗口放长；highvcc 卡流水拉取算时段外突发例外（token 有效拉一次，失效才叫、带证据）；API 补 `markAttemptUnknown` 后排 `POLL_RECHARGE` + 后台 RESOLVE 入口；崩溃 `RECONCILE_ONLY` 重启后进补核。
- 表三 人工兜底点唯一清单（面五队列与面四推送判据的输入）。
- 缝 j：人工收口两按钮写账本（第②步 T3 已证明三条人工分支写账本，本块只需确认与表三对齐）。

## 验收（测试 + 脚本 + 生产只读复验，不靠自述）

- 按需同步：单测（候选卡过期 → 当场同步 → 合格即分；同步失败 → 不分、不重开）+ 生产只读复验「分卡不再因 15 分钟窗口等卡」（用一张窗口外的 hnskj 卡 + 一单演练）。
- 待销：单测（用满 / DEPLETED / 存活期 / 取消续费未确认各一条）；两批旧卡终态脚本 dry-run 清单 + apply 后新连接核实。
- 契约表：三张表落 `docs/contracts/`；交付判据两路线单测（真实响应夹具）；API 不明 → POLL → 收口/RESOLVE 单测；补核两路证据单测（一致收口 / 不一致叫人带证据）；`grep` 证明 API 单不再进 `CANCELLATION_REVIEW_REQUIRED` 阻塞。
- `state-check.sh` 一致；`wrapup-check.sh` 全绿；生产只读复验。

## 边界

- **browser-mvp 只许改付款之后的补核链路**（D-254 白名单）：`recovery.js`（崩溃进补核）、`browser-card-transaction-reader.js`（删假 marker）、`live-post-payment-recovery.js`（两路证据）。**付款前三件一个字不许改**。browser-mvp 一动：全量测试 + 一次 rehearsal 都绿；常驻 worker 重启前问 Lemon。
- 不改付款行为、不改「一卡最多 N 单」上限值、不删表（第⑧步）、不动通知白名单（第⑤步）。
- 卡台真删卡、标终态脚本 apply、发布：**先开口问**。
- 范围外发现只报不改，写进收尾「发现」段并登记账本/DECISIONS。

## 先做这个（前置核查，别跳）

1. hnskj 卡当前同步节奏与合格窗口：`card-sync-job-service.js` 的 `scheduleDueCardSyncJobs`（staleMinutes 默认 60）、`card-sync-policy.js`、生产 `card_sync_jobs` 最近 24h 分布——当场重查。
2. `workflow-repository.js` 分卡函数里现在的「排按需同步」段（`refreshableInventoryCardSql` + `card_sync_jobs` INSERT）。
3. 两批旧卡当前状态（hnskj 12 张 FAILED、highvcc HELD_FOR_REVIEW 8 张里哪 5 张是 Lemon 注销的——**2026-09-18 实查 HELD_FOR_REVIEW 是 8 张不是 5 张，先问 Lemon 哪几张**）。
4. API 单 `CANCELLATION_REVIEW_REQUIRED` 的产生点与历史条数；`markAttemptUnknown` 现在排不排任务。
5. 第③步留下的相关发现：新开 hnskj 卡 `sync_tier` 落库是 `AVAILABLE` 不是 `INVENTORY`（原因未查）；`browser-execution-repository.js:216` 仍投影路线表旧列。

## 涉及文件（起点，不是全集）

`v1/src/db/repositories/workflow-repository.js`（分卡） · `v1/src/services/card-sync-job-service.js` · `v1/src/services/card-sync-policy.js` · `v1/scripts/card-read-sync-runner.js` · `v1/src/services/card-inventory-eligibility.js`（改不改规则由 Lemon 定） · `v1/src/services/card-operational-override-service.js`（待销/终态） · `v1/src/workers/workflow-handlers.js`（API 取消超时、`markAttemptUnknown`） · `v1/src/services/browser-payment-verification-service.js` · `browser-mvp/src/recovery.js` / `browser-card-transaction-reader.js` / `live-post-payment-recovery.js`（白名单） · `docs/contracts/`
