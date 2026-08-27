# Browser Session 上号机制静态分析报告（2026-08-21）

> 状态：静态证据已完成；真实网页登录尚未验证。
>
> 本次只读取本地扩展和仓库 legacy 代码，没有安装扩展、启动浏览器、访问 ChatGPT、使用真实 Session 或执行付款。

## 1. 目标与样本

目标是为 Browser Worker 确定一个最小、可验证、不会伪造登录状态的 Session 装载方案。

用户提供样本：

```text
/Users/lemon/Downloads/诺汇盛专用上号器 v1.1.0/
```

样本是一个未混淆的 Chromium Manifest V3 扩展，共 6 个文本文件、约 32KB。关键文件 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `manifest.json` | `b358cc42c79b5c33defba5245e4f09d7b156e56f77b9474040c2e9bf51e91276` |
| `popup.js` | `b0da9cfc8fff30a55161f45805f7ac96719091850eca550d2fb5e1c57150eca3` |
| `token.mjs` | `0191ca1fb00dd01a4fb3fc24b2f302f29ae9f9c8db76f714bbb29a95c232629b` |

## 2. 上号器的实际机制

扩展仅申请：

- `cookies` 权限；
- `https://chatgpt.com/*` 与其子域的 host permission。

没有发现远程请求、扩展存储、后台上传或第三方服务调用。其流程是：

1. 接收原始 Session Token、带名称 Cookie 或含 `sessionToken` 的 JSON；
2. 清理空白、零宽字符、引号和反斜杠；
3. 拒绝明显的 API Key 或 Bearer Token；
4. 选择 `__Secure-next-auth.session-token` 或 `__Secure-authjs.session-token`；
5. 通过 Chrome Cookie API 写入 `.chatgpt.com`，属性为 `path=/`、`secure=true`、`httpOnly=true`、`sameSite=lax`；
6. 清空输入框并打开 ChatGPT 首页。

本地执行 `token.mjs` 的无敏感 fixture 验证了四种分支：原始 token、命名 Cookie、Session JSON 均能解析，Bearer 输入会被拒绝。

## 3. 能复用和不能复用的部分

### 可复用

- 只使用 `sessionToken` 建立 Cookie 登录，不把 `accessToken` 冒充 Session Cookie；
- 同时兼容 NextAuth 和 Auth.js 两个 Cookie 名；
- 支持原始 token、命名 Cookie 和完整 Session JSON；
- 输入清理和明显错误类型拒绝；
- 写入后立即清空用户输入；
- 不使用扩展存储或外部服务保存 token。

### 不能直接作为生产 Worker 实现

- 扩展只确认 Cookie 被浏览器保存，没有确认服务器接受 Session；
- Cookie 存在不等于已经登录，更不等于登录了正确账号；
- 没有超长 Session Token 的 Cookie 分块处理；
- 没有账号 ID、邮箱和套餐状态比对；
- 没有租约、一次性凭据授权、执行检查点或审计；
- 需要人工安装浏览器扩展，不适合作为批量 Worker 的运行依赖。

结论：扩展是清晰、低风险的机制参考，但不应直接装进 Browser Worker。

## 4. 仓库 legacy 实现评估

根目录 `session-auth.js` 已包含更多能力：

- Playwright `BrowserContext.addCookies()` 注入；
- `__Secure-next-auth.session-token` 超长值按 3936 字符分块；
- Cookie header、cookies 数组、CSRF token 和 device ID 解析；
- `/api/auth/session` 在线校验；
- UI 登录状态探针和登录页识别。

但其 `installChatGptSession()` 还会：

- 拦截并伪造 `/api/auth/session`；
- 伪造 `/api/auth/csrf`；
- 向 ChatGPT/OpenAI/支付域请求添加 `Authorization: Bearer <accessToken>`；
- 把构造的 Session 写入页面 localStorage。

这些行为会让页面看起来已经登录，却不能作为真实 Cookie 会话被服务器接受的证据。新 Browser 主链路禁止整体复用该函数。

