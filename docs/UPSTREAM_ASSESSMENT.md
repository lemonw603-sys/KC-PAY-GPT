# KC-PAY-GPT 上游评估与 v1 映射

- 日期：2026-08-17
- 上游提交：`fb4da763f5cdcd6995b5b8ad3b7f758ae0684963`
- 结论：作为 UI 和运营功能加速器使用，不沿用原支付执行架构

## 1. 当前基线

- `server.js`：4035 行。
- `mysql-store.js`：3638 行。
- `public/admin.html`：8430 行。
- 生产依赖：21 个；开发依赖：3 个。
- `npm test`：1 个测试文件，7 个测试通过，测试范围仅覆盖原第三方 GPT API 客户端。
- `npm audit --omit=dev`：15 个生产依赖问题，其中 11 high、3 moderate、1 low。
- 全量安装审计：17 个问题，其中 13 high、3 moderate、1 low。

当前测试通过不能证明订单、CDK、卡锁、任务恢复或管理后台可靠。

## 2. 为什么不能原样上线

### 2.1 第三方充值协议不兼容

原 `gpt-api-client.js` 使用：

- `Authorization: Bearer ...`
- `GET /plans`
- `POST /pay/inspect`
- `POST /pay`
- `GET /pay/orders/{id}`
- 调用方 `Idempotency-Key`

目标直充平台使用：

- `X-API-Key`
- `POST /third-party/orders/direct`
- `POST /third-party/orders/status`
- `card_key`
- 创建接口没有调用方幂等键

因此原客户端和原 worker 不能通过修改 Base URL复用，必须由 `ZzshuRechargeProvider` 替换。

### 2.2 原资产锁会破坏一卡一单

原系统会：

- 启动时清空所有卡片 `in_use` 锁。
- 周期性释放超过 15 分钟的卡锁。
- 第三方 API异常时释放预留卡。

这适合可复用卡池，不适合“一张卡永久绑定一笔订单”。如果外部充值已创建但本地响应丢失，释放卡会让它被第二笔订单再次使用。

v1 必须使用持久化的订单所有权，不能用临时 `in_use` 作为卡片归属。

### 2.3 原 CDK 失败回滚可能导致重复提交

原 worker 在失败或异常时会把 CDK恢复为未使用。如果外部订单已经创建但响应丢失，客户再次提交同一 CDK可能产生第二笔充值。

v1 中 CDK在本地订单创建后永久绑定该订单。失败后客户只能恢复查询原订单，不能用同一 CDK创建新订单。

### 2.4 原任务不是持久化消费模型

原请求创建任务后直接在当前 Node.js 进程启动异步函数，并使用内存集合计算活动并发。进程在关键步骤重启后，没有通用的任务租约和自动恢复路径。

v1 保留 MySQL，但将执行改成数据库任务表、租约、明确状态迁移和重启恢复。

### 2.5 原状态判断过于宽松

原代码通过字符串包含关系判断成功和失败，例如只要状态文本包含 `success` 就可能被判为成功。供应商新增状态或返回类似 `not_successful` 时存在误判风险。

v1 只接受 Schema 中明确枚举的状态；未知值进入 `RECONCILIATION_REQUIRED`。

### 2.6 旧能力在模块加载时已经进入运行路径

`server.js` 顶层直接加载代理、hCaptcha、浏览器池、浏览器运行时和订阅操作模块，启动时还会同步并可能预热浏览器池。因此仅在后台把功能开关设为关闭，仍需安装和加载整套依赖，也保留了依赖漏洞和误启动风险。

v1 建立新的轻量入口。旧 `server.js` 和相关模块保留在基线或 `legacy` 路径，但新入口不导入它们。

## 3. 功能处置

### 直接复用或小幅整理

| 模块 | 处置 | 原因 |
| --- | --- | --- |
| `admin-auth.js` | 复用并补安全测试 | 已有登录、限流、2FA和登录记录基础 |
| `admin-paths.js` | 可复用 | 后台路径管理相对独立 |
| `telegram-notify.js` | 复用通知发送层 | 改成 v1 异常事件，不沿用旧支付文案 |
| `runtime-log.js` | 复用思路，限制敏感字段 | 适合作为短期运行观察，不作为审计账本 |
| CDK 页面和后台视觉结构 | 复用 UI 结构 | 能减少第一版页面工作量 |
| MySQL 连接与事务辅助方法 | 选择性提取 | 连接池和事务封装可用，业务表方法重写 |

### 需要替换

| 原模块/能力 | v1 替代 |
| --- | --- |
| `gpt-api-client.js` | `ZzshuRechargeProvider` |
| 手工 `card_assets` 卡池 | `HnskjCardProvider` + 订单专属卡记录 |
| 进程内异步 worker | MySQL 持久化任务 worker |
| `task_logs` 混合状态 | `orders`、`tasks`、`order_events` 分层 |
| 临时卡锁 | 数据库唯一绑定与订单生命周期 |
| 字符串状态识别 | 严格枚举与运行时 Schema |
| 失败自动回滚 CDK | CDK永久绑定原订单并恢复查询 |
| 原账单记录 | 供应商调用、卡交易和退款台账 |

### 保留但隔离

- `index.js` 本地浏览器支付流程。
- `browser-*`、`playwright-*`。
- `stripe-payment.js`、`pricing-checkout.js`、`payment-retry.js`。
- `hcaptcha-*`、`captcha-platform.js`、`human-verification.js`。
- `proxy-pool.js`。
- 邮箱、手机号、地址池。
- 截图、录像和旧订阅操作页面。

这些源码保留在 Git 历史和基线分支。v1 新入口不加载，后台不显示相关菜单，生产依赖也不因为它们而保留。

## 4. 建议的新代码边界

```text
src/
├── app/                    HTTP 应用与路由
├── domain/                 订单状态、规则和状态迁移
├── providers/
│   ├── hnskj-card.js
│   └── zzshu-recharge.js
├── workers/                开卡、提交、轮询、交易同步
├── repositories/           MySQL 数据访问
├── security/               管理认证、Session 加密、日志脱敏
└── notifications/          Telegram 事件
```

旧源码暂不移动，避免第一阶段产生大规模无意义 diff。新入口稳定后，再决定将旧源码归档到 `legacy/` 还是只留在 `upstream-baseline`。

## 5. 生产依赖处理

当前高风险依赖主要来自两类：

- 浏览器和旧自动化链：`puppeteer-core`、`@puppeteer/browsers`、`extract-zip`、`ws` 等。
- 邮件和旧账号链：`imapflow`、`mailparser`、`nodemailer`、`linkify-it` 等。

另有当前主链可能使用的 `axios`、`express` 及其传递依赖问题。v1 建立轻量入口后重新生成最小 `package.json` 和锁文件，再升级仍需保留的依赖；不对现有大依赖树直接运行破坏性 `npm audit fix --force`。

## 6. 第一批实现顺序

1. ~~新建轻量应用入口和健康检查，不加载任何旧自动化模块。~~ 已完成。
2. ~~建立 v1 数据表、状态枚举、任务租约和事件日志。~~ 首版已完成，待 MySQL 8 集成验证。
3. 编写两个 Provider 及纯 fixture 合同测试。
4. 接入 CDK与客户提交页面。
5. 接入内部订单、异常和退款页面。
6. 完成只读 API验证后，才进入真实开卡和单笔 PoC。
