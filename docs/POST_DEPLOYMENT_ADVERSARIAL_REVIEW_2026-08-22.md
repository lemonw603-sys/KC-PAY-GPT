# 生产部署后对抗式复核（2026-08-22）

## 已验证事实

1. 当前 release 为 `/opt/pojia/releases/20260822-0a9c574`。
2. 服务端候选包 manifest 416/416 校验通过。
3. 迁移版本为 `037_card_discovery_latest_index`。
4. `/health/live` 和 `/health/ready` 本机、公网均返回 200。
5. 只读 readiness 返回 `ok=true`，活动任务、过期租约、UNKNOWN Provider 调用、资金风险、活动充值授权、对账案件和 DEAD Bark 通知均为 0。
6. Web、Worker、Bark、卡片目录同步、卡片只读同步 active；自动开卡 timer inactive。
7. Worker 的三个 Provider 写入环境开关均为 `false`；接单和派发开关均为 `false`。
8. 部署前加密数据库备份已创建且 checksum、解密和 gzip 完整性验证通过。
9. 公网 `admin.js`、`admin.css` 已与候选包对应资源一致，并包含本轮后台修复标记。
10. 本次没有执行开卡、卡余额充值、客户充值、付款、提现或退款。

## 部署过程中的真实异常

- 迁移初始等待 `recharge_attempts` 元数据锁。
- 通过数据库根权限确认，锁等待由旧应用遗留的长时间总览/任务查询造成；停止旧 Web/Worker 和同步服务后仍有历史查询未结束。
- 清理这些已确认属于旧应用的长时间查询后，迁移 027–037 完成。
- 这说明后续发布流程应将“停旧服务后确认无遗留查询”纳入迁移前检查，不能只检查 systemd 状态。

## 尚不能宣称的事项

- 尚未做真实成功充值；
- 尚未验证目标账号非 Plus 时的完整成功链路及取消自动续费最终态；
- 尚未启用 Provider 写入或自动开卡；
- 尚未完成后台登录后的逐页人工验收；
- 浏览器自动化充值仍未进入生产资金路径。

## 复核结论

本次部署和安全门禁验证通过，生产已切换到候选版本；但这只是后台与只读运行基础设施验收，不等于真实充值成功验收。下一阶段必须继续保持资金写入门禁关闭，先做后台登录态逐页只读验收，再单独规划非 Plus 测试账号的单笔真实链路。

## 后台接口只读核验

对以下未登录管理 API 逐一请求，均返回 HTTP 401，未发现未登录数据泄露：

- `/api/v1/admin/overview`
- `/api/v1/admin/orders`
- `/api/v1/admin/alerts`
- `/api/v1/admin/provider-routes`
- `/api/v1/admin/reconciliation-cases`
- `/api/v1/admin/browser/runs`
- `/api/v1/admin/cdks/batches`

当前终端没有可复用的管理员登录会话，因此“登录后逐页展示和数据核对”仍未宣称完成；本次没有尝试绕过登录或执行后台写操作。

## 前后端路由静态对齐

从生产候选版本源码静态提取：

- 管理前端引用 32 类 API 路径；
- 服务端注册 44 条管理 API 路由；
- 前端引用的总览、订单、卡片库存、卡片接管、CDK、卡台路线、对账、Browser、卡余额和运行设置路径均能在服务端找到对应路由；
- 额外的服务端路由主要是同一页面的详情、写操作和敏感操作子路由。

这项是代码级路由覆盖检查，不替代登录后的真实页面点击验收。

静态 DOM 检查发现导航有 `exceptions` 而没有独立 `exceptions-view`；继续核对 `admin.js` 后确认这是有意的别名：点击“异常队列”会切换到订单视图并自动套用 `REVIEW_REQUIRED` 筛选，不是缺失页面。

## 继续核验结果

- 生产 `/health/live` 返回 `{"status":"ok"}`；
- 生产 `/health/ready` 返回 `{"status":"ready"}`；
- 公网 `admin.js` 与候选包 SHA-256 一致：`7b0de1b3…4b0c4b99`；
- 公网 `admin.css` 与候选包 SHA-256 一致：`db22ba85…e4556f9a31`；
- 前端分支覆盖 `overview/orders/exceptions/reconciliation/card-funding/provider-routes/browser/stock/cdks`；
- 发现的敏感操作入口均通过 `sensitiveApi`，未发现把敏感写操作改成普通只读 API 的情况。

