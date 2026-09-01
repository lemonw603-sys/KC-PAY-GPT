# BitBrowser + 菲律宾代理只读 Pilot（2026-09-02）

## 目的

验证已安装的 BitBrowser 是否能通过用户提供的菲律宾节点访问 ChatGPT，并能被现有 Playwright/CDP Browser 基础接管。此 Pilot 不连接生产队列，不使用 Session，不创建订单，不读取卡资料，不付款。

## 已验证事实

- 本机架构：macOS Apple Silicon（arm64）。
- BitBrowser 7.1.5 Apple Silicon 已安装到 `/Applications/比特浏览器.app`；代码签名、Gatekeeper 和 notarization 校验通过。
- BitBrowser Local API 在 `127.0.0.1:54345`，`POST /health` 返回成功。
- 创建了一个全新空白测试 Profile（ID 记录在本机运行记录中，未写入任何 Session/Cookie）。
- 通过本机 mihomo 代理配置了用户提供的订阅，配置文件位于用户目录，权限为 0600；订阅 URL 和节点认证信息未写入 Git、日志或本报告。
- 代理组实际选中唯一的菲律宾·马尼拉节点；Cloudflare trace 显示 `loc=PH`、`colo=MNL`。
- BitBrowser `/browser/open` 返回本地 CDP 地址；Playwright `connectOverCDP()` 成功接管。
- 在全新空白 Profile、无登录条件下访问 `https://chatgpt.com/`：最终 HTTP 200，标题为 `ChatGPT: Chat, Work, Create & Code with AI`，页面进入公开首页；未出现 Cloudflare challenge。
- 测试截图：`artifacts/bitbrowser-ph-chatgpt-20260902.png`。

## 尚未验证

- 客户 Session 登录、身份识别、Plus 状态和 Checkout 页面。
- 付款、Provider 写入、卡台写入及真实订单。
- 长时间运行、断线恢复、代理 IP 漂移和 Cloudflare 风控稳定性。
- BitBrowser Profile API 与现有 Worker 的正式 adapter 接线。

## 结论

该组合已通过“菲律宾出口 + BitBrowser headed/CDP + ChatGPT 无登录公开页面”的第一道网络可达性验证，说明它具备继续做非付款 Browser Pilot 的条件；不能据此宣称真实充值链路已可用。

## 后续

1. 保持 API 为默认生产路线，Browser Worker 继续关闭。
2. 将 BitBrowser 作为 Browser launcher/profile adapter 的候选，不改订单、资金、队列核心。
3. 先在本机用独立测试 Profile 做 Session 只读登录与付款前页面观察；仍须单独确认，不触发付款。
4. 观察稳定后，再决定是否把同一 adapter 部署到专用常在线主机。
