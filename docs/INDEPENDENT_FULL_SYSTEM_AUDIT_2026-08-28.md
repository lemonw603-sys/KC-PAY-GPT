# 独立全系统只读审查报告（2026-08-28）

> 性质：一次性、独立、**只读**审查。全程未修改代码、未改数据库、未部署、未执行开卡/充值/付款/退款/切卡台/提取余额。唯一执行动作是本地 `cd v1 && node --test`（不连生产库，DB 集成用例按 `TEST_DATABASE_URL` 缺失自动 skip）。
>
> 事实分级贯穿全文：**【实测】**＝本次可直接验证；**【代码】**＝静态代码推断，未经运行验证；**【未验证】**＝依赖文档声称或生产现场，本次无法核实。审查者不为任何未验证项自行补全结论。

## 一、审查范围与方法

- **代码基线**：本地 `git status` clean，`HEAD = 2c75d31`（`feat: converge admin inventory view`），与 `CURRENT_STATE.md` 声称的主线 HEAD 一致【实测】。
- **已读文档**：`CLAUDE.md`、`AGENTS.md`、`AI_AGENT_ROLE_AND_READING_GUIDE`、`CURRENT_STATE`、`ROADMAP`、`MASTER_EXECUTION_PLAN_2026-08-28`、`DECISIONS`（D-001~D-103 全表）、`HANDOFF_LOG`（抽读）、部分合同与专项报告。
- **已读代码/配置**（覆盖用户要求的全部模块）：
  - 后台入口与路由：`v1/src/app/create-app.js`、`v1/src/server.js`
  - 后台数据口径：`admin-read-service.js`（overview/listOrders/getOrder）、前端 `v1/public/admin/assets/admin.js`（1875 行）
  - 库存分类：`card-inventory-eligibility.js`、`card-operational-override-service.js`、`card-stock-service.js`、`card-catalog-snapshot-service.js`、`card-catalog-sync-service.js`、`card-provider-snapshot-service.js`、`card-sync-job-service.js`、`card-sync-policy.js`、`diagnostics/card-consistency.js`
  - 订单/资金/未知处理：`workers/worker-runtime.js`、`workers/workflow-handlers.js`、`db/repositories/recharge-attempt-repository.js`、`card-stock-job-service.js`、`worker.js`
  - 卡台路线/对账：`provider-route-service.js`、`provider-route-admin-service.js`、`reconciliation-case-service.js`
  - CDK/客户/状态：`order-status-service.js`、前端 `customer.js`、CDK 交付前端
  - Browser：`services/browser-admin-service.js`、`browser-mvp/src/*`（清单）、`worker.js` 装配
  - 部署：`deploy/server/*.service` + `*.timer`（全部）、根/`v1` `package.json`
- **方法**：以「当前有效决策（DECISIONS）＋最终需求基线」为「应然」，用代码与部署配置核对「实然」，并对可执行项做本地验证。

## 二、总体结论（事实性）

1. **资金安全内核实现严谨，且与决策高度一致**【代码】。唯一资金栅栏、未知结果锁定、防重复开卡/扣款、取消续费终态、双栅栏/多栅栏门控，逐项落实，未发现 P0/P1 级资金或数据损坏缺陷。这与仓库中多轮对抗式审查「无 P0/P1」的历史结论吻合。
2. **追溯链路完整**【代码】：订单↔CDK↔卡片↔Provider 交易↔客户付款↔审计事件可多维互查。
3. **客户侧敏感隔离、后台脱敏、卡台路线冻结、库存 fail-closed**均正确【代码】。
4. **本次测试实测 456 / 419 pass / 0 fail / 37 skipped**【实测】，核心健康；数字比 `CURRENT_STATE` 记录的 454/417 多 2（见发现 7）。
5. 发现的问题集中在**运营规模瓶颈、部署配置与文档一致性、决策账本/交接日志一致性**，无一属「必须立即修复的资金/数据事故」。
6. **大量生产运行时状态无法在只读静态审查中证实**，全部归入 D 类（见第五节），审查者不将其当作已验证事实。

---

## 三、强项确认（复核通过，无需改动）

