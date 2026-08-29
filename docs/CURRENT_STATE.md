# 当前状态快照（2026-08-29 13:21 CST）

> 本文件只保留当前有效状态。历史过程查 `docs/HANDOFF_LOG.md`；本阶段封账证据查 `docs/PRE_INVENTORY_CONVERGENCE_SEAL_2026-08-28.md`。

## 代码与发布

- 当前生产代码提交：`ef5afd5`（基于 `58dfe0d` 的库存刷新文案安全发布分支，不含延期的“开始营业”入口）。
- 生产 release：`/opt/pojia/releases/20260829-card-refresh-ef5afd5`，为真实独立目录；上一版本回滚点：`/opt/pojia/releases/20260829-card-segment-58dfe0d`。
- 可靠回滚点：`/opt/pojia/releases/20260828-fea0ffd-rollback`。
- 服务：Web、API Worker、卡片读同步、卡目录同步、Bark、备份均正常；Browser Worker 保持 `inactive/disabled`。
- 付费补卡 runner 已确认为 `inactive/disabled`，避免重启后每 10 秒唤醒并带入卡台写权限。
- 最新迁移：`040_card_operational_overrides`。

## 运行门禁与体检

- 生产服务器已独立复核：`acceptNewOrders=true`、`dispatchNewRecharges=true`、派发模式 `AUTOMATIC`；这是用户此前手动开启并决定继续保留的当前运营状态。
- `card_auto_replenishment_enabled=false`；每日自动开卡上限配置值为 `5`，但自动补卡未开启。
- `PROVIDER_WRITES_ENABLED=false`、`PROVIDER_CARD_WRITES_ENABLED=false`、`PROVIDER_RECHARGE_WRITES_ENABLED=false`。
- Browser systemd 单元强制 `BROWSER_PAYMENT_WRITES_ENABLED=false`，且服务未启动。
- 2026-08-29 09:07 CST 重跑生产 readiness：`ok=true`；活动任务、过期租约、UNKNOWN Provider 调用、资金风险、活动授权、开放对账案件均为 `0`，`blockers=[]`。
- 公网 ops/plus 的 live/ready 四个端点均 HTTP 200。
- 当前卡台只读目录共 20 张卡；目录同步与卡片详情读取通过。

## 卡片与库存事实

- `1477 / 6807`：不设运营覆盖；当前原始/有效状态均为 `ASSIGNED`，仍受订单绑定、余额、交易与消费账本限制。
- `1065 / 4744`：`PRODUCT_ONLY(claude)`，不分配 Plus。
- 当前其余 17 张旧批次卡：全部 `RETIRED`；未来新卡不继承这个结论。
- `1628 / 6185`：已分配给第二单真实 API 订单并完成 Plus 充值；不得再作为未使用库存自动分配。卡台 PURCHASE 最终结算状态仍待只读同步补证。
- Plus 实际可直接分配卡为 `0`，但有 `1` 张可补余额卡；`catalog.unresolvedActive=0`、`providerOnlyActiveCount=0`。
- 默认开卡卡段只决定未来开卡偏好，不再排除卡台当前公布的其他合法卡段；订单分配也不再要求卡片卡段等于订单创建时的默认开卡卡段。
- 原始 Provider/本地状态可以与运营覆盖不同；后台主视图已显示有效运营状态，不再把旧卡误展示为可分配。

## 订单与资金状态

- 已完成真实 API 订单 `PJV1-FqFnMiSKBtLGN14GyP7W`，使用 `1477/6807`，并完成取消续费。
- 已完成第二单真实 API 订单 `PJV1-uVsqgepiEHu3tfpQKQq-`，使用 `1628/6185`；外部直充单 `7025`，平台金额 `982.140000 PHP`，最终 `RECHARGE_SUCCESS` 且 `subscription_cancelled=1`。attempt 为 `SUCCESS/SETTLED`，无活动资金风险或开放对账案件。
- 验证用的遗留订单 `PJV1-4cK-yDhExDQbnpr8403G`已按“不充值”结论安全取消；它从未分配卡、未调用 Provider、未建立充值 attempt。
- 当前活动任务为 `0`，不存在该遗留任务反复调度/API 调用风险。
- 消费账本已部署；当前查询为空。历史真实订单发生于账本上线前，没有可靠主键证据时不自动回填。

