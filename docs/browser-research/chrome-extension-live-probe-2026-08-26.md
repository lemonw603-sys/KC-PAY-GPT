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
