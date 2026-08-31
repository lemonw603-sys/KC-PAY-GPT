# 项目规划地图权威纠偏｜2026-08-31 13:30 CST

## 结论

原 `PROJECT_MAP.md` 和 `CURRENT_STATE.md` 未在付款前 hold 演练及清理后同步更新，已经不能代表当前生产。最严重错误是仍写旧 release、API 权限 true、readiness 通过；生产现场恰好相反。

本轮没有只追加“错误记录”，而是直接重写当前事实源，并把 ROADMAP 的旧快照显式降级。

## 现场证据

- `/opt/pojia/current` → `/opt/pojia/releases/20260831-prepayment-hold-55b6ec4`
- Web/Worker active；Browser Worker inactive/disabled。
- Worker 进程：通用 Provider、卡片、API 充值写均 false。
- Provider recharge account：read=1、write=1、circuit=CLOSED。
- app settings：接单=true、派发=true、自动开卡=true、自动补余额=true、每卡成功次数=3。
- 只读 readiness：`ok=false`，唯一 blocker `api_recharge_execution_disabled`；活动任务、UNKNOWN、资金风险、开放对账均 0。
- 自动开卡、funding、funding reconcile timers 均 active。

## 代码合同

- “开始营业”先做路线/执行器/卡供给 readiness，通过后只打开接单与派发；派发失败会补偿关闭接单。
- 它不修改 systemd 或 Provider account，不负责打开 API 写权限。
- API 权限关闭时 readiness `actionId=null`，后台没有跳转按钮；其余卡台路线、Browser、对账、卡库存、卡余额充值和 Provider 规则有 action 映射。
- 开始营业 readiness 不是逐单 Session、卡证据、账号资格或 Provider 响应检查；后者属于订单运行时门禁。

## 已修正文件

- `docs/PROJECT_MAP.md`：重写为目标、生产事实、营业合同、板块状态和唯一顺序。
- `docs/CURRENT_STATE.md`：重写为当前快照，移除大段会误导接班人的历史堆积。
- `docs/ACTIVE_WORKSTREAM.md`：更新精确停止点。
- `docs/ROADMAP.md`：顶部标明最新纠正，历史段落不得覆盖地图。
- `docs/HANDOFF_LOG.md`：补充本轮证据和修正动作。

## 当前唯一下一步

恢复已确认的生产常驻最小 API 权限：只把 Worker `PROVIDER_RECHARGE_WRITES_ENABLED` 设为 true，保持 hold、通用 Provider 写、普通卡片写和 Browser 付款关闭；重跑 readiness 后再接真实订单。

本轮未执行付款、Provider 写、开卡、补余额、退款、提现或任何生产状态修改。
