# Browser Session Loader v2 测试报告

> 状态：本地实现、真实 Chromium 隔离测试和无 Session 公开对照已通过；菲律宾 sticky 出口与真实非菲律宾 Free 账号 Session 的动态 A/B 尚未执行。没有读取卡片、点击升级或发起付款。

## 本轮完成内容

Session Loader v2 已实现以下硬约束：

- 原始 Token 不再默认猜成 NextAuth；必须显式提供 Cookie 名；
- JSON 中只有 `sessionToken` 时必须同时提供 `sessionCookieName`；
- 同一输入同时出现 NextAuth 与 Auth.js Session Cookie 时直接拒绝；
- 每轮使用新的临时 BrowserContext；
- 注入前清除两种 Session Cookie 及其分块；
- 注入后重新读取 BrowserContext，确认最终 Session Cookie 集合与请求集合完全一致；
- 可通过预期身份 SHA-256 + `email`/`id` 类型，或 Session JSON 的 `user` 字段核对服务器返回身份；
- 身份不一致、无法核对或同轮发生变化均为禁止继续的独立终态；
- evidence schema 升级到 `2`，只记录 Cookie 名、数量、身份类型和不可逆身份短指纹；同时存在 user id 与邮箱时优先使用更稳定的 user id。
- 真实运行前强制 Session 文件位于仓库外且权限为 `0600`，并要求 sticky proxy、实验组和地域元数据齐全。

实现位置：

- `browser-poc/session-loader.js`
- `browser-poc/session-ab-core.js`
- `browser-poc/session-ab-poc.js`
- `test/browser-session-ab-poc.test.js`

## 本地测试结果

运行：

```bash
npm run test:legacy -- --reporter=verbose
```

结果：

```text
Test Files  3 passed (3)
Tests       26 passed (26)
```

其中真实启动 Playwright Chromium 的测试先在同一 Context 写入旧 NextAuth 和 Auth.js Session Cookie，再装载一个新 Auth.js Session。测试确认：

```json
{
  "preexistingSessionCookieCount": 2,
  "removedSessionNames": [
    "__Secure-authjs.session-token",
    "__Secure-next-auth.session-token"
  ],
  "finalSessionNames": [
    "__Secure-authjs.session-token"
  ],
  "conflictFree": true
}
```

该测试验证的是 BrowserContext 内真实 Cookie 行为，不是只测字符串过滤。

完整项目回归也已运行：v1 `313` 项中 `287` 通过、`0` 失败、`26` 项因本机未配置隔离 MySQL 而跳过；Browser/legacy `26` 项全部通过。

## 公开浏览器对照

运行：

```bash
npm run poc:browser-session:public
```

2026-08-22 本地时间得到 schema v2 evidence：

| 项目 | 结果 |
| --- | --- |
| Profile | `EPHEMERAL_BROWSER_CONTEXT` |
| 预存 ChatGPT Cookie | `0` |
| 最终 Session Cookie | `0` |
| 实际出口 | `US`，不是菲律宾 |
| 独立 auth 探针（前） | HTTP 200，只有 `WARNING_BANNER`，没有服务器身份 |
| 页面 auth 探针 | HTTP 403，没有服务器身份 |
| 独立 auth 探针（后） | HTTP 200，只有 `WARNING_BANNER`，没有服务器身份 |
| 升级/付款动作 | 均未执行 |
| 付款写请求 | `0` |

该结果再次证明 HTTP 200 不能作为登录证据，也证明新版 Loader 的公开对照没有 Profile/Cookie 残留。因为出口是 US，本轮不能进入菲律宾实验统计。

## 新增结果分类

| 结果 | 含义 | 处置 |
| --- | --- | --- |
| `SESSION_IDENTITY_MISMATCH` | Session 有效，但服务器账号不是预期账号 | 严禁进入 Checkout |
| `SESSION_IDENTITY_UNVERIFIED` | Session 有效，但响应缺少可比对身份 | 严禁进入 Checkout |
| `SESSION_IDENTITY_CHANGED` | 同一轮前后服务器身份不同 | 封存 evidence，人工调查 |

身份核对优先使用仓库外预先计算的完整 SHA-256，并显式指定类型：

```bash
printf '%s' 'test-account@example.test' | shasum -a 256
export BROWSER_POC_EXPECTED_IDENTITY_KIND=email
```

将输出的 64 位十六进制值放入 `BROWSER_POC_EXPECTED_IDENTITY_SHA256`。如果使用 user id，则把类型改为 `id` 并对 user id 原文计算 SHA-256。evidence 仅保存前 16 位短指纹和类型，不保存邮箱或账号原值。

## 当前阻塞条件

本机环境中以下真实实验输入均未配置：

- `BROWSER_POC_SESSION_FILE`；
- `BROWSER_POC_PROXY_URL`；
- `BROWSER_POC_PROXY_SESSION_ID`；
- `BROWSER_POC_EXPECTED_IDENTITY_SHA256`；
- `BROWSER_POC_EXPECTED_IDENTITY_KIND`；
- `BROWSER_POC_RUN_GROUP_ID`；
- Session 获取国家/距离组、年龄区间和账号常用国家四项实验元数据。

因此不能伪造“菲律宾真实 Session 测试已完成”。取得一个经授权的非菲律宾 Free 测试 Session 和菲律宾 sticky proxy 后，下一步按 `SESSION_ONLY`、`CURATED`、`FULL_EXPORT` 顺序运行；全程仍停在卡片输入之前。
