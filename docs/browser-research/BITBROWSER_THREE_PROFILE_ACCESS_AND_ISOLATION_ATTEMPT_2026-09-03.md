# BitBrowser 三 Profile 访问与隔离验证（2026-09-03）

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

## 用户 headed 打开后的复验与根因修正

用户分别在三个 Profile 的 headed 窗口打开 ChatGPT 后，现场确认三个独立 PID、三个独立 CDP 端口、每个 Profile 一个 BrowserContext。两个新 Profile 分别取得自己的 Cloudflare 访问 Cookie，且没有 ChatGPT Session cookie。

随后发现项目的客户隔离清理会删除 `chatgpt.com/openai.com` 下**全部** Cookie，其中也包括 Profile 自身的 Cloudflare clearance/bot-management Cookie；这会把用户刚建立的访问状态一起删掉，正是此前新 Profile 在自动检查中重新变成 403 的直接机制问题。

已将运行时清理修正为：

1. 先只保留 `cf_clearance`、`__cf_bm`、`__cflb`、`_cfuvid` 与 `oai-did` 五类 Profile 运行 Cookie；
2. 清除 ChatGPT/OpenAI 域下其余全部 Cookie，包括任何未知 Cookie 和 Session/Auth Cookie；
3. 清空站点 storage、关闭客户页面；
4. 恢复上述 Profile 运行 Cookie。

单测证明 Session token 与未知 Cookie 都不会被恢复。修正后的真实三路同时检查结果：

- ChatGPT HTTP 200：`3/3`；
- Cookie 隔离标记：`3/3`；
- localStorage 隔离标记：`3/3`；
- 出口地区：`PH`；
- 出口摘要：三者相同，说明当前三路共用一个菲律宾出口，不构成网络出口隔离；
- Session 注入 `0`、卡字段写入 `0`、submit `0`。

本轮粗粒度浏览器属性摘要相同，因为三个 Profile 被统一到同一 macOS/Chrome 大类配置；该摘要不包含 BitBrowser 全部 canvas/audio/WebGL 噪声，不能据此宣称完整指纹相同或不同。完整指纹差异仍需单独验证。

## 最终结论

当前真实边界是：**三个独立 BitBrowser Profile 已同时通过 ChatGPT HTTP 200、Cookie 与 localStorage 隔离验证；客户隔离不能粗暴删除 Profile 的 Cloudflare 运行 Cookie。** 三者目前仍共用一个菲律宾出口，尚未证明网络隔离或完整指纹差异。

此前 403 不是项目队列、资金栅栏或 Session 逻辑造成；在用户 headed 建立访问状态后，项目全量 Cookie 清理会再次删除 clearance，已确认并修复这一机制缺陷。

## 收口与下一步

- 自动复验结束后三个 Profile 均已关闭；新 Profile 未保存登录 Cookie或客户材料，仅保留自身运行访问 Cookie。
- 下一步先验证三个 Profile 的完整指纹差异和重复启动后仍为 HTTP 200，再决定创建另外三个 Profile；若要更强风控隔离，还需准备不同稳定出口，不能把同一菲律宾 IP 写成网络隔离。
- 本轮未部署、未切生产路线、未启动生产 Browser Worker、未调用 Provider/卡台、未付款。
