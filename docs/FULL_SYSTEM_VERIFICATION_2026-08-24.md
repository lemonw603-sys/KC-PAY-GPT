# 全系统全链路验证记录（2026-08-24）

## 目标
不把用户陈述、历史快照或代码实现当作当前运行事实；对客户充值、运营后台、卡台/Provider、CDK/订单/库存/资金、Browser 边界、数据库/Worker/通知和生产只读状态逐项核验。

## 证据分级
- **运行事实**：本次命令、HTTP 响应、数据库查询、浏览器行为。
- **代码/测试事实**：当前工作树代码和测试结果；不等于生产已部署。
- **用户确认**：用户明确提供的当前外部状态；不等于本窗口现场核验。
- **未验证**：尚未取得本次证据。
- **建议**：待确认方案，不写入事实结论。

## 当前已核验（本窗口）
- 本地 `npm test`：409 项，375 通过，0 失败，34 跳过。
- 公网 `https://ops.vibebridge.top/health/live`：HTTP 200。
- 公网 `https://ops.vibebridge.top/health/ready`：HTTP 200。
- 公网 `https://plus.vibebridge.top/health/live`：HTTP 200。
- 公网 `https://plus.vibebridge.top/health/ready`：HTTP 200。
- 已枚举客户、后台、Browser、库存、资金、CDK、路线和健康路由；详见本次命令记录。

## 尚未核验
- 我方生产 VPS 当前 release、迁移版本、服务/定时器和实际开关现场值。
- 生产数据库 readiness、活动任务/租约/Permit/UNKNOWN/资金风险。
- 卡台 HNSKJ 升级后的只读 Schema、账户余额、卡目录和交易同步。
- 客户→CDK→订单→Session→卡片→卡余额→Plus→取消续费的真实成功闭环。
- 生产后台浏览器交叉验证和所有模块的数据口径现场一致性。
- Browser 真实付款（当前不在生产验收范围）。

## 验证顺序
1. 代码、迁移、路由、测试与未提交变更边界；
2. 客户/API 链路；
3. 后台全部模块与权限；
4. 卡台/Provider 只读与资金安全；
5. 数据库、Worker、队列、通知和生产只读；
6. 跨系统交叉验证与对抗式审查；
7. 卡台写能力恢复后，才执行单笔真实 API 全链路。

## 禁止误表述
“我方服务器正常”目前是用户确认/既有记录，不是本窗口本次现场核验；“卡台升级中”是当前用户/项目记录，恢复状态仍需只读命令核验。

## 客户/API 代码与测试核验（本次追加）

- `node --check`：`create-app.js`、`server.js`、`admin-operations-service.js`、后台 `admin.js` 均通过。
- `git diff --check`：通过。
- 客户核心测试：`app.test.js`、`order-intake-service.test.js`、`order-status-service.test.js`、`session-replacement-service.test.js` 共 29 项，29 通过，0 失败。
- 该结果证明当前工作树的客户/API相关代码测试通过；不证明生产部署版本与工作树一致，也不证明外部 Provider 写链路成功。

## 运营后台/Provider/数据层定向测试（本次追加）

- 后台读取、后台会话、Browser 后台、路线管理、卡资金后台、CDK、导出、readiness：33 项，33 通过，0 失败。
- 卡台快照、目录、库存、卡资金执行、交易分类、Provider 适配与 Provider PoC：54 项，54 通过，0 失败。
- 迁移/账本/追溯/Session 恢复/Browser 数据层 schema：33 项，33 通过，0 失败。
- 以上均为当前工作树隔离测试；生产 release、生产数据库和外部 Provider 写入仍未由这些测试证明。
