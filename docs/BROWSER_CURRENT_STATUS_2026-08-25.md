# Browser 当前状态（2026-08-25）

## 事实快照

| 项目 | 当前事实 |
| --- | --- |
| worktree | `/Users/lemon/.codex/worktrees/9128/AI充值业务` |
| 分支 | `codex/browser` |
| 基线 HEAD | `bd9f05b` |
| 当前交接提交 | `7a831ae` |
| 跟踪改动 | 无 |
| 未跟踪改动 | `.playwright-cli/`、`artifacts/` |
| Browser MVP | `browser-mvp/` M0–M5 已完成；共享控制面写路径仍未接入 |
| 生产/真实付款 | 未接入、未执行 |

## 当前阶段

阶段 M5：共享合同只读兼容层已完成。当前不是新版 BRFE 阶段 A/B/C 的完成状态；新版控制面和共享适配器写路径尚未进入本分支。

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

M5 只读兼容层已完成；等待统筹窗口评审未决合同，保持 Browser-only 隔离，不接共享订单写入、MySQL 写入或真实 Browser 付款。

## 2026-08-26 卡台与非 Browser 事实补充

- 已按代码和隔离测试核实 HNSKJ 卡台的开卡、既有卡补余额、卡片就绪和库存接管语义；详见 `docs/browser-research/nonbrowser-card-funding-and-recharge-map-2026-08-26.md`。
- 非 Browser worktree 的卡片补余额实现属于 `card_funding_attempts` 资金动作，不等于 Browser 的 Plus `recharge_attempt`；当前 Browser 分支未接入它。
- 用户已确认 Browser 的上游是卡台 API + 运营后台；当前 worktree 仍无共享 MySQL adapter、真实卡片引用接线、真实 Session provider、Checkout artifact 或支付 permit。
- 本轮没有修改非 Browser 共享核心、没有调用卡台写接口、没有执行真实付款。