静态代码不能证明这些补丁的原始目的。结合仓库同时存在的菲律宾 `locale/timezone`、住宅代理建议和 `{session}` sticky proxy，可以合理推断：作者可能试图在跨地区 Session 经菲律宾出口进入 Checkout 时，减少登录重定向和前端会话丢失，并保持一次任务内的浏览器/出口一致性。该推断尚无独立提交说明或运行证据，不能直接写成已验证风控机制。

这些补丁可能影响前端导航和部分接受 Bearer 的请求，但被伪造的 `/api/auth/session` 仍只是当前 BrowserContext 看见的响应，不能单独证明 ChatGPT 服务端、Checkout 或支付系统已经接受该会话。因此不应删除其研究价值，也不能把“页面能继续走”直接当成真实登录或付款许可。

Bearer 注入是否改善跨地区场景、影响哪些端点、是否产生异常请求形态，必须通过非付款网络取证确认。最终成功证据仍必须来自服务器实际接受的账号/订阅状态和后续资金证据。

可以定点提炼并重新测试的函数思想：Cookie 规范化、超长分块、Playwright 注入、真实 `/api/auth/session` 校验和 UI 探针。auth API 伪造、Bearer 补丁和 bootstrap localStorage 不进入默认资金链；它们只允许在独立、默认关闭、无付款能力的实验 Context 中逐层测试。

## 5. 推荐的最小 Session Adapter

现有 `v1` 已经提供正确的业务输入底座：`session-validation.js` 要求完整 `user`、`account`、`accessToken`、`sessionToken` 和 `expires`，订单保存加密 Session，并单独冻结 `chatgpt_account_id`。这些字段足以构造 Browser 认证前的期望值。

当前 `workflow-repository.loadOrderContext()` 会在通用 Worker 进程内直接解密并返回整个 Session；隔离 Browser Worker 不应复制这种传输方式。实施时增加凭据代理，只向持有效 run 租约的 Worker 返回最小短时视图，并禁止把完整 Session 放进任务记录。

### 5.1 输入

新 Adapter 只从现有订单服务获取解密后的短时 Session 视图：

```typescript
interface BrowserSessionInput {
  orderId: string;
  expectedAccountId: string;
  expectedEmail?: string;
  sessionToken: string;
  cookies?: Array<{ name: string; value: string }>;
  deviceId?: string;
  sessionAcquisitionCountry?: string;
  sessionAcquiredAt?: string;
  accountHabitualCountry?: string;
  expiresAt: string;
}
```

输入不得从任务 JSON、环境变量或 Worker 日志传递。Worker 通过绑定 `runId + attemptId + workerId` 的短时 `credentialGrantId` 获取。

### 5.2 装载算法

1. 创建全新的临时 BrowserContext；
2. 校验 Session Token 非空、不是 access token、未过期且符合允许的字符范围；
3. 选择候选 Cookie 名和对应分块名称；
4. 使用 Playwright `context.addCookies()` 注入，属性固定且不写持久化 profile；
5. 访问真实 `/api/auth/session` 或等价只读会话端点；
6. 基线模式不安装 route fulfill、fetch patch、localStorage bootstrap 或 Bearer header；实验模式只能在另一个无付款能力的 Context 中安装单一变量；
7. 从真实响应提取账号 ID、用户 ID、邮箱和有效期；
8. 与订单冻结的 `expectedAccountId` 比对；
9. 再访问首页做 UI 登录探针；
10. 两层证据一致后返回 `AUTHENTICATED`，否则分类失败并销毁 Context。

### 5.3 Cookie 名兼容策略

Cookie 名不能长期硬编码成单一值。非付款 PoC 应验证：

1. 当前 Session 来源实际对应的 Cookie 名；
2. NextAuth 与 Auth.js 是否需要不同分块命名；
3. 未登录响应或页面是否能稳定识别当前 auth 栈；
4. 无法识别时，是否可以在两个全新 Context 中依次尝试候选名称并用真实会话响应确认。

禁止在同一个 Context 同时写两个不同名称后直接认定成功。任何候选尝试都必须在独立 Context 中进行，失败 Context 立即销毁。

### 5.4 输出

