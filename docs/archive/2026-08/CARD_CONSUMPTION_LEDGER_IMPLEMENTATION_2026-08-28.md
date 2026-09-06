# 一卡多充消费账本实施与对抗式审查（2026-08-28）

## 本次实际完成

1. 保留 migration 038 不改，新增 replay-safe migration 039，把消费记录精确关联到 `recharge_attempts`。
2. `beginAuthorizedAttempt()` 在现有订单资金栅栏事务内锁卡并预留一次消费额度；默认上限读取 `card_max_successful_payments=3`。
3. API 路线：提交明确未发生时释放；UNKNOWN 转 `RECONCILIATION`；充值成功转 `CONSUMED`；Provider 已受理后的失败不自动释放。
4. Browser 路线：付款前安全退出释放；付款未知保留核对；付款确认即转 `CONSUMED`；Plus 激活和取消续费完成后 attempt 记为 `SUCCESS/SETTLED`。
5. 账本保存 card/order/attempt/product/amount/currency/Provider transaction ID/evidence，Provider 交易同步不再是实时计数的唯一来源。
6. 运营后台新增只读接口 `GET /api/v1/admin/card-consumption`，可按 Provider 卡号查看上限、各状态计数和最近账本记录；接口不执行任何写操作。
7. 新增只读审计命令 `npm run audit:card-consumption`，对比本地 `CONSUMED` 与 Provider `PURCHASE/SUCCESS` 数量，输出差异和 `BACKFILL_REVIEW_REQUIRED`/`LEDGER_REVIEW_REQUIRED` 建议，不自动回填。

## 验证证据

- 全量单元测试：`npm test` → 442 total / 405 pass / 0 fail / 37 environment-skipped。
- 全新 MySQL 8.4：001–039 迁移成功，第二次重放无错误。
- 消费账本真实 MySQL 并发：同一卡 4 个并发申请、上限 3，结果 3 成功、1 被 `CARD_CONSUMPTION_LIMIT` 拒绝；消费、核对、释放状态均正确。
- 完整 MySQL 集成：34/34 通过。
- Browser MySQL 资金映射与付款前退出：2/2 通过。
- 后台账本只读视图单元测试通过。
- 审计脚本单元测试通过，并验证仅执行 SELECT。
- 审计结果明确区分“Provider 多于本地（需回填复核）”和“本地多于 Provider（需账本复核）”，不把差异直接当成事实。
- `git diff --check` 通过。

## 对抗式审查结论

### 已修正的问题

- 不能成功后才计数：否则并发订单会超额；现已在付款前、卡锁内原子预留。
- 不能把 UNKNOWN 当失败释放：现进入 `RECONCILIATION` 并继续占用额度。
- Browser 曾在最终成功时把 attempt 写成 `CLEARED/CLEARED`，与实际资金已结算冲突；已修正为 `SUCCESS/SETTLED`。
- Browser 的付款前退出、付款未知和付款确认原本不会同步消费账本；现已接入同一事务。
- migration 038 已进入 Git 历史，不能直接改写；attempt 关联改为新增 migration 039。

### 明确未完成，不得误报

- **没有启用一卡多充自动分配。** 当前 `cards.order_id`、历史绑定资格和库存查询仍按既有规则工作；账本只是把数据与资金安全基础打好。
- 尚未做历史订单/Provider 交易回填；不能据此宣称历史卡消费次数全部准确。
- 尚未做运营后台的已消费/预留/核对/剩余次数展示。
- 已提供后台只读 API；前端页面可视化仍未接入。
- 尚未部署生产；生产仍是交接索引记录的 release 和迁移 037。

## 下一步

生产当前 release 仍未包含 038/039 和审计脚本，因此尚未执行生产差异审计。下一步需先单独确认是否部署本版本；部署后再用只读连接运行审计，只生成差异报告，不自动改历史。未完成历史证据核对前，不开启一卡多充自动复用。
