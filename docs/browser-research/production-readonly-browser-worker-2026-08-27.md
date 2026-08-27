# Browser production-readonly Worker（2026-08-27）

## 结论

`v1/src/worker.js` 仍只负责上游业务任务和 Browser dispatch 入队；本轮新增了一个**独立进程**消费 `browser_dispatch_jobs`：

```text
browser-mvp/src/production-readonly-worker.js
deploy/server/pojia-browser-worker.service
```

该进程使用正式共享 MySQL dispatch/run/resource lease/recovery/`abortBeforePayment()`，并实际启动系统 Google Chrome。它当前只有只读观察能力，没有 payment submitter、Session provider、卡材料 provider 或卡台写客户端。因此它修复的是“生产部署没有 Browser 队列消费者进程”的阻塞，但**不等于真实付款 Worker 已完成或生产可用**。

## 运行链

```text
browser_dispatch_jobs
→ 按 BROWSER_EXECUTOR_PROFILE_ID claim，并冻结未绑定 job 的 profile
→ browser_run + dispatch lease
→ execution resource leases
→ Google Chrome persistent context
→ 只读 page contract 观察
→ AppendOnlyWal
→ abortBeforePayment()
→ order/attempt/funds/dispatch/resource 安全收口
```

正式入口支持：

- `--check`：只检查配置、Chrome 可执行文件、状态目录、迁移、数据库付款写开关和 executor profile；不启动 Chrome、不 claim 任务；
- `--once`：最多 claim 并执行一条任务，适合受控 canary；
- 无参数：常驻轮询，支持 `SIGTERM`/`SIGINT` 在当前迭代结束后停止。

## fail-closed 条件

进程必须同时满足：

1. `BROWSER_WORKER_MODE=PRODUCTION_READONLY`；
2. 精确确认词 `RUN BROWSER PRODUCTION READONLY WORKER`；
3. 五个环境写开关都**精确等于** `false`；
4. 数据库 `app_settings.browser_payment_writes_enabled=false`；
5. 配置的 `executor_profiles` 行存在、为 `BROWSER/ACTIVE`，且 `config_public_json.productionWritesEnabled=false`；
6. Chrome 路径可执行，Profile/WAL 目录可写；
7. 环境中不得出现原始 Session、Token、PAN/CVC 或卡台 API key；
8. `LOCAL_FIXTURE` 只接受 `data:text/html,...`；`EXTERNAL_READONLY` 只接受 HTTPS，并需要第二个精确确认词。

任何一项不满足均拒绝启动。普通 stdout/stderr 只记录状态和 reason code；WAL 只接收通过安全合同校验的摘要。

## systemd 边界

`pojia-browser-worker.service`：

- 不运行 `v1/src/worker.js`；
- 不加载 `/etc/pojia/provider.env`；
- 在 unit 内覆盖五个写开关为 false，不复用旧 API Worker 的 `PROVIDER_RECHARGE_WRITES_ENABLED=true`；
- `ExecStartPre` 强制执行 `--check`；
- 使用 `/var/lib/pojia-browser-worker` 保存 Chrome Profile、cache 和 WAL；
- 使用 `ProtectSystem=strict`、`ProtectHome=true`、空 capability；为 Chrome sandbox 保留 namespace 能力，不传 `--no-sandbox`；
- 文件仅提供安装模板，**不会自动 enable/start**。

## 本地 systemd-equivalent smoke

一键命令：

```bash
npm --prefix browser-mvp run smoke:worker:readonly
```

实际执行：

```text
临时 mysql:8.4
→ migrations 001–037
→ fixture ACTIVE/read-only executor profile
→ 正式 CLI --check
→ 非敏感 order/attempt/card/dispatch fixture
→ 正式 CLI --once
→ dispatch claim/profile 冻结
→ browser_run/resource lease
→ 系统 Google Chrome 临时 Profile
→ data: 页面观察
→ WAL
→ abortBeforePayment()
→ 容器/Profile 清理
```

2026-08-27 实跑结果：config/systemd `8/8`，MySQL + 正式 CLI + Chrome `1/1`。数据库终态：

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

## 部署前一次性输入

- 已安装依赖的干净代码提交（`v1` 和 `browser-mvp` 都需安装依赖）；
- AlmaLinux 上可执行的系统 Google Chrome 路径；
- `/etc/pojia/runtime.env` 中的数据库只读/运行连接参数；
- 独立 `/etc/pojia/browser-readonly.env`；
- 唯一 Worker ID；
- 一个明确用于 readonly canary 的 `ACTIVE` Browser executor profile；
- 三个彼此独立的 canonical base64 32-byte key；
- 经批准的本地 fixture 或外部 HTTPS 只读 page contract；
- 数据库迁移 `001–037` 已完成，数据库 Browser payment 写开关为 false。

当前上游创建的 Browser dispatch 可能没有预绑定 executor profile。readonly Worker 会在原子 claim 时把未绑定 job 冻结到自己的 profile；本阶段只能运行一个被批准的 Browser profile/Worker lane，且只能放入非敏感 canary 订单。多 profile 路由必须在后续增加上游显式 profile 选择后再开启，不能让两个不同 runtime 竞争未绑定 job。

## 未验证

- 未在 AlmaLinux/systemd 上真实安装、启动或重启；
- 未连接生产/预生产数据库，未消费真实订单；
- 未访问外部 ChatGPT，未读取真实 Session/PAN/CVC；
- 未填卡、未付款、未调用卡台写接口；
- 未验证服务器 Chrome sandbox、字体/依赖、代理、真实 Profile 恢复；
- 未实现真实 Session/card material/payment submitter 和付款后三方对账。

因此本轮结论仅为：正式独立 readonly Worker 进程和部署模板已完成本地 production-shaped 验证；生产真实单仍不可开始。
