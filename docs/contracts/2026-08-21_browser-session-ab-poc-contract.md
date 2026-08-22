# Browser Session 非付款 A/B PoC 合同与首轮证据

> 状态：PoC 工具、离线 route 顺序复现、Session Loader v2 和无 Session 公开对照已经完成；菲律宾 sticky 出口下的真实 Session 三模式实验尚未执行。本文不包含 OpenAI 内部风控规则的推测性定论。

## 目标与禁止动作

本 PoC 只回答三个问题：真实 Session Cookie 是否被服务器接受、前端兼容补丁是否改善页面连续性、legacy overlay 是否只是制造“看似登录”的 UI 证据。

运行时固定禁止：

- 读取或填写卡片；
- 点击升级、订阅或付款；
- 发送疑似 Checkout、支付、账单或订阅写请求；
- 把 Session、AccessToken、代理密码、账号邮箱或完整响应正文写入 evidence；
- 用页面渲染结果替代真实网络 Session 响应。

PoC 实现位于 `browser-poc/`，默认只允许无 Session 公开对照。真实 Session 运行必须显式设置 `BROWSER_POC_LIVE=1`。

## 三种实验模式

| 模式 | Cookie | bootstrap/localStorage | 页面 fetch auth 补丁 | Bearer 补充 | 真实证据来源 |
| --- | --- | --- | --- | --- | --- |
| `cookie-only` | 是 | 否 | 否 | 否 | BrowserContext 独立 request 探针 |
| `minimal-compat` | 是 | 是 | 否 | 否 | BrowserContext 独立 request 探针 |
| `legacy-overlay` | 是 | 是 | 是 | 是，auth/csrf 除外 | BrowserContext 独立 request 探针 |

三种模式使用新的 BrowserContext，但同一账号实验组必须复用相同 Session 指纹、Session 获取环境标记、sticky 代理会话标识和实际出口 IP。实验顺序应在账号之间轮换，不能让某一模式永远排在第一位。

Session Loader v2 在注入前主动清除 NextAuth/Auth.js 两组 Session Cookie 及所有分块，注入后再读 BrowserContext 验证最终集合。原始 Token 和仅含 `sessionToken` 的 JSON 不再猜测 Cookie 家族；输入同时包含两组 Session Cookie 时拒绝运行。

## 已证实的 legacy route 行为

旧 `session-auth.js` 依次注册精确 `/api/auth/session`、精确 `/api/auth/csrf` 和最后的 `**/*` route。最后一个 route 对 auth/csrf 调用 `continue()`。

本地最小复现命令：

```bash
npm run poc:browser-session:route-order
```

2026-08-21 实际结果：

```json
{
  "exactRouteCalls": 0,
  "catchAllRouteCalls": 1,
  "responseSource": "network",
  "conclusion": "CATCH_ALL_CONTINUE_BYPASSES_EARLIER_EXACT_ROUTE"
}
```

因此旧实现中精确 auth route 会被后注册总 route 越过。能够确定的实际效果是：

1. overlay 安装前，旧实现曾用真实网络访问 `/api/auth/session`；
2. overlay 安装后，页面主世界的 `window.fetch('/api/auth/session')` 会收到本地构造的 Session；
3. 不经过该 `window.fetch` 补丁的请求仍可能访问真实网络；
4. 非 auth/csrf 的 ChatGPT、OpenAI 和 pay 请求会被补充 Bearer；
5. 页面 fetch 证据与服务器 Session 证据可能互相矛盾。

这解释了旧 overlay 为什么可能改善页面流程，同时也证明不能用它自己的页面 auth 探针验收真实登录。

## 证据格式与结论门槛

每轮 evidence 同时保存：

- `probes.realBefore`：安装任何兼容层前的独立真实网络响应；
- `probes.pageSession`：页面环境看到的响应，可能受 overlay 影响；
- `probes.realAfter`：页面加载后的独立真实网络响应；
- `browserProfile.egress`：实际出口 IP 短指纹与国家代码；
- `safety`：付款写请求拦截数，以及未点击升级/付款的声明；
- `sessionArtifact`：Cookie 名和不可逆短指纹，不包含 Cookie 原值。
- `sessionLoader`：隔离模式、注入前 Cookie 数量、移除/应用/最终 Session Cookie 名；
- `expectedIdentity`：预期身份来源、不可逆短指纹和 `MATCH`/`MISMATCH`/`UNAVAILABLE` 结果。

只有 `realBefore` 和 `realAfter` 都含真实账号身份，才可认定服务器 Session 连续有效。页面识别账号但两个真实探针不认可时，结果固定为 `UI_ONLY_SESSION`。