## 登录失败复核

用户在登录页输入密码后，页面实际返回“密码不正确，请重新输入”。服务器只读核验确认：

- `/etc/pojia/admin.env` 存在 `ADMIN_PASSWORD_HASH` 和 `ADMIN_SESSION_SECRET_BASE64`；
- `ADMIN_PASSWORD_HASH` 格式为有效的 `scrypt-v1$...` 形式；
- Web 服务正常运行，未发现登录接口崩溃或配置缺失日志。

因此目前能确认的是“生产保存的密码哈希与本次输入未匹配”，不能仅凭哈希反推出应使用的明文密码，也不能证明用户输入本身有误。历史交接文档已记录生产密码轮换流程尚未完成；该问题需要通过正式密码轮换流程解决，不能在聊天中传输密码。

## 密码轮换与总览性能热修复

随后已完成一次正式轮换和热修复：

- 生成新的随机后台密码，仅复制到本机剪贴板，未写入代码、日志、文档或聊天；
- 更新生产 `ADMIN_PASSWORD_HASH`，并递增 `admin_session_version` 使旧会话失效；
- Web 重启后 live/ready 均正常；
- 使用剪贴板中的新密码请求登录接口，返回 HTTP 204；
- 登录后 `/api/v1/admin/overview` 返回 HTTP 200，耗时约 1.7 秒；
- 其他只读页面接口（订单、提醒、卡台路线、对账、Browser、CDK、库存、卡片接管、卡余额）均返回 HTTP 200；
- 发现 anti-join 在生产数据规模下仍然过慢，已改为 `ROW_NUMBER()` 最新记录查询并部署 release `/opt/pojia/releases/20260822-99b3f32`；
- Provider 写入、接单、派发和自动开卡门禁继续保持关闭。

## 内部测试 CDK / 订单结果

- 已生成 1 个 Plus CDK，随后由内部测试账号兑换；
- 接单入口曾短暂开启以允许该单创建，创建后立即关闭；
- 订单目前停在 `CREATED`，任务为 `ASSIGN_CARD:PENDING`；
- 未分配卡片、未创建充值 attempt、未产生 Provider 调用；
- 用户明确选择不执行真实充值，因此没有开启派发或资金写入；
- 该测试 CDK 已兑换，不能再通过普通“作废未兑换 CDK”流程撤回，相关订单和兑换记录保留用于追溯。

## 2026-08-23 余额同步复核

### 已证实事实

- `card_provider_snapshots` 的余额/开卡规则快照由 `card-stock-job-runner.js` 刷新；该 runner 要求 `PROVIDER_CARD_WRITES_ENABLED=true` 才能启动。
- 当前生产 `pojia-card-stock-runner.timer` 为 inactive，而订单/充值写入门禁仍关闭。因此仅依赖该 runner 时，后台余额快照不会持续更新。
- 生产 `pojia-card-catalog-sync.timer` 与 `pojia-card-read-sync.timer` 正常 active；catalog sync 原先只更新卡目录快照，不更新 Provider 余额/规则快照。
- 因此“后台显示的卡台余额可能不是实时余额”是事实，不能称为准确同步。

### 已实施修复

- 将只读的 Provider 余额/开卡规则快照刷新接入 `card-catalog-sync.js`；不打开 Provider 写入，不购买卡、不充值卡。
- 后台余额刷新现在由 active 的只读 catalog sync 驱动，不再依赖 card-stock 写入 runner。

### Session 提示文案调整

- 按产品要求，Session 尾部文本仍自动规范化，但不再向客户显示“检测到附加文本”提示。
- 已部署 `/opt/pojia/releases/20260823-session-silent`，生产文件核验确认旧提示文案不存在；Web/Worker active，健康检查通过。

## 2026-08-23 当前版本只读验收

- 当前 release：`/opt/pojia/releases/20260823-session-silent`。
- Web、Worker、卡目录只读同步、卡片只读同步：active；自动开卡 timer：inactive。
- `ops` 与 `plus` 的 live/ready 公网检查均返回 HTTP 200。
- 线上 customer.js 已包含 Session 解析器，旧提示文案不存在。
- 本地全量测试：403 tests，369 passed，34 skipped，0 failed；跳过项为未配置隔离 MySQL 的集成测试，不代表生产集成测试通过。

