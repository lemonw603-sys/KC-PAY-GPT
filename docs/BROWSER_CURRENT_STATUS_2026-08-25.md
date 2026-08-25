# Browser 当前状态（2026-08-25）

## 事实快照

| 项目 | 当前事实 |
| --- | --- |
| worktree | `/Users/lemon/.codex/worktrees/9128/AI充值业务` |
| 分支 | `codex/browser` |
| 当前 HEAD | `bb9429d` |
| 当前阶段 | M6：上游只读投影 → Browser 非付款执行模拟 |
| 跟踪改动 | 无 |
| 未跟踪改动 | `.playwright-cli/`、`artifacts/` |
| Browser MVP | `browser-mvp/` M0–M5 已完成；共享控制面写路径仍未接入 |
| 生产/真实付款 | 未接入、未执行 |

## 当前阶段

阶段 M6：共享合同只读兼容层和上游非付款执行模拟已完成。当前不是新版 BRFE 阶段 A/B/C 的完成状态；新版控制面和共享适配器写路径尚未进入本分支。

## 本分支已验证

- 旧 v1 隔离边界、Worker runtime、Provider PoC 定向测试：8/8 通过。
- 全量 v1 测试：75 pass；3 个测试文件因缺少 `express`/`mysql2` 启动失败，结果不能记为全量通过。
- 旧 Browser PoC JSON 产物存在于 `artifacts/browser-poc/`，尚未纳入当前分支追踪。
- `browser-mvp` contract tests：4/4 通过；`node --check`：通过。
- `FileDispatchStore` 并发/租约测试：3/3 通过（总测试 7/7）。
- 本地 Chromium BrowserContext/执行器测试：4/4 通过（总测试 11/11）；漂移、租约丢失、冻结、超时均 fail-closed。
- WAL/重启/reconcile-only 测试：3/3 通过（总测试 14/14）；截断/篡改均阻断恢复。
- 10 分钟 soak：601439ms、5328/5328 完成、重复 0、错误 0、残留 0、WAL 15984 条；报告位于 `/var/folders/vv/y6273_2s7n98r55m2rc96p_w0000gn/T/browser-mvp-soak-SOtfzq/report.json`。
- 共享合同只读适配器与 SessionProvider 合同测试：6/6 通过（总测试 20/20）；active permit 和敏感源字段均拒绝，Session 仅保留 opaque ref/lease 预留。

## 本分支未验证

- 新版 BRFE Browser Worker/control-plane 接线；
- 生产 artifact vault、账号/订单/卡片/Checkout 资源租约；
- BrowserContext 与共享 Worker 的生产接线；
- 新版 BRFE `NON_PH_FUNCTIONAL` 合同与共享状态适配；
- 菲律宾 cohort、真实 Session、Checkout、付款、生产 Worker、高可用拓扑。
- `recharge_attempts`、资金 permit、审计关联仍需统筹窗口冻结；当前不进入共享写路径或真实付款。

## 暂停条件

- 不把其他 worktree/分支的 commit 当成本分支事实；
- 不删除或覆盖 `.playwright-cli/`、`artifacts/`；
- 不修改非 Browser 共享核心、生产 release 或共享事实源；
- 不执行真实付款、开卡、卡余额充值或生产 Browser 写入。

## 下一步

在 Browser-only 范围建立隔离 MySQL 只读 projection adapter 合同测试：读取冻结的订单/attempt/card/route/readiness 投影，送入现有 `projectUpstreamBrowserJob()` 和非付款模拟；不接共享写入、真实 Session、Checkout、Provider 写入或真实 Browser 付款。

## M7 隔离 MySQL 只读合同

- 新增 `browser-mvp/src/mysql-upstream-adapter.js`：使用参数化单次 SELECT，仅读取统筹层冻结的 `browser_upstream_ready_projection` 视图字段；无写方法、无凭据列、无 Provider 调用。
- `rowToProjection()` 只生成 Browser 所需的订单/attempt/profile/cardRef/routeRef/readiness/sessionRef/auditRef；任何凭据形状列直接拒绝。
- 共享状态 `PREPARED` 尚未被自动翻译为 Browser `PENDING`；adapter 会拒绝该行并暴露合同未冻结问题，避免静默改变状态语义。
- 当前本地没有 MySQL 实例，且共享 worktree 尚未提供该视图，所以未做真实数据库连接验证；仅完成 fake mysql2-like pool 的合同测试。
- `npm --prefix browser-mvp test`：**27/27 passed**；`npm --prefix browser-mvp run check`：通过；`git diff --check`：通过。

## 2026-08-26 卡台与非 Browser 事实补充

- 已按代码和隔离测试核实 HNSKJ 卡台的开卡、既有卡补余额、卡片就绪和库存接管语义；详见 `docs/browser-research/nonbrowser-card-funding-and-recharge-map-2026-08-26.md`。
- 非 Browser worktree 的卡片补余额实现属于 `card_funding_attempts` 资金动作，不等于 Browser 的 Plus `recharge_attempt`；当前 Browser 分支未接入它。
- 用户已确认 Browser 的上游是卡台 API + 运营后台；当前 worktree 仍无共享 MySQL adapter、真实卡片引用接线、真实 Session provider、Checkout artifact 或支付 permit。
- 本轮没有修改非 Browser 共享核心、没有调用卡台写接口、没有执行真实付款。
- 调用策略：卡台/Provider 读取改为快照复用、关键阶段读取、递增轮询；安全状态保留，不以删状态换取少调用。

## 2026-08-26 上游非付款接线切片

- 新增 `browser-mvp/src/shared-contract-adapter.js` 的 `projectUpstreamBrowserJob()`：只接受 `cardRef`、`routeRef`、`providerAccountRef` 和带有效期的 `cardReadyEvidence`，校验卡片/路线匹配、库存为 `AVAILABLE`、路线为 `ACTIVE/BROWSER`；不读取或复制 PAN/CVV/Session/API key。
- 新增 `browser-mvp/src/nonpayment-simulation.js`：把上游投影送入 dispatch、claim、隔离 BrowserContext 和证据 sink；明确不提供支付提交能力。
- 新增 `browser-mvp/test/upstream-simulation.test.js`：投影拒绝过期/错配/非 Browser 路线，并验证非付款闭环。
- 本轮 Browser 测试从 20/20 增至 **23/23**；`npm --prefix browser-mvp run check` 通过。
- 这仍是本地合成上游投影，不是 MySQL 生产 adapter，不是真实 Session/Checkout，也不是付款验证。

## 关键动作提醒（运营/审计可见性）

后续任何会产生扣款、冻结或消费的动作，必须记录并可在后台追溯：动作类型、provider account、cardRef/card ID、order/attempt/browser run、幂等键、provider call ID、动作前余额、预计/实际扣款、手续费、动作后余额、外部引用和对账状态。卡台账户余额、卡片余额、卡片补余额、Plus 实际消费金额分栏展示，不能合并成一个金额。M6 仅有 `intent/checkpoint` 观察证据，`submitCalls=0`，无付款副作用。
