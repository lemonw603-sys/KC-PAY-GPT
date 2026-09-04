# macOS Headed Browser Worker 最小 MVP（2026-09-02）

## 依据

本地 Mac 同出口 A/B 已证明：curl/headless Chrome 访问 ChatGPT 为 403 challenge，headed Google Chrome 首页和登录页均为 HTTP 200。证据位于 `artifacts/browser-local-access-diag-20260902/`。因此短期 MVP 选择 headed Google Chrome，但不将生产出口、代理类型或长期执行主机提前定案。

## 架构

继续复用共享 MySQL 中的 dispatch、run、attempt、租约、资金栅栏和审计；Mac 只替换 Browser 运行主机：

```text
launchd（默认不加载）
  → fail-closed wrapper
    → SSH local forward → production loopback MySQL
    → production-readonly --check
    → caffeinate + headed Google Chrome Worker --once
```

不新增队列、Session 数据库、付款状态机或本地业务真相。本地只保存 `0700` 的 run profile 和追加式 WAL。

## 断线与恢复

- SSH 使用 `BatchMode`、`ExitOnForwardFailure` 和 server-alive；
- 隧道未就绪时 Worker 不启动；
- 隧道退出时 wrapper 立即 `SIGTERM` Worker；
- Worker AbortController 关闭 Browser runtime；
- 页面动作之间仍需共享 lease heartbeat；
- 进程异常后由现有过期租约/`recoverExpiredRun()` 决定能否恢复；付款结果未知时仍禁止重试。

## 默认关闭

launchd 模板 `RunAtLoad=false`、`KeepAlive=false`，launcher 固定 `--once`，一次最多领取一个 job。所有 Browser/Provider/card/recharge/funding 写开关为 false，payment executor 为 false/MOCK，Chrome 强制 `headless=false`。环境中禁止原始 Session/PAN/CVC/API key。

## 启动前最小输入

1. 受限 SSH target 与专用 key；仅允许本地端口转发到服务器 `127.0.0.1:3306`；
2. 只具备 Browser 所需最小数据库权限的账号，`DATABASE_URL` 指向 Mac loopback tunnel；
3. `BROWSER_EXECUTOR_PROFILE_ID`、唯一稳定 `BROWSER_WORKER_ID`；
4. 三把彼此不同的 Browser 32-byte key 与既有共享 Session key；
5. 本地 `0600` env、`0700` profiles/WAL 目录；
6. 已登录的 macOS GUI 会话、Google Chrome、禁睡眠和日志目录；
7. 当次只读任务、明确启动窗口与停止/回滚责任人。

## 未验证

- 未连接生产数据库或领取任务；
- 未使用 Session/PAN/CVC；
- 未安装或加载 launchd；
- 未验证 Mac 重启、TUN/Wi-Fi切换、SSH tunnel flap 和 GUI logout；
- 未验证真实 Session 登录或 Checkout；
- 不构成真实付款或长期容量就绪。

## 长期方向

本地 Mac 是最快的非付款 pilot 主机，不是最终高吞吐节点。后续应使用同一无登录 probe 选择专用常在线主机或批准的稳定出口，并迁移同一 Worker 合同。
