# 浏览器充值模块全量排查报告（2026-08-25）

> **历史快照，不是当前状态源。** 本报告保留 2026-08-25 当时证据，其 HEAD、测试数、未实现项和工作树路径已部分过期。当前 Browser 状态以 `docs/BROWSER_CURRENT_STATUS_2026-08-25.md`、`docs/BRFE_HANDOFF_2026-08-25.md`、`docs/BROWSER_COORDINATION_REALIGN_2026-08-28.md` 和 `docs/CURRENT_STATE.md` 为准；禁止从本报告单独推导下一步。

## 0. 结论先行

1. **当前默认生产链路不是浏览器充值**：根目录 `npm start` 已切换到 `v1/src/server.js`，v1 不导入根目录的 Browser/Stripe/hCaptcha/代理模块；v1 的 worker 默认禁止 Provider 读写，数据库新订单/新充值开关默认关闭。
2. **旧浏览器充值链路仍完整保留，但被显式锁定**：必须使用 `ALLOW_LEGACY_RUNTIME=I_UNDERSTAND npm run start:legacy` 才能启动 `server.js`。该链路是“Session + CDK → Playwright → OpenAI Checkout → Stripe 表单 → 卡池轮换”的进程内异步实现。
3. **`codex/browser` worktree 的 Browser MVP 是隔离控制面 PoC，不是付款实现**：路径 `/Users/lemon/.codex/worktrees/9128/AI充值业务/browser-mvp`，M0–M5 已完成，20/20 测试通过；只允许 `LOCAL_MOCK + NON_PH_FUNCTIONAL + allowWrites=false`，不接真实 Session、Checkout、卡片、付款、Provider 或共享 MySQL 写路径。
4. **真实浏览器付款目前没有可复现的成功证据**。已有 Browser PoC 只证明 Session 服务端身份探针在某次实验中返回用户信息，页面仍可能被 403/Cloudflare 拦截；没有 Checkout 创建或支付点击证据。
5. **后续建议**：保持 v1 为唯一默认生产入口；先冻结 `recharge_attempts`、资金 permit、审计关联和 SessionProvider 合同，再将 Browser 线以只读 projection 接入，最后才单独设计可审计的写能力。不要把旧 `index.js` 直接接回 v1。

---

## 1. 排查范围与证据

### 1.1 当前主工作树

- 路径：`/Users/lemon/code/AI充值业务`
- 分支：`main`
- HEAD：`bd9f05b`
- 入口：根 `package.json` 的 `npm start` → `npm --prefix v1 start`
- 旧入口：`npm run start:legacy` → `node server.js`，但 `server.js` 顶部要求 `ALLOW_LEGACY_RUNTIME=I_UNDERSTAND`。

### 1.2 Browser 专用 worktree

- 路径：`/Users/lemon/.codex/worktrees/9128/AI充值业务`
- 分支：`codex/browser`
- 当前交接提交：`7a831ae`（后续文档提交 `3a282ce`）
- Browser 目录：`browser-mvp/`
- 未跟踪历史证据：`artifacts/browser-poc/*.json`、`.playwright-cli/`
- 该 worktree 的状态文档：`docs/BROWSER_CURRENT_STATUS_2026-08-25.md`、`docs/BRFE_HANDOFF_2026-08-25.md`。

### 1.3 已执行验证

```bash
npm test
npm --prefix /Users/lemon/.codex/worktrees/9128/AI充值业务/browser-mvp test
```

结果：

- 主工作树：legacy 8/8；v1 103 tests，94 pass、9 skip（9 个 MySQL 集成测试因未提供 `TEST_DATABASE_URL` 跳过），0 fail。
- Browser MVP：20/20 pass。
- Browser MVP `run check`：通过（文档已有 10 分钟 soak 证据：5328/5328 完成、重复 0、错误 0、残留 0、WAL 15984 条）。

---

## 2. 运行时拓扑与入口决策

