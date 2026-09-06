# 运营控制面、执行器与生产状态对照矩阵（2026-08-31）

> 范围：只读对照当前 `main` 代码与付款前暂停演练清理后的最新生产证据。未执行付款、Provider 写、开卡、补余额、退款或提现。
>
> 证据优先级：最新生产清理记录 > 较早生产快照 > 当前代码能力 > 旧规划描述。

## 一、确认的重大漂移

1. **旧规划地图的生产状态已过期。** 地图/状态文件曾写 current 为 `20260831-map-audit-d5fb3cf`、Worker API 充值权限为 `true`、readiness 通过；但最新清理记录明确：current 已切到 `20260831-prepayment-hold-55b6ec4`，hold 已移除，Worker 的通用 Provider、卡片、API 充值写权限均为 `false`。
2. **“代码能做”不等于“生产已开启”。** 当前代码已具备 API 任务领取、付款前门禁、自动补给与营业 readiness，但生产 Worker 的 API 最终充值权限关闭，因此当前不能宣称可自动完成真实 API 订单。
3. **“开始营业”不负责打开 API 写权限。** 它只检查 readiness，通过后打开接单与自动派发；API 权限关闭时会被阻断。
4. **API 权限阻断没有后台跳转入口。** 当前 readiness 对该项只返回部署配置说明，`actionId=null`。这是部署级常驻能力；用户最新决定是正常生产应常驻开启，而不是每单/每次营业手动开启。
5. **开始营业 readiness 不是逐单充值预检。** 它不检查具体 Session、具体卡资料/交易证据新鲜度、账号资格和最终 Provider 响应。这些由订单运行时门禁负责。

## 二、代码—生产—规划对照矩阵

| 模块 | 当前代码事实 | 最新生产事实 | 正确规划状态 / 缺口 |
|---|---|---|---|
| 开始营业 | `admin-start-business-service.js` 先做只读 readiness；通过后依次开启接单、派发；派发失败会补偿关闭接单 | API Worker 充值能力为 false 时 readiness 应阻断 | 恢复常驻最小 API 权限后再现场验证；开始营业不隐式改 systemd/DB 权限 |
| API 路线 readiness | `admin-readiness-summary.js` 检查 Worker heartbeat 与 `worker_recharge_writes_enabled` | 最新清理后 Worker API 写权限 false | 当前不可营业；旧 `ok=true` 快照已失效，恢复权限后必须重跑 |
| Provider account 门禁 | 任务领取/执行仍受 recharge Provider account 可写状态约束 | 演练前曾发现 recharge account `write_enabled=0` 并临时修正；最新清理记录未证明该 DB 值当前是什么 | 恢复生产时必须现场核对 `provider_accounts.write_enabled=1`；开始营业 readiness 当前未直接展示这项，属于可见性缺口 |
| 自动补余额 | 订单驱动；5 秒仅查本地任务；低余额且能力开启时 readiness 为 `AUTO_HEAL` | 独立 funding service 此前已启用；最新演练清理只明确常驻 Worker 卡片写权限关闭，未证明 funding service 被关闭 | 不得把 Worker `PROVIDER_CARD_WRITES_ENABLED=false` 误写成独立 funding 关闭；恢复前现场核对 funding unit、DB gate 与 timer |
| 自动开卡 | 有真实需求时才刷新规则/开卡；空闲 timer 不应高频调用 Provider | 此前 timer/DB 设置已开启且空闲 `NO_DEMAND`；演练清理未记录关闭 | 当前应保留为“先现场复核、再用于实单”，不能凭旧快照宣称仍开启或已关闭 |
| 库存状态 | readiness 只分：可直接分配；可自动补余额；无卡但可自动补卡；否则阻断 | 历史运营覆盖与一卡多单已部署；演练订单使用过尾号 1013 | 不把“余额不足”当坏卡；可否分配还受订单占用、成功次数、产品策略、证据与资金栅栏共同约束 |
| Browser | 默认 Browser 时 readiness 检查 Browser dispatch/profile/heartbeat；API 默认时不要求 Browser 在线 | Browser Worker 最新可靠事实仍为 inactive/disabled、付款关闭 | Browser 并行做非付款闭环；不得阻断 API 营业，也不得宣称真实付款可用 |
| 付款前 hold | `RECHARGE_SUBMIT_HOLD_BEFORE_PROVIDER=true` 会在外部 Provider 调用前停止 | 演练完成，订单已收敛，hold drop-in 已移出并备份 | 仅测试机制；正常生产必须为 false，不纳入日常运营开关 |
| 真实 API 付款 | executor capability 传递缺陷已修复；付款前路径可到 `SUBMITTING` | 本轮未付款；历史有两单真实成功证据 | 下一真实订单才验收当前 release 的最终外部提交、回写、取消续费、卡交易与对账 |

## 三、“开始营业”准确动作与跳转

### 实际动作

1. 前端调用 `POST /api/v1/admin/operations/start-business`。
2. 后端读取 overview、库存、默认卡段，生成 readiness。
3. 任一 `BLOCKED`：返回 409，不改变营业开关。
4. `READY` 或 `AUTO_HEAL`：先开 `accept_new_orders`，再开 `dispatch_new_recharges`；派发开启失败会关闭接单作为补偿。

### 实际检查

- 默认路线是否为 API / Browser；
- API：Worker 是否健康、是否上报真实充值权限；
- Browser：dispatch、profile、heartbeat 是否就绪；
- 是否有可直接分配卡；
- 若只有低余额卡，订单驱动自动补余额是否开启；
- 若无卡，自动补卡、Provider 快照新鲜度、开卡能力与默认卡段是否就绪。

### 当前 actionId

- `OPEN_PROVIDER_ROUTES`
- `OPEN_BROWSER_STATUS`
- `OPEN_RECONCILIATION`
- `OPEN_CARD_FUNDING`
- `OPEN_CARD_STOCK`
- `REFRESH_PROVIDER_RULES`

API 最小充值权限关闭时没有 actionId，也没有后台开启按钮；显示部署配置说明。运营设计上应把它作为生产常驻配置，而不是制造日常操作入口。

## 四、下一步（仅由事实推导）

1. 现场恢复并核验 API 常驻最小权限：Worker `PROVIDER_RECHARGE_WRITES_ENABLED=true`，通用 Provider 写、普通卡片写、Browser 付款继续关闭；同时核对 recharge Provider account `write_enabled=1`。
2. 重跑 Worker 心跳、营业 readiness、Web/Worker、活动任务、资金 UNKNOWN 与对账状态；未通过前不开放新订单。
3. 现场复核自动补余额与自动开卡的独立 service/timer/DB gate，不能用较早快照代替。
4. readiness 通过后，再点击“开始营业”；随后用真实 API 订单验收当前 release 的最终付款、回写、取消续费、卡交易、对账以及需要时的精确补余额。
5. Browser 保持并行非付款线，不阻塞 API；真实 Browser 付款仍单独确认。

## 五、引用代码与运行证据

- `v1/src/services/admin-start-business-service.js`
- `v1/src/services/admin-readiness-summary.js`
- `v1/src/services/admin-read-service.js`
- `v1/public/admin/assets/admin.js`
- `docs/archive/2026-08/2026-08-31_production-prepayment-hold-rehearsal.md`
- `docs/HANDOFF_LOG.md` 的“生产付款前暂停演练清理”段
- commit `55b6ec4`（executor capability 修复）
- commit `c472854`（清理状态记录）
