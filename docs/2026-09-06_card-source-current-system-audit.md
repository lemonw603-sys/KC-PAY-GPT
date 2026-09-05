# 多卡源/卡台切换现状核查（2026-09-06）

## 范围与方法

本轮只读核对本地 `main` 代码与生产 SSH 现场；未修改生产、未切换路线、未调用 Provider 写接口、未创建订单、未付款。

## 代码事实

### 当前后台入口

- 导航入口为 `provider-routes`，页面标题为“Plus 卡台路线”。
- 页面以 `fulfillment_routes` 为行展示路线、是否接收新订单、关联卡台账户、读写状态和健康状态。
- 当前切换按钮仅对非当前路线显示；前端根据 `readEnabled`、`circuitState`、`retryAfterUntil` 计算 `canSwitch`，不健康时按钮直接 disabled。
- 切换请求为 `POST /api/v1/admin/provider-routes/:routeId/switch`。
- 前端要求输入确认词和不少于 10 个字符的原因；后端再次校验。

### 后端切换约束

`v1/src/services/provider-route-admin-service.js` 的 `switchRoute`：

- 在事务中锁定目标路线；
- 强制目标 `read_enabled=1`、`circuit_state=CLOSED`、不处于 retry window；否则返回 `ROUTE_NOT_HEALTHY`，不切换；
- 将同产品其他路线 `accepts_new_orders` 置 0，再将目标置 1；
- 写入 `provider_route_switch_events`；
- 该接口切换的是**充值路线/接单路线**，不是独立的“同一路线当前卡台来源”。

`setDefaultRechargeMethod` 另行按 `executor_kind=API/BROWSER` 切换默认充值方式，并在切 Browser 时检查 Browser dispatch、Profile 与 heartbeat。这与卡台路线切换是两个不同服务动作。

### 数据模型现状

- 当前代码已有 `provider_accounts` 与 `fulfillment_routes.card_provider_account_id`。
- 本地候选包含 `fulfillment_route_card_sources`（备用卡源映射），但生产尚未部署 migration 048，生产不存在该表。
- 因此“多卡台来源/同一路线选择”目前还没有生产可用的独立策略模型。

## 生产只读事实（2026-09-06）

- current release：`/opt/pojia/releases/20260905-browser-zero-tax-04e08e6`。
- `pojia-web.service`、`pojia-worker.service`：active；远程 Browser Worker：inactive。
- 生产 `fulfillment_routes` 只有两条 Plus 路线：
  - `LEGACY_HNSKJ_ZZSHU_V1`，executor `API`，当前不接新订单；卡台账户 `legacy-primary`；read 开启、write 关闭、circuit CLOSED。
  - `CHATGPT_PLUS_BROWSER_V1`，executor `BROWSER`，当前接新订单；卡台账户 `legacy-primary`；read 开启、write 关闭、circuit CLOSED。
- 生产 `provider_accounts` 目前只有：
  - `hnskj / legacy-primary / CARD`，read=1、write=0；
  - `zzshu / legacy-primary / RECHARGE`，read=1、write=1。
- 生产没有 `fulfillment_route_card_sources` 表，备用卡台策略尚未部署。
- 最近路线切换事件显示历史上确实发生过 API/BROWSER 默认路线切换；这是路线切换，不是备用卡台来源切换。

## 结论（仅基于上述证据）

1. 用户指出的“卡台路线、充值方式、卡台来源容易混淆”在当前代码结构中确实存在：现有入口主要切换 `fulfillment_routes.accepts_new_orders`，并非独立切换同一路线下的卡源。
2. 当前切换确实会被健康条件拦截；这与用户要求“可切换但只提醒、不阻止”不一致。
3. 当前生产尚未具备备用卡源策略表；本地备用卡导入/映射代码不能视为生产能力。
4. 当前生产 Browser 路线与 API 路线都绑定同一个 `legacy-primary` 卡账户；不能从该字段推断已实现“Browser 可在多个卡台间切换”。
5. “单订单切换”不是当前生产入口或已验证能力，之前将其作为方案提出属于未经事实核对的设计假设，已撤回。

## 未决设计问题

- 是否在充值方式下分别设置一个“当前卡台”指针（API 固定 HNSKJ，Browser 可选多个来源）；
- 切换是否允许保存任意目标，仅给出能力/健康/库存提醒；
- 如何让现有路线映射继续负责能力绑定，而不承担日常切换；
- migration 048/备用卡导入何时以何种最小模型进入生产。

以上问题在继续实现前需要结合用户业务流程再次讨论确认。