### 2.1 默认 v1（当前生产边界）

```text
npm start
  └─ v1/src/server.js
       ├─ Express 客户端页 /api/v1/orders
       ├─ Session 校验 + AES-256-GCM 加密入库
       ├─ MySQL orders/tasks/order_events
       └─ 独立 v1 worker（Provider 读写硬开关）
```

v1 明确不导入：`index.js`、`server.js`、`stripe-payment.js`、`pricing-checkout.js`、`browser-*`、`hcaptcha-*`、`proxy-pool.js` 等旧自动化链。

### 2.2 旧 legacy 浏览器充值

```text
POST /api/run-process (或 /api/admin/trigger-activation)
  └─ server.js 校验 CDK + Session + 并发/维护状态
      ├─ 第三方代充开关开启 → runGptApiWorker（非浏览器）
      └─ 否则 → spawnActivationWorker
          └─ spawn node index.js 子进程
              ├─ browser-runtime: pool CDP 或 standalone Chromium
              ├─ session-auth: Cookie/session 注入与在线探针
              ├─ chatgpt: Checkout API 创建（失败可回退 pricing-checkout UI）
              └─ payment-retry → stripe-payment
```

### 2.3 浏览器池策略

- `browser-pool.js` 负责预热 `launchPersistentContext`，每个任务仍创建隔离 `BrowserContext`。
- 任务通过 CDP 接入 slot；池满时进入等待队列，超时默认 180 秒，未就绪时回退独立冷启动。
- `mysql-store.getBrowserPoolEnabled()`：数据库配置优先；无数据库值时回退环境变量，代码默认值为 **true**。这与部分 README “默认关闭”描述不一致，必须以数据库/环境实际值为准。
- legacy 启动时会预热池，并执行 `resetAllAssetLocks()`；每 60 秒回收超过 15 分钟的资产锁。

---

## 3. 旧浏览器充值端到端流程

### 3.1 客户输入与前置校验（`public/index.html` → `server.js`）

1. 客户输入 CDK，调用 `/api/verify-cdk`；服务端检查类型、自助属性、未使用、冷却和运行中任务。
2. 客户粘贴完整 Session JSON（推荐来自 `chatgpt.com/api/auth/session`）。前端/服务端提取 `accessToken` 并执行 JWT 结构、`iss`、`aud`、账户信息、`model.request` scope 和 `exp` 检查。
3. `POST /api/run-process` 再次验证维护模式、全局并发、CDK 状态、IP/CDK 冷却；无第三方 API 时要求卡池存在。
4. 原子 `markCdkUsed` 后创建 `task_logs` 任务，记录 jobKey，返回任务标识；前端通过 WebSocket/状态接口接收进度。

### 3.2 服务端调度与重试

- `spawnActivationWorker` 最多 `MAX_PROCESS_ATTEMPTS` 次（默认 1）。每次从数据库取活动代理、hCaptcha 配置并拼接子进程环境。
- `runCheckoutScript` 监听 stdout/stderr，按日志 marker 映射进度（0–99），3 分钟无输出触发杀进程；结束后使用 `analyzeProcessOutput` 分类 `success/failed/retry/manual/maintenance`。
- 已进入 Checkout/Stripe 后，大多数失败不再整单自动重试，改为人工处理；只在代理、鉴权、手机号等前置失败时按规则重试。
- 成功不回滚 CDK；失败/人工状态最终将 CDK 标记未使用（这是旧链路的业务决策，与 v1 “CDK 永久绑定订单”的设计相反）。

### 3.3 `index.js` 浏览器生命周期

