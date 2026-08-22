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
