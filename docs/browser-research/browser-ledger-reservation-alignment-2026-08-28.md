# Browser 消费预留合同对齐记录（2026-08-28）

## 范围

本记录只覆盖 Browser adapter、Browser 权威付款快照和测试 fixture 对 migration 039
`card_consumption_ledger.recharge_attempt_id` 的消费预留校验。未修改卡片库存资格、同步或运营覆盖规则。

## 已实现

- MySQL upstream adapter 读取消费账本的 `id/status/recharge_attempt_id/order_id/card_id`。
- Browser 合同只接受 `status=RESERVED`，并要求消费预留同时匹配当前 `attempt/order/card`。
- 权威 payment snapshot 在签发 permit 及提交前重锁上下文时执行同样校验；消费预留 ID/status 纳入快照事实。
- 缺失、非 `RESERVED` 或任一绑定漂移统一 fail-closed（`CARD_CONSUMPTION_NOT_RESERVED`）。
- 隔离 fixture 使用共享 `beginAuthorizedAttempt()` 创建真实 `RESERVED` 记录；安全 abort 后验证账本变为 `RELEASED`。

## 对齐与验证

- `codex/browser` 已 rebase 到主线 `5eb0967`；保留 Browser 控制面改动，不删除主线 migration/卡运营覆盖文件。
- `npm --prefix browser-mvp test`：85 passed，4 skipped（仅因未配置 `TEST_DATABASE_URL`），0 failed。
- `node --test browser-mvp/test/local-worker-chrome-fixture.test.js`：1/1 passed；本地 Worker + 系统 Chrome fixture 观察流程无付款提交。
- 使用五个写开关均为 `false` 执行 `npm --prefix browser-mvp run dry-run:shared`：静态检查通过，隔离 MySQL migration 001–039、dispatch/run、Chrome 观察和安全收口 1/1 passed；最终消费账本为 `RELEASED`，活动 permit=0，`PAYMENT_SUBMIT`=0。

## 未验证边界

未连接生产或预生产数据库，未启动生产 Browser service，未读取真实 Session/PAN/CVC，未填卡、未付款，未调用卡台写接口。
