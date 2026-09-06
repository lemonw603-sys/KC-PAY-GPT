# 独立全系统审查统筹复核（2026-08-28）

> 被复核报告：`INDEPENDENT_FULL_SYSTEM_AUDIT_2026-08-28.md`。本文件记录统筹窗口对报告逐项回查后的有效结论，不修改原始独立报告。

## 结论

- 报告没有发现即时资金或数据事故，这一总体判断与代码、测试和生产只读体检一致。
- 发现 1、3、5、6、7 属实或基本属实；发现 2 的方向成立但阈值计算应修正；发现 4 不成立；发现 8 未证实存在漏洞，仅是依赖卫生观察。
- 报告 D 类运行时未验证项已由统筹窗口在生产只读补验，不能继续沿用“全部未验证”的表述。

## 逐项裁决

### 发现 1：Git worker 模板写开关不一致

- **属实，但生产没有该风险。** Git 模板原为 `PROVIDER_RECHARGE_WRITES_ENABLED=true`；生产 systemd 实际为 `false`。
- 已把 Git 模板改为 `false`，与生产和当前规划一致。

### 发现 2：卡片只读同步吞吐

- **未来规模风险成立，报告阈值偏保守。** 15 秒一张约为 4 张/分钟；资格新鲜度为 15 分钟，因此理论覆盖约 60 张，而不是报告用 10 分钟得出的约 40 张。
- 当前 Provider 仅 19 张、Plus 可分配 0，不是当前故障；放量或库存接近 40–60 张前应改为有限批量同步或重新校准频率/新鲜度窗口。

### 发现 3：D-069 重复

- **属实。** Browser dispatch 保留 `D-069`；API 不做独立预检更正为 `D-104`，语义未改变。

### 发现 4：HANDOFF_LOG 落后两天

- **不成立。** 报告把“第一条日期标题”误当成“最新日期”；文件实际已包含 2026-08-27 和多条 2026-08-28 记录，包括消费账本、migration 040、库存覆盖、封账与生产部署。

### 发现 5：库存列表 LIMIT 200 与全表汇总

- **属实但非当前问题。** 当前卡量远低于 200；规模接近 200 前应分页或让汇总明确作用域，当前不增加复杂度。

### 发现 6：总览返回未展示的旧库存字段

- **属实，属于低价值清理项。** 不影响当前展示或资金安全；可在下一轮后台接口收敛时删除未消费字段，并以接口测试防回归。

### 发现 7：测试数字滞后

- **属实并已修正。** 当前主线复跑为 456 total / 419 pass / 0 fail / 37 skipped，已更新 `CURRENT_STATE.md`。

### 发现 8：根 legacy 依赖

- **仅能确认依赖仍在 manifest，不能确认存在高危漏洞。** legacy 不在生产启动路径；不在当前阶段扩大清理范围，后续先跑依赖审计再决定。

## 生产只读补验

2026-08-28 统筹窗口现场核验：

- current release：`/opt/pojia/releases/20260828-2c75d31-inventory`，为独立目录；
- Web/API Worker active；Browser Worker inactive/disabled；付费补卡 timer inactive/disabled；
- 卡片读取/目录同步、Bark、备份 timer active/enabled；
- 生产 worker 三类 Provider 写开关均为 false；
- `accept_new_orders=false`、`dispatch_new_recharges=false`、`card_auto_replenishment_enabled=false`；
- readiness `ok=true`、migration 040、活动任务/UNKNOWN/资金风险/活动授权/对账案件均为 0；
- ops/plus live/ready 四端点均 HTTP 200；最新加密备份完整性 OK；
- Provider 19、本地 6、critical/warning 均为 0；18 条运营覆盖中 17 条 RETIRED、1 条 `PRODUCT_ONLY(claude)`，6807 保持原规则。

## 保留到后续规划

1. 管理员会话下的后台视觉和数据交叉验收；
2. 卡段人工刷新与持久默认选择；
3. 库存接近 40–60 张前解决同步吞吐余量；
4. 卡数接近 200 前处理列表分页/汇总作用域；
5. 下一轮后台接口收敛时删除确认无人消费的冗余字段。

