# 运营后台独立评估（2026-08-24）

> 作者：接班执行模型（本窗口）。这是基于**亲自阅读代码**的独立判断，不复用 `ADMIN_CONSOLE_SIMPLIFICATION_REVIEW_2026-08-24.md`（那是另一窗口的优化意见，用户明确要求本执行者按实际独立评估）。
> 性质：只读分析 + 建议，**未改任何代码/数据库/生产**。与前一份方案存在实质分歧处已标出。
> 证据：C=代码，均来自 `v1/src/app/create-app.js`、`v1/src/services/admin-read-service.js`、`v1/public/admin/assets/admin.js`、`v1/public/admin/index.html`。

## 一、后台真实结构（代码核实）

前端 9 个顶层导航（`index.html:22-30`），逐个对应的后端数据源（`create-app.js` 路由 + service）：

| 导航 | 后端 API | 独立数据模型 | 判断 |
|---|---|---|---|
| 总览 | `GET /admin/overview` → `admin-read-service.getOverview` | 聚合多表（无独立表） | 保留，首屏需瘦身 |
| 订单 | `/admin/orders*` → `listOrders/getOrder` | orders/events/cards/... | 保留（中枢） |
| 异常队列 | **无独立 API**，前端 filter=`REVIEW_REQUIRED` | **无** | **唯一可降级项** |
| 资金证据核对 | `/admin/reconciliation-cases*` | `refund_cases`/对账案件 | 保留 |
| 卡余额充值 | `/admin/card-funding-attempts*` | `card_funding_attempts` | 保留 |
| 卡台路线 | `/admin/provider-routes*` | `fulfillment_routes`/`provider_accounts` | 保留（独立） |
| Browser 执行 | `/admin/browser/runs*` | `browser_*` 全套 | 保留（独立） |
| 卡片库存 | `/admin/card-stock*`+`card-intake*` | `cards`/`card_stock_jobs`/intake | 保留，内部分区 |
| CDK 管理 | `/admin/cdks*` | `cdks`/`cdk_batches` | 保留 |

**结论**：9 个里只有「异常队列」没有独立后端数据模型——它是 `orders?status=REVIEW_REQUIRED` 的前端预设筛选（`admin.js` 的 metric filter 机制）。其余 8 个都各有独立 service、API 和表，**删任何一个顶层入口都会连累对应能力或让运营者找不到入口**。

## 二、我的独立判断（含与前一份方案的分歧）

### 1. 只有「异常队列」值得降级，其余导航别动
- 它无独立数据模型，可从顶层导航去掉，改为「订单」内一个显眼的「需要处理(REVIEW_REQUIRED)」快捷筛选。（C）
- 这是我唯一确信"删顶层入口零能力损失"的一项。

### 2. 【分歧】不建议把「资金证据核对」+「卡余额充值」合并成"资金与对账"父导航
前一份方案主张两者合并。我**不同意**，依据代码：
- 数据模型不同：`reconciliation-cases`（对账案件，偏**只读核对/结案**）vs `card-funding-attempts`（卡余额充值，含**资金写**：幂等键、`PENDING`/`UNKNOWN`/`MANUAL_REVIEW`/`SETTLED`、`resolveUnknown`）。
- 操作语义不同：一个是"核对已发生的资金证据"，一个是"发起/处置一笔卡余额写入"。合并到同一父导航，UI 上会把"只读核对"和"会动资金的写操作"放在一起，**增加运营者误操作的认知风险**，收益只是少一个导航项。
- 合并顶层只是 UI 折叠，**不减少后端任何查询/负担**。
- 我的建议：**保持两者独立顶层**；若一定要收敛，最多做同一导航下的两个二级 tab，且写/读边界必须有明显视觉区隔和各自的 step-up。

