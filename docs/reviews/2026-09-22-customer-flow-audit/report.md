# 客户充值页与新系统衔接审查（FB-07）

审查时间：2026-09-22（UTC+8）  
性质：只读生产页面 + 生产数据库只读查询 + 当前代码合同 + 本地隔离测试。没有提交真实 CDK、Session 或订单，没有付款、开卡、部署或生产写入。

## 结论

现有 Plus 主链的页面、接口、状态展示和重复提交保护整体衔接正常；发现 **1 个发布前应修的高优先级断点**：5X/20X 路线关闭时，客户仍会被页面邀请使用这两类卡密，且验码通过后还要粘贴完整 Session，直到最后创建订单才得知当前不能兑换。

这不是支付安全缺陷：订单不会被创建、CDK 不会被占用、不会触发付款。问题在于客户体验与敏感信息最小提交原则不一致，并且生产现有 2 张 `pro_20x AVAILABLE` 卡密可实际触发。

## 依据清单

### 决策与任务

- D-120：无付款终态退码、同码同账号复用原单、Session 可重贴。
- D-286：过期与路线下线保护；其记录已明确提到 20X 路线关闭后可撞 `ORDER_ROUTE_UNAVAILABLE`。
- D-314～319：CDK 最终业务与交互；当前客户页方案不重开无关布局。
- FB-07：`docs/tasks/2026-09-21-post-step6-feedback-plan.md:113`。

### 原型/生产页面

- 本项没有新的客户页对比原型；审查对象是已经挑定并上线的“候光”生产客户页。
- 设计基线：`docs/design/README.md:26`，第一屏固定写“请输入卡密(Plus、Pro 5X、Pro 20X)”。
- 生产实现：`v1/public/index.html:68` 同样展示该文案。
- 生产页面：`https://plus.vibebridge.top/`，2026-09-22 现场返回 HTTP 200、`cache-control: no-store`。

### 生产 SQL 与原始输出

查询时间：`2026-09-22T00:38:47.404Z`。

```sql
SELECT p.product_code,p.display_name,p.legacy_plan_type,p.status AS product_status,
       fr.id AS route_id,fr.executor_kind,fr.accepts_new_orders,fr.retired_at
FROM products p
LEFT JOIN fulfillment_routes fr ON fr.product_id=p.id
WHERE p.product_code IN ('chatgpt_plus','chatgpt_pro_5x','chatgpt_pro_20x')
ORDER BY p.product_code,fr.route_version DESC;
```

```json
[
  {"product_code":"chatgpt_plus","route_id":"...302","executor_kind":"BROWSER","accepts_new_orders":0,"retired_at":null},
  {"product_code":"chatgpt_plus","route_id":"...301","executor_kind":"API","accepts_new_orders":1,"retired_at":null},
  {"product_code":"chatgpt_pro_20x","route_id":"...306","executor_kind":"BROWSER","accepts_new_orders":0,"retired_at":null},
  {"product_code":"chatgpt_pro_5x","route_id":"...305","executor_kind":"BROWSER","accepts_new_orders":0,"retired_at":null}
]
```

```sql
SELECT plan_type,status,COUNT(*) AS count
FROM cdks GROUP BY plan_type,status ORDER BY plan_type,status;
```

```json
[
  {"plan_type":"plus","status":"AVAILABLE","count":19},
  {"plan_type":"plus","status":"REDEEMED","count":20},
  {"plan_type":"plus","status":"REVOKED","count":39},
  {"plan_type":"pro_20x","status":"AVAILABLE","count":2},
  {"plan_type":"pro_20x","status":"REDEEMED","count":1}
]
```

```sql
SELECT plan_type,COUNT(*) AS available_total,
       SUM(expires_at IS NULL OR expires_at>UTC_TIMESTAMP(3)) AS available_not_expired,
       SUM(expires_at IS NOT NULL AND expires_at<=UTC_TIMESTAMP(3)) AS available_expired
FROM cdks WHERE status='AVAILABLE'
GROUP BY plan_type ORDER BY plan_type;
```

```json
[
  {"plan_type":"plus","available_total":19,"available_not_expired":"19","available_expired":"0"},
  {"plan_type":"pro_20x","available_total":2,"available_not_expired":"2","available_expired":"0"}
]
```

## 覆盖结果

### 已现场验证

- 第一屏、订单查询、使用教程正常；空卡密分别得到明确提示。
- 375×812 视口下 `bodyScrollWidth=375`，没有横向溢出；主卡和按钮未越界。
- 当时页面控制台没有 error/warning。
- 生产空验码请求返回 `200 {"cdk":{"state":"INVALID"}}`；空订单查询返回 `400 {"error":"invalid_order_query"}`。
- 后续浏览器通道再次报 `Codex auth token is unavailable`，因此没有冒充已继续完成主题、焦点等现场复验。

