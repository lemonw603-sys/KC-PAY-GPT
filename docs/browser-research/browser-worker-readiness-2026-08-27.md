# Browser Worker + Chrome readiness（2026-08-27）

## 基线核对

- 主线合并提交：`6580871`（`merge(browser): integrate nonpayment worker and chrome dry-run`）。
- 当前 Browser worktree：`codex/browser`，HEAD=`ce1ffa9`；`git diff 6580871..HEAD` 为空，代码树与主线合并提交一致。当前新增 readiness 变更尚未合并。
- Browser 入口：`npm --prefix browser-mvp run dry-run:shared`；本地 Worker/Chrome fixture 回归：`browser-mvp/test/local-worker-chrome-fixture.test.js`。

## 一次性 readiness 命令

```bash
BROWSER_DRY_RUN_ENV=isolated-fixture \
BROWSER_PAYMENT_WRITES_ENABLED=false \
PROVIDER_WRITES_ENABLED=false \
PROVIDER_CARD_WRITES_ENABLED=false \
PROVIDER_RECHARGE_WRITES_ENABLED=false \
CARD_FUNDING_WRITES_ENABLED=false \
npm --prefix browser-mvp run dry-run:readiness
```

结果：

```text
PASS local isolated fixture runtime
PASS all payment/provider/card write switches are false
PASS no raw Session/PAN/CVC environment material
PASS Chrome executable is available
PASS worker parameters present (local fixture defaults)
```

## 隔离 fixture dry-run

使用相同五个 `false` 写开关执行：

```bash
npm --prefix browser-mvp run dry-run:shared
```

结果：`exit code=0`，静态检查通过，共享 MySQL 集成 `1/1 passed`，临时 MySQL 容器自动清理。

补充本地 Worker + Google Chrome fixture：

```bash
node --test browser-mvp/test/local-worker-chrome-fixture.test.js
```

结果：`1/1 passed`。实际驱动 `createBrowserWorkerProcess` 的 claim/run/complete，并以 `GoogleChromeControlRuntimeAdapter` 启动临时 persistent profile 访问本地 `data:` 页面；无付款提交。

## 仍需预生产输入

若要执行预生产只读 dry-run，需要统筹窗口一次性提供：

1. 隔离/预生产 `TEST_DATABASE_URL`，并确认 migrations `001–037`；
2. Browser Worker 启动参数（worker ID、executor profile、运行目录）；
3. 非敏感测试订单 ID；
4. Chrome executable/profile 根目录；
5. `browser_payment_writes_enabled=false` 与卡台/Provider 写开关关闭证明。

本次没有连接生产或预生产，没有读取真实 Session/PAN/CVC，没有调用卡台写接口，没有填卡或付款。