### 3. 总览首屏：真正的问题是"查询重"不是"项数多"
- 首屏 ~18 个 metric 已分 4 组（订单类 / 资金与风险 / 库存运营 / 系统健康，`admin.js:308-313`），认知上不算失控。
- 真正成本在 `getOverview`：一次加载跑 5-6 组聚合查询，且对账判断含 `CREATE_ATTEMPTED`/`STALE`/`SUCCESS_EVENT`/`PAYMENT_MATCH`/`PAYMENT_SETTLED`/`RECONCILIATION_ISSUE` 等多个 `EXISTS` 关联子查询（`admin-read-service.js:36-77`）。**这才是首屏慢的根源**。
- 我的建议：
  - 首屏只保留**可立即行动的风险 + 急停开关 + 健康**：接单/派发/写开关+当前卡台、处理中、等待 Session、等待补卡、资金结果未决、对账案件未结、卡台健康、Worker 健康、可分配库存。
  - 把**统计类**（今日单量、成功率等）移到「订单」区，不在首屏算。
  - 把重对账 `EXISTS` 子查询做成**懒加载/按需**（点开"三方对账异常"再算），首屏用轻量计数。
  - 这是"降查询成本"，不是"删能力"。

### 4. 用户此前担心的合并风险，代码里其实已避免——要保持而非新建
- 资金风险 / 对账疑点 / 对账案件是**三个不同字段**（`reconciliationIssues` / `fundsRiskPending` / `reconciliationCasesOpen`，`admin.js:276/281/292`），未被错误合并。
- 卡台账户余额与卡片余额**已分开标注**（`admin.js:326`："卡台账户余额…不是可分配卡片余额"）。
- 待验证新卡（card-intake）、可分配卡、对账案件入口**都还在**，未被误删。
- **动作**：这些保持现状即可，不需要"新增"，重构时不许把它们并回一起。

### 5. 卡台路线、Browser 执行：独立导航必须保留（C 佐证）
- 卡台路线有独立路由冻结（旧订单保原路线）、健康/熔断/写权限字段，不是库存同义词。
- Browser 有独立 run/artifact/lease/checkpoint/操作详情（`admin.js:613-627`），是独立执行器。
- 两者都不能并入库存或彼此。

## 三、一个需要记录的横向事实（非 UI 问题）

`getOverview` 的对账 SQL **硬编码 `provider='zzshu'`**（`admin-read-service.js:36-46` 的 `CREATE_ATTEMPTED_SQL` 等）。当前 API 执行器是 ZZSHU，合理；但 Browser 路由不写 `provider_calls.create_direct`，**Browser 订单的总览对账口径与 API 不同源**。未来 Browser 成为主链路时，总览/对账的证据判断需要为 Browser route 补一套口径，否则 Browser 订单在总览对账上会"隐身"。这是**未来工程项**，不是当前 bug（当前 Browser 不接生产）。

## 四、我的收敛建议（一句话版）

- **改**：异常队列 → 降为订单内筛选（唯一零损失项）。
- **不改结构、只优化查询**：总览首屏减统计类、重对账子查询懒加载。
- **明确不合并**：资金证据核对 vs 卡余额充值（写/读语义不同）；卡台余额 vs 卡片余额；卡台路线 vs 库存 vs Browser。
- **保持**：三个不同的资金/对账字段、待验证新卡入口、完整卡号仅受控详情、敏感操作 step-up。

## 五、执行前置（任何改动都要先做）

1. 逐页 API/表/权限依赖清单（本报告已给数据源映射，可作起点）。
2. 卡台升级期间不做真实写路径验证，UI 改动用本地 mock/只读数据验证。
3. 改动走单元+浏览器交叉验证，再对抗式审查，最后才谈生产部署。
4. 本报告是建议，不是已批准变更；等用户确认要动哪几项再实施。

## 六、与前一份方案的关系

| 议题 | 前一份 `ADMIN_CONSOLE_SIMPLIFICATION` | 本独立评估 |
|---|---|---|
| 异常队列降级 | 建议降级 | 同意（唯一零损失项） |
| 资金核对+卡余额充值合并 | 建议合并为父导航 | **不同意**，保持独立（写/读语义不同） |
| 总览瘦身 | 建议移出退款观察/内部提醒等 | 同意方向，但更强调**查询懒加载**才是关键 |
| 卡台路线/Browser 独立 | 保留 | 保留 |
| 卡台余额 vs 卡片余额 | 提醒别合并 | 代码已分开，保持 |

分歧核心：前一份偏"少几个导航项"，本评估认为**首屏性能靠拆查询、资金写操作别和只读核对混导航**才是实处，导航项数不是主要矛盾。