| 主题 | 证据位置 | 结论 |
| --- | --- | --- |
| 唯一资金栅栏 | `recharge-attempt-repository.js:187` `FUNDS_FENCE_EXISTS`、`:199` `LEGACY_CREATE_ALREADY_ATTEMPTED`、`:146/158/161` dispatch/route/write 门控、需 `recharge_authorizations` | 每订单最多一个资金风险 attempt，且必须先有授权【代码】 |
| 未知结果锁定 | `workflow-handlers.js:340-391` | 提交异常 `uncertain`→`markAttemptUnknown`；40030→`markAttemptCleared`（回 Session 可恢复，不重付/不换卡）；本地 commit 失败→锁 UNKNOWN；**所有分支 `retryable:false`**（符合 D-004/D-022/D-069-API/D-032） |
| 防重复开卡 | `workflow-handlers.js:79-112,174-188` | 开卡 `uncertain`→经卡列表识别（非重新开卡），多张匹配→`reviewCardPurchase` 禁止自动 rebuy |
| 取消续费终态 | `workflow-handlers.js:511-521` | 仅 `is_subscription_cancelled===1` 或 attempts 耗尽才停（符合 D-032） |
| Worker 双栅栏 | `worker-runtime.js:5-24` | `SUBMIT_RECHARGE` 需 `dispatchNewRecharges`(DB)＋`providerReadsEnabled`＋`providerRechargeWritesEnabled`(进程)；`PURCHASE_CARD` 需 dispatch＋card 写权限 |
| 开卡多重门控 | `card-stock-job-runner.js:22`（要求 `CARD_WRITES=true` 才启动）＋`card-stock-job-service.js:170`（`card_auto_replenishment_enabled` 门控）＋队列驱动＋`create-app.js:331` step-up | 自动补卡受 DB 开关约束；手动开卡需 step-up＋确认词 |
| 库存资格 fail-closed | `card-inventory-eligibility.js:1-37` | 需 `order_id IS NULL`＋AVAILABLE＋卡密＋余额＋**15 分钟内交易同步**＋无分配史＋无 PURCHASE＋无未撤销退款＋不被 RETIRED/PRODUCT_ONLY 覆盖 |
| 运营覆盖不被同步覆盖 | `card-catalog-sync-service.js:66-73`（`blocksPlus` 排除 RETIRED/非plus PRODUCT_ONLY）、`card-consistency.js:68-92`（`suppressedOverrideCount`） | 17 张 RETIRED 卡不会把 `openingBlocked`/一致性审计永久拉红（符合 MASTER_PLAN A1、D-092） |
| override 覆盖 discovery 与 cards | `card-operational-override-service.js` 按 `provider_account_id + external_card_id`（`BINARY` 精确匹配） | 可覆盖尚未进入 `cards` 的发现卡 |
| 追溯 | `admin-read-service.js:658-701`（多维查询）、`:787-808`（getOrder 16 维并行） | 邮箱/公众单号/充值单号/Provider 业务码/卡号(pan_hmac)/CDK 哈希/标签/客户付款全可查 |
| 卡台路线冻结与切换 | `provider-route-service.js:6-27`（不 fallback 历史账户）、`provider-route-admin-service.js:77-85`（切换只改 `accepts_new_orders`，不动既有订单，写审计） | 符合 D-012/D-028/D-089 |
| 客户侧隔离 | `order-status-service.js:8-20,67`（内部态→6 类稳定态，未知/对账/取消归 `REVIEWING`）、`customer.js`（不回显卡号/session） | 符合硬约束「客户侧不提供退款查询」 |
| Browser 后台脱敏 | `browser-admin-service.js:2,56-61` `redactSensitiveFields`；SELECT 仅取运行元数据 | 符合 D-065（不返回 authority/密文/token/lease hash） |

---

## 四、发现（按位置/证据/影响/严重度/事实层级）

### 发现 1｜主 Worker systemd 单元硬编码 `PROVIDER_RECHARGE_WRITES_ENABLED=true`，与 CURRENT_STATE 表述冲突
- **位置**：`deploy/server/pojia-worker.service` 的 `ExecStart`。
- **证据**【实测】：`ExecStart=/usr/bin/env PROVIDER_WRITES_ENABLED=false PROVIDER_CARD_WRITES_ENABLED=false PROVIDER_RECHARGE_WRITES_ENABLED=true /usr/bin/node src/worker.js`。而 `CURRENT_STATE.md:18` 声称生产 `PROVIDER_RECHARGE_WRITES_ENABLED=false`，`MASTER_EXECUTION_PLAN` 亦称「三类 Provider 写入保持关闭」。
- **影响**：git 模板里主 worker 的 ZZSHU 直充写开关是开启的。存在双栅栏兜底——`worker-runtime.js:15-16` 要求 `dispatchNewRecharges`＋`providerReadsEnabled`＋`recharge_write` 同时为真才领 `SUBMIT_RECHARGE`，且 `acceptNewOrders=false` 阻止新单；加之 ZZSHU 已按 D-039 放弃——故**不构成即时资金风险**。但（a）配置事实与文档「全部关闭」的表述不一致；（b）少一道纵深防线：一旦误开 `dispatchNewRecharges`，写权限已处于开启态。
- **严重度**：中（配置/文档一致性 + 纵深防御）。
- **事实层级**：git 模板内容＝【实测】；生产 `/etc/systemd/system/pojia-worker.service` 实际值与 `EnvironmentFile=/etc/pojia/provider.env` 的最终合成值＝**【未验证】**（可能与模板漂移）。
- **复现**：`cat deploy/server/pojia-worker.service | grep ExecStart`。生产核实：`systemctl cat pojia-worker | grep RECHARGE`。