```typescript
type BrowserSessionBootstrapResult =
  | {
      outcome: 'AUTHENTICATED';
      accountId: string;
      userId?: string;
      email?: string;
      cookieFamily: 'NEXT_AUTH' | 'AUTHJS';
      sessionExpiresAt?: string;
    }
  | { outcome: 'SESSION_INVALID'; reasonCode: string }
  | { outcome: 'ACCOUNT_MISMATCH'; observedAccountId: string }
  | { outcome: 'HUMAN_REQUIRED'; reasonCode: 'LOGIN_REQUIRED' | 'CHALLENGE' }
  | { outcome: 'PAGE_CONTRACT_UNKNOWN'; signatureHash: string };
```

结果不得包含 Session Token、Cookie 值或 access token。

## 6. 安全与审计要求

- 每单新建 Context，不保存 persistent profile 或 storageState；
- Cookie 注入完成后，进程内明文引用尽快释放；
- 日志只能记录 Cookie family、分块数量和结果码，不能记录长度以外的 token 信息；
- Playwright trace、HAR、视频和 DOM dump 在 Session 装载阶段默认关闭；
- 真实会话响应只保存允许字段和响应 Schema 哈希；
- 账号不匹配时立即销毁 Context，订单进入可恢复/人工状态，不继续 Checkout；
- Cloudflare/验证码归类为 `HUMAN_REQUIRED`，不能伪造会话响应绕过；
- Session Adapter 只负责认证和账号比对，不负责付款或最终成功判断。

## 7. 当前事实与未验证项

### 已由静态证据确认

- 用户提供的扩展通过安全 Cookie 上号；
- 扩展不使用 access token 登录；
- 扩展兼容两个候选 Session Cookie 名；
- 本地 Playwright 1.59.1 支持 `BrowserContext.addCookies()`；
- legacy `session-auth.js` 含分块与真实 Session API 探针；
- legacy 同时包含不可复用的 auth API 伪造和 Bearer 注入。
- legacy 明确提供菲律宾 locale/timezone、住宅代理和按 session 固定出口的配置，证明区域/出口一致性是原方案的设计目标之一。

### 仍需非付款 PoC

- 当前 ChatGPT 接受的 Cookie 名和分块规则；
- 现有订单 `sessionToken` 是否足以建立网页登录态；
- 真实会话响应中稳定的账号 ID 字段；
- Session 是否绑定设备、地区、出口或其他 Cookie；
- 非菲律宾 Free 账号 Session 取得后切到菲律宾出口时，Session 获取国家、Session 年龄和账号常用国家分别产生什么影响；
- `SESSION_ONLY`、精选 Cookie/device bundle 与完整 `cookies[]` 的真实差异；
- Cloudflare/登录挑战的可重复分类；
- UI 登录探针和真实会话响应的一致性；
- Session 失效、被撤销和账号不匹配的实际页面/响应形态。
- 菲律宾出口登录远距离账号时，Cookie-only 与 auth overlay 两种模式的实际差异；
- 哪些真实请求接受 Cookie、哪些接受 Bearer，以及 overlay 是否只改变前端表现；
- 同一订单固定菲律宾出口后，登录、Checkout、3DS和取消续费能否保持同一网络身份。

## 8. 实施决策

采用“新建可分层验证的 Browser Session Adapter”方案：

- 以用户提供扩展的 Cookie 输入规则为参考；
- 以 legacy 的分块、Playwright 注入和真实只读验证思路为参考；
- 不安装扩展、不整体照搬 legacy `installChatGptSession()`；
- 默认从真实 Cookie 模式开始；把 auth overlay 与 Bearer 注入拆成独立、可观测、默认关闭的实验层，通过非付款 A/B PoC 判断其真实作用；
- 即使实验层帮助页面继续导航，也不能用伪造响应或 Cookie 存在作为真实登录成功证据；
- 通过非付款 PoC 冻结真实 Session 合同后再进入实现。

不联网的 Cookie 解析、分块、fixture 测试、三模式 PoC 骨架、route 顺序复现和无 Session 公开对照已经完成。下一实施边界是使用从非菲律宾 Free 测试账号取得的 Session，在固定菲律宾 sticky 出口执行真实只读 A/B；PoC 只到账号、套餐和升级入口，后续 Checkout 观察需另行扩大只读边界，始终不填写卡片、不点击付款。