1. `preparePlaywrightProxy` 处理 HTTP/SOCKS5（必要时 SOCKS→本地 HTTP 中继）。
2. `connectTaskBrowser` 根据 `BROWSER_RUNTIME_MODE` 选择池 CDP 或独立 Chromium。
3. 创建 1920×1080 context，按支付地区设置 locale/timezone；可录制 webm。
4. `installChatGptSession`：
   - 解析完整 JSON 或裸 token；收集 cookies/cookieHeader/session-token/CSRF/device id。
   - 对超长 `__Secure-next-auth.session-token` 按 NextAuth 规则拆块。
   - 先访问 `/api/auth/session` 做在线探针；失败时区分 Cloudflare/403/无用户信息。
   - 注入 `/api/auth/session`、`/api/auth/csrf` 路由和 `Authorization: Bearer` 请求头；阻断明显登录导航。
5. 注入 30+ 指纹修改（webdriver、UAData、plugins、语言、平台、屏幕、Canvas/WebGL、Chrome 对象等）。
6. 可选代理连通性检查 `api.ipify.org`，失败即终止。
7. 读取支付地区（默认 PH/PHP；支持 US/USD、SG/SGD、MY/MYR），从 CDK 记录解析 plan type，默认 `plus`。
8. `bootstrapChatGptSession` 打开 ChatGPT 首页，清理 Cloudflare/hCaptcha，检查登录 UI/API 探针。

### 3.4 Checkout 创建与 UI 回退

**API 主路径（`chatgpt.js`）**

```json
{
  "entry_point": "all_plans_pricing_modal",
  "plan_name": "由 plan_type 映射或 PLAN_NAME_OVERRIDE 覆盖",
  "billing_details": { "country": "PH/US/SG/MY", "currency": "PHP/USD/SGD/MYR" },
  "checkout_ui_mode": "custom（可配置）"
}
```

调用 `POST https://chatgpt.com/backend-api/payments/checkout`，使用 Bearer token。响应解析 `checkout_session_id/session_id/url`；无 URL 时由 session id 拼接 `https://chatgpt.com/checkout/openai_llc/{id}`。

打开后检查：非登录页、Cloudflare/hCaptcha 已处理、Checkout 表单文案/字段存在；失败时默认回退 `pricing-checkout.js`：

1. 打开 `https://chatgpt.com/#pricing`；
2. 切到 Personal（拒绝 Business）；
3. 选择地区并校验价格币种；
4. 点击 Plus/Pro 升级按钮；
5. 等待跳转 `/checkout/`。

`CHECKOUT_DEBUG_ONLY=1` 仅生成并输出 `CHECKOUT_URL`，不填写卡、不点击支付。

### 3.5 Stripe 表单与账单地址（`stripe-payment.js`）

1. 识别 OpenAI custom checkout 或 Stripe hosted 页面。
2. 扫描 3 个 Stripe iframe，按卡号/有效期/CVC 填写；单 iframe 多 input 和通用 frame selector 是回退。
3. 账单区按多组 selector/label/DOM 顺序兜底填写姓名、国家、街道、城市、州、邮编。
4. 地址池优先美国免税州（OR/DE/MT/NH/AK）；填写后轮询 “Due today”，按菲律宾 VAT 12% 估算和最终页面金额确认。
5. 关闭 Google Places 联想下拉，避免地址字段未提交。
6. 勾选服务条款（若存在），点击 Subscribe/Pay。

### 3.6 人机验证、结果确认与卡轮换

- 提交前/提交后/轮询期间均检查 Cloudflare/hCaptcha；可调用 VLM/打码平台/视觉求解器，无法清除则返回 `captchaRequired/manual_intervention`。
- 结果成功信号：`redirect_status=succeeded`、离开 checkout、成功文案（`subscription active`、`welcome to plus` 等）。
- 拒付信号：大量英文/中文拒付文案、alert 文案、`insufficient funds`、`incorrect cvc` 等。
- 结果等待默认 180 秒，每 2 秒轮询；每 15 秒保存 live screenshot。
- `payment-retry.js`：最多 `PAYMENT_MAX_CARD_ATTEMPTS` 张卡（默认 3）；卡按 `usage_count/last_used_at` 轮换。
  - 明确拒付：账单失败记录、卡标记 `已报废`、换下一张。
  - 表单/验证码/未知错误：账单失败记录，释放卡锁，转人工；不自动换卡（除非被识别为拒付）。
  - 成功：记录账单、绑定持卡人姓名/地址、增加卡使用计数、释放卡锁。

