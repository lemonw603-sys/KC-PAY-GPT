# Browser Worker 进程入口阶段性对抗审查

日期：2026-08-22
范围：durable dispatch queue、Worker control shell、iteration/process wrapper
边界：仅 mock/local runtime；未启动真实浏览器、未加载真实 Session、未创建 Checkout、未付款

## 判定

**控制面方向通过；真实 BrowserContext 阶段暂不自动进入，需用户确认。**

当前代码已经能安全地表达 `claim → beginRun → action guard → complete`，但它仍是可注入的 Worker 进程控制壳，不是已经接入主 worker 的生产进程，也不是可执行真实页面的 Worker。

## 已验证

- dispatch job 以 `job_key` 和 attempt 双重幂等；不保存 Session、卡片或 Checkout authority。
- claim 使用 `SKIP LOCKED` 和短租约；heartbeat 验证 owner、token 和租约有效期。
- 每个 runtime action 前都会 heartbeat 并读取 run recovery state。
- lease 丢失、`RECONCILE_ONLY` 或终态时，在 runtime 调用前失败关闭。
- job 只有在持有 lease 且最新 Browser run 为 `COMPLETED` 时才能完成。
- Worker process wrapper 强制 `LOCAL_MOCK` runtime manifest。

## 对抗性发现

| 编号 | 级别 | 发现 | 影响 | 下一步 |
|---|---|---|---|---|
| WPR-P1-01 | P1 | queue claim、beginRun、页面动作不是一个跨 repository 事务；Worker 在 claim 后崩溃会留下短期 CLAIMED job。 | 不会重复付款，但会增加恢复延迟和租约堆积。 | 保留保守过期接管；真实 Worker 接入前增加 crash-after-claim/after-beginRun 计时和 backlog 指标。 |
| WPR-P1-02 | P1 | heartbeat 只发生在动作前；单个长导航/等待如果超过 lease，动作本身可能仍在 runtime 内运行。 | 旧页面动作可能在 lease 过期后继续，尤其是不可中断的浏览器调用。 | 为 runtime action 增加可取消 timeout、动作中 heartbeat 或 page-level abort signal；付款动作前必须再次同步检查。 |
| WPR-P1-03 | P1 | `resolveExecutionContext` 目前是注入接口，还没有绑定真实 Session vault、profile manifest 和 account identity HMAC 的安全 repository。 | 真实 Worker 可能拿到错误账号或漂移 profile。 | 真实页面阶段前实现受控 resolver，并绑定 account HMAC、profile hash、network lease 和 Session evidence。 |
| WPR-P1-04 | P1 | process wrapper 目前是模块，不是带信号、健康检查和优雅退出的独立 OS 进程入口。 | 无法证明真实部署中的停止、重启和租约恢复行为。 | 在 mock runtime 下补独立进程 smoke、SIGTERM、崩溃和重启测试，再接真实 BrowserContext。 |
| WPR-P2-01 | P2 | loop 没有内建 queue backlog、lease age、action latency 和 stop reason metrics。 | soak 时难以判断吞吐和人工 SLA。 | 在并发 soak 前补指标 schema 和告警。 |

## 必须保持的停止条件

- 任何真实 Session/卡片/Checkout 进入 Worker 前，必须先完成本报告 WPR-P1-02/03/04 的 mock/隔离验证。
- 任何付款动作前，仍需独立 payment permit、同 Context 页面证据和用户当次确认。
- 不能因为 job lease 过期而自动换卡、换 lane 或重建 Checkout。

## 证据

- Worker/dispatch/process 定向测试：12/12 通过。
- v1 全量测试在本节点前一轮为 348/348 通过（32 跳过）；本节点只增加隔离 Worker 代码和测试，未改变 Provider 生产分支。

## 后续修订状态

审查后的 mock/隔离补强已完成：动作中 lease watchdog、`accountKeyHmac`/profile manifest/network lease digest 校验、process stop smoke、子进程 SIGTERM/崩溃重启已加入；最新相关测试 9/9 通过，v1 最新结果为 353 通过、34 跳过、0 失败。子进程 smoke 仍使用内存 mock service，不能替代真实数据库重启验证；真实 runtime 仍未获准。

## 当前进入条件

控制壳现在可以进入一次**用户当次确认的真实但不付款 BrowserContext 观察**。该阶段只允许读取 Session/账号身份、页面状态和 Checkout 只读/非付款证据；仍禁止真实卡片、付款提交、自动换卡、未知结果重试和生产 Worker。进入前必须冻结候选 runtime、profile、network manifest，并为每个观察 cohort 记录出口证明和身份 HMAC。
