# 生产 Browser `CHATGPT_ACCESS_BLOCKED` 只读诊断（2026-09-02）

## 结论

生产服务器出口 `144.34.180.184` 在**没有 Browser、没有 Session**的普通 HTTPS 请求阶段即被 Cloudflare 返回 HTTP 403 challenge。生产安装的 Chromium headless 使用全新、无登录 Context 访问 ChatGPT 首页和登录页时得到相同的 403、`Just a moment...` 和验证页面。

因此，本次 `CHATGPT_ACCESS_BLOCKED` 的直接触发层已经定位为**生产公网出口到 Cloudflare 的边缘访问挑战**。出口 IP、ASN 或地域是当前最可能原因；headless 特征不是触发 403 的必要条件，但是否影响挑战通过率尚未完成 headed A/B，不能下定论。

这不是 Browser 付款失败证据，也不是客户 Session 失效证据。当前 API 默认充值路线不依赖 ChatGPT Browser 页面访问，不受本次 Browser 出口阻断影响。生产 Browser Worker 应继续保持 `disabled/inactive`，不得因本报告启动。

## 范围与安全边界

本轮仅进行网络与无登录页面只读观察：

- 未创建订单；
- 未读取或使用客户 Session；
- 未读取 PAN/CVC；
- 未调用 Provider 或卡台接口；
- 未填卡、未点击付款、未产生付款；
- 未修改生产开关、systemd、环境或 release；
- 未启动生产 Browser Worker。

## 已验证事实

### 1. 生产运行状态

- 当前 release：`/opt/pojia/releases/20260901-browser-access-block-7bad460f26d311d8f15103c86933a276cf4b9d14`。
- `pojia-browser-worker.service`：`disabled/inactive`。
- Browser 与 Provider/card/recharge/funding 付款写开关及 payment executor 均关闭。
- 持久配置当前为 `LOCAL_FIXTURE`，不是外部 ChatGPT 目标。
- 生产未配置 HTTP/HTTPS/ALL proxy；安装的 `chromium_headless_shell` 可执行文件存在。

### 2. 出口、DNS、TLS 与普通 HTTP

- 公网 IPv4：`144.34.180.184`；IPv6 不可用。
- `chatgpt.com` 正常解析至 Cloudflare 地址 `104.18.32.47`、`172.64.155.209`。
- TLS 验证成功：`ssl_verify_result=0`。
- 无 Browser、无 Session 的 `curl`：
  - `https://chatgpt.com/`：HTTP 403；
  - `https://chatgpt.com/auth/login`：HTTP 403；
  - 响应 `server: cloudflare`、HTML、带 `cf-ray`，正文含 `challenge-platform`。

这证明挑战在 Session 验证和 Browser 指纹之前即可发生。

### 3. 无登录 headless Chromium

| 输入 URL | HTTP | 最终 URL | 标题 | 页面特征 |
| --- | ---: | --- | --- | --- |
| `https://chatgpt.com/` | 403 | 原 URL | `Just a moment...` | Cloudflare `Verifying...` |
| `https://chatgpt.com/auth/login` | 403 | 原 URL | `Just a moment...` | Cloudflare `Verifying...` |

原始截图保存在未跟踪 artifact 目录，文件不含 Session、卡资料或账号数据：

- `artifacts/browser-access-diag-20260902/headless-home.png`，SHA-256 `904c2c2de3bdd0dfefbad081a24e6a8eaa9fb7ed7acba08d78ac737dc5da1af1`；
- `artifacts/browser-access-diag-20260902/headless-login.png`，SHA-256 `8bd5a8037d4fb39922fbb32cf76c3db75f8b6a23f7a6b3aa0335e7a4e628efd2`；
- 本轮命令与摘要：`artifacts/browser-access-diag-20260902/README.md`。

### 4. Headed 对比边界

本轮未获得 headed 对比结果。生产主机没有 `DISPLAY`、`Xvfb` 或 `xvfb-run`；直接启动 headed Chromium 在显示环境建立前因 Crashpad/SIGTRAP 退出。安装显示设施会改变生产主机，因此没有在只读排查中执行。

由此只能得出：headless 不是**触发**当前 403 的必要条件；不能得出 headed Chrome 一定通过或一定失败。

## 错误分类审查

当前实现没有把所有异常都并入 `CHATGPT_ACCESS_BLOCKED`：

- DNS、连接或普通导航失败在 `page.goto()` 阶段退出，通常归入 `PAGE_CHECKPOINT_FAILED`；
- Playwright 导航超时归入 `ACTION_TIMEOUT`；
- HTTP 200 后标题、URL 或 selector 漂移归入 `PAGE_DRIFT`；
- Cloudflare/HTML 403、带 `cf-ray` 的 403 和 HTTP 429 统一归入 `CHATGPT_ACCESS_BLOCKED`。

最后一项适合作为统一安全停止码，但运营诊断粒度不足。后续可增加不改变订单/资金行为的诊断 subtype，例如 `CLOUDFLARE_CHALLENGE`、`ACCESS_FORBIDDEN`、`RATE_LIMITED`；本轮不修改状态机或资金逻辑。

## 下一步

不把“住宅代理”或任何代理产品写成既定路线。只保留两个候选，并通过相同无登录只读探针实测选择：

1. 使用经过批准、可固定且稳定的网络出口；
2. 将 Browser 执行器迁移到能够正常访问 ChatGPT 的主机。

候选出口/主机首先必须通过：DNS/TLS、普通 HTTP、headless 与 headed 同 URL 对比、连续稳定性和 sticky 一致性。全部只读门槛通过前，生产 Browser Worker继续关闭；API 默认路线照常独立运行。
