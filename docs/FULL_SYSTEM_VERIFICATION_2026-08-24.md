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

## 2026-08-24 第二轮现场复核追加

- 生产只读复核时间：`2026-08-24T08:54:18Z`；release 仍为 `/opt/pojia/releases/20260823-admin-ui-alert-7587d44`；Web/Worker/Bark active，卡库存付费 runner inactive，迁移仍为 `037_card_discovery_latest_index`。
- 最终 readiness：`ok=true`；`acceptNewOrders=false`、`dispatchNewRecharges=false`、三类 Provider 写开关显式置 false；`activeTasks=1`、其余活动 Permit/资金风险/对账案件/Browser 活动队列均为 0。
- HNSKJ `provider:read-check` 再次通过：账户 67、USD、3 个卡型、18 张可见卡；未发起任何写请求。
- 已登录运营后台逐页只读交叉验证：总览、订单、异常队列、资金证据核对、卡余额充值、卡台路线、Browser 执行、卡片库存、CDK 管理均可访问。关键口径：累计订单 3、自动处理中 1、三方对账异常 1、资金结果未决 0、卡余额充值待处理 0、待验证新卡 13、本地可分配卡 0；接单关闭、派发关闭、追踪已有订单开启、派发模式为正常自动。卡台路线显示当前 `LEGACY_HNSKJ_ZZSHU_V1`，备用路线未切换；Browser 运行 0；资金证据案例 0；卡余额充值记录 0；CDK 可使用批次 10 个未使用码。
- 卡片库存页明确提示“对账未完成，禁止新开卡”；页面中的创建开卡、保存阈值/上限、生成 CDK、作废等按钮均未点击。
- 客户付款前 dry-run：使用系统剪贴板内容在浏览器内存中填入 Session，并使用既有测试 CDK 提交一次；剪贴板元数据为 279 字节且不是合法 JSON，页面返回 `账号 Session 格式不正确，请检查后重试`；没有新订单、没有付款页、没有付款或 Provider/卡台写入。
- 订单/卡片/Provider/资金/追溯交叉结论：后台累计订单与生产数据库既有 3 单一致；当前新 dry-run 未新增订单；当前订单仍无新卡绑定、无 Permit、无资金风险、无 Browser run；异常订单与三方对账异常仍为既有历史记录。
- 未完成边界保持不变：遗留 `ASSIGN_CARD/PENDING` 任务、长期 `VALIDATING` intake batch、2 张 quarantine/review 卡未擅自清理；真实 Plus 付款和成功订单闭环未执行。

## 2026-08-24 第三轮 Session 重试追加

- 系统剪贴板读取结果：总长度 7430 字节；整体不是合法 JSON，解析错误为 `SyntaxError: Unexpected non-whitespace character after JSON`，尾部多出 19 个非 JSON 字符。
- 去掉尾部非 JSON 字符后，前缀解析为 object，长度 7409 字节；顶层字段仅记录为 `WARNING_BANNER`、`user`、`expires`、`account`、`accessToken`、`authProvider`、`sessionToken`、`rumViewTags`；未记录任何字段值。
- 使用清理后的 JSON 前缀 + 测试 CDK 重新执行客户付款前 dry-run；页面返回 `当前暂停接收新订单，请稍后再试`。
- 浏览器 Network 事件未观察到 `/api/v1/orders` 请求；因此没有 HTTP 状态码/错误代码、没有创建订单、没有进入付款页，也没有任何 Provider/卡台/资金写操作。
- 该轮仅在浏览器内存中临时修剪非 JSON 尾部，没有改写系统剪贴板，也没有把 Session 原文写入日志或文档。

## 2026-08-24 第四轮重试

- 09:14 UTC 前重新跑 readiness：`ok=true`，`acceptNewOrders=false`、`dispatchNewRecharges=false`，迁移仍为 037。
- 使用当前剪贴板 JSON 前缀（原始 7430 字节，清理后 7409 字节）再次提交测试 CDK + Session；页面仍返回 `当前暂停接收新订单，请稍后再试`。
- Network 未观察到 `/api/v1/orders`，未产生 HTTP 响应、订单、资金动作或付款页。
