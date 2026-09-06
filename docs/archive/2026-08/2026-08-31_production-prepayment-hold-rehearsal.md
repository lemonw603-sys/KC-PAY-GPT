# 2026-08-31 生产付款前暂停演练

## 范围

经明确确认，部署最新 `main@55b6ec4` 到生产，仅验证 API 充值在外部调用前的暂停边界。未恢复正常充值权限，未移除 hold。

## Release 与服务

- Release：`/opt/pojia/releases/20260831-prepayment-hold-55b6ec4`
- `/opt/pojia/current` 指向上述 release
- `pojia-web.service`：`active`
- `pojia-worker.service`：`active`
- Worker 环境：`PROVIDER_READS_ENABLED=true`、`PROVIDER_RECHARGE_WRITES_ENABLED=true`、`RECHARGE_SUBMIT_HOLD_BEFORE_PROVIDER=true`；通用 Provider/卡片写入保持关闭。

## 目标订单结果

- 订单：`PJV1-0RcrjBEOL6senGnzqW7e`
- 订单状态：`SUBMITTING`
- `SUBMIT_RECHARGE` task：`DEAD`，`attempts=1`，`last_error_code=PREPAYMENT_TEST_HOLD`
- recharge attempt：`7b2ad429-608c-4590-aaf5-acb0b7012179`，`PREPARED` / `ACTIVE`；`submitted_at`、`finished_at` 均为空。

## 外部调用核验

该订单仅留下本地 `provider_calls` 意图记录：`operation=create_direct`、`outcome=STARTED`、`http_status=NULL`、`finished_at=NULL`，无 SUCCESS/完成记录。Hold 在执行器调用外部充值 Provider 前抛出，未执行真实付款、开卡、卡充值或 Provider 写入。

## 后续约束

该演练故意留下 ACTIVE funds fence 与 SUBMITTING 订单；后续必须先由人工确认并执行专门的恢复/清理步骤，禁止直接重试、换卡或切换执行器。
