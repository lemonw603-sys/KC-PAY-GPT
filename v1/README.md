# 破甲 v1 运行骨架

本目录是独立的 v1 生产边界。它不导入仓库根目录的浏览器、Stripe、hCaptcha、代理或旧充值模块。

## 当前能力

- 轻量 Express 入口。
- 存活与数据库就绪检查。
- 严格订单状态机。
- MySQL 任务租约、过期租约恢复和有界重试。
- 订单状态变更与事件同事务写入。
- Session AES-256-GCM 加密工具。
- v1 首版 MySQL 数据结构。
- `HnskjCardProvider` 和 `ZzshuRechargeProvider` 纯 fixture 合同适配器。
- Provider 调用开始/结束审计、递归敏感字段脱敏和真实 MySQL 落库验证。
- 单任务执行骨架：成功完成、可重试回队、非重试错误进入 dead-letter，单个失败不阻塞其他任务。
- 开卡、直充提交和状态轮询 handler：固定幂等键、`SUBMIT_UNKNOWN`、429 安全重试和失败二次确认。
- MySQL workflow repository：仅在 worker 边界解密 Session，并原子提交卡片绑定、外部订单标识、状态事件和后续任务。
- 独立 worker 入口：按数据库开关和进程级 Provider 权限双重过滤可领取的任务类型，支持空转、租约恢复和优雅停止。
- 客户订单入口：验证 CDK 与完整 Session，原子创建加密订单、创建事件和 `PURCHASE_CARD` 任务。
- v1 CDK CLI：批量生成、按行导入、批次追踪和哈希去重；生成明文只写入新建的 `0600` 文件。
- 独立 v1 客户页：提交 CDK + Session、通过 `publicNo`/CDK 查询、有界自动轮询和稳定客户状态展示。

客户页面已接入，内部管理后台仍待实现。卡台读取结构已经完成一次获批的真实只读验证，开卡与直充写接口仍未调用，因此真实写响应的字段映射仍待单笔 PoC 确认。

## 本地检查

```bash
cd v1
npm ci
npm test
npm audit --omit=dev
```

有独立 MySQL 8 测试库时运行集成测试：

```bash
TEST_DATABASE_URL='mysql://user:password@127.0.0.1:3306/pojia_v1_test' npm test
```

没有设置 `TEST_DATABASE_URL` 时，九个数据库集成用例会明确跳过，其余单元测试继续执行。

## 配置

复制 `.env.example` 中的字段到进程环境。程序不会主动读取 `.env` 文件，部署环境应显式注入变量。

- `HOST` 在生产环境只能使用 `127.0.0.1` 或 `::1`；公网入口必须经过 Caddy 等反向代理。
- `DATABASE_URL` 只给 Web、worker 和 CDK 工具使用，生产账号不得拥有 DDL 权限。
- `MIGRATION_DATABASE_URL` 只在执行迁移时注入，必须使用独立迁移账号。
- 生产环境连接非本机 MySQL 时，`DATABASE_TLS=true` / `MIGRATION_DATABASE_TLS=true` 为强制项；URL 必须使用证书覆盖的 DNS 主机名，并始终校验证书链和主机名。
- 私有 CA 以 base64 PEM 放入对应的 `*_TLS_CA_BASE64`；公共 CA 签发的证书不需要额外填写。
- 完整权限、网络、备份和验收合同见 `docs/contracts/MYSQL_PRODUCTION_SECURITY.md`。

生成 Session 加密密钥：

```bash
openssl rand -base64 32
```

不要提交生成后的密钥。

## 数据库迁移

要求 MySQL 8。迁移命令只使用迁移专用 URL 建立连接，不需要 Session 或后台密钥：

```bash
npm run migrate
```

`NODE_ENV`、`MIGRATION_DATABASE_URL` 和 TLS 字段应由部署密钥存储预先注入，不要把带密码的 URL 直接写进 shell 历史。

迁移版本写入 `schema_migrations`，已执行的版本不会重复运行。

## 启动

```bash
npm start
```

- `GET /health/live`：进程存活。
- `GET /health/ready`：数据库可查询时返回 200，否则返回 503。
- `GET /`：客户 Plus 订单提交和查询页面。
- `POST /api/v1/orders`：提交 `{ cdk, session }`，成功返回客户查询用 `publicNo` 和 `CREATED`。
- `POST /api/v1/orders/status`：提交 `{ publicNo }` 或 `{ cdk }`，返回客户可见状态和最后更新时间。

数据库业务开关默认禁止新订单和新充值，保留已有订单轮询。进程级 Provider 读写权限又默认全部关闭，因此仅启动 worker 不会访问外部系统。

开放接单前必须在 `app_settings` 同时配置 `default_card_type_id`、`default_open_card_amount`，再将 `accept_new_orders` 改为 `true`。只开启接单不会触发真实开卡，worker 写权限仍有独立硬锁。

## CDK 批次

```bash
npm run cdk -- generate --count 100 --batch BATCH_20260817 --output /absolute/private/cdks.txt
npm run cdk -- import --input /absolute/private/cdks.txt --batch IMPORT_20260817
```

两条命令都必须显式注入运行账号的 `DATABASE_URL`；远程生产数据库还必须注入 TLS 配置。完整参数、输出摘要和明文文件边界见 `docs/contracts/CDK_CLI.md`。

## Worker

```bash
npm run start:worker
```

- `PROVIDER_READS_ENABLED=false` 和 `PROVIDER_WRITES_ENABLED=false` 是默认值；两者均为关闭时，worker 可启动但不领取任何外部调用任务。
- 读权限开启时才要求 `ZZSHU_API_KEY`，用于轮询已有订单。
- 写权限在当前代码中硬锁；卡台开卡与卡详情真实 Schema 未经单笔 PoC 验证前，即使配置 `PROVIDER_WRITES_ENABLED=true` 也会在启动阶段拒绝运行。
- 数据库的 `dispatch_new_recharges` 和进程写权限必须同时开启，worker 才可领取开卡或直充提交任务。
