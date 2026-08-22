# Plus 运营后台全量审计（第一轮事实盘点）

日期：2026-08-22
状态：审计进行中；本文件只记录已从当前源码核对出的事实，不把未实测项目写成结论。

## 1. 当前后台页面入口

当前 `v1/public/admin/index.html` 声明 9 个导航入口：

- 总览 `overview`
- 订单 `orders`
- 异常队列 `exceptions`（复用订单视图的 REVIEW_REQUIRED 过滤）
- 资金证据核对 `reconciliation`
- 卡余额充值 `card-funding`
- 卡台路线 `provider-routes`
- Browser 执行 `browser`
- 卡片库存 `stock`
- CDK 管理 `cdks`

当前页面中有 8 个实际 `<section>` 视图；`exceptions` 没有独立 section，而是由 `switchView()` 映射到订单视图。这是代码事实，不代表一定是错误。

## 2. 总览 API 与前端实际使用情况

后端 `getOverview()` 返回：

- `metrics`：总订单、今日订单、成功订单、处理中、待执行充值、需关注、三方对账异常、成功率；
- `orderStatuses`；
- `cdkStatuses`；
- `refundStatuses`；
- `openAlertCount`；
- `runtimeHealth`；
- `operationalBacklog`：待验证新卡、资金风险、卡余额充值风险、人工复核、对账案例、卡片同步积压；
- `cardStock`：可用、开卡中、已分配、耗尽、隔离、低库存线和低库存布尔值；
- `settings`。

前端 `loadOverview()` 当前实际渲染 11 张指标卡：

1. 今日订单
2. 自动处理中
3. 待执行充值
4. 需要关注
5. 三方对账异常
6. 资金结果未决
7. 卡余额充值待处理
8. 待验证新卡
9. 本地可分配卡
10. 订单 Worker
11. 已完成订单成功率

## 3. 已确认的总览字段缺口

以下字段后端明确返回，但当前总览页面没有直接展示：

- `metrics.totalOrders`
- `metrics.successfulOrders`
- `cdkStatuses`
- `refundStatuses`
- `openAlertCount`（页面只在有告警时显示告警区，不显示总数卡）
- `operationalBacklog.reconciliationCasesOpen`
- `operationalBacklog.cardSyncBacklog`
- `cardStock.provisioning`
- `cardStock.assigned`
- `cardStock.depleted`
- `cardStock.held`
- `cardStock` 的完整库存结构（总览只显示 available）

这是“后端有数据、前端未直接体现”的事实，尚不能据此断定这些字段原本都必须是卡片；需要结合历史需求和用户确认的总览信息架构决定展示形式。

## 4. 当前不能仅凭源码确定的项目

以下必须通过实际服务或生产页面核对，不能猜测：

- 用户看到的“卡片消失”是源码设计问题、生产 release 版本不一致、静态资源缓存，还是 API 返回异常；
- 生产总览 API 当前实际返回的字段和值；
- 当前生产页面实际渲染了几张卡；
- 其他视图是否存在“接口返回但页面遗漏”或“页面控件请求失败”；
- 数据库中的统计值是否与卡片定义一致。

## 5. 当前下一步（暂停修改）

先完成后台全量审计矩阵：导航/视图 → API → 返回字段 → 页面使用 → 权限 → 空/错/加载状态 → 生产只读证据。总览缺口要与历史需求逐项对齐后，再决定哪些恢复为卡片、列表、告警或详情入口。

在完成这份矩阵并获得用户确认前，不修改总览布局、不部署生产、不改变生产数据。
