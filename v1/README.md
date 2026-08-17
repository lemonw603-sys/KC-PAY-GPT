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

尚未接入客户页面和后台。卡台读取结构已经完成一次获批的真实只读验证，开卡与直充写接口仍未调用，因此真实写响应的字段映射仍待单笔 PoC 确认。

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

没有设置 `TEST_DATABASE_URL` 时，七个数据库集成用例会明确跳过，其余单元测试继续执行。

## 配置

复制 `.env.example` 中的字段到进程环境。程序不会主动读取 `.env` 文件，部署环境应显式注入变量。

生成 Session 加密密钥：

```bash
openssl rand -base64 32
```

不要提交生成后的密钥。

## 数据库迁移

要求 MySQL 8，配置好环境变量后执行：

```bash
npm run migrate
```

迁移版本写入 `schema_migrations`，已执行的版本不会重复运行。

## 启动

```bash
npm start
```

- `GET /health/live`：进程存活。
- `GET /health/ready`：数据库可查询时返回 200，否则返回 503。
- `POST /api/v1/orders`：提交 `{ cdk, session }`，成功返回客户查询用 `publicNo` 和 `CREATED`。

数据库业务开关默认禁止新订单和新充值，保留已有订单轮询。进程级 Provider 读写权限又默认全部关闭，因此仅启动 worker 不会访问外部系统。

开放接单前必须在 `app_settings` 同时配置 `default_card_type_id`、`default_open_card_amount`，再将 `accept_new_orders` 改为 `true`。只开启接单不会触发真实开卡，worker 写权限仍有独立硬锁。

## Worker

```bash
npm run start:worker
```

- `PROVIDER_READS_ENABLED=false` 和 `PROVIDER_WRITES_ENABLED=false` 是默认值；两者均为关闭时，worker 可启动但不领取任何外部调用任务。
- 读权限开启时才要求 `ZZSHU_API_KEY`，用于轮询已有订单。
- 写权限在当前代码中硬锁；卡台开卡与卡详情真实 Schema 未经单笔 PoC 验证前，即使配置 `PROVIDER_WRITES_ENABLED=true` 也会在启动阶段拒绝运行。
- 数据库的 `dispatch_new_recharges` 和进程写权限必须同时开启，worker 才可领取开卡或直充提交任务。