### 3.7 结果持久化与前端展示

- `task_logs`：状态、进度、raw_output、截图/录像路径、CDK、cardLast4。
- `billing_records`：成功/失败、金额/币种、Stripe session、CDK、邮箱、错误码/消息。
- 运行日志与 WebSocket 广播实时进度；后台可读取截图、录像、Session、账单和任务详情。

---

## 4. 数据与状态关键点

### 4.1 CDK

- 旧链路先 `markCdkUsed`，任务失败后可回滚为未使用；连续“无激活资格”会触发 CDK/IP 冷却。
- v1 改为订单创建后永久绑定 CDK，未知提交不允许靠重试新建第二单。

### 4.2 卡池

`card_assets` 保存卡号、有效期、CVC、持卡人姓名和使用/冷却/锁信息；`reserveCard` 使用 `FOR UPDATE SKIP LOCKED`。明确拒付卡永久报废；成功卡 24 小时内达到 3 次会冷却 24 小时。

### 4.3 账单

`billing_records` 同时保存 `card_number`（完整卡号，可为空）与 `card_last4`。这为审计方便，但属于高敏感支付数据，应迁移为 token/last4 + 授权引用。

### 4.4 Session

legacy `task_logs`/Session 管理接口支持保存和后台查看完整 Session payload；v1 只在服务端 AES-256-GCM 加密存储，客户/后台查询不返回明文。

---

## 5. Browser MVP（`codex/browser`）现状

### 5.1 设计目标

```text
opaque order/attempt/profile ref
  → durable dispatch + lease
  → isolated local BrowserContext
  → URL/title/marker checkpoint
  → fail-closed freeze
  → WAL/hash-chain evidence
  → restart reconcile-only
```

### 5.2 已实现能力

- `BrowserExecutionPort`、`DispatchStore`、`EvidenceSink`、`RuntimeAdapter`、`SessionProviderPort` 边界。
- `FileDispatchStore`：原子 JSON、幂等 enqueue、claim、heartbeat、complete、过期恢复；rename 不确定时抛 `AmbiguousStorageError`，禁止自动重放。
- `LocalPlaywrightRuntimeAdapter`：只接受 `LOCAL_MOCK` 且 `allowWrites=false`，只打开隔离 BrowserContext。
- `BrowserExecutionService`：导航、URL/title/marker 检查；页面漂移、租约丢失、人工冻结、超时全部 fail-closed；`submitCalls=0`。
- 代码层面 `BrowserExecutionService.execute()` 成功路径当前只追加 `intent` 与 `checkpoint`，不自行追加 `completion`；完成事件依赖外部编排/`DispatchStore.complete`。启动恢复时必须先处理 WAL 终态再决定 `recover()` 是否重排队，否则可能把无终态任务重新投递。
- `AppendOnlyWal`：单写者、序列、SHA-256 哈希链；篡改/截断抛 `WalIntegrityError`。
- `reconcileIncompleteJobs`：无终态证据的 RUNNING job 只进入 `RECONCILE_ONLY`，不自动重放 Browser 动作。
- `ReadOnlySharedContractAdapter`：只接受 order `CARD_READY/RECONCILIATION_REQUIRED`、attempt `PENDING/OBSERVING`、资金 `NOT_REQUESTED`；拒绝 active permit、Session/卡凭据/Checkout authority/API key。
- `SessionProviderPort`：只预留 `sessionRef → 短时 lease`，当前实现 fail-closed。

### 5.3 明确未实现