### 后台总览与数据库只读交叉核对

- 生产 `getOverview()` 返回：订单总数 3，处理中 1，复核中 1，对账问题 1；这些数字直接来自生产数据库聚合查询。
- 卡库存总览返回：可分配 0、已分配 1、已耗尽 2；低库存阈值为 1，因此 `low=true`。
- Provider 余额快照返回：HNSKJ 余额 `$279.17 USD`，卡台剩余开卡额度 294，快照时间 `2026-08-22T17:34:04.467Z`。
- 本地 2 张 AVAILABLE 卡当前余额均为 `$0.01`，低于最低可分配余额规则，因此后台将“可分配卡”计为 0；这与总览查询逻辑一致，不是卡数量统计丢失。
- 接单与派发仍为 `false`；自动补卡今日用量 `0/5`。

### 本轮后台核对发现并修复

- 发现只读卡目录同步周期为 5 分钟，而 Provider 严格快照新鲜度为 2 分钟；因此后台可能在正常同步间隔内错误显示“规则已过期/禁止开卡”。
- 已将后台展示专用新鲜度窗口调整为 6 分钟，覆盖同步周期和调度抖动；写入任务仍使用严格 2 分钟并在执行前强制刷新，不会放宽资金安全门禁。
- 已部署 `/opt/pojia/releases/20260823-freshness`；Web/Worker active，live/ready 通过；本地测试 370 passed、0 failed、34 skipped。

## 订单追溯只读审计（2026-08-23）

### 已证实事实

- 生产当前有 3 个订单：1 个内部测试订单仍为 `CREATED`，1 个真实订单为 `RECHARGE_FAILED`，1 个已关闭的预提交取消订单。
- CDK 表中已兑换 CDK 与订单存在关联；未兑换作废批次保持 `REVOKED`，没有发现已兑换 CDK 被标记为作废。
- 真实失败订单的卡片关联、卡号后四位、卡片余额、卡片库存状态均可通过订单关联查询得到。
- Provider 只读卡详情/交易调用均有记录；卡余额充值账本目前为空。
- 当前生产 `recharge_attempts` 有一条历史拒绝记录，资金风险为 `CLEARED`，没有外部订单号。

### 发现的追溯缺口（未直接修改生产数据）

- 历史真实失败订单的 `orders.failure_code` 和 `failure_reason` 当前为空，虽然订单状态为 `RECHARGE_FAILED`，且对应历史 Provider/attempt 记录存在。这说明旧版本失败收尾没有把可读失败原因回填到订单主表。
- 这不是当前新代码路径的结论；当前代码会写入 `RECHARGE_SUBMIT_REJECTED` 或 `PROVIDER_CONFIRMED_FAILURE`。需要单独设计“历史记录修复/展示回退”方案，禁止直接人工 SQL 改业务数据。
- 本次查询使用的是实际表结构；项目中不存在名为 `order_trace_events` 的表，追溯关系由订单、CDK、卡片、Provider 调用、充值尝试和事件表共同组成。

### 追溯缺口修复结果

- 后台订单详情现在对历史缺失的失败字段执行只读回退：仅当订单为 `RECHARGE_FAILED` 且存在非成功 ZZSHU `create_direct` Provider 记录时，显示 `PROVIDER_<business_code>` 及“历史记录推导”说明。
- 不修改订单主表，不改变客户订单状态；当前历史 40030 失败单后台详情已显示 `PROVIDER_40030`，Provider 记录仍显示 `DEFINITE_FAILURE`。
- 本地全量测试：373 passed、0 failed、34 skipped；生产 Web/Worker active，ready 通过。

## 第一性原理阶段性审查（2026-08-23）

### 核心不变量

1. 客户订单只能分配“真实存在、资料完整、未绑定、余额达标、无历史消费/绑定冲突”的卡。
2. 卡台账户余额只能说明“卡台账户有钱”，不能说明“已有库存卡可立即使用”。
3. 每一次卡余额写入都必须有唯一幂等键、资金风险状态、Provider 调用记录和可读的最终结论。
4. 任何“同步成功”都必须同时包含数据时间戳和失败可见性；没有新鲜快照时不能把数据当实时数据。

### 已发现的盲区

