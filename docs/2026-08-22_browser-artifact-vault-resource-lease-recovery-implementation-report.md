# Browser artifact vault 与资源租约跨进程恢复实施报告

## 结论

B2 第二个 MySQL 主工程节点已完成。此前离线 WAL 中的 artifact vault、账号/订单/卡片/Checkout 租约和进程崩溃接管规则，现已落到共享 MySQL 与可由不同 Node 进程实例调用的 Repository；同一 Checkout authority 可以在安全付款前由新 Worker 恢复，但任何已提交或结果未知的付款都只能进入对账。

本节点没有接入生产，也没有执行真实页面或资金动作。

## 实现内容

### 数据库

迁移 `028_browser_artifact_vault_recovery.sql` 新增独立密文表，并为 artifact 增加期限、销毁时间、索引和显式外键。新增 ALTER 均有 information_schema guard，027 与 028 均可单独重放。

### Repository

`browser-recovery-repository.js` 实现：

- ACCOUNT/ORDER/CARD/CHECKOUT_ARTIFACT 资源领取与统一心跳；
- AES-256-GCM artifact 写入、按 key version 解密和认证；
- run/resource 全部过期后的新 owner 接管；
- 已有 artifact 的原物恢复而非重建；
- 付款 operation/state 的保守检查；
- artifact 过期 review 和确定性销毁；
- 仅保存 lease token hash、资源 HMAC 和 Checkout hashes。

并发资源领取没有依赖“先查询不存在行再加 gap lock”；代码先读取活动唯一键，存在时锁具体主键，不存在时由数据库唯一键承担最终竞争裁决，避免多个测试/Worker 在共享索引范围互相等待。

## 验证

1. Node 全量测试：349，320 pass，29 skip，0 fail；skip 均为没有常驻 `TEST_DATABASE_URL` 的真实 MySQL 场景。
2. 一次性 Docker MySQL 8.4 重新执行全量迁移。
3. 在同一隔离库并行运行 Browser 事务映射和恢复集成测试：2 pass，0 fail。
4. 查询确认 `browser_artifact_secrets` 表存在，`checkout_artifacts → browser_artifact_secrets` 与 `browser_artifact_secrets → browser_runs` 两条关系存在。
5. 验证跨 Repository 实例解密、过期接管、同 artifact 恢复、过期 review 和密码材料物理清零。

第一次容器验证曾在 MySQL 初始化重启窗口被 `mysqladmin ping` 过早判为就绪，迁移连接被服务关闭；改为等待实际 `SELECT 1` 连续成功后，完整验证通过。该失败属于测试容器 readiness，不是 schema 或业务事务失败。

## 仍未完成

下一主工程节点是后台 Browser 只读追溯和人工恢复接口。其后是并发队列、长租约续期与连续 24 小时 soak，再进入隔离 Browser Worker/attempt 派发接入。菲律宾真实输入仍须等待对应 Session 与接近生产的 sticky 出口，不能由当前离线/MySQL 结果替代。
