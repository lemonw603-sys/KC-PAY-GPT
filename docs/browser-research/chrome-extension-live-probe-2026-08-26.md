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

项目内新建派生版本：`browser-mvp/extensions/nuohuisheng-session-loader/`，版本 `1.1.1`，保留 Downloads 原始 `1.1.0` 不变。派生版增加长 Cookie 分块、旧分块清理、分块会话识别；纯函数测试覆盖 8500 字符 Token 的三段重组。尚未安装到专用 Profile。
