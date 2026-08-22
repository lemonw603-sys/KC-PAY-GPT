# 生产部署清单（2026-08-22）

## 当前结论

- 本地候选包已通过 v1 全量测试：401/401 通过，0 失败，0 跳过。
- 候选包目录：`/Users/lemon/code/AI充值业务/artifacts/release-candidate-20260822-0a9c574/`
- 候选包清单 SHA-256：`607675eb618eb1605b3e921e6ea3ae34ec031406ebf764c771a25bbd196aef81`
- 生产当前 release：`/opt/pojia/releases/20260822-stage3-8a3134d`
- 生产当前 `/health/ready` 只读检查超时；生产尚未部署本候选包。

## 部署前硬门禁

以下任一项不满足，都不得切换生产：

1. 候选包目录存在且 `manifest.sha256` 校验通过。
2. 生产数据库已完成可回滚备份，并确认备份文件可读。
3. 生产接单、派发和 Provider 写入开关保持关闭：
   - `acceptNewOrders=false`
   - `dispatchNewRecharges=false`
   - `PROVIDER_WRITES_ENABLED=false`
   - `PROVIDER_CARD_WRITES_ENABLED=false`
   - `PROVIDER_RECHARGE_WRITES_ENABLED=false`
4. 不执行开卡、充值、付款、提现、退款等资金动作。
5. 当前 release、候选 release、数据库迁移版本和服务状态均记录到部署日志。

## 执行顺序（需单独确认后执行）

1. 在 VPS 创建候选 release 目录并上传候选包。
2. 服务端校验候选包 manifest；校验失败立即删除候选目录，不触碰 current。
3. 只读执行数据库迁移；迁移失败立即停止，不切换 release。
4. 切换 `/opt/pojia/current` 到候选 release。
5. 按服务依赖顺序重启 Web/Worker；写入开关继续保持关闭。
6. 验证：
   - `/health/live` 返回 200；
   - `/health/ready` 在限定时间内返回 200；
   - 数据库 readiness：活动任务、过期租约、UNKNOWN Provider 调用、资金风险、活动授权均为 0；
   - 后台静态资源哈希与候选包一致；
   - 只读卡同步、目录同步服务正常。
7. 通过后保持关闭写入门禁，进行后台逐页只读验收。

## 回滚条件与步骤

出现以下任一情况立即回滚：健康检查失败、迁移失败、静态资源不一致、服务无法启动、出现资金风险或 UNKNOWN Provider 调用。

1. 关闭接单、派发和 Provider 写入开关。
2. 将 `/opt/pojia/current` 切回部署前记录的 release。
3. 重启 Web/Worker。
4. 重新验证 live/ready、readiness 和活动风险为零。
5. 保留候选 release、日志、迁移结果和回滚原因，不删除证据。

## 明确不包含的动作

- 不进行真实客户充值验收。
- 不调用 Provider 写接口。
- 不自动开卡或给卡充值。
- 不改变 Plus 账号拒绝规则。

本清单只定义部署准备和回滚边界；生产切换必须在清单全部满足后再次获得明确确认。

## 候选包再次核验记录

2026-08-22 本地只读核验结果：

- `manifest.sha256`：通过，416 个文件；
- 迁移 037：存在；
- 总览 anti-join 查询代码：存在；
- “卡台当前 active 卡数”文案：位于 `v1/public/admin/assets/admin.js`；
- 常见真实密钥模式扫描：未发现。

该核验只针对本地候选包，不代表生产已部署。
