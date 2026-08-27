# Browser 运行时接管事实

日期：2026-08-25  
工作范围：Browser 线；没有修改非 Browser 共享核心，没有执行真实付款。

## 当前工作树

```text
path: /Users/lemon/.codex/worktrees/9128/AI充值业务
branch: codex/browser
HEAD: 3a282cef9134973884d76a0912de729ccdf9a44a
untracked untouched: .playwright-cli/, artifacts/
```

相关 worktree（只作对照，不等同于当前运行基线）：

```text
/Users/lemon/code/AI充值业务                         main @ bd9f05b
/Users/lemon/.codex/worktrees/c566/AI充值业务       codex/competitor-recharge-research-20260824 @ a08cbac
/Users/lemon/.codex/worktrees/nonbrowser/AI充值业务 codex/nonbrowser-integration-20260825 @ c202a57
```

## 入口事实

### Legacy 浏览器充值

入口：

```text
/server.js
/index.js
```

调用链：

```text
POST /api/run-process
→ 校验 Session/CDK
→ markCdkUsed + createTaskLog
→ spawnActivationWorker
→ spawn node index.js
→ connectTaskBrowser
→ installChatGptSession / bootstrapChatGptSession
→ create Checkout
→ Stripe 表单和支付动作
→ billing record / task status / CDK rollback or success
```

证据位置：`server.js:3702-3818`、`server.js:3445-3699`、`index.js:199-249`、`index.js:519-590`、`payment-retry.js:115-285`。

事实：这套代码包含真实 Browser/Checkout/Stripe 支付动作；默认由 `server.js:1-7` 的 `ALLOW_LEGACY_RUNTIME` 保护。默认锁定不等于代码删除，也不等于技术上不可启动。

### v1 当前分支

入口：

```text
/v1/src/server.js
/v1/src/worker.js
```

事实：当前 `codex/browser` 分支的 v1 是订单/任务/Provider Worker；没有新版 Browser dispatch repository、Browser Worker 生产启动入口或真实 Browser 页面执行器。

### browser-mvp

入口：

```text
/browser-mvp/src/*
/browser-mvp/scripts/soak.js
```

事实：这是本地控制能力 PoC；支持文件 dispatch、lease、WAL、reconcile-only、只读 Playwright Context 和 opaque SessionProvider 边界。不接共享 MySQL、真实 Session、Checkout、卡片或付款。

## 实际运行验证

| 验证 | 命令/条件 | 结果 | 证据等级 |
|---|---|---|---|
| Legacy 默认启动 | `node server.js` | 退出 78，明确提示 Legacy locked | L2 |
| Legacy 显式启动 | `ALLOW_LEGACY_RUNTIME=I_UNDERSTAND node server.js` | 进入启动流程，随后因本机 MySQL `ECONNREFUSED` 退出 | L2 |
| Legacy 单元测试 | `npm run test:legacy -- --reporter=dot` | 2 files / 8 tests passed | L2 |
| standalone Browser | `node` 调用 `connectStandaloneBrowser()` | Chromium/CDP `127.0.0.1:9222` 启动成功 | L2 |
| Browser pool | `BROWSER_POOL_SIZE=1 ... pool.initBrowserPool()` | slot-0/CDP 启动和释放成功 | L2 |
| browser-mvp 测试 | `cd browser-mvp && npm test` | 20/20 passed | L2 |
| browser-mvp soak | `SOAK_MS=1000 SOAK_WORKERS=2 SOAK_INTERVAL_MS=20 npm run soak` | 43 jobs completed、0 duplicate、0 residual、0 errors、submitCalls=0 | L2 |
| 当前 v1 服务 | `npm start` | 当前 worktree 缺少 `v1/node_modules/helmet`，未进入监听 | L2 |
| 当前 v1 Worker | 带最小配置运行 `npm run start:worker` | 能通过配置校验，但本机无 MySQL，循环报 `ECONNREFUSED` | L2 |

## 尚未证明

- 远端/生产到底运行哪个 commit；
- 真实 Session 有效率；
- 当前 ChatGPT Checkout 页面是否仍匹配旧 Selector；
- 真实网络、代理、验证码、3DS 和付款成功率；
- 真实订单、资金账本和 Browser 控制面是否已在同一部署接线；
- 每日几百单的真实产能。

## 证据纪律

源码存在、历史文档、测试通过和生产可用必须分开记录。任何真实 Session、Checkout、付款或远端状态都需要独立证据，不能从本文件推断。
