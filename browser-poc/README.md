# Browser Session 非付款 A/B PoC

> 安全边界：本工具不接订单、不读取卡片、不点击升级、不填写付款表单。所有疑似付款写请求都会被浏览器路由拦截。真实 Session 运行必须显式打开 `BROWSER_POC_LIVE=1`。

这个 PoC 用同一个菲律宾浏览器画像和同一个 sticky 代理会话，比较 `cookie-only`、`minimal-compat` 和 `legacy-overlay`。它同时采集浏览器页面看到的 Session 与绕过页面补丁的真实网络 Session，避免把伪造 `/api/auth/session` 当成服务器登录成功。

`checkout-link-core.js` 另提供纯离线的 hosted Checkout 合同：只把带权威 fragment 的 `pay.openai.com`/`checkout.stripe.com` 链接记为 `HOSTED_LINK_READY`；`chatgpt.com/checkout/...` 明确记为依赖账号 Session 的回退；付款可能已提交后只允许对账，不允许重新提链或打开。对应测试不访问网络、不创建 Checkout。

PoC 不再把所有方向堆入同一个脚本。原上号器、ChatGPT 站点状态克隆+CDP、Loader 同 Context、hosted 分离 Context 和页面 Context hosted 的边界、公共实验轴及淘汰规则见 [`lanes/README.md`](lanes/README.md)。

## 运行离线控制面

离线 runner 使用合成账号、合成 hosted URL、内存加密 artifact vault 和 mock gateway，不启动浏览器、不访问网络：

```bash
npm run poc:browser-experiment:offline
```

默认模拟 `PAYMENT_UNKNOWN`，用于证明同一模拟提交只消费一次、原始 hosted authority 不进入输出、未知状态不触发 fallback 或第二次 Checkout。实现入口：

- `experiment-core.js`：实验 scope、runtime manifest、账号/Checkout 租约、cohort 隔离、artifact vault、控制权转移和预路由；
- `mock-gateway.js`：safe decline、unknown、success、3DS 和 cancellation pending；
- `run-offline-experiment.js`：可重复的端到端合成演示。

验证进程重启和 WAL 恢复：

```bash
npm run poc:browser-experiment:wal
```

该命令把合成 run 的四个公开检查点写入 `0600`、带哈希链的临时 JSONL WAL，再用新实例读取并恢复。默认结果必须是 `PAYMENT_UNKNOWN → RECONCILE_ONLY`，且恢复后仍禁止创建 Checkout 或再次提交付款。

## 运行本地 Browser 页面仿真

`mock-browser-server.js` 提供合成账号页、Checkout 页和 payment iframe，只监听随机的 `127.0.0.1` 端口。它不读取 Session、不访问 ChatGPT/Stripe、不接卡台，表单只接受合成测试值。Playwright 测试覆盖：

- 不同 BrowserContext 的站点状态隔离；
- 模拟提交已被服务端消费但连接丢失，页面进入 `PAYMENT_UNKNOWN` 且禁止第二次提交；
- 同一授权引用继续 3DS，不产生第二次付款提交；
- 权益确认后独立取消，最终到达 `DELIVERY_COMPLETE`。

```bash
npm run test:browser-poc
```

当前本地页面用于验证控制流，不代表真实站点定位器、菲律宾网络或支付链路已验收。

页面仿真还覆盖 popup Checkout 和页面签名漂移。`local-mock-page-adapter.js` 只有在产品、PHP 金额和 payment iframe 三项签名同时匹配时才返回 `CHECKOUT_SIGNATURE_VALID`；漂移返回 `PAGE_SIGNATURE_MISMATCH`，不得定位或提交付款。

## 运行 WAL-backed 编排和容量仿真

`wal-backed-experiment.js` 在每次可变操作前写入 `OPERATION_PREPARED`，内存动作成功后再写领域完成事件。付款额外在调用 gateway 前写入 `PAYMENT_SUBMITTING`；进程在任一中间点退出，重启后都不会重新提交同一 operation ID。

```bash
npm run poc:browser-experiment:capacity
```

固定 350 单合成负载的当前证据为：350 次 submit、0 次重复、3710 条 WAL 事件、1,991,456 bytes、约 38.14 秒。它是 24 小时业务量的等效负载，不是连续运行 24 小时的 soak 测试。

旧实现的 route 注册顺序可以完全离线复现：

```bash
npm run poc:browser-session:route-order
```

该复现证明后注册的 `**/*` route 调用 `continue()` 时，不会再执行先注册的精确 auth route。因此本工具的 `legacy-overlay` 按旧代码的实际行为复刻：auth 网络请求透传，页面级 `window.fetch` 返回本地 Session；两种证据必须分开分析。

## 先运行公开对照组

公开对照组不使用 Session、代理或账号：

```bash
node browser-poc/session-ab-poc.js --public-control --mode cookie-only
```

结果写入 `artifacts/browser-poc/`，文件权限为 `0600`。证据只保存 Cookie、代理和账号标识的 SHA-256 短指纹，不保存原值、响应正文或页面截图。

## 准备真实 Session 对照

把一个经授权的测试 Session 保存到仓库外，例如 `/secure/browser-poc/session.json`。支持：

- `__Secure-next-auth.session-token`；
- `__Secure-authjs.session-token`；
- 浏览器导出的 `cookies[]`；
- 同时含 `sessionToken`、`accessToken` 和 `user` 的完整 Session JSON。