- **账户余额与卡片余额混淆**：当前账户余额 `$279.17`，但两张 AVAILABLE 卡都是 `$0.01`，所以可分配卡为 0。后台应继续强化这两个指标的名称和解释，不能只显示一个“余额”。
- **卡余额充值生产链路尚未成立**：代码有 `rechargeCard()`、资金账本和只读对账设计，但生产没有 `card-funding-runner` 服务；因此不能说“现在已经能自动给卡充值”。
- **卡余额同步失败可见性**：当前同步成功且时间新鲜；但若只读同步连续失败，需确认后台是否把“快照过期/同步失败”作为独立告警，而不是继续展示旧余额。当前代码层面已看到新鲜度判断，生产故障告警仍未做真实演练。
- **低库存与低卡余额是两种告警**：现有 `CARD_STOCK_LOW` 告警覆盖合格可分配卡数量；卡台账户余额不足、卡片余额不足、Provider 余额快照过期应分别告警，不能共用同一文案。
- **卡片资金结果未知**：代码有 `UNKNOWN/MANUAL_REVIEW` 状态和后台队列，但尚未进行真实 Provider 写入验证，不能假设人工恢复路径已被生产验证。
- **运营指标语义**：当前后台 `available=0` 是“合格可分配卡”而非“数据库里没有 AVAILABLE 行”。这个定义正确，但必须在界面上显式说明，否则运营人员容易误以为卡片同步丢失。

### 暂未证实、不得定性为漏洞

- 余额快照连续失败时是否一定会触发 Bark 通知；当前只验证过成功同步，未做故障注入。
- HNSKJ 卡余额充值接口的真实金额扣款、异步状态和退款行为；目前只有适配器和隔离测试证据。
- 后台浏览器视觉展示是否完全符合上述语义；当前完成的是 API、代码和生产数据库交叉核对，未声称逐页人工点击验收全部完成。

### 阶段结论

当前最重要的下一项不是开启客户充值，而是先完成“卡余额充值的只读/写入边界验收”：确认生产 runner 注册、资金账本、未知结果恢复和快照过期告警，再由单独确认进入资金写测试。

### 本轮执行结果

- 生产检查确认：没有注册 `card-funding-runner` 或 `card-funding-reconcile-runner` systemd 服务；卡余额充值尝试数为 0；卡余额充值开关为 `false`。因此没有误执行资金写入。
- 已将 Provider 余额/开卡规则同步失败写入 `operator_alerts`（`PROVIDER_SNAPSHOT_STALE`，去重键固定）；同步恢复后自动关闭该告警。
- 已在生产手动运行一次只读卡目录同步，执行成功，Provider 快照刷新成功；没有调用开卡或卡余额充值写接口。
- Web/Worker 仍 active，健康检查通过，所有资金写入门禁保持关闭。

### 卡台路由统一修复

- Web、卡目录同步、卡片只读同步、库存 CLI、卡余额充值执行器和只读对账执行器现在启动时统一解析当前有效的生产卡台路由，不再直接使用历史固定账户 ID。
- 没有有效路由时这些进程会 fail-closed，不会回退到旧卡台账户。
- 本次只改变路由解析，不启用任何 Provider 写入；卡台替换后旧订单仍按卡片记录保留，新任务按当前有效路由处理。

### 路由修复生产验证

- 当前 release：`/opt/pojia/releases/20260823-route-aware`。
- Web/Worker active，live/ready 通过；卡目录同步和卡余额只读对账均成功运行。
- 当前有效路由仍是现有 HNSKJ 生产卡台，未发生切换；因此本次证明的是“按路由读取并 fail-closed”，不是“备用卡台切换已真实验收”。

### 卡余额充值服务注册结果

- 已在生产注册 `pojia-card-funding.service/.timer`，但 timer 明确保持 disabled；service 的进程级 `PROVIDER_CARD_WRITES_ENABLED=false` 也会硬阻断资金写入。
- 已注册并启用 `pojia-card-funding-reconcile.service/.timer`；该 runner 只读取卡详情/交易并更新对账状态，不调用卡余额写入 API。
- 首次只读对账执行成功，输出 `handled:false`，表示当前没有待对账资金尝试。
- 本地全量测试：403 tests，369 passed，34 skipped，0 failed；跳过项均为未配置隔离 MySQL 的集成测试。
