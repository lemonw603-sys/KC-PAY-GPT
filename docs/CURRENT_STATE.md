# 当前生产状态快照｜2026-08-31 13:30 CST

> 只保留当前有效事实；历史过程查 `HANDOFF_LOG.md`，方向与顺序查 `PROJECT_MAP.md`。
> 本快照已现场核对生产 release、systemd、Worker 进程环境、数据库 Provider account 和只读 readiness。

## 1. 代码、release 与服务

- 本地主线：`main@c472854`；工作区除未跟踪 `output/` 外无其他改动（本次文档修正前）。
- 生产 `/opt/pojia/current`：`/opt/pojia/releases/20260831-prepayment-hold-55b6ec4`。
- `pojia-web.service=active`；`pojia-worker.service=active`。
- `pojia-browser-worker.service=inactive/disabled`。
- 自动开卡 timer、卡余额 funding timer、funding reconcile timer 均 active；最新 migration 为 `044_operator_alert_actionability`。
- 付款前 hold 的临时 drop-in 已移出运行配置，测试订单已正式清理；当前不处于 hold 演练。

## 2. 当前营业与执行门禁

- `acceptNewOrders=true`。
- `dispatchNewRecharges=true`，模式 `AUTOMATIC`。
- 默认充值方式：API。
- Worker 实际进程环境：
  - `PROVIDER_WRITES_ENABLED=false`
  - `PROVIDER_CARD_WRITES_ENABLED=false`
  - `PROVIDER_RECHARGE_WRITES_ENABLED=false`
- 数据库 recharge Provider account：`read_enabled=1`、`write_enabled=1`、`circuit_state=CLOSED`。
- 因 Worker 进程门禁为 false，数据库账户允许写也不能执行 API 最终充值。
- 只读 readiness：`ok=false`；唯一 blocker 为 `api_recharge_execution_disabled`；活动任务、过期租约、UNKNOWN Provider 调用、活动资金风险和开放对账案件均为 0。

### 当前结论

生产目前是**业务开关已营业，但 API 最终执行权限关闭**的半开状态，不能直接承诺客户订单会自动充值完成。该状态与已确认的“API 最小充值权限长期常开”基线冲突；下一步必须先恢复 `PROVIDER_RECHARGE_WRITES_ENABLED=true`，其余写门禁继续关闭，并重跑 readiness。

## 3. “开始营业”当前真实行为

代码会先检查：

1. 默认 API/Browser 路线是否可识别；
2. 所选执行器是否健康且具备真实执行能力；
3. 卡供给是否可直接满足，或能由自动补余额/自动开卡恢复；
4. 自动开卡时 Provider 快照、开卡能力和默认卡段是否就绪。

无 blocker 后才打开接单与自动派发；派发开启失败时补偿关闭接单。该入口不会修改 systemd、Provider account 或资金写权限。

已有跳转：卡台路线、Browser、对账、卡片库存、卡余额充值、刷新 Provider 规则。API 充值进程权限关闭目前只显示文字、没有“去处理”跳转。

## 4. 自动补给与卡片规则

- `card_balance_recharge_enabled=true`，独立 funding service/timer 已开启；仅真实订单遇到合格低余额卡时创建精确差额 attempt。空闲零 Provider 写调用已验证，首笔真实补余额闭环尚未验收。
- 自动开卡已开启：真实无卡需求时按当前默认卡段开一张目标余额卡；60 秒 timer 只兜底，无需求时不刷新 Provider。
- 每卡最大成功支付次数全局设置为 3（可在 1–4 调整）；跨订单容量代码已部署，连续真实订单计数/释放/上限仍待验收。
- `4744/1065=PRODUCT_ONLY(claude)`；当前旧失效批次（含 8590）均 `RETIRED`；未来新卡按实时证据接管，不使用永久卡号白名单。
- 15 分钟资料/交易证据要求触发按需只读刷新，不把订单年龄本身当失败。

## 5. 已验证与未验证

### 已验证

- 至少两笔历史真实 API 成功订单，并完成取消续费。
- 付款前暂停演练：订单走到 `SUBMITTING`/唯一 attempt/资金栅栏，在外部 `create_direct` 前停止；没有真实付款。
- 演练清理：测试订单为 `RECHARGE_FAILED`，attempt/funds fence 清除，task 保持 DEAD，避免自动重试。
- Worker executor capability 传递缺陷已修复并有测试覆盖。
- 自动补余额空闲安全：无订单时零 Provider 充值写调用。

### 尚未验证

- 当前 release/config 恢复 API 常驻最小权限后的下一笔真实订单。
- 低余额卡精确补款→到账→原订单自动继续的生产闭环。
- 无合格卡时唯一自动开卡→订单继续的生产闭环。
- 一卡跨 3 个订单的真实计数和上限停止。
- 当前主线的 Browser 生产非付款闭环与任何真实 Browser 付款。
- 3–5 单连续 API 稳定性、10–20 单并发、恢复演练和 100–300 单/日。

## 6. 当前唯一下一步

1. 恢复 Worker 常驻最小 API 充值权限为 true；确保 hold 关闭，通用 Provider/卡片写与 Browser 付款仍关闭。
2. 重启后验证 readiness `ok=true`、Worker 能力心跳 true，且活动测试任务/资金风险仍为 0。
3. 再接受下一笔真实 API 订单，并尽量同时验收自动补余额或自动开卡。
4. 通过后进入 3–5 单连续 API 验收；Browser 非付款线并行。
