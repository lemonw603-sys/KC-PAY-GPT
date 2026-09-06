# Browser 自动化充值公开实现调研报告

> 结论状态：2026-08-21 已完成第一轮 GitHub、X、官方 Playwright/Stripe 文档和公开项目源码调研。所有外部实现只作为设计证据，不代表已在本项目、菲律宾出口或真实付款环境验证。

## 结论摘要

公开实现没有一套可以直接照搬的标准答案，但出现了六个稳定模式：

1. Session Cookie、完整 Cookie 导出和精选 Cookie bundle 都有人使用，效果相互矛盾；
2. 多个实现不依赖升级按钮，而是在已登录页面内取得真实 AccessToken，再创建官方 Checkout；
3. Checkout 同时存在 `hosted` 和 `custom` 两种 UI 路线，公开实现多数因页面问题转向 `custom`，但它的维护面和支付状态复杂度更高；
4. 有头真实 Chrome/CDP、Xvfb、Camoufox 和 BitBrowser profile 被广泛用于提高浏览器环境连续性；
5. 代理通常按账号或 profile 隔离，并统计出口成功率；随机轮换 IP 不是主流稳定方案；
6. 很多公开脚本在资金安全上不合格：超时后自动换卡重提、日志保存卡号/CVV、仅凭 URL 包含 success 判断成功。

本项目应吸收“会话材料分层、页面内 Checkout discovery、每单 profile/代理绑定、浏览器后端可替换、结构化失败统计”，继续保留自身更严格的 MySQL 资金栅栏、结果未知锁定和敏感证据边界。

## 调研来源与可信度