三轮汇总器还会检查 Session 指纹、Session 获取环境、实验组、代理 Session、实际出口 IP 和菲律宾国家验证。任一不一致，结论为 `INCOMPARABLE`。

## 无 Session 公开对照结果

2026-08-21 使用 Playwright Chromium、`en-PH`、`Asia/Manila`、无代理、无 Session 运行：

- 实际出口被 Cloudflare trace 识别为 `US`，不是菲律宾；
- ChatGPT 首页导航返回 HTTP 403；
- 独立 `/api/auth/session` 返回 HTTP 200，但没有 `user` 或 `accessToken`；
- 页面 `/api/auth/session` 返回 HTTP 403；
- 没有登录 UI、升级入口或付款动作；
- 没有触发疑似付款写请求。

该轮只证明当前无代理对照不可作为菲律宾实验数据，并证明“auth API HTTP 200”不等于登录成功。它不能证明 403 是由账号、无代理、出口信誉、自动化环境或其他因素中的哪一项造成。

2026-08-22 使用 Session Loader v2 重跑公开对照，evidence schema 为 `2`。临时 Context 的预存 ChatGPT Cookie 和最终 Session Cookie 均为 `0`；独立 auth 探针仍为 HTTP 200 + `WARNING_BANNER` 且无服务器身份，页面 auth 为 HTTP 403。完整测试摘要见 `../2026-08-22_browser-session-loader-v2-test-report.md`。

## 菲律宾真实 Session 实验设计

业务常态已经确认为：Session 来自需要充值的 Free 账号，这些账号基本不是菲律宾账号；执行充值时才进入菲律宾 VPN。第一阶段因此按“Session 获取环境到菲律宾执行环境的距离”分组，每组先一份经授权 Session 做烟雾验证：

1. Session 在菲律宾周边的非菲律宾环境取得；
2. Session 在远距离非菲律宾环境取得；
3. Session 获取国家未知，作为独立未知组，不混入前两组。

每个账号按轮换顺序运行三种模式，全程使用同一 sticky 菲律宾代理会话。Executor 对该 Session 的第一次 ChatGPT 网络访问就必须走此菲律宾出口，禁止先从本地预检再切换。烟雾验证没有出现挑战升级或 Session 撤销后，再扩展到每组多个账号，统计：真实 Session 接受率、页面 UI 就绪率、403/429/挑战率、升级入口可见率、页面与真实证据矛盾率。

Session 获取国家、账号常用国家和 Session 获取后时长必须由运营输入，不能根据 Session、邮箱或当前 IP 猜测。三模式不得并行使用同一 Session，避免实验本身制造并发登录变量。

地域轴完成后，再单独比较三档 Session 材料：`SESSION_ONLY`、排除 Cloudflare 临时 Cookie/陈旧路由 Cookie 的 `CURATED`、以及 `FULL_EXPORT`。上号器只写单 Session Cookie，而 legacy 支持更多 Cookie 和 `oai-did`；公开项目又报告完整导出可能造成 Checkout 431 或携带旧出口状态。如果不拆轴，材料缺失或材料污染都会被错误归因于菲律宾跨区。

## 尚未证实

- 菲律宾 sticky 出口是否能稳定访问 ChatGPT 首页；
- 不同非菲律宾 Session 获取环境首次经菲律宾出口时的真实挑战差异；
- localStorage bootstrap 是否单独改善 UI；
- legacy Bearer 补充是否改变升级入口或只读请求结果；
- legacy overlay 是否降低登录重定向，还是只隐藏了真实失败；
- Checkout 创建、支付 iframe、币种和账单行为；本合同刻意不触发这些动作。

## 下一次运行所需输入

真实 A/B 烟雾实验需要：

- 一个菲律宾 sticky 代理模板，以及可固定的代理 Session ID；
- 至少一个经授权的测试 Session，包含真实 Session Cookie；
- 原始 Token 必须提供明确的 `BROWSER_POC_SESSION_COOKIE_NAME`，JSON `sessionToken` 必须包含 `sessionCookieName`；
- 建议提供预期账号身份的 `BROWSER_POC_EXPECTED_IDENTITY_SHA256` 和明确的 `email`/`id` 类型，避免有效 Session 串到错误账号；
- Session 文件必须位于仓库外且权限为 `0600`；sticky proxy、实验组和地域元数据缺一项时在启动浏览器前失败关闭；
- 若要运行 `legacy-overlay`，同一输入还需包含 `user` 与 `accessToken`；
- 人工标注 Session 获取国家、获取距离组 `NON_PH_NEAR`/`NON_PH_FAR`/`UNKNOWN`、Session 年龄区间，以及账号常用国家；

具体命令和脱敏规则见 `browser-poc/README.md`。