## 验证结果

- v1：459 tests / 422 pass / 0 fail / 37 environment-skipped；另在全新临时 MySQL 8.4 上完成 37/37 数据库集成测试。
- Browser：89 tests / 85 pass / 0 fail / 4 skipped。
- 最新加密备份 `/var/backups/pojia/pojia-20260829T005211Z.sql.gz.enc` 已通过解密与 gzip 完整性校验。

## 当前未完成

- 库存后台收敛已部署生产（2026-08-28），并已通过发布后公网健康、服务状态、备份完整性和未认证路由验收；后台浏览器交叉验收仍待使用管理员会话执行。
- 已实现卡段人工刷新（`POST /api/v1/admin/card-stock/provider-refresh`）与默认卡段持久保存（`POST /api/v1/admin/card-stock/default-card-type`）；刷新仅调用 Provider 只读接口，不恢复高频自动读取。
- “开始营业”入口代码已在主线但暂不部署；生产继续使用现有分离开关。该入口的部分成功回滚优化延期。
- 已新增低复杂度“开始营业”入口：通过只读就绪检查后才同时开放接单与自动派发；库存不足会明确提示，不会误报卡台故障。
- 自动跨订单复用卡片尚未开启。
- Browser 真实付款尚未验证；仍按独立 Browser 工作线推进非付款联调，真实付款必须另行确认。
- Browser 独立线提交 `1d02c78` 已由统筹审查并以主线提交 `d6f9bf3` 安全合入：attempt 与 run 的 executor profile 现在必须一致，漂移时以 `EXECUTOR_PROFILE_CONFLICT` fail-closed；该 profile 同时进入权威付款 snapshot。合入后语法检查与相关 adapter/runtime/repository 测试 **46/46** 通过；未部署 Browser Worker、未连接生产、未执行付款。
- 第二单 API 灰度已完成；临时充值写权限已关闭，单笔 Permit 已撤销。卡台已读到 `PURCHASE 15.76 USD`，但截至 05:54 UTC 仍为 `PROCESSING` 且余额快照仍为 `$16`，最终卡台结算证据待后续只读同步补齐，绝不重付。
- 本单暴露出“分配要求 15 分钟新鲜、定时同步默认 60 分钟”的窗口错配。主线已实现按订单需求只同步 1 张过期候选卡的低调用量修复，回归 466/429/0/37；尚未部署。
- 2026-08-29 13:21 CST 公网复核：ops/plus 的 live/ready 四个端点均 HTTP 200。
- Browser profile 绑定合入后的 v1 全量回归：465 total / 428 pass / 0 fail / 37 environment-skipped。
- 卡余额充值目前仅有后台记录/核对视图，指定卡发起充值的管理入口暂缓开发；生产 Provider 写入继续关闭。

## 2026-08-29 卡片库存只读同步复验

- 已登录生产后台执行“卡片库存 → 只读同步全部”，页面提示加入 7 张卡同步队列；等待后刷新完成。全程未执行开卡、卡充值、付款、退款、提现或任何写开关操作。
- 卡 1477（卡号末四位 6807）详情：卡台账户 `00000000-0000-4000-8000-000000000101`、卡段 1、状态 `invalidating`、已分配、余额 `0.07 USD`、资料/交易同步时间 `08/29 09:50`。
- 交易证据：`CARD_RECHARGE 16.000000 USD SUCCESS` 与 `PURCHASE 15.930000 USD SUCCESS` 均已显示并持久化；chargeback 监控记录仍保留。
- 订单 `PJV1-FqFnMiSKBtLGN14GyP7W` 现显示“充值成功 / 三方一致 / 卡片核对 15 分钟内已更新”，平台金额 `982.140000 PHP`，直充订单号 `6294`。
- 库存总览：可分配 0、使用中 1、暂不可用 1、永久停用 17；卡台余额 `$47.36`、默认卡段 VISA-40024200、剩余开卡额度 292；自动补卡关闭。
- Console 唯一错误为 CSP 阻止 inline style，未发现业务请求失败；只读 GET 接口均 HTTP 200。
- 详细报告：`docs/2026-08-29_card-inventory-readonly-sync-verification.md`。
