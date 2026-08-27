# 卡片库存同步专项合并前对抗式审查（2026-08-27）

## 审查对象

- 分支：`codex/card-inventory-sync-20260827`
- 原专项提交：`f182a05`
- 本次审查修正：`6c5e18d fix: allow re-intake of historical card discoveries`
- 状态：尚未合并、尚未部署；以下结论仅适用于代码，不代表生产已生效。

## 已核实事实

1. 相对 `main`，专项提交修改 Provider 交易字段标准化、卡类型名称映射、卡目录同步、卡片接管重试、同步周期、库存告警去重及 Provider route account 读取。
2. 专项分支测试结果：`402 passed / 0 failed / 36 skipped`；跳过项是未配置 `TEST_DATABASE_URL` 的 MySQL 集成测试。
3. `npm test` 在本次工作树通过（402 通过、0 失败、36 跳过）。
4. 发现并修正一个确定性逻辑缺陷：`findExistingExternalIds()` 曾把历史 `card_discoveries`（包括 `QUARANTINED`/`FAILED`）当作已存在，从而新一轮目录变化时跳过重新接管；现在只以已落库 `cards` 作为跨批次已存在判断，批次内唯一索引仍防止重复。

## 仍需在合并前确认的边界

1. 交易 Schema 现在先做字段归一化再校验；未知字段会被 Zod 对象 schema 丢弃。当前测试覆盖通过，但若后续业务需要新字段，必须显式加入归一化与 schema，不能依赖透传。
2. `cardType` 名称映射采用精确且唯一匹配；无法唯一匹配时保持缺失并进入既有审查路径，不得改成模糊匹配。
3. Provider snapshot 在接管配置时可能为空；此时仍依赖 `default_card_type_id`，不能把 snapshot 缺失解释为 Provider 已确认。生产启用前需只读核对 snapshot 与当前 route account 一致。
4. `AVAILABLE` 同步间隔改为 10 分钟，会增加读取次数；这是代码事实，是否符合 API 成本目标需结合实际计费与订单量单独决定，不能由测试结果推断。
5. 告警去重逻辑会抑制同一 OPEN 案件的重复 Bark；只有案件解决后（或按确认条件）才重新入队。需由运营确认这符合“变化时是否再次提醒”的业务规则。

## 结论

修正前：**不建议直接合并**（存在历史 discovery 永久阻断重试的确定性缺陷）。

修正后：**可以进入合并前复核，但不得视为已上线**。合并前至少完成：

1. 在隔离 MySQL 上补跑被跳过的集成测试；
2. 只读核对当前生产 route account、Provider snapshot、卡类型映射；
3. 确认 10 分钟同步频率与告警重新通知规则；
4. 用户确认后再合并、部署，并做生产只读验证；未确认前不执行任何 Provider 写操作。

