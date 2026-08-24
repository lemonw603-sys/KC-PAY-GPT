# Session Cookie 家族 A/B 只读证据（2026-08-22）

## 范围

对安全收件箱编号 `4f1f0e71f65b4e9290060f63` 对应的测试材料进行本地临时解密，并在两个独立临时 Chromium BrowserContext 中分别注入候选 Session Cookie 家族。材料正文、Token、邮箱、账号 ID 和 Cookie 值不进入本报告。

## 固定输入

- Browser：Playwright Chromium，临时 BrowserContext；
- locale：`en-PH`；timezone：`Asia/Manila`；
- 网络：当前 `NON_PH_FUNCTIONAL`，无代理；
- 页面动作：仅打开首页、读取独立 `/api/auth/session`；
- 安全：无卡片、无 Checkout 创建、无付款、非 GET 支付/订阅请求拦截；

## 结果

| Cookie 家族 | 注入结果 | `/api/auth/session` | 身份字段 | 页面结果 |
|---|---|---:|---|---|
| `__Secure-authjs.session-token` | 分块 Cookie 成功注入 | HTTP 200 | 仅 `WARNING_BANNER`，无 `user`/`accessToken` | HTTP 403，挑战页 |
| `__Secure-next-auth.session-token` | 分块 Cookie 成功注入 | HTTP 200 | 有 `user`、`account`、`accessToken`、`sessionToken` 等完整字段 | HTTP 403，挑战页 |

## 结论

当前 Session 的正确 Cookie 家族为 `__Secure-next-auth.session-token`。该结论来自同一材料、同一运行基线、独立网络事实的差异，不依赖 Cookie 存在徽标，也不依赖页面文字。

页面 HTTP 403/挑战页是当前网络下的页面可达性限制，不能推翻独立 Session 接口已经确认的 Cookie 家族；它也不能被解释为菲律宾出口或付款风险结论。

## 后续

1. 以 `next-auth` 进入非付款观察器的下一轮身份/页面证据收集；
2. 观察结束后进行 cohort 级对抗式审查；
3. 菲律宾出口到位后新建 PH manifest/cohort，不覆盖本报告。

## 正式 NON_PH_FUNCTIONAL 重跑

同一 Session 以 `next-auth` 进入正式只读观察器，脱敏证据已写入：

`artifacts/browser-poc/nonph-functional-2026-08-22T09-23-48-422Z.json`

结果：独立 Session 接口前后均 HTTP 200 且身份存在；页面导航 HTTP 403；付款变更拦截计数为 0。该 artifact 仅保存脱敏字段和 opaque Session 引用，不保存 Token/Cookie/正文。