### 已由代码与测试验证

- 过期/作废：`cdk-verify-service.js:62-78`；过期在真正建单时再次拦截，见 `order-intake-repository.js:154-162`。
- 等待重贴：`WAITING_FOR_SESSION -> NEEDS_SESSION/ACTION_REQUIRED`，重贴沿用原订单。
- 处理中刷新：状态接口按 publicNo/CDK 找回同一订单；前端后台降频轮询，失败后静默重试。
- 失败重提：后端用与验码相同的资金阻断规则生成 `canRetry`；付款证据未知时不允许重新兑换。
- 付款未知：`SUBMIT_UNKNOWN -> VERIFYING`，不会显示为失败或触发重付。
- 重复点击/响应丢失：按钮忙碌态阻止前端连点；数据库事务保证同一码只创建一单；请求成功但响应丢失后，再验码会进入已绑定订单查询。
- 客户专项 112 项测试：112 通过、0 失败、0 跳过。

### 旧集成套件说明

全量 `mysql-integration.test.js` 在全新 058 隔离库为 31 通过、11 失败、1 跳过；隔离库已删除。失败主要是既有卡源夹具与当前模型漂移。与本项直接相关的一条仍期待“换号剩余 2 次”，而 D-120 当前规则已是不限次数，实际返回 `null`。这些失败不能记成此次客户链新回归通过，也不能据此判断生产客户链失效；后续应单独清理测试债。

## ISSUE-001：关闭产品仍先收 Session，最后才拒绝

- 严重级别：高（发布前客户体验阻塞；不涉及误扣款）。
- 前置条件：使用当前 2 张未过期 `pro_20x AVAILABLE` 之一，或未来生成 5X/20X 码但路线仍关闭。
- 实际路径：
  1. 第一屏公开提示支持 Plus、Pro 5X、Pro 20X。
  2. `cdk-verify-service.js:71-78` 对未过期 AVAILABLE 码直接返回 `VALID`，没有读取路线。
  3. 客户粘贴完整 Session 并核对账号。
  4. 最后点击“立即兑换”后，`order-intake-repository.js:168-187` 才检查开放路线并返回 `ORDER_ROUTE_UNAVAILABLE`。
  5. 前端提示只有“当前暂时无法创建订单，请稍后再试”，见 `customer.js:102`。
- 期望：凡会启动新订单的卡密，在要求客户提交 Session 之前就判断当前产品能否接单；现有订单的查询、重贴和付款未知保护不受路线开关影响。
- 数据影响：当前失败发生在同一事务回滚前，不创建订单、不改 CDK、不付款。

## 推荐的最小修正（尚未获批准，未实施）

1. 验码查询复用建单时的“产品 + 开放路线 + 卡源能力”判断；只对会创建**新订单**的 AVAILABLE/无付款失败退回码返回一个明确的“当前方案暂停兑换”状态。
2. 已绑定订单仍可查询；`WAITING_FOR_SESSION` 仍可重贴；不能因后来关路线而卡住已有客户。
3. 建单端现有路线检查继续保留，作为最终资金前防线，不把安全性寄托在前端验码。
4. 第一屏把固定的三产品宣传改为中性的“请输入购买后收到的卡密”，避免关闭路线仍被宣传；验码成功后继续显示实际产品。
5. 不新增页面、数据库表、后台开关或自动售后流程。

## 建议验收方式

- 隔离 MySQL：Plus 开路可进入 Session；20X 关路在验码后直接提示暂停，且不要求 Session；开路后同一码恢复可继续。
- 既有订单：路线关闭后，处理中查询、`WAITING_FOR_SESSION` 重贴、付款未知锁定均不受影响。
- 竞争/响应丢失：同一码并发仍最多一张新订单；建单路线二次校验仍在。
- UI：桌面与 375px 手机均能看清提示；不出现内部“路线/执行器/卡台”词汇。
- 回归：客户专项测试、相关真实隔离 MySQL、默认 V1 测试；不以真钱付款作为本修正的必要验证。

## 未覆盖边界

- 未提交真实有效 CDK、真实 Session 或真钱订单，因此不声称各产品真实付款闭环已验证。
- 没有真实 Provider/ChatGPT 行为证据，付款后的外部失败仍按 `UNVERIFIED_LEDGER` 管理。
- 浏览器工具通道失效后没有继续主题切换与键盘焦点现场检查；这不影响 ISSUE-001 的数据库与代码证据。
