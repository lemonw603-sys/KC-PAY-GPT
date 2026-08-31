# 项目规划地图最后一轮定向对抗审查｜2026-08-31 16:05 CST

## 范围与原则

审查 `PROJECT_MAP.md`、`PROJECT_OPERATING_MODEL.md`、`CURRENT_STATE.md`、`ACTIVE_WORKSTREAM.md`、`ROADMAP.md`、`HANDOFF_LOG.md`，并对照当前 main 代码与生产只读事实。只检查决策误写、生产一致性、代码可落实性、下一步可执行性和复杂度；没有为了凑问题扩大范围。

本轮未修改生产、未重启服务、未执行 Provider/卡台写入、开卡、补余额、充值、付款、退款或提现。

## 现场只读结论

- current：`/opt/pojia/releases/20260831-prepayment-hold-55b6ec4`。
- Web/Worker active；Browser Worker inactive/disabled。
- 普通 Worker：Provider 通用写=false、卡片写=false、API 充值写=false。
- 接单=true、派发=true、模式 AUTOMATIC、默认路线 API。
- recharge Provider account：read=1、write=1、circuit=CLOSED。
- card Provider account：read=1、write=0、circuit=CLOSED；但当前 stock/funding runner 不以该 `write_enabled` 为写门禁，而以各自 systemd 窄范围 gate 为准。因此它是待收敛的字段语义不一致，不是当前自动补给 blocker。
- readiness：`ok=false`，唯一 blocker=`api_recharge_execution_disabled`；活动任务、过期租约、UNKNOWN、活动资金风险、开放对账均为 0；migration 044。
- 独立 `pojia-card-stock-runner.timer`、`pojia-card-funding.timer`、`pojia-card-funding-reconcile.timer` active/enabled；funding 独立 gate=true。普通 Worker 卡片写=false 不等于两个补给 runner 被关闭。
- 当前生产资格 SQL：可立即分配 1 张（Provider `1839`、尾号 `1013`、余额 `$16.00`）。
- `6807/1477` 当前为 Provider `invalidating` 且保留历史 ACTIVE assignment，因此现行系统不会分给新订单；这与“卡实际可用”的运营事实必须分开表达。

## 确认并修正的问题

### 1. 当前状态文件把本地主线固定为旧提交

`CURRENT_STATE.md` 写 `main@c472854`，在文档补强提交后已经过期。已改为记录生产代码基线，不再写一个下一次提交后立即过期的文档 HEAD。

### 2. 普通 Worker 卡片写与自动补给的独立权限被混写

旧文字容易让接班人把 Worker `PROVIDER_CARD_WRITES_ENABLED=false` 理解为自动开卡/补余额均关闭。现场确认两个独立 runner 使用窄范围卡片写权限且 timer/gate 开启；地图、状态和 P0 恢复步骤已明确分层，避免恢复 API 权限时误关自动补给。

### 3. “开始营业”被描述得比代码更完整

代码只做开启瞬间的最小 readiness：

- 自动补给检查尚不包含独立 runner/timer 心跳、卡 Provider account 字段状态/熔断、开卡日限额/账户资金和未决补给任务；其中 card account 的 `write_enabled=0` 当前并非 runner 实际门禁，不能据此判断补给被关闭；
- 营业后执行能力若漂移，代码不会自动关闭已经开启的接单/派发；
- API 权限 blocker 仍无 actionId。

这些边界已补入地图和运行总册，避免把按钮说成持续全链路健康保证。当前生产的独立 runner 已另行只读验证，不因此新增日常开关。

### 4. 当前真实库存与 6807 的系统资格没有进入地图

已补入当前可立即分配卡 `1839/1013/$16`；并明确 `6807/1477` 真实可用是用户运营事实，但系统因当前 Provider 状态和历史 ACTIVE assignment 不会分配。下一笔真实单不能误称会测试 6807 复用，也不能为了测试强行破坏现有库存。

### 5. 过期证据卡会与自动开新卡同时排队

代码在发现一张潜在合格但交易证据过期的卡时，会排只读同步；原逻辑同时可能因 fresh fundable=0 再排一个付费开卡任务，违背“优先复用已有卡、减少 API/开卡费”的已确认方向。

已修复为：

1. 先排一张卡的只读同步；
2. 同步在跑时 5 秒重试分配；
3. 不同时排付费开卡；
4. 同步达到 `REVIEW_REQUIRED` 后不无限重复同一只读同步，后续才允许走无安全候选的开卡路径。

定向 MySQL 8.4 migration 001–044 测试通过，证明自动补卡开启时，过期候选只产生一个 read-sync，付费开卡任务为 0。该修复尚未部署生产。

最终复验：JavaScript 语法检查通过；控制面/任务/工作流定向单测 `52/52` 通过；全新一次性 MySQL 8.4 完整迁移 001–044 后，相关集成测试 `1/1` 通过。

### 6. 验收标准“资源准备只有一次”过于绝对

只读刷新可以安全重试；必须唯一的是补余额 attempt、付费开卡任务和最终充值提交。运行总册已改成这一准确口径。

### 7. 决策账本不能再作为当前生产状态入口

已提交版 `DECISIONS.md` 的历史状态栏仍有“API 权限已部署开启”等已被 hold 清理覆盖的旧状态；当前工作区还存在另一窗口未提交的大规模重写，不能在本轮覆盖或采信。已从新窗口强制首读顺序移除“DECISIONS 尾部”，并明确它只保存决策历史，当前生产事实必须服从 `CURRENT_STATE.md`。

## 未发现需要改变的方向

- API 与 Browser 共用订单/资金核心，全局默认路线、不逐单选路；
- API 正常 2 分钟、Browser 正常 5 分钟，超时但能继续时不伪造失败；
- 有合格卡先补余额，无合格卡再开带余额的新卡；
- 一卡按 1–4 全局上限跨订单顺序复用；
- UNKNOWN 不重付、不换卡、不换路线；
- 运营后台保持最小，不新增逐单 Provider 权限按钮或复杂策略服务；
- 当前唯一先行事项仍是恢复 API 常驻最小充值权限并重跑 readiness，随后才接下一笔真实 API 订单；Browser 非付款线并行。

## 残余边界

1. API 常驻最小充值权限仍未恢复；生产仍为半开状态。
2. 自动补给 readiness 的运行态覆盖缺口尚未编码修复；当前仅已准确记录并现场核对现状。
3. `6807/1477` 的 Provider 状态与历史 ACTIVE assignment 尚未收敛，不能擅自清除。
4. 过期证据候选优先同步修复只在本地提交，未部署。
5. `DECISIONS.md` 的未提交重写属于并行窗口工作，本提交不覆盖；合入前必须单独审查，特别是不得把“每笔真实付款都需人工确认”写成长期业务规则。
6. 真实 API 最终付款、自动补余额、自动开卡、一卡跨三单、Browser 真实付款和放量仍按地图标记为未验收。
