# Session 上号器与指纹浏览器运行时事实（2026-08-26）

## 结论先行

此前把 `SessionProviderPort` 直接解释成“上号器/Session broker”不准确，现更正：

- 现有“诺汇盛专用上号器”是一个本地 Chromium Manifest V3 扩展，核心能力是把用户提供的 Session Cookie 写入 `chatgpt.com`，不是 API、不是凭据租约服务、不是账号验证器，也不是指纹浏览器。
- 它没有浏览器指纹配置、代理绑定、Profile 租约、账号核验、Checkout 处理或审计能力；不能原样作为批量 Browser Worker 的上游服务。
- 项目旧 Browser 代码另有 `session-auth.js`、`browser-runtime.js`、`browser-pool.js` 和 Stealth 插件。这些是独立的 Cookie 注入、浏览器运行时、代理和进程池能力，不能与上号器混称。
- 当前项目没有发现已安装或已接入的商业指纹浏览器。已有实现是 `playwright-extra + puppeteer-extra-plugin-stealth`、locale/timezone、代理和本地 Profile/Browser Pool；这不等于商业指纹浏览器。

## 已验证的上号器能力

样本：`/Users/lemon/Downloads/诺汇盛专用上号器 v1.1.0/`

已读取 `manifest.json`、`popup.js`、`token.mjs`、README：

1. 仅申请 `cookies` 权限和 `chatgpt.com` host 权限；
2. 支持 `__Secure-next-auth.session-token`、`__Secure-authjs.session-token`；
3. 支持原始 token、命名 Cookie、包含 `sessionToken` 的 JSON；
4. 清理空白、零宽字符、引号和反斜杠；
5. 拒绝明显的 API Key/Bearer 输入；
6. 通过 `chrome.cookies.set()` 写入安全 Cookie，然后打开 ChatGPT；
7. 不使用远程服务、扩展存储或第三方上传；
8. 只检查 Cookie 是否写入成功，不确认服务器是否接受会话，也不核对登录账号、套餐或 Checkout 状态。

因此，上号器真正可复用的是**输入解析和 Cookie 写入规则**，不是“完整登录能力”。

## 旧项目中可复用但必须拆开的能力

### `session-auth.js`

已发现：

- Playwright `BrowserContext.addCookies()` 注入；
- NextAuth 超长 Session Cookie 分块；
- Cookie header/cookies 数组解析；
- 真实 `/api/auth/session` 探针和 UI 登录探针；
- 账号 ID、邮箱、用户 ID 期望值核对所需的辅助代码。

不可直接复用：

- 伪造 `/api/auth/session`、`/api/auth/csrf`；
- 注入 `Authorization: Bearer`；
- localStorage bootstrap；
- 把页面“看起来已登录”当成服务器已接受会话。

### `browser-runtime.js` / `browser-pool.js`

已发现：

- standalone Chromium 冷启动；
- Browser Pool 常驻 Chromium + CDP；
- 每单 `newContext()` 的 Cookie/Storage 隔离意图；
- 代理、locale、timezone 配置；
- `playwright-extra` 和 `puppeteer-extra-plugin-stealth`。

注意：Browser Pool 复用 Chromium 进程和磁盘槽位，不能自动证明跨订单所有站点状态都已隔离；必须验证 Profile、缓存、Service Worker、代理和 Session 的生命周期。

## 指纹浏览器事实与项目关系

### 当前事实

- 项目已有资料把 `ANTIDETECT_LOCAL_PROFILE` 列为候选 runtime lane；未证明它优于真实 Chrome 或普通 Chromium。
- 当前代码没有 GoLogin、AdsPower、Multilogin 等商业指纹浏览器的已接入适配器、Profile API、许可证配置或运行产物。
- `StealthPlugin` 只是对自动化痕迹的一组运行时修改，不等价于独立指纹浏览器，也不等价于“防串联”。

### 可以借鉴的能力

- Profile、代理、locale/timezone、浏览器版本作为同一 run 的不可变 manifest；
- 每个订单独立工作副本；
- Profile/代理/Session/Worker 绑定和租约；
- 运行结束后的销毁、封存和失租约清理；
- 运行时版本、依赖和配置哈希进入审计。

### 不能直接当作成功证据

- 指纹检测网站分数；
- 随机 Canvas/WebGL 噪声；
- 硬件 ID 伪装；
- 预热浏览历史；
- “用了指纹浏览器就不会串联”的宣传结论。

## 对 Browser MVP 的修正

Browser MVP 不再把“上号器”抽象成默认的 Session Provider。正确的抽象应拆为：

```text
SessionMaterialSource
  └─ 接收/规范化上号器支持的 Cookie 输入

SessionBootstrapAdapter
  └─ 在独立 Context 注入 Cookie
  └─ 访问真实会话端点
  └─ 核对目标账号

BrowserIdentityRuntime
  ├─ SYSTEM_CHROME
  ├─ PLAYWRIGHT_CHROMIUM
  └─ ANTIDETECT_LOCAL_PROFILE（候选）
```

现有 `SessionProviderPort` 只能理解为未来的可替换边界，不应再声称“等同于现有上号器”。下一轮 MVP 必须先验证：Cookie 写入、服务器真实认证、账号身份核对、Profile/代理隔离，然后才进入 Checkout 观察。

## 未验证事项

- 当前 Session Cookie 名、分块规则和真实会话响应字段；
- 上号器写入后服务器是否接受目标 Session；
- 指纹浏览器候选产品及其本地 API/CDP 接口；
- 商业指纹浏览器是否会引入云同步、第三方托管或 Profile 外传；
- 指纹浏览器与真实 Chrome 在固定网络和同一 Session 下的差异；
- 任何 runtime 是否能降低目标平台的实际挑战/失败率。

本文件只记录 Browser 线已核实事实和架构修正，不启动真实 Session，不安装扩展或指纹浏览器，不执行付款。
