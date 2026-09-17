# 任务书：落实第③步「卡台选择表 + 供卡调度」（面一 C1 + 面二①③，D-246/D-247/D-252）

> 开专门落实窗口做。第一句读 `AGENTS.md` 四份顺序 + `docs/V2.0_EXECUTION.md` §3.A 面一/面二 + 本任务书。
> **只做本块，做完放回主线验。** 第②步已完成（数据源三件已上生产，release `20260917-datasources-c1a026a`）。

## 为什么是这一步

面二的水位调度要「按卡台开卡」，得先有一张说得清「谁该用哪个卡台」的表；面一 C1 正是那张表。
两件必须同窗口做，否则调度器要么写死卡台、要么读一张还没建的表。

## 目标

**A · 一张「产品 × 执行器 → 卡台」选择表**（面一 C1）

替代现在这两张各说各话的表。**2026-09-17 15:3x 当场重查，两者确实矛盾**：

| 来源 | 说 Browser 该用哪个卡台 |
|---|---|
| `fulfillment_routes.card_provider_account_id` | 四条路线（301/302/305/306）**全是 101 hnskj** |
| `browser_card_source_selections` | 三个产品（201/205/206）**全是 103 highvcc** |

而实际在跑的是 103（`CURRENT_STATE` 的「Browser 当前卡台」行）。**先坐实这两张表是谁在读、谁赢**，再决定合并后的唯一真相放哪——不要假设 `browser_card_source_selections` 一定是赢家。

- API 行固定 101 且后台不给选择控件（D-253：ZZSHU 按 BIN 白名单放行，拒 highvcc 卡 40020）。
- intake 删掉 `provider_code='hnskj'` 硬写（面一「现状证据」记的三处硬写，**动手前当场重查位置**）。
- 切路线 / 切卡台端点前跑四项校验，不过即拒并说原因：目标路线唯一、目标卡池可分配 > 0、卡台 `circuit_state=CLOSED` 且 `read_enabled`、版本对。
- `resolveCurrentCardProviderAccount` 改为遍历所有 `purpose='CARD'` 账户按**能力位**分派（有 API 同步位的才发请求），不看名字。

**B · 库存水位驱动的供卡调度**（面二①③）

- 每卡台 × 每产品设目标可分配张数（Plus 每台 2；Pro 每台 0、来单即开）；调度器每分钟看一次，低于水位 且 在日限内 且 钱包预检过 → 按该台适配器开一张。`WAITING_FOR_CARD` 保留作兜底触发。
- 开卡金额按产品：Plus $50 / 5X $100 / 20X $150。每卡单数 Plus 3 / Pro 1 不变。
- 三条开卡线合一：hnskj `card-stock-job-runner` 挂定时（人工 job 与自动 job 同一执行者，不再 ssh）；highvcc `openCard` 接调度，`HIGHVCC_OPEN_NO_PAN` 自动转 `recordExistingCard`；worker `PURCHASE_CARD` 死线删。
- 钱包硬底线 hnskj $30 / highvcc $20，开卡前预检 `余额 − 金额 − 手续费 ≥ 底线`，否则不开并推手机。**手续费用第②步落的真实观察**（`CARD_ISSUE_FEE` 行）而不是费率常量。
- 每台每日开卡上限起步 20。
- 故障转台双向（D-252）：hnskj 故障 → 转 highvcc；highvcc 时段外无 token → Browser 缺卡自动用 hnskj 开一张顶上，不叫人。API 路线冻结 hnskj、不转。

**C · 清掉卡死调度器的残留**

`card_stock_jobs` 里 `REVIEW_REQUIRED` **965 条**（2026-09-17 15:3x 当场重查；账本 §3.A 写的 930 是 2026-09-15 的数，已过时）。
最旧 2026-08-31 03:53、最新 2026-09-05 22:32，之后没有新增。不归档的话 `scheduleAutomaticJob` 永远返回 `FUNDS_REVIEW_REQUIRED`。
**归档，不删行。**

## 验收（测试 + 脚本 + 生产只读复验，不靠自述）

- 选择表：单测覆盖三产品 × 两执行器取卡台；四项校验各拒一次；能力位分派（hnskj 发请求 / highvcc 不发 API 同步请求）。
- `grep` 证明 intake / `provider-route-service` / `workflow-handlers` / pool worker 选卡路径里没有 `'hnskj'` / `'manual_excel'` 字面量。
- 切路线的测试证明**不连带动卡台**（D-219 那个「切路线连带切卡台」是 Lemon 手点两次造成的错觉，代码本来就不耦合）。
- 调度器单测：水位 / 日限 / 钱包预检 / 故障转台各一条，**真实响应夹具**。
- 两台各真开一张卡（**Lemon 当次确认**，花钱）。开完核对 `CARD_ISSUE_FEE` 行有值——这是第②步 T2 的第一个真实样本。
- 965 条归档后 `scheduleAutomaticJob` 不再返回 `FUNDS_REVIEW_REQUIRED`（跑一次看返回）。
- `grep` 证明 `PURCHASE_CARD` 死线已删。
- `state-check.sh` 一致；`wrapup-check.sh` 全绿；生产只读复验。

## 边界

- **browser-mvp 只许改这两处**（D-254 白名单，越界即停下来问 Lemon）：
  - `browser-mvp/src/production-live-pool-worker.js:215` 与 `production-live-worker.js:283-284` 的「按 `provider_code === 'manual_excel'` 判交易读取器」→ 改为按能力位；
  - `shared-encrypted-materials` 的卡台校验（按能力位）。
  - **付款前三件一个字不许改**：`billing-address-fill.js`、`live-chatgpt-payment-adapter.js`、`payment-executor.js` 的 submit 段。
  - browser-mvp 一动：全量测试 + 一次 rehearsal 演练都绿才算改完；常驻 worker 重启前问 Lemon。
- 不改付款行为、不改「一卡最多 N 单」的资格规则、不删表（删表是第⑧步）。
- 不动通知白名单（第⑤步）。
- 开卡、补余额、发布：**先开口问**。
- 范围外发现只报不改，写进收尾「发现」段并登记账本/DECISIONS。

## 先做这个（前置核查，别跳）

动代码前把下面几件当场重查，**不要照本任务书或账本的行号**：
1. 两张卡台表各自的**读取方**（谁在读 `fulfillment_routes.card_provider_account_id`、谁在读 `browser_card_source_selections`），确认实际生效的是哪张。
2. intake 三处硬写的真实位置。
3. `card_stock_jobs` 的 `REVIEW_REQUIRED` 当下条数（本任务书写的 965 是 09-17 的数）。
4. 现有开卡路径：`card-stock-job-runner.js` → `openStockCards`（第②步刚在它的 `onCardOpened` 里加了成本记账，别覆盖掉）。

## 涉及文件（起点，不是全集）

`v1/src/services/provider-route-service.js` · `v1/src/services/card-stock-service.js` · `v1/src/services/card-stock-job-service.js` · `v1/src/services/card-stock-runner-service.js` · `v1/scripts/card-stock-job-runner.js` · `v1/src/services/highvcc-card-service.js` · `v1/src/db/repositories/workflow-repository.js` · `v1/src/workers/workflow-handlers.js` · `v1/src/services/card-inventory-eligibility.js`（只读不改规则） · `browser-mvp/src/production-live-pool-worker.js`（仅 :215 一处） · `browser-mvp/src/production-live-worker.js`（仅 :283-284 一处）
