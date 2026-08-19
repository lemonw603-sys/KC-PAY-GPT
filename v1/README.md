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
- 自有运营后台：订单指标跳转、待确认充值队列、完整卡号库存、人工补卡和单订单一次性充值放行。
- 卡台目录每 5 分钟只读对账；有效但余额不足的卡标记为 `DEPLETED`，未解析卡片会禁止新开卡。

卡台开卡与直充写能力已通过单笔 PoC 验证。正式订单仍默认停在付款前，只有后台对具体订单签发短时一次性 Permit 才能真实充值。

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

没有设置 `TEST_DATABASE_URL` 时，11 个数据库集成用例会明确跳过，其余单元测试继续执行。

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
- 读权限开启时要求 `HNSKJ_API_KEY` 与 `ZZSHU_API_KEY`，分别用于卡台只读查询和直充订单查询；密钥只注入 worker 的 provider 环境文件，Web 进程不需要读取。
- 部署后可运行 `npm run provider:read-check`，它只调用 HNSKJ 的账户、余额、卡段、卡列表和 ZZSHU 连接检查接口；脚本在 `PROVIDER_WRITES_ENABLED=true` 时拒绝启动，也不会输出密钥、完整卡资料或 Session。
- `WORKER_CONCURRENCY` 控制每个 worker 进程同时领取的任务数，范围 `1–32`，默认 `1`。提高它只会增加任务处理吞吐，不会绕过卡台限流或状态确认。
- 正式接通 Provider 前保持 `1`；完成单笔和小批量验证后再按 `1 → 2 → 4` 逐级提高，并观察 429、失败率、余额和 `SUBMIT_UNKNOWN`。
- 正式 Worker 会在开卡写入前持久化卡片列表基线；响应缺 ID 或进程中断后只做列表差异恢复，不能自动重开。
- 数据库的 `dispatch_new_recharges` 和对应的分离写权限必须同时开启，worker 才可领取开卡或直充提交任务。
- `SUBMIT_RECHARGE` 还必须带指定订单、短时有效的 `rechargePermit`；Permit 在网络请求前原子消费，任何结果都不能自动第二次创建。

## 库存卡

新订单只领取已经登记且余额足够的库存卡；库存为空时订单安全等待并产生后台告警，不会触发自动开卡。

```bash
npm run card:catalog-sync
```

该命令只读取卡台列表/详情并更新本地加密库存，在 Provider 写权限开启时拒绝运行。生产由 `pojia-card-catalog-sync.timer` 每 5 分钟执行；对账超过 15 分钟或存在未解析有效卡时，后台禁止创建新开卡任务。

```bash
pojia-card-stock status
pojia-card-stock threshold --count 5
pojia-card-stock register --card-id 123 --card-type-id 1
pojia-card-stock sync
pojia-card-stock open --count 10 --card-type-id 1 --amount 16 --execute OPEN-CARDS
```

只有最后一条命令会产生真实开卡费用，且必须同时提供明确数量、卡段、金额和执行确认词。批量命令逐张使用独立幂等键；中途失败会保留已经登记成功的卡并停止，不会从头重开。生产 Worker 的开卡写权限始终保持关闭。

生产只通过 root 运维脚本操作直充执行门：

```bash
pojia-recharge-gate status PJV1-ORDER
pojia-recharge-gate arm PJV1-ORDER 10
pojia-recharge-gate close PJV1-ORDER
```

`arm` 只接受 `CARD_READY + PENDING + attempts=0 + 无 create_direct 历史` 的单个订单；`close` 先关闭全局直充写入并重启 Worker，再撤销尚未消费的 Permit。

单笔 PoC 优先复用已经人工确认可用的专属卡，避免为了验证流程重复开卡：

```bash
npm run provider:poc -- \
  --session-file /absolute/private/session.json \
  --state-file /absolute/private/provider-poc-state.json \
  --provider-card-id CARD_ID \
  --min-card-balance 16
```

该模式会读取卡片详情并验证状态、完整凭据和最低余额，默认在构造直充请求后以 `PREPAYMENT_STOPPED` 停止，不调用直充创建接口。它不会开卡，但会读取真实供应商数据，不能作为健康检查或部署探针运行。

需要验证“开卡到直充”的完整链路时，开卡金额与最低余额必须分别显式传入：

```bash
npm run provider:poc -- \
  --session-file /absolute/private/session.json \
  --state-file /absolute/private/provider-poc-state.json \
  --card-type-id CARD_TYPE_ID \
  --amount 16 \
  --min-card-balance 16
```

脚本不会从开卡金额推断最低余额；最低余额必须为正数且不能超过开卡金额。
该模式会真实调用卡台开卡接口并产生开卡资金动作，但默认不会调用直充创建接口；只有明确接受开卡成本后才能运行。

## 卡片一致性巡检

```bash
npm run audit:cards
```

巡检只读取 HNSKJ 卡片列表和本地 `cards` 表，不开卡、不充值，也不读取或输出完整卡号、CVV、Session。它会发现卡台有卡但本地卡片表为空、卡台卡片未映射、本地卡片在卡台消失，以及明确的终态冲突。输出为单行 JSON：一致时退出码为 `0`，发现不一致时为 `2`，巡检本身失败时为 `1`。

服务器单元 `pojia-card-audit.service` 与 `pojia-card-audit.timer` 默认不启用；启用定时器前需确认只读 API 的调用频率和告警接收方式。默认计划为每 30 分钟一次，并附带最多 5 分钟随机延迟。
