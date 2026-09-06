# 真实单笔测试方案 × 代码审查 交叉校验（2026-08-24）

> 作者：接班执行模型（本窗口）。用途：用 2026-08-24 全项目审查的**代码发现**去校验并加固 `REAL_E2E_SINGLE_ORDER_TEST_PLAN_2026-08-24.md`，补它的盲点，把清单落到可执行核对。
> 性质：只读分析，未改代码/生产。**不替代**原方案，配套阅读。
> 前提（用户确认）：当前阻塞在卡台 HNSKJ 升级（开卡/卡余额充值写不可用），我方服务器正常。故本文只做"卡台恢复后可立即执行"的前置准备。

## 一、原方案硬闸门 → 可执行核对（代码依据）

原方案"二、开始前硬闸门"多为人工清单。以下把可自动核的项对到 `npm run preflight:readiness`（`src/diagnostics/readiness-audit.js`）的实检：

| 原方案闸门 | 自动核对 | 代码实检 |
|---|---|---|
| `expired_task_leases=0` | ✅ readiness `no_expired_task_leases` | tasks 中 PENDING/RUNNING 且 `leased_until<now` |
| `uncertain_provider_calls=0` | ✅ readiness `no_uncertain_provider_calls` | provider_calls `outcome IN (STARTED,UNKNOWN)` 且超 2 分钟 |
| `active_or_unknown_funds_risk=0` | ✅ readiness `no_active_funds_risk` | recharge_attempts `funds_risk_state IN (ACTIVE,UNKNOWN)` |
| Browser 队列空（原方案未列，**审查补**） | ✅ readiness `no_active_browser_dispatch` | browser_dispatch_jobs `PENDING/CLAIMED/RUNNING` |
| DB 就绪 | ✅ readiness `database_ready` | `checkDatabaseReady` |
| 接单/派发/写开关现值 | ✅ readiness `settings` | app_settings 三键回显 |

**命令**：`cd v1 && npm run preflight:readiness`（`report.ok=false` 时退出码 2）。

**审查发现的安全前提**：readiness 脚本在**任意 Provider 写开关开着时拒绝运行**（`preflight-readiness.js:5-11`）。所以正确时序是——先在写开关**全关**下跑 readiness 全绿 → 再按最小范围开写开关做那一单 → 测完立即关回。不能先开写开关再体检。

## 二、审查发现的测试风险点（原方案盲点，必须先知道）

### 风险 1【高】：开接单会联动打开派发
- 代码：`admin-operations-service.js:35-40`——`setOrderAcceptance(enabled=true)` 会**强制** `dispatch_new_recharges='true'`；`enabled=false` 不关派发。
- 对测试的影响：原方案 B-3"临时开启接单"的**同一瞬间，派发也被打开**。若此刻数据库里存在其他处于可派发状态的订单（历史滞留单、其他测试单），它们会被 Worker 自动派发充值——**不在本次单笔控制范围内**。
- 对策：开接单前，先确认**除本测试单外，没有任何订单处于 `CARD_READY`/可派发态**（见风险 3 的 SQL）；或全程用 `recharge_dispatch_mode=MANUAL`，靠单笔 Permit 精确放行，即使派发开关被联动打开也不会自动履约无关订单。
- 关接单不关派发：测试收尾要**分别**关 `accept_new_orders` 和 `dispatch_new_recharges`（关接单不会替你关派发）。

### 风险 2【高】：卡台升级是当前唯一阻断
- 原方案第一闸门"卡台升级已结束、HNSKJ 只读检查成功"当前为 **FALSE**。
- 恢复后必须先重跑只读合同，确认无 Schema/状态漂移：`npm run provider:read-check`、`npm run card:catalog-sync`（只读同步）、核对卡台账户余额与卡目录同步时间。
- 未确认卡台只读合同前，不得进入任何开卡/补卡/充值写。

### 风险 3【中】：卡片核验 15 分钟时效（CARD_CHECK_STALE）
- 代码：`recharge-attempt-repository.js:161`——卡片 `last_synced_at` 超 15 分钟即 `CARD_CHECK_STALE`，充值 attempt 无法开始。
- 对策：授权/派发**前**手动触发一次该卡只读同步，确保 15 分钟内新鲜。历史真实测试就曾首次 `CARD_CHECK_STALE`、只读同步后才过。

### 风险 4【中】：确认"只有这一单可派发"的直接核对
测试前用只读 SQL 确认无其他可派发/在途订单（补 readiness 未覆盖的业务态）：
```sql
-- 期望结果全为 0（除即将测试的那一单）
SELECT status, COUNT(*) FROM orders
 WHERE status IN ('CARD_READY','SUBMITTING','RECHARGE_PROCESSING','SUBMIT_UNKNOWN','WAITING_FOR_CARD')
 GROUP BY status;
```

### 风险 5【低】：资金栅栏与 UNKNOWN 的预期行为（测试时不要误判为 bug）
- 一个订单已有 `ACTIVE/UNKNOWN/SETTLED` attempt 时再次派发会被 `FUNDS_FENCE_EXISTS` 拒绝——这是**正确**的防重复扣款，不是故障。
- 提交结果未知 → `SUBMIT_UNKNOWN`/`funds_risk=UNKNOWN`，**不会自动重试**；此时按方案进入人工对账，不要手动重发。

## 三、卡台恢复后的最小执行顺序（把审查约束串起来）

1. 确认写开关全关 → `npm run preflight:readiness` 全绿（含 Browser 队列空）。
2. `npm run provider:read-check` + 只读卡目录同步 → 卡台合同无漂移，记录卡台账户余额。
3. 只读 SQL 确认无其他可派发订单（风险 4）。
4. 生成 1 枚 Plus CDK（记录批次，本单不作废）。
5. 开接单（**注意派发被联动打开**）；客户提交 CDK+Session 后**立即分别关**接单与派发。
6. 分配合格库存卡；派发/授权前手动只读同步该卡（避免 CARD_CHECK_STALE）。
7. 按最小范围开必要 Provider 写开关 → 执行**一次** create → 轮询结果。
8. 成功后取消续费，仅 `is_subscription_cancelled=1` 判最终成功；未知进等待/人工，不重发。
9. 收尾：关全部写开关 + 接单 + 派发 → 再跑一次 readiness 全绿 → 双向追溯与资金对账（按原方案 E 节）。

## 四、并发与目标量的现实边界（审查结论）

- 本单必须并发 1（原方案已定）。
- 200–300 单/天**从未在生产拓扑压测**；Browser 侧的 soak 全是隔离窄范围合成负载、单 MySQL 无高可用（D-115）。真实成功单稳定前不谈放量。

## 五、未由本文关闭的事项

- 卡台升级完成时间未知（外部依赖）。
- 真实成功链路、新卡付费开通、SUBMIT_UNKNOWN 真实人工对账、退款、取消续费真实样本仍全部未验证。
- 本文所有 SQL/命令为准备用途；实际现场值需在卡台恢复且获授权后填入原方案"五、测试结果记录"。