- 没有真实 Session provider、Checkout、卡片、付款按钮或 Provider 写接口。
- `SessionProviderPort` 目前只是 fail-closed stub，`BrowserExecutionService` 尚未调用它；“sessionRef → lease → BrowserContext”仍是待接线设计。
- 没有 MySQL dispatch adapter、生产 artifact vault、生产 worker、高可用拓扑。
- 当前 v1 尚未冻结正式 `recharge_attempts` 表，因此适配器不会从 `tasks/provider_calls` 猜测 attempt 映射。

### 5.4 真实 Browser PoC 证据解读

`artifacts/browser-poc/` 中的历史 JSON 显示：

- cookie-only 多次实验 `pageSession` 为 HTTP 403，页面标题/状态常为 Cloudflare `Just a moment...`，`loggedInUi=false`，`clickedUpgrade=false`，`clickedPayment=false`。
- `nonph-functional` 实验中 `/api/auth/session` 返回 `hasUser=true/hasAccessToken=true`，但首页导航仍为 403/Cloudflare，结论是 `SESSION_SERVER_IDENTITY_CONFIRMED`，不是付款成功。
- 所有实验均 `cardDataSupplied=false`、`checkoutCreated=false` 或未执行支付突变，不能作为真实充值成功率证据。

---

## 6. 已确认的设计决策与原因

| 决策 | 原因 |
|---|---|
| v1 与旧 Browser/Stripe 隔离 | 旧入口依赖重、状态/重试不持久化，且旧供应商协议不兼容；避免误启动和资金链路混用。 |
| Browser MVP 先只读、`allowWrites=false` | 先验证 dispatch/lease/证据/恢复，不把未冻结的资金/订单合同带入浏览器写路径。 |
| Session 只走 provider 边界 | 队列/WAL/普通日志只保存 `sessionRef`、digest、lease 过期时间，避免 Session 原文扩散。 |
| lease 丢失/页面漂移/未知状态 fail-closed | 防止进程重启、页面改版或状态不明导致重复充值。 |
| 未知外部结果进入人工/对账 | 支付成功不能用宽松字符串或中间响应推断。 |
| 旧卡池按临时锁，v1 改订单专属卡绑定 | 旧卡池适合可复用卡；v1 必须防止提交响应丢失后重复使用同一卡。 |

---

## 7. 风险、缺口与需要优先确认的事项

### P0：生产边界和真实付款证据

- 目前默认生产没有 Browser 充值能力；若要启用，必须明确切换入口、数据源和回滚策略。
- 没有真实 Checkout/付款成功的可重复证据；不能以 `SESSION_SERVER_IDENTITY_CONFIRMED` 或页面离开 checkout 作为资金成功。

### P1：旧链路安全与一致性

- `card_assets` 与 `billing_records` 存储完整 PAN/CVC/卡号；应改为加密密文或支付 token，后台只显示 last4。
- legacy 任务/后台存在完整 Session payload 查看/导出路径，需移除明文读取，改短时租约和一次性调试授权。
- 启动清空全部 `in_use` 锁、15 分钟回收 stale lock，会在“外部支付已创建但本地进程丢失响应”时允许同卡再次分配；这是与真实资金一致性冲突的旧设计。
- `analyzeProcessOutput`/`waitForPaymentResult` 把“离开 checkout”列为成功信号，存在页面跳转但支付未最终确认的误判窗口；应要求官方订阅状态/订单状态证据。
- 旧链路失败后回滚 CDK，和外部已创建但响应丢失时可能重复充值；v1 已通过永久绑定/`SUBMIT_UNKNOWN` 设计规避。

### P1：配置和可观测性

- README 对 `BROWSER_POOL` “默认关闭”的描述与代码 fallback true 不一致；应在启动时打印最终生效配置并统一默认值。
- 3 分钟无输出 watchdog 与支付结果 180 秒等待接近边界；网络慢/验证码阶段可能被误杀，应按阶段心跳而不是 stdout 空闲计时。
- 旧日志 marker 驱动状态分类脆弱，目标页面文案改版会导致误分类；应使用结构化事件。

