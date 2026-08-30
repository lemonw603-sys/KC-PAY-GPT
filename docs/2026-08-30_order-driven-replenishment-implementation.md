# 订单驱动补给实施记录｜2026-08-30

## 本轮完成

- `ASSIGN_CARD` 在无合格卡时，按订单需求幂等排队自动开卡或订单关联补余额任务。
- 补给任务排队后，订单以 5 秒间隔重试分配；普通等待仍保持低频重试。
- 自动开卡仅在存在 `WAITING_FOR_CARD` 订单时触发，避免无需求购买库存。
- 显式订单补余额任务不再被旧的全局低余额扫描开关阻断；全库自动补钱扫描仍可关闭。
- Browser 路由的资金 attempt 与 dispatch job 入队保持同一事务；若事务失败不会留下资金栅栏。
- 若资金 attempt 已提交而 dispatch 入队遭遇临时故障，重试会复用同一个 `PREPARED/ACTIVE` attempt，不退款、不重复建立资金栅栏。

## 验证

- `npm --prefix v1 test`：439 pass，0 fail，38 skipped（缺少 `TEST_DATABASE_URL` 的隔离 MySQL 集成项）。
- Browser 测试：103 pass，0 fail，4 skipped。
- `git diff --check` 通过。

## 当前边界

- 本轮只完成代码和隔离测试，尚未部署生产。
- 生产 API Provider 写入、Browser Worker/gate、真实付款仍保持关闭。
- 生产启用前仍需候选 release 部署演练、资金/任务只读检查，以及明确的 API 写权限范围确认。

## 提交

- `e07e6a0 fix: retry browser dispatch handoff without releasing funds fence`
- 前置订单驱动补给提交：`aca1fb5`、`7a53ebe`、`eb8d427`
