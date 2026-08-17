# 生产 MySQL 安全接入合同

- 状态：代码约束已实现，已完成服务器隔离集成验证
- 日期：2026-08-17
- 范围：破甲 v1 Web、worker、CDK 工具、迁移、网络与备份

## 结论

生产运行与数据库迁移必须使用不同账号。MySQL 不得直接暴露公网；生产环境只要不是连接本机回环地址，应用就会强制要求 TLS 并校验证书。

本合同不包含任何真实数据库地址、用户名、密码或证书。真实凭据只允许由部署密钥存储注入。

## 账号边界

### 运行账号

供 Web、worker 和 CDK 工具使用，通过 `DATABASE_URL` 注入。

只授予目标 schema 的：

```sql
SELECT, INSERT, UPDATE, DELETE
```

不得授予 `CREATE`、`ALTER`、`DROP`、`GRANT OPTION`、`FILE`、`PROCESS`、`SUPER` 或全局权限。

### 迁移账号

只在人工执行 `npm run migrate` 时，通过 `MIGRATION_DATABASE_URL` 临时注入。迁移脚本不会使用 `DATABASE_URL` 建立连接，也不需要 Session 加密密钥或后台密钥。若部署环境同时注入了 `DATABASE_URL`，脚本只读取其中的用户名用于生产账号分离校验。

迁移账号可以在目标 schema 获得迁移所需 DDL 权限。首版可在迁移窗口短时授予目标 schema 的全部权限，迁移完成后立即撤销或禁用账号。不得授予全局 `*.*` 权限。

生产环境如果同时提供两个 URL，配置校验要求其中的用户名不同，防止仅修改密码或 URL 写法后继续误用同一账号。最终仍必须通过 MySQL `SHOW GRANTS` 验证实际账号权限。

## TLS 与网络

### 本机数据库

应用和 MySQL 位于同一台服务器、使用 `127.0.0.1`、`localhost` 或 `::1` 时，可以设置：

```env
DATABASE_TLS=false
MIGRATION_DATABASE_TLS=false
```

MySQL 仍只能监听回环地址，不得把 3306 映射到公网。

同机 Web 服务也只能监听 `127.0.0.1` 或 `::1`，由已有 Caddy 提供公网 HTTPS；生产配置会拒绝 `0.0.0.0` 等非回环监听地址。

### 远程数据库

生产环境连接任何非回环地址时必须设置：

```env
DATABASE_TLS=true
MIGRATION_DATABASE_TLS=true
```

代码固定使用 `rejectUnauthorized=true`，不会接受无法验证的服务端证书。

远程连接必须在 URL 中使用证书覆盖的 DNS 主机名，不能直接填写数据库 IP；代码同时启用 `verifyIdentity=true` 校验主机名。

- 公共 CA 签发证书：无需提供额外 CA。
- 企业或自签私有 CA：把 PEM 证书做 base64 后放入 `DATABASE_TLS_CA_BASE64` 和迁移侧对应字段。
- 禁止使用跳过证书校验的参数。
- 安全组或防火墙只允许应用服务器私网地址访问 3306。

## 推荐建权方式

以下是权限形态示例，不得直接复制示例密码；主机范围要替换成实际应用私网地址，而不是 `%`：

```sql
CREATE USER 'pojia_app'@'<app-private-host>' IDENTIFIED BY '<secret>' REQUIRE SSL;
GRANT SELECT, INSERT, UPDATE, DELETE ON pojia.* TO 'pojia_app'@'<app-private-host>';

CREATE USER 'pojia_migrator'@'<operator-private-host>' IDENTIFIED BY '<secret>' REQUIRE SSL;
GRANT ALL PRIVILEGES ON pojia.* TO 'pojia_migrator'@'<operator-private-host>';
```

上述 `REQUIRE SSL` 示例面向跨主机连接。本机回环部署若按前文关闭数据库 TLS，应省略 `REQUIRE SSL`，并以 MySQL 仅监听回环地址作为网络边界。

迁移结束后至少执行其中一种：

- 锁定迁移账号；或
- 撤销目标 schema 权限；或
- 删除一次性迁移账号。

## 密钥与配置

- `DATABASE_URL`、`MIGRATION_DATABASE_URL`、Session 加密密钥和后台会话密钥不得进入 Git、镜像层、命令历史或普通日志。
- URL 中的密码应使用 URL 编码；配置错误响应不得输出 URL 原文。
- 应用与 worker 共用运行账号时，权限以两者所需最小并集为准。
- Session 加密密钥必须独立于数据库密码；数据库密码轮换不能改变 Session 解密能力。
- 本地 `.env.admin.local` 只包含后台凭据，不能追加数据库密码。

## 备份与恢复

- 备份必须在离开数据库主机前加密；优先使用云数据库自带加密备份或受管快照。
- 自建备份使用独立只读备份账号，不复用应用或迁移账号。
- 备份文件、临时导出和恢复环境不得进入项目目录或 Git。
- 至少保留每日备份和一份异地副本；具体保留期在真实订单量确定后冻结。
- 上线前必须把备份恢复到隔离数据库，验证表数量、迁移版本、订单数量和 Session 密文完整性。
- 恢复验证不得调用供应商 worker；所有 Provider 读写开关保持关闭。

## 实际接入验收

接入空生产 schema 后逐项记录证据：

1. 3306 从公网不可达，只能从允许的应用/运维网络访问。
2. 远程连接的 TLS 已启用，证书身份校验通过。
3. 运行账号能够完成 `SELECT/INSERT/UPDATE/DELETE`，但 `CREATE TABLE` 与 `ALTER TABLE` 被拒绝。
4. 迁移账号能够完成四个迁移；重复执行不会重复建表。
5. 迁移完成后账号已锁定、撤权或删除。
6. 九个 MySQL 集成测试全部通过。
7. 新建订单后 Session 列为密文，普通后台查询不选择该列。
8. 备份可以在隔离库恢复，恢复过程不启动 worker。

完成上述八项并把结果写入本文件后，生产 MySQL 接入阻塞项才算关闭。

## 2026-08-17 服务器隔离集成验证记录

- 在服务器上创建一次性隔离 schema 和一次性测试账号；测试账号只授予该隔离 schema 权限。
- 使用当前发布目录执行 4 个迁移，全部成功。
- `npm test` 结果：87 tests、87 pass、0 fail、0 skipped。
- 测试全程未启用 Provider 访问，不调用卡台或直充 API。
- 测试结束后已删除隔离 schema 和测试账号；复核结果均为不存在。
- 生产 schema 复核仍为 10 张表、4 个迁移；Web 根路径返回 HTTP 200。
- 测试使用的一次性 SSH 公钥已从服务器删除；复用该密钥登录验证失败（退出码 255）。

本记录不包含服务器地址、密码、Session、API Key 或其他凭据。
