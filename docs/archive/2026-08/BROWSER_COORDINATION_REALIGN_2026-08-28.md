# Browser 工作线重新对齐（2026-08-28）

## 为什么重新对齐

Browser 曾因真实 API 客户订单临时暂停；随后主线完成 API 成功单、卡片同步部署和消费账本 migration 038/039。不能从旧停止点直接继续，必须先核对分支、主线和生产。

## 已确认状态

### 主线代码

- Browser gated payment executor、默认关闭 payment gate、MySQL mock 成功/UNKNOWN 状态机和 production-readonly Worker 相关历史提交已经进入 main。
- 当前 main 已新增一卡多充消费账本；Browser 付款前必须持有与 attempt/order/card 一致的 `RESERVED` 账本记录。

### Browser 独立分支

- worktree：`/Users/lemon/.codex/worktrees/9128/AI充值业务`
- branch：`codex/browser`
- 已在最新 main 之上有 1 个未合入提交 `e165314`：后台展示 Browser dispatch 队列。
- 因统筹窗口过早恢复任务，worktree 产生 6 个未提交文件：正在把 Browser adapter/权威付款快照接到 migration 039 的消费预留；尚未完成正式测试和提交。该改动已暂停并保留，不视为已完成。
- 历史未跟踪 `artifacts/browser-checkout-observe/` 保持不动。

### 生产运行

- 当前 release：`/opt/pojia/releases/20260828-card-ledger-43ab997`，只包含 `v1/`，不包含 `browser-mvp/`。
- Browser 数据库 migration/表存在；`browser_dispatch_enabled=false`、`browser_payment_writes_enabled=false`；当前 Browser jobs/runs 均为 0。
- `pojia-browser-worker.service` 已安装但 disabled/inactive；它仍指向 `/opt/pojia/current/browser-mvp/...`，当前 release 不含该路径，因此现在不能启动。
- 旧 production-readonly Worker 曾在 2026-08-27 用 LOCAL_FIXTURE 短时启动并安全停止；后续 release 切换没有保留 Browser runtime 包。不能把旧 smoke 写成当前生产可运行。

## 准确停止点

Browser 的控制面和 mock 付款状态机已实现；当前真正要完成的是：

1. 将 Browser adapter 与消费账本 `RESERVED` 合同接通并通过 migration 039 隔离 MySQL；
2. 审核并合入 dispatch 后台只读提交；
3. 重新构建包含 `v1 + browser-mvp` 的候选 release，但仍保持 dispatch/payment 关闭；
4. 先做生产只读 fixture smoke，再做共享非付款 dry-run；
5. 真实 Session/外部 ChatGPT/付款均另行确认。

## 分工边界

- Browser 窗口只做 adapter、非付款状态链、故障注入和候选包证据。
- 统筹窗口负责共享库存资格、账本合同最终审核、合并、生产包和运行闸门。
- Browser 窗口不得直接启动生产服务或执行真实付款。
