# Browser Worker dry-run 复验记录（2026-08-27）

## 目的

在不连接生产、不读取真实 Session/卡资料、不调用卡台写接口、不付款的前提下，执行最新 fail-closed launcher，验证共享 Browser 非付款 composition 可重复运行并安全收口。

## 精确命令

```bash
BROWSER_DRY_RUN_ENV=isolated-fixture \
BROWSER_PAYMENT_WRITES_ENABLED=false \
PROVIDER_WRITES_ENABLED=false \
PROVIDER_CARD_WRITES_ENABLED=false \
PROVIDER_RECHARGE_WRITES_ENABLED=false \
CARD_FUNDING_WRITES_ENABLED=false \
npm --prefix browser-mvp run dry-run:shared
```

## 实际结果

```text
exit code: 0
node --check: passed
shared-dry-run-mysql-integration: 1/1 passed
```

launcher 自动完成：

1. 创建临时 `mysql:8.4` 容器；
2. 等待连续 SQL 查询成功；
3. 执行 v1 migrations `001–037`；
4. 使用真实共享 MySQL dispatch/execution/recovery repositories，运行 Browser 非付款集成；
5. 通过本地 Playwright Browser fixture 执行观察；
6. 调用 `abortBeforePayment()` 安全收口；
7. 退出时删除临时容器。

集成测试断言：

```text
order = CARD_READY
attempt = CLEARED
fundsRiskState = CLEARED
run = FAILED_SAFE
dispatch = CANCELLED
active permits = 0
PAYMENT_SUBMIT operations = 0
live resource leases = 0
external payment calls = 0
```

独立清理核对确认没有残留 `codex-browser-dry-run-*` 容器。

## 这次实际验证了什么

- fail-closed launcher 能在无协调数据库配置时自行建立隔离 fixture；
- 正式共享 dispatch/run/resource lease 与 Browser executor 可端到端联调；
- 付款前安全退出能清除 funds fence、permit 和资源租约；
- 所有写开关显式为 false 时流程才会启动。

## 尚未验证 / 不应外推

- 这不是生产或预生产 Worker 验收；没有启动 `v1/src/worker.js` 部署进程；
- Browser 页面使用本地 Playwright fixture，不是外部 ChatGPT 页面，也不是系统 Google Chrome 真实站点观察；
- 未读取真实 Session、PAN/CVC，未填卡，未调用 HNSKJ/ZZSHU 写接口，未点击付款；
- 未验证生产部署配置、真实 Chrome Profile、真实卡材料、付款后三方对账或容量。

## 复现前置

- Docker 可用；
- Node.js 与项目依赖已安装；
- 不设置任何真实 Session/PAN/CVC 环境变量；
- 保持五个写开关显式为 `false`。
