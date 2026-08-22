# Browser artifact vault 与资源租约跨进程恢复合同

> 状态：B2 恢复 Repository v1 已实现，并在一次性 Docker MySQL 8.4 隔离库通过真实重启接管验证。生产派发和付款写开关仍关闭。

## 1. 合同边界

本合同只解决同一 Browser run 在进程退出后的敏感 Checkout authority 保存、账号/订单/卡片/Checkout 资源互斥和失败关闭恢复。它复用既有 `browser_runs`、`checkout_artifacts`、`execution_resource_leases` 和 `recharge_attempts`，不建立第二套订单或资金账，也不负责真实页面操作。

实现位置：

- 迁移：`v1/migrations/028_browser_artifact_vault_recovery.sql`；
- Repository：`v1/src/db/repositories/browser-recovery-repository.js`；
- Schema/Repository 测试：`v1/test/browser-recovery-schema.test.js`、`v1/test/browser-recovery-repository.test.js`；
- MySQL 集成：`v1/test/browser-recovery-mysql-integration.test.js`。

## 2. 密钥与数据边界

- artifact 使用独立的 32-byte AES-256-GCM key；`key_version` 随密文保存，key 本身不入库；
- 资源身份使用另一把独立 32-byte HMAC key，不与 artifact key 共用；
- AES-GCM AAD 绑定 `secret_ref + run_id + account_key_hmac + artifact_kind + expires_at`，跨 run 或篡改元数据不能解密；
- `browser_artifact_secrets` 仅保存 IV、auth tag、ciphertext、key version 和期限；
- `checkout_artifacts` 仅保存 opaque `secret_ref`、URL hash、Checkout hash 和状态，不保存完整 URL/fragment；
- 销毁时 IV、auth tag 和 ciphertext 必须全部置空，数据库 CHECK 约束阻止“已销毁但仍可恢复”的行。

允许的 authority 仅限完整的 `pay.openai.com`/`checkout.stripe.com` hosted Checkout URL，或受约束的 ChatGPT 内部 Checkout URL。未知 host、凭据型 URL、不完整 hosted URL 和不符合格式的 Checkout ID 在连接数据库前失败。

## 3. 资源租约

一个可变 run 必须同时持有：

1. `ACCOUNT`：目标账号身份 HMAC；
2. `ORDER`：本地订单；
3. `CARD`：已绑定卡片；
4. `CHECKOUT_ARTIFACT`：仅在活动 artifact 存在时加入。

活动资源由 `active_resource_key = resource_type + ':' + resource_key_hmac` 的数据库唯一约束作最终并发闸门。领取前会识别活租约；并发插入冲突统一返回 `RESOURCE_BUSY`，不能把账号锁退化为订单锁。

Worker lease token 只明文返回一次，数据库保存 SHA-256。`heartbeatRunResources` 必须同时续期 run lease 和当前完整资源集合；任一资源所有权变化都会整体回滚。

## 4. 过期接管

`recoverExpiredRun` 只在 run lease 和全部资源 lease 均已过期时允许新 Worker 接管，并签发新的单次 lease token。

- 已存在 `PAYMENT_SUBMIT` 的 `COMMITTED/OUTCOME_UNKNOWN` operation，或付款/资金状态不安全：固定返回 `RECONCILE_ONLY`，不签发 token；
- 控制权不属于自动化：固定返回 `HUMAN_REQUIRED`，不签发 token；
- 活租约仍存在：返回 `RESOURCE_BUSY`；
- 安全的付款前 run：释放旧过期租约并以新 owner 原子领取全部资源；
- 已有活动 artifact：返回 `RESUME_EXISTING_ARTIFACT`，禁止创建第二个 Checkout。

旧 Worker 在 token/owner/期限任一不匹配时无法读取 artifact、续租或销毁。

## 5. artifact 生命周期

### 创建

`storeCheckoutArtifact` 要求有效 Worker lease、自动控制权、完整基础资源租约和付款前安全状态。密文 secret、公开索引和 artifact 资源租约在同一事务创建；同一 run/账号已有活动 artifact 时返回 `ACTIVE_CHECKOUT_EXISTS`。

### 读取

`revealCheckoutArtifact` 要求当前 Worker 持有包括 artifact 在内的完整资源集合。付款已经提交或状态未知时返回 `RECONCILE_ONLY`。过期只把 artifact 改为 `REVIEW_REQUIRED`，返回 `EXPIRY_IS_NOT_INVALIDATION_PROOF`，绝不泄露 URL，也不把过期猜成确定失效。

### 销毁

`destroyCheckoutArtifact` 仅接受代码 allowlist 内的确定性失效原因，并且只能发生在付款前。销毁与公开索引失效、密文清零、artifact 租约释放处于同一事务；付款后禁止销毁来为重建 Checkout 腾位置。

## 6. 当前未覆盖

- Browser attempt 的订单调度入口、隔离 Worker 注册和真实页面 adapter；
- artifact key 的在线轮换/重加密作业和到期清理 runner；
- 后台只读时间线、人工接管与恢复 API；
- 并发 Worker 队列、长时间心跳压力和连续 24 小时 soak；
- 菲律宾 sticky 出口真实 Session/Checkout 验证。

## 7. 验收证据

- v1 全量：349 项，320 通过、29 项因未配置常驻隔离 MySQL 跳过、0 失败；
- 一次性 Docker MySQL 8.4：027/028 随全量迁移成功；
- 两个真实 MySQL Browser 集成场景：2/2 通过；
- 新 Repository 进程使用相同 key ring 解开原密文，公开索引和密文均不含可用 Checkout URL；
- run/resource 过期后新 Worker 接管并恢复同一个 artifact；
- artifact 过期进入 review，不自动重建；确定性销毁后密文材料全部为 NULL；
- 本节点没有连接生产、没有真实开卡、没有输入真实卡片或 Session、没有点击付款。
