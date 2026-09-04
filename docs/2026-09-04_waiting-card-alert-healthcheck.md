# “订单正在等待卡片”提醒体检（2026-09-04）

## 现场核对

- 生产最新订单 `PJV1-GodDHJHDQnURKz62CmYU` 当前为 `WAITING_FOR_CARD`。
- 该订单只有一条 OPEN 的 `ORDER_WAITING_FOR_CARD` alert，dedupe key 为订单级键；对应 `alert_notifications` 当前只有一条 `SENT` 记录。数据库没有证据表明同一条 alert 被重复插入或重复生成多条通知。
- 但自动开卡 runner 在约 6:06–6:11 连续生成多条 `REVIEW_REQUIRED` 任务，错误交替/重复为 `CARD_STOCK_BALANCE_INSUFFICIENT`，随后出现 `CARD_STOCK_CARD_TYPE_UNAVAILABLE`。这说明订单被卡在自动供给失败，且供给失败后仍在重复尝试/更新等待卡状态。
- 生产当前卡片库存按现场查询只有 `ASSIGNED` 与 `DEPLETED`，Browser 派发和付款均关闭，资金风险为 0。

## 结论

1. **已确认的问题不是“同一 alert 无去重”**：当前数据库对该订单只有一条 SENT 通知。
2. **已确认的运营问题是订单持续 WAITING_FOR_CARD 且自动开卡失败后重复产生 REVIEW_REQUIRED 任务**。这会造成后台反复刷新/反复触发等待卡提醒，看起来像骚扰式通知。
3. 失败根因已有明确供应证据：卡台余额不足（`CARD_STOCK_BALANCE_INSUFFICIENT`）；随后卡段可用性又返回 `CARD_STOCK_CARD_TYPE_UNAVAILABLE`。在资金或规则未变化前继续重试没有意义。

## 测试前处理建议

- 不用这笔 API 订单做 Browser 测试；路线已冻结且当前供给失败。
- 在测试前修复或至少抑制“同一 demand 在 REVIEW_REQUIRED 且无物质变化时重复创建 stock job”，并保持订单级 alert 只通知一次，只有状态/原因发生实质变化才重新通知。
- 本轮未修改生产数据、未补余额、未开卡、未付款。
