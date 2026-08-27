# Browser 验证命令索引

所有命令默认在隔离环境运行；除非另有批准，不提供真实 Session、真实卡片或真实付款开关。

## 静态检查

```bash
cd /Users/lemon/.codex/worktrees/9128/AI充值业务/browser-mvp
npm run check
```

验证：Browser MVP 源码语法。

## Browser MVP 测试

```bash
cd /Users/lemon/.codex/worktrees/9128/AI充值业务/browser-mvp
npm test
```

当前已验证：20/20 通过；仅证明本地控制能力和非付款行为。

## Browser MVP 短 soak

```bash
cd /Users/lemon/.codex/worktrees/9128/AI充值业务/browser-mvp
SOAK_MS=1000 SOAK_WORKERS=2 SOAK_INTERVAL_MS=20 npm run soak
```

验收字段：`duplicateClaims=0`、`residualJobs=0`、`errors=0`、`submitCalls=0`。

## Legacy 安全启动探针

```bash
cd /Users/lemon/.codex/worktrees/9128/AI充值业务
node server.js
```

预期：退出 78，确认默认锁仍存在。

显式 Legacy 启动只能用于无付款/依赖探针，且需要本地 MySQL 配置；不得在没有单独批准时提供真实 Session 或付款开关。

## Browser runtime 探针

```bash
cd /Users/lemon/.codex/worktrees/9128/AI充值业务
node - <<'NODE'
const { connectStandaloneBrowser } = require('./browser-standalone');
(async () => {
  const session = await connectStandaloneBrowser({ headful: false });
  console.log({ ownsBrowser: session.ownsBrowser, cdpUrl: session.cdpUrl, userAgent: session.realUserAgent });
  await session.browser.close();
})().catch((error) => { console.error(error); process.exitCode = 1; });
NODE
```

预期：本地 Chromium/CDP 启动并关闭；不导航 ChatGPT、不注入 Session。

## 结果记录要求

每次新增验证都记录：

```text
commit
命令
环境前提
进程/端口
输出摘要
是否触碰真实 Session/Checkout/付款
生成的 artifact 路径
未验证边界
```
