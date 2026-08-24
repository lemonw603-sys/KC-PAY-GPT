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

## 2026-08-24 现场全系统验证追加（本轮）

### 证据与命令

- SSH 只读现场：`ssh -o BatchMode=yes root@144.34.180.184`。
- 现场 release：`/opt/pojia/releases/20260823-admin-ui-alert-7587d44`；Web/Worker、MySQL、Bark active/running；卡库存付费 runner inactive；只读同步与目录同步 timer active。
- 生产迁移查询：最新 `037_card_discovery_latest_index`，编号 37。
- 生产 readiness（加载 systemd runtime/admin/card-read/provider 环境，且显式将三类 Provider 写开关置 false）：`ok=true`、`acceptNewOrders=false`、`dispatchNewRecharges=false`、`activeRechargeAuthorizations=0`、`activeOrUnknownFundsRisk=0`、`openReconciliationCases=0`、`activeCardStockJobs=0`、`deadBarkNotifications=0`、`workerHeartbeatAgeSeconds=9`；`activeTasks=1`，阻断项为空。
- `npm run provider:read-check`：`ok=true`；HNSKJ 账户可读、USD 余额可读、卡型 3、可见卡 18；ZZSHU connection=ok。未调用任何 Provider 写接口。
- `npm run card:catalog-sync`：只读供应商调用成功；`providerTotal=18`、`providerActive=7`、`available=2`、`assigned=1`、`provisioning=0`；发现 2 张 `CARD_QUARANTINED_OR_REVIEW`。该同步会在本地数据库留下 intake batch 记录，不应误称为纯无写入操作。
- 卡台已登录网页只读：余额 `75.670000 USD`、18 张卡、7 张活跃、处理中 0；未点击开卡、充值、卡片写操作。
- 客户页付款前 dry-run：提交当前页面中的测试 CDK 与 Session 后，页面返回 `账号 Session 格式不正确，请检查后重试。`；未创建近 30 分钟订单，未出现付款页或付款提交动作。剪贴板内容未写入日志或文档。
- 本地测试：`cd v1 && npm test` → 409 tests / 375 pass / 0 fail / 34 skipped。

### 现场残留与未验证边界

- 遗留任务：`tasks.id=22`、`ASSIGN_CARD`、`PENDING`，订单状态 `CREATED`，创建于 2026-08-22；本轮未擅自取消或改写生产任务。
- 卡目录同步后仍存在长期 `VALIDATING` intake batch；另有 2 张上游 active 卡处于 quarantine/review，不能视为可分配库存。
- 历史 `provider_calls` 中存在 1 条 `UNCERTAIN`，本次 readiness 的“不确定调用超时”计数为 0；未对历史 UNKNOWN 做人工结算。
- 运营后台登录后逐页交叉验证未完成：当前 Chrome 没有 `ops.vibebridge.top/admin` 已登录标签页；未猜测凭据或绕过登录。
- Session 校验失败，故未创建测试订单、未分配卡、未产生 Permit、未触发 Provider 或资金动作。真实 Plus 付款仍未执行。

### 结论

本轮完成了生产、卡台和客户页付款前 dry-run 的可执行只读部分；资金安全边界保持关闭。由于 Session 格式校验失败、遗留 PENDING 任务与 VALIDATING intake batch 未被授权清理，以及后台登录后逐页核验缺少现场会话，本轮不能标记为“全系统闭环通过”。