### 发现 2｜卡片只读同步吞吐上限，放量后会引起库存资格抖动
- **位置**：`deploy/server/pojia-card-read-sync.timer`（`OnUnitActiveSec=15s`）＋`v1/scripts/card-read-sync-runner.js:37`（每次仅 `claimCardSyncJob` 一个 job）＋`card-inventory-eligibility.js:11`（要求 `last_transaction_synced_at >= now-15min`）＋`card-sync-policy.js:20`（AVAILABLE tier 间隔 10min）。
- **证据**【代码】：runner 是 `Type=oneshot`，每次运行只处理 1 个同步 job；15s/次 ⇒ 吞吐约 4 job/min ⇒ 10 分钟窗口最多刷新约 40 张卡的「详情+交易」。资格 SQL 要求交易证据不老于 15 分钟。
- **影响**：当**可分配（AVAILABLE）库存超过约 40 张**时，同步无法在 15 分钟新鲜度窗口内覆盖全部卡，健康卡会周期性掉出资格（fail-closed，即「有货却判为不可分配」，安全但影响可用库存）。当前卡极少（Provider 侧约 19 张、可分配为 0）【未验证生产数】，**当前无实际影响**。
- **严重度**：中（放量前瓶颈；当前无影响）。
- **事实层级**：吞吐算术＝【代码】；当前卡少＝【未验证生产数，代码/文档一致】。
- **建议触发点**：进入 ROADMAP 阶段 5「10–20 单并发」或库存明显增长前处理（提高 read-sync 频率/单轮批量，或扩大新鲜度窗口相对同步间隔的裕度）。

### 发现 3｜`DECISIONS.md` 决策 ID `D-069` 重复
- **位置**：`docs/DECISIONS.md:75`（Browser `SUBMIT_RECHARGE` dispatch）与 `:95`（API 充值路径不加独立预检）。
- **证据**【实测】：`grep -oE "^\| D-[0-9]+" docs/DECISIONS.md | sort | uniq -d` ⇒ `| D-069`。
- **影响**：两条不同决策共用同一 ID，`CLAUDE.md`/`ROADMAP`/handlers 注释引用「D-069」时产生歧义。`HANDOFF_LOG`（08-24/08-25）已识别该类重复（曾提到 D-069/D-089/D-109），但因当时相关改动在其他窗口未提交而未修。当前工作区仅 D-069 仍重复【实测】。
- **严重度**：低–中（决策账本自身一致性）。
- **复现**：见上 grep。

### 发现 4｜`HANDOFF_LOG.md` 落后主事实源约两天
- **位置**：`docs/HANDOFF_LOG.md` 顶部最新条目为 `## 2026-08-26`；而 `CURRENT_STATE`/`DECISIONS`/`ROADMAP` 已到 2026-08-28。
- **证据**【实测】：`grep "^## 2026" docs/HANDOFF_LOG.md` 首条为 08-26。08-27/08-28 的消费账本、migration 038–040、库存后台收敛、生产部署、付费补卡 timer 修复等重大工作未进入该统一交接日志。
- **影响**：`CLAUDE.md` 指「历史过程查 `HANDOFF_LOG.md`」，但最近两天最密集的变更缺席（虽有 `PRE_INVENTORY_CONVERGENCE_SEAL_2026-08-28`、`INVENTORY_CONVERGENCE_IMPLEMENTATION_2026-08-28` 等专项文档兜底，历史未丢失）。属布盘完整性问题，主事实源本身已最新。
- **严重度**：低。

