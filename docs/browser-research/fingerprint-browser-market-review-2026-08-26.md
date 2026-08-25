# 多账号隔离指纹浏览器市场评估（2026-08-26）

## 目标

为 Browser MVP 选择一个**本地可控、支持 Chrome/Chromium、支持 Playwright/CDP、支持多 Profile 隔离**的指纹浏览器候选。评估重点不是“指纹分数”，而是：

- Profile 是否能本地保存；
- 是否能按任务创建、启动、停止、删除；
- 是否能与 Worker 的租约和审计绑定；
- 是否支持 Playwright/CDP；
- 是否会把 Session/Profile 上传到云端；
- 是否有 API 频率或运行时限制；
- 是否能在 macOS/Apple Silicon 本地运行。

## 结论

### 首选：Kameleo（本地 Profile + Chroma/Chrome 指纹 + Local API）

Kameleo 最贴合当前 Browser MVP 的约束：

- Local API 默认监听 `http://localhost:5050`；
- 官方 JS/Python/C# SDK；
- 可以筛选 `browser_product='chrome'` 的桌面指纹；
- Playwright 通过 CDP 连接 Chroma profile；
- 官方明确建议“一 Profile 一 BrowserContext”，不要在一个 Profile 内创建多个 Context；
- Profile 有 Created/Starting/Running/Terminated/Locked 等生命周期，便于接 Worker lease；
- 支持 local profile，Profile 数据保存在本机；云 Profile 可以完全不用；
- 官方明确不建议叠加 `playwright-extra` 或其他第三方 stealth patch；
- 官方安装文档列出 macOS Apple Silicon 支持。

证据：

- Kameleo Playwright 集成：<https://developer.kameleo.io/integrations/playwright/>
- Kameleo Profile 生命周期和本地存储：<https://developer.kameleo.io/concepts/profiles/>
- Kameleo 安装与 macOS Apple Silicon：<https://developer.kameleo.io/getting-started/installation/>

### 次选：Multilogin（Mimic Chrome + Local Profile + API/Playwright）

优点：

- 官方支持 API、CLI、Puppeteer、Selenium、Playwright；
- Mimic 是 Chrome-based runtime；
- 支持 local profile storage，macOS 路径为 `~/mlx/profiles`；
- 支持启动/停止 Profile、Profile 级 API 和本地存储；
- 产品成熟度和 Profile 管理能力较强。

限制：

- 自动化依赖 Multilogin App/Launcher 和远程 WebDriver/端口；
- API 有 RPM 限制；
- 默认生态同时包含 cloud profile/team sync，必须强制选择 local storage；
- 比 Kameleo 多一层厂商账号、Launcher、Automation Token 依赖。

证据：

- 自动化 FAQ：<https://multilogin.com/help/en_US/automation-faq>
- Local/Cloud Profile 存储：<https://multilogin.com/help/en_US/profile-management/cloud-and-local-storage>
- Profile 启动 API：<https://multilogin.com/help/en_US/starting-a-profile-with-postman>

### 第三候选：AdsPower（Local API + CDP/Playwright）

优点：

- Local API 支持创建/查询/更新 Profile、配置指纹、启动/关闭浏览器；
- 官方提供 CDP/Playwright 示例；
- 支持 headless + API key；
- 多账号运营场景成熟，部署门槛较低。

限制：

- Local API 依赖 Team/付费权限；
- 官方/社区资料显示存在 API 频率控制，GitHub 官方示例写明最大约 1 request/second；这与卡台调用受限和 Browser 控制面低调用要求不冲突，但会限制高并发控制面设计；
- Data Sync 打开后会把 Profile 数据上传云端并与团队共享，必须明确关闭；
- 需要审计 API key、Profile cache、同步开关和退出清理。

证据：

- 官方 Local API 说明：<https://help.adspower.com/docs/api>
- 官方 Local API GitHub：<https://github.com/AdsPower/localAPI>
- 官方 Open Browser V2：<https://localapi-doc-en.adspower.com/docs/Open-Browser-V2>
- 官方 Data Sync 说明：<https://help.adspower.com/docs/global_settings>

### 暂不首选：GoLogin

GoLogin 的公开开发文档当前重点是 Cloud Browser：通过远程 WebSocket URL 连接云端 Profile，并由 REST API 管理 Profile、代理和指纹。它也有桌面应用，但当前项目明确要求本地 Profile、禁止第三方 Session/Profile 托管，因此不适合作为第一候选。除非后续确认只使用桌面本地模式并完成敏感数据边界审查，否则不进入 MVP 首轮。

证据：<https://gologin.com/docs/api-reference/cloud-browser/getting-started>

## 社区信号（仅作线索，不当作事实）

- Reddit 多个讨论反复提到：长期稳定性更依赖“浏览器 Profile + sticky proxy + 版本稳定”组合，而不是单独指纹分数；也有人报告 AdsPower 在高 Profile 数量下出现内存问题。此类内容是个人经验，不能替代本项目测试。
- 社区普遍认为 Multilogin、AdsPower、GoLogin 使用量较大，Kameleo 更偏开发者/自动化和本地 API；这与官方接口证据方向一致，但不证明对目标平台的成功率。

参考讨论：

- <https://www.reddit.com/r/AntiDetectGuides/comments/1tqw2h4/which-antidetect-browser-works-best-with-which-proxies/>
- <https://www.reddit.com/r/AntiDetectGuides/comments/1s4528/what-antidetect-browser-is-actually-worth-using-right-now/>

## 与“本地 Google Chrome”决策的关系

Google Chrome 与指纹浏览器不是二选一：

- **Google Chrome**：作为真实 Chrome control lane，验证页面兼容性、Session Bootstrap 和业务流程；
- **Kameleo/Multilogin/AdsPower**：作为可替换 BrowserIdentityRuntime，验证 Profile/指纹/代理隔离；
- 两条 lane 使用同一订单、Session、网络和证据合同，只改变 runtime。

指纹浏览器的 Chrome 模式通常是 Chrome-compatible Chromium 内核或定制内核，不等于用户机器上的 `/Applications/Google Chrome.app`。因此 MVP 应保留真实 Google Chrome 作为基线，不把指纹浏览器的“Chrome 模式”误写成系统 Chrome。

## 推荐实施顺序

1. 先用系统 Google Chrome 完成 runtime control smoke（不付款）；
2. 安装 Kameleo，使用 **local profile + Chroma + Chrome fingerprint**；
3. 通过 Local API 创建一个 Profile，绑定测试代理/locale/timezone，连接 Playwright；
4. 接入上号器 Cookie Bootstrap，验证真实账号身份；
5. 在同一测试订单上完成 Browser 非付款/模拟付款闭环；
6. 比较 Google Chrome 与 Kameleo：Session 接受、账号身份、页面稳定、Profile 清理、代理一致性、重启恢复；
7. 只有 Kameleo 通过本地数据边界、失租约、Profile 销毁和运行时 smoke，才考虑其作为 MVP runtime champion；Multilogin/AdsPower 保留为 fallback/对照。

## 仍未验证

- Kameleo 对当前目标站点 Session Cookie 的真实接受情况；
- Kameleo Profile 重启后 Session Cookie 的实际保留语义；
- Kameleo Chroma 与系统 Google Chrome 的页面/Checkout 兼容差异；
- Multilogin/AdsPower 在本项目 macOS 环境的真实安装、API 授权和资源占用；
- 任何厂商对目标平台风控/账号关联的实际改善；
- 所有真实支付和真实客户 Session 行为。

本评估只用于选择 Browser runtime，不代表生产可用，不启动真实付款。
