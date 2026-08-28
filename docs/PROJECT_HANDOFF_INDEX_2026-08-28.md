# 项目统一交接索引（2026-08-28）

本文件是当前交接入口，不替代详细证据。事实优先级：生产运行结果 > Provider/数据库只读证据 > 测试产物 > 已确认决策 > 讨论草稿。

## 必读顺序

1. `CLAUDE.md`
2. `docs/CURRENT_STATE.md`
3. `docs/MASTER_EXECUTION_PLAN_2026-08-28.md`
4. `docs/PRE_INVENTORY_CONVERGENCE_SEAL_2026-08-28.md`
5. `docs/DECISIONS.md`
6. 需要追溯时再读 `docs/HANDOFF_LOG.md`

## 当前生产状态

- Release：`/opt/pojia/releases/20260828-d8954bd-sealed`；回滚：`/opt/pojia/releases/20260828-fea0ffd-rollback`。
- Web/API Worker/卡读同步/卡目录同步/Bark/备份正常。Browser Worker 与付费补卡 runner 均 inactive/disabled。
- 接单、派发、Provider 三类写入、Browser 付款和自动补卡均关闭。
- 最新迁移 040；readiness `ok=true`，活动任务和资金风险均为 0。
- HNSKJ 只读：账户 67、7 种卡类型、19 张可见卡；ZZSHU 连接正常。

## 当前卡片结论

- `1477/6807`：原始/有效状态 `ASSIGNED`，不设特权覆盖。
- `1065/4744`：`PRODUCT_ONLY(claude)`，不分配 Plus。
- 其余当前旧批次 17 张卡：`RETIRED`。
- 未来新卡不继承旧批次结论，不存在尾号永久白名单。
- Plus 实际可分配卡为 0；卡片审计 critical/warning 均为 0。

## 已完成

- 共享订单、CDK、Session、Provider、资金栅栏、审计、消费账本和后台基础已建立。
- 真实 API 订单 `PJV1-FqFnMiSKBtLGN14GyP7W` 已完成 Plus 充值和取消续费。
- migration 040 与全部当前旧批次运营覆盖已落地。
- 验证遗留订单已安全取消，活动任务归零。
- Browser dispatch 只读展示和消费账本绑定已合入主线。
- 代码测试：v1 417 pass/0 fail；Browser 85 pass/0 fail。

## 下一阶段

1. 库存后台信息收敛：主视图只保留“可分配、使用中、暂不可用、永久停用”，低价值技术指标下沉到详情/审计。
2. 不物理删除真实卡、订单、交易和审计证据。
3. Browser 独立线继续 adapter/非付款联调；真实 Browser 付款必须另行确认。
4. 收敛后做后台浏览器交叉验收，再实现卡段“人工刷新 + 持久默认选择”。

## 文档边界

- `docs/BROWSER_RECHARGE_MODULE_REPORT_2026-08-25.md` 只是历史全量排查快照，不是当前 Browser 状态源。
- Browser 当前详细状态查 `docs/BROWSER_CURRENT_STATUS_2026-08-25.md`、`docs/BRFE_HANDOFF_2026-08-25.md` 和 `docs/BROWSER_COORDINATION_REALIGN_2026-08-28.md`。
- 历史讨论中的“未部署”、旧 release 路径、task 22 和 Worker 心跳阻断都不再是当前事实。
