# Plus 运营后台全量复查（2026-08-28）

## 结论范围

本报告只写本次代码检查和生产只读查询已经证明的事实；“待验证”单独列出，不把推测写成结论。生产查询未执行任何开卡、充值、付款、退款或配置写入。

## 生产事实

- 当前生产 release：`/opt/pojia/releases/20260828-2c75d31-inventory`。
- 订单共 4 单：`RECHARGE_SUCCESS` 1、`RECHARGE_FAILED` 1、`CLOSED` 2。
- `WAITING_FOR_SESSION` 当前为 0；`reconciliation_cases` 当前没有记录。
- `operator_alerts` 共 6 条：低库存 OPEN 1 条，另有 1 条已 RESOLVED；其余为已解决的测试/过期告警。未发现同一 dedupe key 产生多条 operator alert。
- `cards` 共 6 张：`ASSIGNED` 2、`AVAILABLE` 2、`DEPLETED` 2。
- 卡目录快照：Provider 共 19 张、active 8 张；当前 Plus 快照中 `available=0`，`providerOnlyActiveCount=0`，因为 17 张被 RETIRED 覆盖、4744 对应 Provider 卡 ID 1065 被 `PRODUCT_ONLY(claude)` 覆盖。
- `card_operational_overrides` 共 18 条：17 条 `RETIRED`，1 条 `PRODUCT_ONLY/claude`。
- 余额历史快照 1846 条；当前 HNSKJ 账户余额快照为 `51.890000 USD`，开卡能力为 true。
- 成功订单 `PJV1-FqFnMiSKBtLGN14GyP7W` 绑定尾号 6807；其卡交易同步结果当前没有 `purchase` 交易行，但订单本身有 Provider 充值订单号 `6294` 和实际支付金额 `982.140000 PHP`。因此不能仅凭“成功”字样断言三方交易证据已齐全。

## 12 项问题裁决

1. **三方对账异常**：代码把 `SUBMIT_UNKNOWN`、金额/币种缺失、充值成功但付款证据缺失或金额不匹配列为异常。它是资金安全能力，不能删除；但成功订单若只是证据延迟/历史补录不足，不应长期显示为异常。当前生产对账案件为 0，需以订单详情中的 reconciliation code 和证据字段定位用户看到的具体页面/缓存问题。
2. **接单/自动充值按钮太深**：属已确认的 UI 可用性问题。两个开关逻辑正确且彼此独立，不复制第二套控制；应提升到总览顶部运行控制条。
3. **等待 Session**：当前数量为 0。保留订单状态和原订单换 Session（最多 3 次）的能力；总览不必永久占主卡片，建议仅在数量大于 0 时放入“需要处理”。
4. **低库存 Bark 重复**：生产当前只有 1 条 OPEN 的 `CARD_STOCK_LOW`。代码原先在订单路径中无条件把已有告警重新置 OPEN/清空确认，存在重复投递风险。本次已改为：只有从 RESOLVED 重新进入低库存才 reopen，OPEN/SENT 状态不重复重开；Bark outbox 继续按告警幂等投递。
5. **卡台余额变化 Bark**：原先没有余额变化事件通知。本次已复用现有余额快照和 Bark outbox：首次快照不通知，后续余额变化才建立去重告警，消息包含旧值、新值、币种；同一同步不会重复产生告警。
6. **订单详情噪音**：后端数据追溯字段有价值，不应删除。前端应默认突出客户、产品、状态、CDK、邮箱、卡尾号、金额、Provider 结果、Plus/取消续费；事件、任务、原始调用、授权、完整审计、Session 历史等改为折叠技术证据。此项尚未在本次提交中改动。
7. **CDK 筛选跑出底块**：根因是通用 `.filters` 固定列宽与 CDK 批次表单项目过多。本次改为 CDK 表单 flex 换行并限制子项最小宽度。
8. **CDK 横杠**：当前生成器格式为 `PJ-ABCDE-FGHIJ-KLMNO-PQRST`（4 个横杠），校验器兼容旧无分组格式。若生产最近批次仍无横杠，必须查该批次的实际导出/前端显示，不能只看当前源码推断。
9. **内部提醒错位**：本次把提醒卡标题区改为垂直居中，修复文字/底块明显错位的 CSS 根因。
10. **列表没有 4744**：这是产品可见性缺陷，不是简单把 4744 强行变成 Plus 可分配卡。4744 在 Provider 侧被明确标记为 Claude 专用；后台卡片列表只读本地 `cards`，所以看不到它。本次将接管按钮前置；“Provider 全目录（含 Claude 专用/永久停用）”展示仍需单独实现，不能绕过覆盖规则。
11. **同步接管按钮太深**：已把“同步并接管新卡”移到卡片列表标题区，记录详情仍保留在折叠区。
12. **资金证据核对为空**：当前生产没有 reconciliation case；空队列表示没有待处理案件，不表示模块无用。该模块保留资金安全能力；无案件时可下沉入口/在总览只显示数量，不删除表和审计链。

## 本次代码改动

- 低库存告警改为真正按 dedupe 状态 reopen，避免同步/订单重复触发 Bark。
- 新增 Provider 余额变化告警，复用既有 `provider_balance_snapshots`、`operator_alerts`、Bark outbox，不增加额外 Provider API 调用。
- 修复内部提醒标题对齐、CDK 批次筛选换行、同步接管按钮位置。
- 卡片库存接口现在会把未进入本地 `cards` 的 `RETIRED`/`PRODUCT_ONLY` 运营覆盖也作为只读行返回；前端以“卡台卡片 ID + 限定产品/永久停用”展示，不会使其进入 Plus 可分配数量。

## 尚未改动但应排入后续

1. 对账异常页面增加“触发代码/缺失字段”可读摘要，并核对成功订单的证据延迟与缓存问题。
2. 用浏览器实际截图交叉验收 7、9、11；代码修复不等于视觉验收。

## 验证

- `npm --prefix v1 test -- --test-name-pattern='appends immutable balance evidence|Bark outbox|card stock'`：81 通过、1 跳过、0 失败。
- 生产只读 SQL 查询如本报告“生产事实”所列；未打开任何生产写开关。
