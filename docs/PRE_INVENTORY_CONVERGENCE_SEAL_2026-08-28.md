# 库存后台收敛前阶段封账（2026-08-28）

## 目的

在进入库存后台收敛前，对代码、生产、卡片运营状态、订单/资金门禁、Browser 边界、回滚和文档做整体复查。本报告只记录已验证事实和已完成修正。

## 最终验证证据

- 主线：`d8954bd`。
- v1：454 total / 417 pass / 0 fail / 37 skipped。
- Browser：89 total / 85 pass / 0 fail / 4 skipped。
- 生产：`/opt/pojia/releases/20260828-d8954bd-sealed`；migration `040_card_operational_overrides`。
- readiness：`ok=true`；活动任务、过期租约、UNKNOWN Provider 调用、孤立/缺失/重复充值 intent、授权、资金风险、补卡任务、对账案件和 Bark 死信均为 0，`blockers=[]`。
- 公网 ops/plus 的 live/ready 四个端点均 HTTP 200。
- Provider 只读检查：HNSKJ 账户 67、USD、7 个卡类型、19 张可见卡；ZZSHU connection ok。
- 卡片审计：Provider 19、本地 6、critical 0、warning 0。
- 备份：`/var/backups/pojia/pojia-20260828T043251Z.sql.gz.enc` 的 SHA-256 校验通过。
- 回滚：`/opt/pojia/releases/20260828-fea0ffd-rollback` 为真实独立目录；不可用的早期 release 已记录在 `/opt/pojia/releases/RELEASE_STATUS_20260828.txt`。

## 对抗复查发现与修正

1. **有效库存与原始卡状态混用**：卡目录、审计和后台已统一应用运营覆盖；`RETIRED` 和非 Plus 的 `PRODUCT_ONLY` 不进入 Plus 库存。验证 Plus 可分配卡为 0。
2. **已覆盖 Provider 卡被误报为未映射故障**：审计已压制这类虚假 critical，但保留 suppressed 计数供追溯；最终 critical/warning 均为 0。
3. **验证订单长期停在 `WAITING_FOR_CARD`**：已增加“未分配卡、未调用 Provider、未建立 attempt”的安全取消路径，并取消订单 `PJV1-4cK-yDhExDQbnpr8403G`；`activeTasks=0`。
4. **发布候选曾错误复制 current 软链接**：当前发布和回滚点均改为真实独立目录。当前 release 与 Git 323/323 文件对比无 missing/extra/changed，且不含 `.env.admin.local`。
5. **付费补卡 timer 为 inactive 但 enabled**：该 service 显式带 `PROVIDER_CARD_WRITES_ENABLED=true`，主机重启后可每 10 秒唤醒。已执行 `disable --now`，timer/service 均为 inactive/disabled；数据库 `card_auto_replenishment_enabled=false`。
6. **当前状态/路线图/主规划停留在部署前**：已统一更新 `CURRENT_STATE.md`、`ROADMAP.md`、`MASTER_EXECUTION_PLAN_2026-08-28.md`、`DECISIONS.md` 和 `HANDOFF_LOG.md`。

## 对抗结论

- **重复付款**：当前没有活动 attempt、Permit、资金风险或 Browser dispatch；付款写入和 Browser Worker 都关闭。未发现本阶段新增的重付路径。
- **旧卡误分配**：所有当前旧批次已精确覆盖；新卡不按尾号白名单继承。
- **错误库存展示**：后台卡列表已显示有效运营状态，重复原始 active 指标已删除。下一阶段收敛的是信息量，不再是分配正确性阻断。
- **无效任务/API 重复调用**：遗留任务已结束，活动任务为 0；付费补卡 timer 已禁用。
- **回滚有效性**：已保留独立回滚目录和完整性校验通过的加密备份；早期不可用 release 已标记。

## 阶段出口

进入“库存后台收敛”所需的代码、生产门禁、卡片覆盖、活任务、只读合同、备份和回滚基线已对齐。下一阶段可直接收敛后台信息，不需要再重做 A1 或再次批量改卡片状态。

下一阶段仍遵守：不删除真实卡、订单、交易和审计证据；不开启自动补卡、Provider 写入或 Browser 付款。
