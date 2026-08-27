# 真实 Session / Chrome 观察记录（2026-08-26）

## 输入

用户在对话附件中提供了一份 Session JSON。只在本地临时脚本中读取首行 JSON，未写入仓库、日志或提交；报告不包含 token、Cookie、账号邮箱或完整响应。

## 执行命令

```bash
node /tmp/browser-real-session-smoke.mjs
```

脚本使用：

- 系统 Google Chrome control lane；
- 临时 persistent Profile：`/tmp/browser-real-session-profile`（运行后删除）；
- `CookieSessionBootstrapAdapter`；
- NextAuth session token 分块 Cookie 注入；
- 访问 `https://chatgpt.com/`；
- 同源探针 `/api/auth/session`；
- 只输出 HTTP 状态、页面标题、Cookie 名称和脱敏探针结果。

## 观察结果

```text
导航 HTTP：403
页面标题：请稍候…
页面 URL：https://chatgpt.com/
Cookie 名称：__Secure-next-auth.session-token.0、__Secure-next-auth.session-token.1、__cf_bm
/api/auth/session：HTTP 403
```

## 结论

- Session token 已按 NextAuth 分块规则写入 Profile；这只能证明 Cookie 注入动作完成。
- 当前运行被 Cloudflare/人机验证页面拦截，不能据此判断 Session 已失效，也不能证明账号身份不匹配。
- 真实账号身份、Checkout 页面结构和订阅状态仍未验证。
- 本次没有点击验证码、没有提交 Checkout、没有调用卡台或付款写接口。

## 后续动作

1. 使用用户可见的 headed Chrome 观察同一 Session 是否需要人工通过人机验证；
2. 通过后重新执行 `/api/auth/session` 身份核对；
3. 仅在身份核对成功后读取 Checkout 摘要；
4. 不启用真实付款写开关。