| 来源 | 固定版本/日期 | 实际核对内容 | 许可证/采用限制 |
| --- | --- | --- | --- |
| [easy-chan/ABCard-ts](https://github.com/easy-chan/ABCard-ts/tree/c934141c5cd2ab9cab876b8f69ad9394349dc3bb) | `c934141`，2026-03-17 | Checkout API、device/sentinel、真实 Chrome CDP、Stripe Elements、Xvfb/SwiftShader | README 声明 MIT；只吸收设计，不复制实现 |
| [Mac-XK/gpt2api](https://github.com/Mac-XK/gpt2api/tree/4400bf1dc6d3ef52176af89a28455b4abf33f15a) | `4400bf1`，2026-05-16 | Cookie 归并/清理、页面内 Checkout API、custom Checkout、网络 trace、自动重试 | 未发现明确 LICENSE；禁止复制代码 |
| [kacalayar/Autoplus](https://github.com/kacalayar/Autoplus/tree/2ff03de1f42e3e32a336ed309373f1a0ef5e92e6) | `2ff03de`，2026-06-02 | Camoufox/BitBrowser 后端、profile 池、代理池、并发任务、统计 | AGPL-3.0；禁止把实现并入当前项目 |
| [3mora2/ChatGPTPlaywright](https://github.com/3mora2/ChatGPTPlaywright/tree/7e0ac2bb4e7bde1fe4b1da3e7e997764684e05cd) | `7e0ac2b`，2024-01-29 | 单 Session Cookie 注入、代理、独立 Context、Session 更新 | GPL-3.0，且实现较旧；只作为历史对照 |
| [菲律宾 Checkout 浏览器内脚本](https://github.com/hvoyai/chinaGPTClaude) | 2026 年公开内容 | 真实页面 `/api/auth/session` → PH/PHP Checkout → 官方 Checkout 页面 | 教程性质、无批量/恢复证明 |
| [OpenCLI Auth.js Cookie issue](https://github.com/jackwener/OpenCLI/issues/2087) | 2026 年 issue | 真实 `/api/auth/session` 已有 user，但代码因只认 legacy Cookie 名误判未登录 | 单一报告，支持双 Cookie family 兼容 |
| [Playwright authentication](https://playwright.dev/docs/auth) | 读取于 2026-08-21 | storageState 覆盖 Cookie、localStorage、IndexedDB；认证状态文件属于高敏凭据 | 官方文档，可作为能力事实 |
| [Stripe Checkout UI modes](https://docs.stripe.com/api/checkout/sessions/create) | 读取于 2026-08-21 | `hosted`、`embedded`、`custom` 的正式语义 | 官方文档，可作为支付状态模型事实 |
| [Stripe 3DS 状态](https://docs.stripe.com/payments/3d-secure/authentication-flow?api-integration=checkout-session-api) | 读取于 2026-08-21 | `requires_action`、`processing`、`requires_payment_method`、`succeeded` 不能混为一类 | 官方文档，可作为结果分类事实 |

X 使用多组中英文关键词检索，但没有找到能核对源码、配置与运行证据的 ChatGPT Plus 批量 Browser 技术原帖；结果主要是支付营销或泛讨论，因此本轮不把 X 内容写入技术结论。

## 可迁移的新思路

### 分离 Cookie 材料策略

`ChatGPTPlaywright` 证明“单 Session Cookie 注入”是一种常见基线；`gpt2api` 则接收多 Cookie，但主动排除 `__cf*`，并在 Checkout 前清理 callback、route、client-auth 等 Cookie。后者的源码还专门识别 HTTP 431。

这意味着完整 Cookie 并不天然优于单 Cookie：

- Cloudflare Cookie 可能绑定原 Session 获取出口，带到菲律宾可能反而冲突；
- 陈旧路由 Cookie 可能增大请求头或把 Checkout 导向旧状态；
- `oai-did`、`_puid`、`oai-sc` 等又可能对设备/会话连续性有帮助；
- 超长 Session 分块需要先合并或保持正确 family，不能重复注入。

PoC 已新增三档策略：

| Policy | 内容 | 目的 |
| --- | --- | --- |
| `SESSION_ONLY` | 只注入 Session Cookie family | 最小基线 |
| `CURATED` | 排除 Cloudflare 临时 Cookie和已知陈旧路由 Cookie，保留其他 ChatGPT Cookie | 测试“足够上下文但不携带原出口临时状态” |
| `FULL_EXPORT` | 注入完整 ChatGPT Cookie 导出 | 仅作为对照，不作为默认 |

### 将 Checkout discovery 从页面定位中解耦

多个公开实现和菲律宾教程都在已登录 ChatGPT 页面内读取真实 AccessToken，然后调用 `/backend-api/payments/checkout`。这种方式的价值不是绕过服务器认证，而是降低升级按钮 A/B、文案和 DOM 漂移造成的失败。

本项目可增加 `CheckoutDiscoveryAdapter`：

- `UI_ENTRY`：从官方升级入口进入，作为兼容回退与页面合同验证；
- `IN_PAGE_API_HOSTED`：在真实登录页面主世界创建 `hosted` Checkout；
- `IN_PAGE_API_CUSTOM`：只用于非付款可达性实验，不直接进入默认资金链。

创建 Checkout 虽不扣款，但属于外部写操作。它必须使用独立的 `CHECKOUT_OBSERVATION_PERMIT`，与一次性 `PAYMENT_PERMIT` 分离；前者永远不能解锁卡片填写或确认付款。

Checkout URL 不应硬编码 `openai_llc`。公开实现已经出现不同 processor/entity；应优先使用服务端返回的 URL或 processor 字段，并记录响应 schema 版本。

### 让浏览器后端成为实验变量

公开项目常见三类后端：

- Playwright Chromium headless；
- 有头真实 Chrome，通过 CDP 接管并运行在 Xvfb；
- Camoufox/BitBrowser 等带 profile 的浏览器。

公开 README 对“通过率”的描述没有独立统计证明，不能直接当结论。但“浏览器后端必须可替换、profile 不能并发共享”值得采用。

建议顺序：先比较 Playwright headless 与 headed Chrome/CDP；只有两者都无法稳定通过菲律宾只读 PoC 时，再评估 Camoufox。BitBrowser 需要额外桌面服务和 profile 运维，不作为首版依赖。

### 每单可恢复 profile，而不是跨账号共享 profile

Autoplus 为并发 Worker 分配独占 profile，避免多个任务共用 Chromium 进程。Playwright 官方还确认 storageState 能覆盖 Cookie、localStorage 和 IndexedDB。

本项目采用更严格的语义：

- profile 只绑定一个订单/账号；
- 同一订单崩溃恢复可恢复同一 profile 与 sticky 代理；
- profile 不跨客户复用；
- storageState 或 user-data-dir 必须加密、短期保存、任务结束销毁；
- profile 租约持久化在 MySQL，不能只靠进程内计数。

### 用代理统计指导调度，但不自动换出口重试

公开项目普遍记录代理成功/失败并降低高风险出口的使用率。对本项目有价值的是“代理健康度”和“同单稳定”，不是运行中随机换 IP。

建议记录：

- 菲律宾出口 IP/ASN/代理供应商的不可逆指纹；
- Session 获取地到菲律宾的距离组；
- 每个出口的真实 Session 接受率、403/429/挑战率、Checkout 可达率；
- 账号级和出口级失败聚类。

同一订单一旦开始，不因 403、页面超时或挑战自动换出口；换出口必须生成新的实验 run，并保留旧 run 证据，避免把两种网络身份混成一次充值。

## 明确不采纳的公开做法

### 付款超时后自动换卡重提

`gpt2api` 支付循环在等待约 30 秒无响应后可自动换卡并再次提交。对代充资金系统，这是不可接受的：第一次提交可能已经产生授权或处于 `processing`，第二次提交可能形成重复付款。

本项目继续执行：任何已点击付款但结果不明确的情况进入 `PAYMENT_UNKNOWN`，禁止自动换卡、换浏览器、换代理或再次点击。

### 在日志和 trace 中保存卡片明文

部分公开实现把完整卡号、CVV、地址写入日志、结果对象和网络 trace。本项目禁止采用：卡片输入期间关闭 trace/HAR/视频/DOM dump，普通日志最多保存卡后四位和卡片内部引用。

### 仅凭 URL 文本判断成功

部分实现把 URL 含 `success`、`thank`、`complete` 当作成功。Stripe 官方状态模型表明，3DS 后仍可能处于 `processing`、`requires_action` 或失败状态。

本项目成功仍需组合：页面明确结果、真实 Plus 状态、HNSKJ 卡交易/余额和取消续费结果。任何矛盾进入对账，不重新付款。

### 把反检测声明当作运行事实

README 中“有头通过率高”“住宅代理一定通过”“SwiftShader 可解决 hCaptcha”等均是项目作者经验声明，不是可迁移合同。它们只能变成实验变量，不能变成生产默认值。

## 下一轮测试矩阵

为避免组合爆炸，按顺序筛选，不一次跑完所有组合：

1. 固定一个非菲律宾 Free 测试 Session、一个菲律宾 sticky 出口和 `cookie-only`，比较 `SESSION_ONLY`、`CURATED`、`FULL_EXPORT`；
2. 使用最佳 Cookie policy，比较 `cookie-only`、`minimal-compat`、`legacy-overlay`；
3. 使用最佳 Session 模式，比较 Chromium headless 与 headed Chrome/CDP；
4. 取得独立 Checkout observation 许可后，比较 `UI_ENTRY` 与 `IN_PAGE_API_HOSTED` 的 Checkout 可达性；
5. `custom` 只观察 schema/iframe，不填写卡片、不确认付款；
6. 烟雾验证通过后，再扩展到 `NON_PH_NEAR`、`NON_PH_FAR` 和 Session 年龄分组。

每一阶段都必须保持同一 Session 指纹、同一 sticky proxy Session、同一实际菲律宾出口和同一浏览器版本。上一阶段没有稳定结论时，不进入下一阶段。

## 当前可执行结论

- 保留 Browser 主执行路线，不切回纯协议付款；
- 优先研究“真实页面 Session + 页面内 hosted Checkout discovery + 官方页面接管”；
- 新增精选 Cookie bundle，而不是盲目导入完整 Cookie；
- 浏览器 backend、Cookie policy、auth overlay 和 Checkout discovery 必须各自独立版本化；
- 外部项目不能替代现有订单、卡片、资金栅栏、审计和异常恢复；
- 真实菲律宾 Session/Checkout 结果仍需本项目自己的非付款 PoC 才能冻结。
