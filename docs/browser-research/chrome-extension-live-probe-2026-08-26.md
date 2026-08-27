# Google Chrome 上号器真实加载探针（2026-08-26）

## 目的

验证系统 Google Chrome control lane 是否真实加载 `/Users/lemon/Downloads/诺汇盛专用上号器 v1.1.0/`，不输入 Session、不访问 Checkout、不付款。

## 运行时事实

- 浏览器：`Google Chrome 151.0.7922.174`。
- headed persistent context 可以正常启动；先前把空 `DISPLAY` 写成 macOS headed 阻塞条件不准确，已由真实运行纠正。
- 启动参数包含 `--load-extension`/`--disable-extensions-except` 时，Chrome 进程能启动，但 Profile `Secure Preferences` 中只有内置 PDF Viewer，没有诺汇盛扩展。
- 访问按扩展 canonical path 派生的 `chrome-extension://.../popup.html` 返回 `net::ERR_BLOCKED_BY_CLIENT`。
- 没有输入 Session；没有写 Cookie；没有请求 ChatGPT；没有付款副作用。

## 原因证据

Chrome 官方在 Chrome 137 移除了 branded Google Chrome 的 `--load-extension` 命令行加载能力：

- https://developer.chrome.com/blog/extension-news-june-2025
- https://chromium.googlesource.com/chromium/src/+/04f6233ce5be7e5e420418b5286f3b0f87ffc28f%5E%21/

因此“传入启动参数”不是“扩展已加载”的证据。当前 Chrome 151 的真实行为与官方变更一致。

## 已修正

`ChromeExtensionSessionRuntimeAdapter` 新增 `verifyLoaded()`：必须真实打开 popup 并找到 `#sessionToken/#loginButton` 才算扩展已加载；`ERR_BLOCKED_BY_CLIENT` 直接 fail-closed。测试增加未真实加载时拒绝，当前总计 43/43 通过。

## 下一步

Google Chrome 主 lane 要继续使用实际扩展，需要在专用 persistent Profile 中通过 `chrome://extensions` 一次性“加载已解压的扩展”；这是持久化安装动作。安装完成后再执行：popup 只读确认 → 用户已提供 Session 的写入验证 → `/api/auth/session` 身份核对。真实付款仍保持关闭。

## 实际安装与 Session Bootstrap 结果

用户确认后，原始 `v1.1.0` 已安装到专用 Profile，真实 popup 验证通过：扩展 ID 存在，标题、Session 输入框、提交按钮和“未登录”状态均可见。

随后用用户已提供的 Session JSON 做实际 popup 写入（不记录原文/邮箱/Token）：扩展返回 `Failed to parse or set cookie named "__Secure-next-auth.session-token".`，未写入 Session Cookie，也未打开 ChatGPT。根因是当前 Session Token 超过单 Cookie 限制，而原始扩展只写一个 Cookie，不支持 NextAuth/Auth.js `.0/.1/...` 分块。

因此不能把“扩展已安装”写成“扩展已完成上号”。同时发现 Worker adapter 点击后立即返回成功、没有等待 popup 结果，也会造成假成功；已修正为等待 popup 状态和 ChatGPT 新页面，错误时 fail-closed。

项目内新建派生版本：`browser-mvp/extensions/nuohuisheng-session-loader/`，版本 `1.1.1`，保留 Downloads 原始 `1.1.0` 不变。派生版增加长 Cookie 分块、旧分块清理、分块会话识别；纯函数测试覆盖 8500 字符 Token 的三段重组。

## 派生版真实安装与身份核对（2026-08-26）

- 为解决 macOS 文件夹选择器中 worktree 路径过深的操作问题，把已追踪源目录同步到 `/Users/lemon/Downloads/Browser MVP 上号器 v1.1.1/`；源码事实源仍是 worktree 中的目录，Downloads 只是 Chrome 手动安装副本。
- 专用 Profile 成功加载 `Browser MVP 上号器 1.1.1`，安装 ID 为 `ponldkcoceojcdbhbgildboehojebklm`；原始 `1.1.0` 仍保留，未覆盖。
- 派生 popup 真实打开，`#sessionToken` 和 `#loginButton` 均存在。
- 用用户已提供 Session JSON 的第一行执行 popup bootstrap；不记录 Token、邮箱、账号 ID 或 Session 原文。
- 结果为 2 个 `__Secure-next-auth.session-token.*` 分块；ChatGPT 页面成功打开；`/api/auth/session` 返回 HTTP 200；user ID/email/account ID 三项摘要全部与输入一致。
- 未打开 Checkout，未填卡，未点击支付，未调用卡台写接口。

### 实跑发现的竞态与修复

`chrome.tabs.create()` 创建页面时，Playwright 首先收到的 page URL 为空字符串/`about:blank`。旧 adapter 在这个时点读 URL，会把真实成功误报为 `unexpected page`。运行时后续证据显示 ChatGPT 已打开且 Cookie 已写入，因此这是验证器竞态，不是上号失败。

`a79c5aa` 已修正为等待 URL 真实到达 `https://chatgpt.com` 并完成 DOMContentLoaded；同时支持显式 `installedExtensionId`，以匹配 branded Chrome 中手动安装的 unpacked extension。修复后用 adapter 重放一次成功，三项身份摘要仍全部匹配。

### 与早前 403 观察的关系

早前临时 Profile + 直接 Cookie adapter 观察到 Cloudflare HTTP 403；本次专用 persistent Profile + 真实扩展路径得到 HTTP 200。最新运行时事实是当前 Profile 可核对身份，但尚无证据将差异单独归因于上号器、Profile 持久化或边缘风控时间变化。

### 未验证边界

- 真实 Checkout 页面和套餐/币种/金额合同；
- 卡材料真实只读获取与填充；
- 付款提交、扣款、权益/订阅/卡台交易对账；
- 指纹浏览器 runtime Spike 和多账号隔离效果。

当前下一步是 Checkout 只读观察，不是打开付款写开关。
