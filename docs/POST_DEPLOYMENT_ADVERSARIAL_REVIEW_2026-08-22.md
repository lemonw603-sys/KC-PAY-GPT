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
- 本地全量测试：403 tests，369 passed，34 skipped，0 failed；跳过项均为未配置隔离 MySQL 的集成测试。
