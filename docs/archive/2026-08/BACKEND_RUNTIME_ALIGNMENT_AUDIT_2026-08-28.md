# 后端代码与生产运行对齐审计（2026-08-28）

## 范围

本次核对当前 `v1` 后端目录、migration 001–039、卡片资格/同步/消费账本、API/Browser repository 和生产 VPS 运行状态；生产仅做 SSH、Provider 与数据库只读查询，未修改状态、未开卡、未充值、未付款。

## 生产事实

- 当前 release：`/opt/pojia/releases/20260828-card-ledger-43ab997`；Web active。
- Worker inactive；Browser Worker inactive；付费补卡 timer inactive；卡片只读同步、卡目录同步和 Bark active。
- 接单 `false`、派发 `false`、模式 `AUTOMATIC`；migration 最新为 039。
- readiness 当前 `ok=false`，唯一 blocker 为 `worker_heartbeat_stale`；存在 1 个活动 PENDING task。活动/UNKNOWN 资金风险为 0。
- HNSKJ 只读：19 张可见卡。Provider 中存在 `1477/6807`、`1065/4744`、`917/7923` 等 active 卡。
- 本地 `cards` 只有 6 张；`1065/4744` 和 `917/7923` 未进入 `cards`，而是在 `card_discoveries` 中反复处于 `REVIEW_REQUIRED`，原因是 `CARD_TYPE_MISSING`。
- `1477/6807` 本地为 `ASSIGNED`，绑定成功订单 `PJV1-FqFnMiSKBtLGN14GyP7W`，余额 `$0.07`，取消续费已确认；因此“运营上仍能工作的卡”不等于“当前可直接分配的 Plus 库存”。
- 现有本地失效卡仍可能显示 Provider `active` 和本地 `AVAILABLE/DEPLETED/ASSIGNED`；Provider active 不能代表业务可分配。

## 对统一规划的纠正

1. 不能假设 4744 已存在于 `cards` 后直接加字段；它当前只有 discovery 记录。最小实现必须同时覆盖“已接管 cards”和“尚未接管的 Provider 卡”。
2. 为避免新增复杂策略服务，优先采用一个极小的 Provider 卡运营覆盖表（按 provider account + external card id），资格查询和 intake/sync 共用；`cards` 可投影其结果，但不是唯一事实入口。
3. 当前没有可直接分配的 Plus 成品库存：6807 已绑定且余额 `$0.07`；4744 是 Claude 专用且不在本地 cards；其他现有卡永久不可用。因此下一真实 Plus 单需要新开/补资金后的新卡，不能靠现有可分配统计。
4. Worker/付费补卡 runner 当前停用，readiness 因 Worker 心跳过期失败；在它们恢复并重新通过 readiness 前，不能宣称自动履约生产链已就绪。
5. Browser 可继续非付款 adapter/故障注入，但在共享卡片覆盖规则落地、readiness 恢复和单独确认前不能进入真实付款。

## 未改变的结论

- 双线并行仍合理；Browser 与 API 必须共用订单、资格、资金栅栏和消费账本。
- 不新增微服务、消息系统或第二套库存系统。
- 历史交易、订单、discovery 和审计证据保留；后台展示后续收敛而非先删除数据。

## 下一步

1. 先实现最小 Provider 卡运营覆盖数据结构和查询；
2. 接入 intake/sync、统一 Plus 分配资格和后台只读展示；
3. 用 6807、4744、8590、7923 及其他现有失效卡做隔离 MySQL 回归；
4. 并行继续 Browser 非付款 adapter；
5. 生产只读复核通过后，再单独确认写入现有卡运营规则和恢复运行服务。