### 发现 5｜库存 `status()` 卡列表 `LIMIT 200` 与汇总走全表，规模化后会不一致
- **位置**：`card-stock-service.js:339`（`cards` 列表 `ORDER BY created_at DESC LIMIT 200`）vs `:306-318` `operationalSummary`（全表聚合）与 `:296-305` `cardTypes`（全表分组）。
- **影响**【代码】：卡数超过 200 时，库存页逐卡列表与页顶汇总数字（ready/inUse/blocked/retired）将对不上。当前卡少无影响。
- **严重度**：低。

### 发现 6｜后台总览返回一套前端未使用的冗余库存指标
- **位置**：`admin-read-service.js:565-573` 返回 `cardStock.{available,provisioning,assigned,depleted,held}`；前端 `admin.js:293` 只消费 `cardStock.available`（"Plus 可分配卡"）。库存页另有 `operationalSummary.{ready,inUse,blocked,retired}` 新四分类（`card-stock-service.js:355-363`）。
- **影响**【实测（代码对照）】：`provisioning/assigned/depleted/held` 四个旧口径字段被计算并返回但前端不展示，与库存页新四分类语义重复。属 MASTER_PLAN A2「低价值指标下沉」尚未清理干净的残留；不影响展示正确性（总览的 `available` 与库存页 `ready` 同为 `eligibleInventoryCardSql`，一致）。
- **严重度**：低（清理项，对应用户要求 9「无价值指标/重复」）。

### 发现 7｜测试基线数字滞后
- **位置**：`CURRENT_STATE.md:42`（v1 454 / 417 pass / 0 fail / 37 skipped）。
- **证据**【实测】：本次 `cd v1 && node --test` ⇒ `tests 456 / pass 419 / fail 0 / skipped 37`（duration ≈ 7.97s）。
- **影响**：文档基线比工作区实测少 2（tests/pass 各 +2，skipped 同为 37，均 0 fail）。核心健康结论成立，仅精确计数滞后（疑似封账数字未在最终 HEAD 复跑更新）。
- **严重度**：低。

### 发现 8｜根 `package.json` 保留大量 legacy 运行时依赖
- **位置**：`package.json:26-48`（`axios`/`playwright`/`playwright-stealth`/`puppeteer-extra`/`puppeteer-extra-plugin-stealth`/`proxy-chain`/`imapflow` 等）。
- **影响**【实测（manifest）】：`start` 已指向 v1（`"start":"npm --prefix v1 start"`），legacy 仅 `start:legacy` 显式启动，**不在生产路径**；但依赖仍在根 manifest，`npm audit` 会将其漏洞计入。v1 自身依赖极简（`express`/`helmet`/`mysql2`/`zod`）。`CLAUDE.md` 硬约束「不为以后可能使用而保留存在高危漏洞的运行时依赖」。
- **严重度**：低（依赖卫生；不影响运行）。
- **事实层级**：manifest＝【实测】；是否存在高危漏洞＝**【未验证】**（本次未跑 `npm audit`）。

### 观察项（不单列为发现）
- `browser-admin-service.js:195` 使用 `SELECT br.*` 宽选择 `browser_runs`。当前该表应仅含运行元数据【代码】，但宽选择在未来若新增敏感列会随 `br.*` 外泄，建议改显式列。风险低。
- `create-app.js:166-172` 后台「发现卡」一次动作触发 `discover + validate×2`（`card-catalog-sync-service.js:43-44` 亦 `validateBatch` 两次）。这是 D-099「两次确认失败才判不可用」的实现，但意味着每次刷新对新发现卡会打多次 Provider 详情 API；与 D-098「人工刷新+持久默认、降低 API 频次」的方向需在实现卡段刷新时一并收敛。

---

## 五、六类总结

### A. 必须立即修复
- **无**。本次未发现会立即造成资金损失、重复扣款/开卡、数据损坏或客户侧敏感泄露的缺陷。资金安全内核复核通过。

### B. 建议近期修复
1. **发现 1**：核实并对齐 `pojia-worker.service` 的 `PROVIDER_RECHARGE_WRITES_ENABLED`——要么把生产/模板改为 `false` 与文档一致，要么在 `CURRENT_STATE` 中明确「主 worker 保留 ZZSHU 写开关＝true，由 dispatch 栅栏兜底」，消除「三类写全关闭」的笼统表述。
2. **发现 3**：修复 `DECISIONS.md` 的 `D-069` 重复 ID（重新编号其一并全局校对引用）。
3. **发现 2**：在放量（阶段 5）或库存增长前，提升卡只读同步吞吐或调整新鲜度窗口裕度，避免 AVAILABLE 库存 > ~40 张时资格抖动。
4. **发现 4**：补记 `HANDOFF_LOG` 的 08-27/08-28，使统一交接日志与主事实源同步。