原始 Token 无法判断属于 NextAuth 还是 Auth.js，改良版 Loader 不再猜测：原始 Token 必须同时设置 `BROWSER_POC_SESSION_COOKIE_NAME`；JSON 的 `sessionToken` 必须自带 `sessionCookieName`。如果导出材料同时包含两种 Session Cookie 家族，PoC 会直接拒绝。

不要把 Session 文件、代理密码或 evidence 原始响应提交到 Git。

真实实验还会强制检查：Session 文件位于仓库外且权限为 `0600`；菲律宾 proxy、sticky Session ID、实验组、Session 获取环境、年龄分组、账号常用国家和预期账号身份均已显式提供。缺一项就会在启动浏览器前失败关闭。

## 运行三组实验

每个账号的三组实验必须复用相同的 `BROWSER_POC_PROXY_SESSION_ID`，并在较短时间窗口内完成：

```bash
export BROWSER_POC_LIVE=1
export BROWSER_POC_SESSION_FILE=/secure/browser-poc/session.json
export BROWSER_POC_PROXY_URL='http://user-{session}:password@proxy.example:8000'
export BROWSER_POC_PROXY_SESSION_ID='poc_order_001'
export BROWSER_POC_RUN_GROUP_ID='account_001_round_001'
export BROWSER_POC_SESSION_ACQUISITION_COUNTRY='US'
export BROWSER_POC_SESSION_ACQUISITION_CLASS='NON_PH_FAR'
export BROWSER_POC_SESSION_AGE_BUCKET='LT_1H'
export BROWSER_POC_ACCOUNT_HABITUAL_COUNTRY='US'
export BROWSER_POC_COOKIE_POLICY='SESSION_ONLY'
export BROWSER_POC_SESSION_COOKIE_NAME='__Secure-authjs.session-token' # 仅原始 Token 输入需要
# 可选：预期账号邮箱的完整 SHA-256，不在证据中保存原值
export BROWSER_POC_EXPECTED_IDENTITY_SHA256="$(printf '%s' 'test-account@example.test' | shasum -a 256 | awk '{print $1}')"
export BROWSER_POC_EXPECTED_IDENTITY_KIND='email'

node browser-poc/session-ab-poc.js --mode cookie-only
node browser-poc/session-ab-poc.js --mode minimal-compat
node browser-poc/session-ab-poc.js --mode legacy-overlay
```

`legacy-overlay` 只有在输入同时包含真实 Cookie、`accessToken` 和 `user` 时才运行。三种模式都不会点击升级入口；本阶段只记录入口是否可见。

三轮完成后生成可比性结论：

```bash
node browser-poc/summarize-ab.js \
  artifacts/browser-poc/<cookie-only.json> \
  artifacts/browser-poc/<minimal-compat.json> \
  artifacts/browser-poc/<legacy-overlay.json>
```

如果三轮的 Session 指纹、Session 获取环境、sticky proxy 会话、实际出口 IP、菲律宾国家验证或实验组编号不一致，汇总器返回 `INCOMPARABLE`，不得从结果推导风控结论。

## 判读结果

| 结果 | 含义 | 是否可进入资金链 |
| --- | --- | --- |
| `SERVER_SESSION_VALID` | overlay 前后真实网络探针均识别账号，页面探针也识别账号 | PoC 仍然不可进入 |
| `SERVER_SESSION_UI_UNREADY` | 服务器接受 Session，但页面未形成可靠登录 UI | 不可进入 |
| `UI_ONLY_SESSION` | 页面或 overlay 显示已登录，真实网络探针不认可 | 严禁进入 |
| `SESSION_CHALLENGED` | 网络探针出现挑战信号 | 不可进入 |
| `SESSION_ACCESS_DENIED` | 真实网络探针返回 401、403 或 429 | 不可进入 |
| `SESSION_REJECTED` | Session 未被服务器认可 | 不可进入 |
| `SESSION_IDENTITY_MISMATCH` | 服务器接受了 Session，但不是预期账号 | 严禁进入 |
| `SESSION_IDENTITY_UNVERIFIED` | 服务器接受 Session，但返回材料不足以核对预期账号 | 严禁进入 |
| `SESSION_IDENTITY_CHANGED` | 同一轮前后服务器身份发生变化 | 严禁进入 |

核心对比字段是 `probes.realBefore`、`probes.pageSession`、`probes.realAfter`。只有 `realBefore` 和 `realAfter` 都成立，才说明页面补丁之外的服务器 Session 连续有效。

## 当前限制

- 还没有验证真实菲律宾出口，也没有运行任何真实 Session；
- `minimal-compat` 当前只写入 legacy bootstrap session，不伪造 auth 请求、不注入 Bearer；
- 本阶段不点击升级，因此尚不能回答 Checkout 创建接口和支付 iframe 的行为；
- 业务常态是从非菲律宾 Free 账号取得 Session，再在菲律宾出口执行充值。Session 获取国家、获取后时长、账号常用国家和菲律宾执行出口必须分别记录，不能合并成“账号来源地”。
- Cookie 材料分为 `SESSION_ONLY`、`CURATED`、`FULL_EXPORT`。`CURATED` 排除 Cloudflare 临时 Cookie 和已知陈旧路由 Cookie，但保留 Session、device 与其他 ChatGPT Cookie；三档必须作为第二实验轴，不能把差异误归因于地域。
- `browserProfile.egress.countryVerifiedAsPhilippines` 必须为 `true`，否则该轮不能计入菲律宾实验组。
- 每轮使用新建的临时 BrowserContext；注入前主动清除 NextAuth/Auth.js 两组 Session Cookie 及分块，再验证最终只剩当前输入家族。Cookie 清理证据记录在 `sessionLoader`，不记录 Cookie 值。
