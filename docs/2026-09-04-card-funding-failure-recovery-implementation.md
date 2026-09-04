# 卡补余额明确失败恢复实施记录（2026-09-04）

## 问题与目标

生产测试订单 `PJV1-tw-hliEBgnOfdEVsxn5r` 首次生成 `$15.99` 补款 attempt。HNSKJ 只接受正整数美元，请求在 Provider 调用前被本地适配器明确拒绝，attempt 安全收敛为 `FAILED/CLEARED`。整数合同已在 `8caccfb` 修复，但原订单不会稳定地创建后续 attempt。

本实施的目标是让 API 与 Browser 共用的订单/库存层自动恢复真正可恢复的明确失败，同时不放宽 UNKNOWN 资金栅栏。

## 实现

- 提交：`0e5a82d fix: recover cleared card funding failures safely`
- `card-funding-executor.js`：每个失败固化一个最小恢复分类：
  - 明确未扣款且 `error.retryable=true` → `AUTO_RETRY`；
  - 明确未扣款但不可重试 → `DO_NOT_RETRY`；
  - Provider 已可能受理或结果不明 → `MANUAL_REVIEW`。
- `workflow-repository.js`：只在最近 attempt 为 `FAILED/CLEARED/AUTO_RETRY` 时生成新的 `PREPARED` attempt，每个订单+卡片最多 3 次。
- 新 attempt 使用 `order-card-funding:<order>:<card>:v<attemptNo>` 独立幂等键。数据库现有单卡 `PREPARED` 唯一约束与行锁继续防止并发重复。
- 历史 attempt 没有恢复分类时默认不重试，不根据新代码倒推旧资金结果。

## 对抗式边界

1. 不对所有失败盲目重试；业务参数错误等明确不可恢复失败会停止。
2. timeout、transport、5xx/schema 等可能已被 Provider 受理的写请求仍是 UNKNOWN，不因 `retryable` 字段自动重付。
3. 重试上限为 3 个 attempt，不会无限消耗卡台 API 或资金。
4. 正常路径不增加运营操作；只有 UNKNOWN 才需要人工对账。
5. 旧 `$15.99` attempt 没有新分类，部署后也不会自动触发扣款。

## 验证

- `node --test test/card-funding-executor.test.js`：6/6。
- `npm test`：526 total / 480 passed / 46 environment-skipped / 0 failed。
- 全新 `mysql:8.4.11`，完整 migration 001–045：`mysql-integration.test.js` 42 total / 41 passed / 1 intentional skip / 0 failed。
- MySQL 集成已覆盖：并发只创建一个 v2、v3 后停止、`DO_NOT_RETRY` 不创建、UNKNOWN 不创建。

隔离测试未连接 Provider，没有开卡、补余额或付款。

## 待完成

1. 按发布流程备份并部署 `0e5a82d`。
2. 为旧 `$15.99/FAILED/CLEARED` attempt 记录一次可审计恢复动作，不改写旧失败事实。
3. 观察系统生成 `$16` v2、Provider 只调用一次、到账对账和原订单继续。未经单独确认不执行客户 Plus 最终付款。
