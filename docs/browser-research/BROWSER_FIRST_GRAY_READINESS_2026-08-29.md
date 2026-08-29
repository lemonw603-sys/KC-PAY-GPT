# Browser 首次灰度前生产化就绪检查（2026-08-29）

## 结论

本轮只完成**生产形态的非付款检查与本地隔离验证**。独立 readonly Worker 的启动、领取、
profile 绑定、共享卡片/资金快照、Chrome 观察、WAL 审计和付款前安全收口已经形成闭环；它仍然
不是可处理真实客户充值的付款 Worker。

首单 Browser 灰度现在**不能开始**。主要缺口不是队列或资金状态机，而是正式进程尚未接入：

1. 从共享订单密文按 `sessionRef/orderId` 即时取得 Session 的 production `SessionProvider`；
2. 从共享卡片记录即时取得完整卡资料的 production card-material provider；
3. 真实 ChatGPT 页面非付款观察、页面合同和服务器 Chrome/网络验证；
4. LIVE payment adapter、付款后 Plus/取消续费/卡交易对账的真实实现；
5. 包含 `v1 + browser-mvp` 的候选 release、服务器 `--check`、安装/停止/回滚演练；
6. 上述全部通过后，仍需用户单独确认一单真实付款。

## 本轮基线与边界

- Worktree：`/Users/lemon/.codex/worktrees/9128/AI充值业务`
- 分支：`codex/browser`
- 同步基线：`16cec70`，与当时 `main` 一致，统筹合入的 Browser profile 修复无重复提交或冲突。
- 历史未跟踪目录 `artifacts/browser-checkout-observe/` 未读取、未修改、未提交。
- 未连接生产/预生产，未读取真实 Session/PAN/CVC，未填卡，未付款，未调用卡台写接口，未部署。

## 七项检查结果

| 检查项 | 已证明 | 仍未证明 |
| --- | --- | --- |
| Worker 启动配置 | 独立 CLI、`--check/--once`、系统 Chrome、专用 systemd unit；五个业务写开关和 payment executor gate 均 fail-closed | AlmaLinux 实机依赖、Chrome sandbox、service start/restart |
| 任务领取 | 隔离 MySQL 001–040 中 profile-scoped claim、dispatch→run、同一 job 仅一次执行 | 生产队列和真实订单 |
| Session 上号边界 | 通用 `SessionProviderPort`、Cookie bootstrap、身份探针和 opaque `sessionRef` 测试存在；readonly Worker 明确拒绝 Session 原文 | 共享订单密文到 production SessionProvider 的正式接线；真实页面登录/账号一致性 |
| 卡片/资金快照 | adapter/权威快照要求 order/attempt/card/route/provider/profile 一致，消费账本为同 attempt 的 `RESERVED`；安全退出转 `RELEASED` | production card-material provider、真实卡资料填写和 Provider 实时交易核对 |
| 失败恢复 | 租约丢失、崩溃、重复投递、页面/route/card 漂移、数据库重启已有隔离证据；付款前走 `abortBeforePayment()` | 服务器进程/Chrome/代理真实故障、付款后的外部 UNKNOWN 对账 |
| 审计证据 | `browser_run.id` 为执行/审计引用；WAL 哈希链、敏感字段拒绝、后台 dispatch/run 只读追溯已测试 | 生产日志采集、WAL 轮转/备份及运营页面实机验收 |
| 部署/回滚 | 候选 unit/env、启动前 `--check`、Browser 专属 stop/disable/previous-release 回滚命令已落盘 | 未构建/安装候选 release，未在服务器演练 |

## 本轮发现并修复

### 1. Readiness 仍停在 migration 037

production-readonly Worker 原来只检查 `037_card_discovery_latest_index`，但当前 Browser 权威快照已经
依赖 migration 039 的消费预留 attempt 绑定，共享核心基线已到 040。现在 `--check` 同时要求
`039_card_consumption_attempt_link` 和 `040_card_operational_overrides`；缺任一项都拒绝启动。

### 2. CLI 未强制 payment executor gate

systemd unit 虽然固定 `BROWSER_PAYMENT_EXECUTOR_ENABLED=false` 和 `MODE=MOCK`，直接运行 CLI 时配置
加载器原先不验证这两项。现在两项都必须精确匹配；readonly Worker 仍未导入任何 payment submitter。

### 3. Smoke fixture 未携带新增 gate

第一次复验因此按预期 fail-closed，错误为 `INVALID_BROWSER_WORKER_CONFIG`。已只修正测试 fixture 的
环境项并重跑，正式 CLI `--once` + MySQL + Google Chrome 通过。没有放宽运行时检查。

### 4. 部署口径和回滚入口过旧

`deploy/README.md` 与 readonly Worker 文档的 `001–037` 已更新为 `001–040`；补充 Browser 单元专属
stop/disable/previous-release 回滚和回滚后检查。`Requires=docker.service` 保留：当前生产 MySQL 是
本机 Docker 容器，其他 v1 runtime 单元也依赖它；Browser 代码本身不调用 Docker。

## 验证证据

```bash
npm --prefix browser-mvp run smoke:worker:readonly
```

结果：config/systemd **8/8 passed**；共享 MySQL mock payment 状态机和正式 readonly CLI +
Google Chrome **3/3 passed**。后者实际 claim Browser dispatch、建立 run/lease、打开本地 fixture、写 WAL、
调用 `abortBeforePayment()`；没有外部付款调用。

```bash
npm --prefix browser-mvp test
```

结果：**90 tests / 86 passed / 4 skipped / 0 failed**。4 个 skip 都要求显式隔离 `TEST_DATABASE_URL`；
其中生产 Worker 和共享 dry-run 的 MySQL 路径已由本轮独立命令实际覆盖。

```bash
BROWSER_DRY_RUN_ENV=isolated-fixture \
BROWSER_PAYMENT_WRITES_ENABLED=false \
PROVIDER_WRITES_ENABLED=false \
PROVIDER_CARD_WRITES_ENABLED=false \
PROVIDER_RECHARGE_WRITES_ENABLED=false \
CARD_FUNDING_WRITES_ENABLED=false \
npm --prefix browser-mvp run dry-run:shared
```

结果：隔离 MySQL 8.4、migration 001–040、共享 dispatch/run/Chrome/safe-abort **1/1 passed**。

## 距离首单灰度的最短顺序

1. 在 Browser 分支实现并测试共享 Session/card-material 的 production adapter，但仍只跑非付款页面观察；
2. 统筹构建包含 `v1 + browser-mvp` 的候选 release，在服务器保持 dispatch/payment false 执行 `--check`；
3. 用专用非客户测试账号做真实 ChatGPT 页面非付款观察，冻结页面/Session/网络合同；
4. 接通 LIVE payment/post-payment adapters，先用 mock/隔离状态机和故障注入验证；
5. 完成部署/停止/回滚演练和付款前最终审查；
6. 用户单独确认后才执行一单真实 Browser 付款。
