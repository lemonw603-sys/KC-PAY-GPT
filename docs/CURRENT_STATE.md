# 当前状态快照（2026-08-28 13:03 CST）

> 本文件只保留当前有效状态。历史过程查 `docs/HANDOFF_LOG.md`；本阶段封账证据查 `docs/PRE_INVENTORY_CONVERGENCE_SEAL_2026-08-28.md`。

## 代码与发布

- 主线 HEAD：`d8954bd` (`fix: show effective card allocation status in admin stock`)。
- 生产 release：`/opt/pojia/releases/20260828-d8954bd-sealed`，为真实独立目录，不是候选软链接。
- 可靠回滚点：`/opt/pojia/releases/20260828-fea0ffd-rollback`。
- 服务：Web、API Worker、卡片读同步、卡目录同步、Bark、备份均正常；Browser Worker 保持 `inactive/disabled`。
- 付费补卡 runner 已确认为 `inactive/disabled`，避免重启后每 10 秒唤醒并带入卡台写权限。
- 最新迁移：`040_card_operational_overrides`。

## 运行门禁与体检

- `acceptNewOrders=false`；`dispatchNewRecharges=false`。
- `card_auto_replenishment_enabled=false`；每日自动开卡上限配置值为 `5`，但自动补卡未开启。
- `PROVIDER_WRITES_ENABLED=false`、`PROVIDER_CARD_WRITES_ENABLED=false`、`PROVIDER_RECHARGE_WRITES_ENABLED=false`。
- Browser systemd 单元强制 `BROWSER_PAYMENT_WRITES_ENABLED=false`，且服务未启动。
- 2026-08-28 13:03 CST 在禁用付费补卡 timer 后重跑生产 readiness：`ok=true`；活动任务、过期租约、UNKNOWN Provider 调用、资金风险、活动授权、开放对账案件均为 `0`，`blockers=[]`。
- 公网 ops/plus 的 live/ready 四个端点均 HTTP 200。
- HNSKJ/ZZSHU 只读合同检查通过：HNSKJ 账户 67、USD、7 个卡类型、19 张可见卡；ZZSHU 连接通过。

## 卡片与库存事实

- `1477 / 6807`：不设运营覆盖；当前原始/有效状态均为 `ASSIGNED`，仍受订单绑定、余额、交易与消费账本限制。
- `1065 / 4744`：`PRODUCT_ONLY(claude)`，不分配 Plus。
- 当前其余 17 张旧批次卡：全部 `RETIRED`；未来新卡不继承这个结论。
- 卡片一致性审计：`ok=true`，Provider 19、本地 6、critical 0、warning 0。
- Plus 实际可分配卡为 `0`；`catalog.available=0`、`unresolvedActive=0`、`providerOnlyActiveCount=0`、`openingBlocked=false`。
- 原始 Provider/本地状态可以与运营覆盖不同；后台主视图已显示有效运营状态，不再把旧卡误展示为可分配。

## 订单与资金状态

- 已完成真实 API 订单 `PJV1-FqFnMiSKBtLGN14GyP7W`，使用 `1477/6807`，并完成取消续费。
- 验证用的遗留订单 `PJV1-4cK-yDhExDQbnpr8403G`已按“不充值”结论安全取消；它从未分配卡、未调用 Provider、未建立充值 attempt。
- 当前活动任务为 `0`，不存在该遗留任务反复调度/API 调用风险。
- 消费账本已部署；当前查询为空。历史真实订单发生于账本上线前，没有可靠主键证据时不自动回填。

## 验证结果

- v1：454 tests / 417 pass / 0 fail / 37 environment-skipped。
- Browser：89 tests / 85 pass / 0 fail / 4 skipped。
- 最新加密备份 `/var/backups/pojia/pojia-20260828T043251Z.sql.gz.enc` 已通过 SHA-256 完整性校验。

## 当前未完成

- 库存后台收敛已在当前主线完成，但本次前端改动尚未部署生产；发布前需重跑公网健康、readiness 和后台浏览器交叉验收。
- 卡段人工刷新与持久默认选择尚未实现。
- 自动跨订单复用卡片尚未开启。
- Browser 真实付款尚未验证；仍按独立 Browser 工作线推进非付款联调，真实付款必须另行确认。
