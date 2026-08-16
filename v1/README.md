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

尚未接入客户页面、后台、卡台或直充 API。

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

没有设置 `TEST_DATABASE_URL` 时，三个数据库集成用例会明确跳过，其余单元测试继续执行。

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

当前所有业务开关默认禁止新订单和新充值，只允许已有订单轮询与交易同步。真实 Provider 接入前不会产生资金动作。