### P2：Browser MVP 接线合同

在任何写路径前必须冻结：

1. `recharge_attempts` 主键、状态、幂等键和与 `orders/tasks` 的关系；
2. funds permit 字段、生命周期、授权范围与失效语义；
3. Browser 事件与 `order_events`/artifact vault 的关联；
4. SessionProvider 的真实实现、租约撤销和泄露监控；
5. 菲律宾 cohort、网络/代理身份、Checkout authority 的来源与证据等级。

---

## 8. 推荐后续执行顺序

1. **冻结事实源**：将本报告、v1 状态、Browser worktree 状态登记到统一 CURRENT_STATE/DECISIONS/HANDOFF 文档。
2. **不改 Browser 写能力**：先完成 `recharge_attempts`、funds permit、审计关联和 SessionProvider 合同评审。
3. **只读接线**：实现 MySQL → normalized projection 的只读 adapter；保持 `CARD_READY/RECONCILIATION_REQUIRED` 白名单与 `funds=NOT_REQUESTED`。
4. **单独做可观测性验收**：WAL/artifact vault、lease recovery、页面漂移、403/Cloudflare、人工冻结演练。
5. **最后才做单笔写 PoC**：一笔、单卡、单 Session、显式资金 permit、官方最终状态确认；任何 `SUBMIT_UNKNOWN` 进入人工对账，禁止自动重放。
6. **通过单笔后再小批量**：1 → 2 → 4 并发，观察 429、失败率、资金差异和重复提交；任一资金差异立即停止新写入。

---

## 9. 关键文件索引

### 旧 legacy 浏览器充值

- `/Users/lemon/code/AI充值业务/index.js`
- `/Users/lemon/code/AI充值业务/server.js`
- `/Users/lemon/code/AI充值业务/session-auth.js`
- `/Users/lemon/code/AI充值业务/chatgpt.js`
- `/Users/lemon/code/AI充值业务/pricing-checkout.js`
- `/Users/lemon/code/AI充值业务/stripe-payment.js`
- `/Users/lemon/code/AI充值业务/payment-retry.js`
- `/Users/lemon/code/AI充值业务/browser-runtime.js`
- `/Users/lemon/code/AI充值业务/browser-pool.js`
- `/Users/lemon/code/AI充值业务/mysql-store.js`
- `/Users/lemon/code/AI充值业务/mysql-schema.sql`

### 当前 v1

- `/Users/lemon/code/AI充值业务/v1/src/server.js`
- `/Users/lemon/code/AI充值业务/v1/src/worker.js`
- `/Users/lemon/code/AI充值业务/v1/src/services/order-intake-service.js`
- `/Users/lemon/code/AI充值业务/v1/src/workers/workflow-handlers.js`
- `/Users/lemon/code/AI充值业务/v1/README.md`

### Browser MVP worktree

- `/Users/lemon/.codex/worktrees/9128/AI充值业务/browser-mvp/README.md`
- `/Users/lemon/.codex/worktrees/9128/AI充值业务/browser-mvp/src/contracts.js`
- `/Users/lemon/.codex/worktrees/9128/AI充值业务/browser-mvp/src/shared-contract-adapter.js`
- `/Users/lemon/.codex/worktrees/9128/AI充值业务/browser-mvp/src/dispatch-store.js`
- `/Users/lemon/.codex/worktrees/9128/AI充值业务/browser-mvp/src/executor.js`
- `/Users/lemon/.codex/worktrees/9128/AI充值业务/browser-mvp/src/wal.js`
- `/Users/lemon/.codex/worktrees/9128/AI充值业务/docs/BROWSER_CURRENT_STATUS_2026-08-25.md`
- `/Users/lemon/.codex/worktrees/9128/AI充值业务/docs/BRFE_HANDOFF_2026-08-25.md`
