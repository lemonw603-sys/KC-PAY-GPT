# BitBrowser 三 Profile 访问与隔离尝试（2026-09-03）

## 目标

在不注入 Session、不填卡、不进入 Checkout、不付款的边界内，准备三个彼此独立的 BitBrowser Profile，并验证三者能否同时访问 ChatGPT、各自保存独立 Cookie/localStorage 标记及使用预期菲律宾出口。

## 本地准备

- 现场 Local API 列表最初只有 1 个已验证 Profile。
- 通过 BitBrowser 官方 Local API 新建 2 个候选 Profile；不复制账号、Session 或支付资料，关闭 Cookie、localStorage、Session、历史、授权和支付地址同步。
- 三个 Profile 的 opaque ID 只保存在 Git 忽略的本机 `0600` 配置 `.env.browser-local`，没有进入代码、文档或提交。
- 新增 `browser-mvp/scripts/verify-bitbrowser-three-profile-nonpayment.js`，只读取该 `0600` 配置；脚本无 Session、卡片、Checkout 或 submit 能力，结束时清 Cookie/storage 并关闭全部 Profile。

## 现场结果

- 三个 Profile 均能由 Local API 启动并被 CDP 接管，且每个只暴露一个 BrowserContext。
- 原已验证 Profile 保持可访问基线；两个新 Profile 单独访问 ChatGPT 均返回 HTTP 403，Cloudflare trace 仍显示菲律宾出口。
- 初始随机指纹存在明确内部不一致：配置被改为 Mac/Chrome 148 后，实际 User-Agent 仍为 Windows/Chrome 147。已通过 partial update 把 OS、核心版本、User-Agent、WebGL 等运行字段统一到当前 macOS/Chrome 148 形态；再次单独访问仍为 HTTP 403。
- 曾用现有 Profile 中仅含 Cloudflare bot-management 的非登录 Cookie 做一次窄范围 bootstrap 对照；没有复制 ChatGPT Session，但新 Profile 仍为 403。对照后已从两个新 Profile 删除该 Cookie并执行 cookie cleanup。
- 因两个候选 Profile 不能正常访问 ChatGPT，三路 Cookie/localStorage 隔离验收未成立；没有把“Profile 创建成功”误写成“三路 Browser 已可用”。

## 结论

当前真实边界是：**BitBrowser 账户内已有 3 个本地候选 Profile，但只有原 Profile 已证明能访问 ChatGPT；新建 Profile 不能仅靠相同代理和看似一致的指纹立即获得可用访问。**

失败不是项目队列、资金栅栏或 Session 逻辑造成，因为本轮在注入 Session 之前就停止。最可能仍位于 Cloudflare 对新 Profile 的浏览器状态/指纹/信誉组合，而不是菲律宾出口缺失；现有证据不足以把单一字段定为唯一根因。

## 收口与下一步

- 三个 Profile 均已关闭；新 Profile 未保存登录 Cookie或客户材料。
- 遵守窄范围在线重试限制，本轮不再继续随机改指纹或复制 Cookie。
- 下一步应先为一个新 Profile 建立独立、可复现的正常访问基线：优先使用其自身 headed 窗口完成公开页访问/挑战建立，或为其配置另一条已验证稳定出口；单个候选达到 HTTP 200 后再恢复三路同开隔离测试。
- 本轮未部署、未切生产路线、未启动生产 Browser Worker、未调用 Provider/卡台、未付款。
