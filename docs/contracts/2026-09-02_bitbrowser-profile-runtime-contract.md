# BitBrowser Profile Runtime Adapter 合同（2026-09-02）

## 定位

BitBrowser 只替换 Browser Worker 的 launcher/profile runtime 层。订单、dispatch、run、lease、attempt、消费账本、资金栅栏、payment permit 和审计仍以共享 MySQL 核心为权威，不建第二套业务状态。

## 配置 Schema

| 变量 | 规则 |
|---|---|
| `BROWSER_RUNTIME_PROVIDER` | 默认 `GOOGLE_CHROME`；只有显式设为 `BITBROWSER` 才使用本 adapter |
| `BROWSER_BITBROWSER_ENABLED` | BitBrowser 模式必须精确为 `true`；默认未配置即禁用 |
| `BROWSER_BITBROWSER_API_URL` | 只允许无账号、无路径、无 query 的 loopback HTTP origin；当前实测值为 `http://127.0.0.1:54345` |
| `BROWSER_BITBROWSER_PROFILE_ID` | 由运营人员预先创建的本地测试 Profile ID；不是共享 executor profile ID |
| `BROWSER_BITBROWSER_API_TIMEOUT_MS` | `250–60000`，默认 `10000` |

现有五个写开关、payment executor `false/MOCK` 和原始凭据禁入环境的规则不变。代理订阅 URL、代理密码、Session、PAN/CVC 不属于本 adapter 配置。

## Local API 与 CDP

adapter 只使用下列 loopback 请求：

1. `POST /health`，JSON `{}`。
2. `POST /browser/open`，JSON `{ "id": "<profileId>" }`。
3. `POST /browser/close`，JSON `{ "id": "<profileId>" }`。
4. 启动响应只提取已知 CDP 字段：`data.http/ws/cdp/cdpUrl/debuggingAddress/debuggerAddress/wsEndpoint/webSocketDebuggerUrl`；CDP endpoint 也必须是 loopback。
5. Playwright 使用 `chromium.connectOverCDP()` 接管，并要求恰好一个已有 `BrowserContext`；不新建第二 Context。

错误不回显 Local API 响应体，避免将 Profile 元数据写入普通日志。

## 租约与收口

- 一个 adapter 实例同时只允许一个活动 `profileRef`。
- 当前部署模型要求一个共享 Browser executor profile 对应一个 BitBrowser Profile；跨进程单租约继续由现有 `execution_resource_leases` 保证。
- CDP 接管失败、Context 数量冲突或执行异常时，adapter 必须调用 `/browser/close`。
- 正常结束、任务失败、租约丢失或 SIGTERM 收口都走现有 executor `finally -> runtimeAdapter.close()`。
- Local API 关闭失败明确返回 `BITBROWSER_CLEANUP_FAILED`，不把 Profile 冒充为已关闭。
- 操作系统强制杀进程/断电无法由当前进程执行 close；重启后必须先经 Local API 健康检查和 Profile 重新 open，不得绕过共享租约恢复。

## 默认和未验证边界

- 当前默认仍是 `GOOGLE_CHROME`，BitBrowser 不会被隐式启动。
- 本合同只完成 mock/合同测试；未连接生产队列，未部署。
- 公开页 HTTP 200 Pilot 不等于 Session、Checkout、风控、付款或长时稳定性验收。