### C. 可以暂不处理
- 发现 5（LIMIT 200 vs 全表，规模隐患）、发现 6（getOverview 冗余库存字段）、发现 7（测试数字滞后）、发现 8（legacy 依赖卫生）、以及两条观察项。均不影响当前正确性与资金安全。

### D. 未发现问题但需后续验证（本次静态只读无法证实的运行时声称）
1. 生产服务真实状态：Web / API Worker / 卡片只读同步 / 卡目录同步 / Bark / 备份 timer 是否 active；**Browser Worker 与 card-stock-runner 是否真的 inactive/disabled**。
2. 生产 DB 卡片实况：`6807/1477=ASSIGNED`、`4744/1065=PRODUCT_ONLY(claude)`、其余 17 张 `RETIRED` override 是否已写入并回读；Plus 可分配是否真为 0。
3. 生产开关 DB 实际值：`acceptNewOrders`/`dispatchNewRecharges`/`card_auto_replenishment_enabled`＝false；三类 Provider write 实际值（尤见发现 1）。
4. `readiness ok=true / blockers=[]`、公网 live/ready 四端点 200、HNSKJ/ZZSHU 只读合同、备份 SHA-256 完整性——均为文档声称。
5. 生产 release 目录 `/opt/pojia/releases/20260828-2c75d31-inventory` 及回滚点是否真实存在为独立目录。
6. `/etc/systemd/system/*` 实际单元内容是否与 `deploy/server/*` 模板一致（尤其 worker 的 recharge 写开关）。
7. `browser-mvp/src/production-readonly-worker.js` 能否对接当前 v1 schema——`BROWSER_COORDINATION_REALIGN_2026-08-28` 明确「旧 production-readonly smoke 不代表当前 release 可运行」。
8. 8590 等历史消费未回填消费账本＝文档声称（无可靠主键证据不回填，方向正确，数据现状未核）。

> 以上 D 类需要**生产只读体检**（SSH 现场核验 release/迁移/服务/开关/健康/备份）才能转为已验证事实；本审查不替代该体检。

### E. 与当前规划冲突的地方
1. **发现 1**：`pojia-worker.service` recharge 写＝true 与 `CURRENT_STATE`/`MASTER_EXECUTION_PLAN`「Provider 写入保持关闭」表述冲突（需对齐口径）。
2. **发现 3**：`D-069` 重复，破坏决策账本引用唯一性。
3. **发现 6 + 观察项**：MASTER_PLAN A2「低价值指标下沉详情/审计页」尚未在 `getOverview` 冗余字段处清理干净；D-098「降低高频自动目录读取」与现有「发现卡触发多次 validate」需在卡段刷新实现时统一。
4. **发现 7**：测试基线数字与实测轻微不符（文档滞后）。

### F. 建议的下一步优先级
1. **先做生产只读体检，落实 D 类**（尤其发现 1 的 worker 写开关现场值），把「文档声称」逐条变为「已验证」，再执行 MASTER_PLAN 的下一可执行项「管理员会话下后台浏览器交叉验收」。顺序上：**先核对生产事实 → 再做后台交叉验收**，避免在未证实的运行时前提上验收。
2. **低成本先清**：修 `D-069` 重复 ID（发现 3）、补 `HANDOFF_LOG`（发现 4）、对齐 worker 写开关文档口径（发现 1 的文档侧）。
3. **放量前置项**：解决卡只读同步吞吐瓶颈（发现 2），并在实现 D-098「卡段人工刷新+持久默认」时一并收敛 Provider 详情 API 频次。
4. **保持现状**：资金安全内核、追溯、路线冻结、脱敏、客户隔离本次复核通过，无需改动；Browser 真实付款继续按「单独确认」硬约束，不因 API 成功而连带开启。

---

## 六、审查边界声明

- 本报告的「强项」结论基于**静态代码与测试**，等价于「实现符合当前决策且逻辑自洽」，**不等于生产运行行为已验证**——真实开卡/充值/付款/退款的端到端成功仍未验收（与 ROADMAP、D-024 一致）。
- 所有标注 **【未验证】** 的项均未被本次审查证实，不得据本报告当作已验证事实向下游传递。
- 本次未触碰任何写操作；`node --test` 未连接生产数据库。
