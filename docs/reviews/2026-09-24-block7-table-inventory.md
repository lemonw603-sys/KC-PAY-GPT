# 块 7 删表盘点（只读，未动生产）｜2026-09-24

执行者：窗口 acd69d1e。依据：面五④定稿（`V2.0_EXECUTION.md` §3.A 面五 ④，D-250）+ D-275 第 8 条（`reconciliation_cases` / `browser_interventions` 在用不删；只删真 0 引用的表；`refund_cases` 删前先改资格 SQL）+ 面二⑪（删补余额整条线）+ D-236 删表铁律（先查 getOverview 与所有读该表的面）。

## 证据

- 生产表清单与**精确行数**：`information_schema.tables`（63 张 BASE TABLE）+ 逐表 `COUNT(*)` UNION，2026-09-24 03:52:35 UTC，经 `prod-query.sh` 只读。
- 代码引用：`grep -rlw <表名>` 分区统计（v1/src、v1/scripts+scripts、browser-mvp/src+scripts、v1/public、测试、迁移），再逐条看调用函数是否接到入口。
- 定时任务耗时：服务器 `journalctl -u <unit> --since -10min` 的 `Consumed …s CPU` 求和，04:04 UTC；`nproc`=4。

## 全表普查：运行代码里真正没人用的表只有 3 张

| 表 | 行数 | 运行代码引用 | 说明 |
|---|---|---|---|
| `browser_card_source_selections` | 3 | 0（仅 `order-intake-repository.js:194` 一句注释） | 迁移 053 注释：被 `card_source_selections` 替代（只有 Browser 一半）；053 已把它的行迁入新表 |
| `browser_card_source_switch_events` | 7 | 0 | 旧表的切换审计；新切换审计在 `card_source_selection_events` / `provider_route_switch_events` |
| `fulfillment_route_card_sources` | 2 | 0 | 053 起卡台选择不再按路线表 |

测试里对它们只有「不许再读它们」的反向断言与对旧迁移文本的断言，删表不影响。**这三张不在面五④清单上，是本次普查新发现。**

## 面五④点名的表逐条核对

| 表 / 项 | 行数 | 谁在用（代码位置） | 结论 |
|---|---|---|---|
| `order_tags` | 0 | 写：`traceability-operations-service.js:51` `addOrderTag`——**没接到任何入口**（`server.js` 只接了 `completeCustomerPayment`）；读：`admin-read-service.js:1081`（订单列表按标签筛，`orders.js` / `admin.js` 都不传 tag 参数）、`:1093`（关键词搜索顺带匹配标签，表空恒不命中）、`:1419`（详情） | **可删**：删死函数 + 两处读 + 表 |
| `order_compensations` | 0 | 写：`order-compensation-service.js:92`——**整个服务没被 `server.js` 引用**（补发功能入口早已不在）；读：客户查单 `order-status-query-repository.js:14`、后台 `admin-read-service.js` 7 处、`traceability-operations-service.js:108` | **可删**，但要改客户查单那条 SQL（发布前跑 customer-sql-probe） |
| `order_notes` | 0 | 写：`traceability-operations-service.js:138`——**「补录客户付款」在用**（旧订单详情 `admin.js:2688` 的「补录付款」按钮，工作台待处理队列点开订单即此详情，`POST /orders/:publicNo/customer-payment`）；`addOrderNote` 本身未接入口 | **跟着「补录客户付款」功能走**：功能留则表留 |
| `checkout_artifacts` / `browser_artifact_secrets` | 0 / 0 | 写入三函数 `storeCheckoutArtifact` / `revealCheckoutArtifact` / `destroyCheckoutArtifact`（`browser-recovery-repository.js:600/651/734`）**无人调用**；但**每张 Browser 单**都会过的 `abortBeforePayment`（`browser-execution-repository.js:781`）与 `recordPlusActivation`（`:1484/1594`）会 UPDATE 它们，后台 run 列表/详情与三个处置动作也读写（`browser-admin-service.js` 6 处） | **现在不删**：零行不等于零引用，直接删表每张 Browser 单都会报错；要删须改付款链路相邻代码，而当前无法做演练验证（没有 free 号）。建议并入块 6 动执行器时一起清 |
| `refund_cases` | 0 | 写：交易同步发现疑似退款时 `card-transaction-repository.js:21`（highvcc 快照同步也走这条）；读：**分卡资格规则** `card-inventory-eligibility.js:137/182/217`（有退款案的卡不再分配、不再补钱）、概览 `admin-read-service.js:655`、后台列表 `:1348` | **建议不删**：它是一道资金保护，0 行只因还没发生过退款；按 D-275 要删就得先从资格规则拿掉这道保护 |
| 导出端点 `/api/v1/admin/exports/:dataset.csv` | — | 诊断页「低频工具 → 导出留档」两个按钮在用（`index.html:342`，`admin.js:3452/3455`） | **与定稿冲突**：面五④（09-17）写删；诊断页 D-325（09-21 Lemon 确认的布局）保留了它。建议按后来的决定保留 |
| 补余额整条线（面二⑪） | `card_funding_attempts` 6（5 条 FAILED/风险 CLEARED、1 条 FAILED/NONE，最新 09-14）；`card_funding_manual_actions` 1 | 两个定时任务仍在跑：`pojia-card-funding.timer` 每 5 秒、`pojia-card-funding-reconcile.timer` 每 15 秒；开关 `card_balance_recharge_enabled=false`，每次进来即退出；**10 分钟共 95 次、约 105 秒 CPU**（4 核机器的约 4%）。代码 8 个文件：执行器/对账/后台服务、`workflow-repository.js:433/450`（分卡时补余额，被开关挡住）、资格规则 `card-inventory-eligibility.js:132/177`、`card-source-selection-service.js:33`（等卡单谓词）、`order-cancellation-service.js:115`、`admin-read-service.js`、`admin.js` | **可删，分两步**：①停并删两个定时任务（不改代码、随时可恢复）；②删代码与两张表（表先导出留底）。②动分卡规则与 API 路线分卡函数，要全量测试 + SQL 探针 |
| `COMPLETE_20X` / `UPGRADED_20X`（面三⑤ 旧两阶段 20X） | — | 碰执行器（D-254 受限文件附近） | **归块 6**，本块不动 |

## 已定保留（不再讨论）

`reconciliation_cases`（2 行，付款不明收口在写在读）、`browser_interventions`（1 行，人工接管）——D-275；`payment_permits`（27）、`cdk_delivery_events`（47）——面五④保留；card-intake 链路（`card_discoveries` 5732、`card_intake_batches` 519、`card_catalog_snapshots`）——面五④保留。

## 与事实表的冲突

`CURRENT_STATE.md`「事实表之外」一句写「生产使用量为零的功能（三方对账案例、退款观察、灰度许可、CDK 交付记录、订单标签/备注/补发）按基线删除清单处理」——与后来的面五④（灰度许可、CDK 交付记录保留）和 D-275（三方对账案例在用不删）冲突，已改为指向本报告。

## 建议的做法与顺序（待 Lemon 点头）

1. 删三张旧表：新迁移 `DROP TABLE`，删前把 12 行导出到服务器备份目录。
2. 补余额线第一步：停并禁用两个定时任务（生产运维动作，可恢复）。
3. 删 `order_tags`、`order_compensations` 及其读写代码（含客户查单一句 SQL）。
4. 补余额线第二步：删代码、资格规则两句、两张表（导出留底）。
5. 每步：全量测试 + `sql-probe` + `customer-sql-probe`；迁移与发布前问 Lemon。
