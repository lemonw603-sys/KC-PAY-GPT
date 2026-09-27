# 任务书｜恢复 API 路线 301：ZZSHU 直充 + 任何卡台的卡 + 点数监控（D-400 / D-401）

2026-09-27（UTC+8）起草；Lemon 批准、选 (a)。**状态：实现与测试完成（D-401 补记），待装 Key 与发布**。只动服务器端 `v1/`；`browser-mvp/` 一行不改（D-254 不涉及）。

## 依据（动手前先对一遍）

- 决策：D-253（09-17 ZZSHU 拒 highvcc 卡头 → API 行固定 hnskj，本任务取代其结论）、D-353（09-23 默认路线切 Browser、API 路线标「未验证」）、D-400（认其他卡台就恢复；首张真实客户单验成功路径）、D-401（卡源放开、点数 ≤5 / 0 推送、用完回落 Browser、充点 Lemon 去对方网站手动）、D-228（卡留在客户账号的风险，欠账 21）。
- 对方接口：`docs/contracts/2026-09-26_zzshu-api-changes-since-0917.md`（计费改为发放 Key + 成功扣点；`verification`；`40107` / `40306` / `42902`；无幂等键）。
- 生产事实（2026-09-26～27 现查）：旧 Key `40107`；新 Key（Lemon 本机 `~/.config/zzshu/api.env`）`/third-party/user` → points 15；卡 4022（highvcc，`51398996`）`region PH` 建单成功（订单 35289）后失败「该卡交易过于频繁」、未扣点；`provider_accounts`：`backup-a` `supports_api_recharge=0`、`legacy-primary(hnskj)` =1；路线 301 `accepts_new_orders=0`、302 =1。
- 代码现状：建单选路线要求「正好一条可用路线」（`order-intake-repository.js:108-129`）；API 路线须挂 `supports_api_recharge=1` 的卡台（同文件 `:119`）；付款后同步卡流水固定调 hnskj（`workflow-handlers.js:549` 起）；付款不明取证固定查 hnskj 卡流水（`workflow-handlers.js:385`）；开卡调度对 API 需求不转台（`card-supply-scheduler-service.js` `pickFallback` 的 `NOT_BROWSER_DEMAND`）；付款前取卡已按卡台能力分支，highvcc 用库内凭证（`workflow-handlers.js:192-194`，不用改）。

## 目标

1. Plus 新单在路线 301 上，用任何卡台（现为 highvcc）的卡，经 ZZSHU `orderType=direct` 下单、查状态、确认、取消续费，走完现有 API 路线状态机。
2. 服务器用 Lemon 新买的 ZZSHU API Key；Key 失效 / 点数不足在建单前被拒时，按「确定未扣款」处理，不当成付款不明。
3. ZZSHU 点数有人盯：定时只读读剩余点数、后台可见；≤5 推手机一次，0 推紧急；点数用完时新单自动改走 Browser，Browser 也不可用则停收新单（客户看到的是现有的暂停接单答复）。
4. 事实源与规矩同步：CLAUDE.md 删「ZZSHU 只保留历史兼容」，写明 API 路线 = ZZSHU 直充 + 任意卡台；D-253 结论标为被 D-401 取代。

## 边界（不做 / 不许）

- 不改 `browser-mvp/`；不改付款、重试、换卡规则：付款结果不明不重付、不换卡、不换执行器（CLAUDE.md 硬约束）；不新增任何自动重试。
- ZZSHU 无幂等键：一张本方订单在它那边只下一次；建单响应不明时只查不重下（沿用 `RECHARGE_COMMIT_UNKNOWN` / 付款不明两路取证）。
- 非 hnskj 卡的卡台取证：用该卡台自己的数据源；拿不到就记「证据不足」转人工，**不得当成未扣款**。
- Key 只进服务器 worker 的 provider 环境文件，不进仓库、日志、聊天；装 Key、重启 worker、发布、改生产数据、切路线，每一步执行前问 Lemon。
- 充点不开发（Lemon 去对方 `/query` 页）；Pro（5x / 20x）不在本任务（欠账 9）；API 路线 `region` 不传（默认 PH）。

## 要 Lemon 先定的一处设计

「点数用完改走 Browser」与「同一套餐只能一条路线开着」冲突，二选一：
- **(a) 自动切路线（建议）**：巡检发现 301 是开着的 Plus 路线且点数为 0、Browser 心跳新鲜 → 用现有正式切路线服务把 301 关、302 开，审计记 `system:zzshu-points`，推手机；点数充回来**不自动切回**，推手机请 Lemon 自己切。改动小，不动「一条路线」这条规矩。代价：切换前已建在 301 上、还没下到 ZZSHU 的单会被它拒（`40306`，确定未扣款），按现有失败流程退卡密，客户重提会走 Browser。
- (b) 主备路线同时开：选路线改成「按优先级挑第一条可用的」（点数、心跳都算可用性）。客户完全无感，但要改选路线的唯一规则及其所有调用方（客户页验卡预检、后台切路线、统计），面更大。

## 验收（做完逐条给证据）

1. 单元测试覆盖：`40107` / `40306` / `42902` / `verification` 非空 / 「交易过于频繁」类 failed / 正常 success（含取消续费）的映射；highvcc 卡在 API 路线上的付款后流水与付款不明取证分支；点数阈值推送（≤5 一次、0 一次、充回后再跌再推）与回落切换；每项做一次「改回旧行为」的变异，测试必须失败。
2. 真数据库测试（`v1/scripts/mysql-tests.sh`）全绿，含：API 路线 + highvcc 卡从建单到终态的状态机；点数回落切换的审计记录。
3. 生产只读核对：新 Key `/third-party/user` 返回点数；highvcc 在选卡规则下对 API 路线合格；巡检首轮读到点数、无误推。
4. 发布经 Lemon 批准；发布后独立核对服务、进程、健康、错误日志。
5. 成功路径：按 D-400 用第一张真实客户单验收（Lemon 在后台把 Plus 切到 301 时才会发生）；在此之前本任务不宣称「API 路线可用」，只宣称「代码与配置就绪」。

## 已知未知（不因本任务而消失）

- `51398996` 只证明能建单；付款能否成功未验，且它在 Browser 上 7 单成 2 败 3（自用期样本）。
- 「该卡交易过于频繁」含义未知；其他 highvcc 卡头 ZZSHU 收不收未测。
- 每单扣几点由 ZZSHU 后台配置（默认 1）；Pro 可能不同。
