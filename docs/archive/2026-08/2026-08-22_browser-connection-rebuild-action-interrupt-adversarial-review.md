# Browser 连接重建与动作中断对抗式审查（2026-08-22）

## 通过项

1. 已有 mysql2 pool 的连接被明确 `KILL CONNECTION` 后，后续查询重新连接成功。
2. Worker watchdog 在长动作中发现 lease 丢失，会触发 abort 并阻止继续动作。
3. 定向 Worker process/service/loop 测试 12/12 通过。

## 盲区

### P1：连接重建只验证单连接

本轮只杀掉一个连接，没有同时制造连接池耗尽、多个连接同时断开或数据库短暂不可用。

**整改**：在长时间 soak 中记录池连接错误、重建次数、claim 延迟和积压；增加多连接同时断开场景。

### P1：动作中断仍是 LOCAL_MOCK

watchdog 测试证明控制壳的 abort 语义，不证明 Playwright 页面在导航、表单提交或 iframe 等待中能立即停手。

**整改**：在不付款的本地 Browser mock page 中加入导航/等待中断，并确认未产生任何提交事件。

### P2：重建后的恢复决策未覆盖未知资金状态

本轮没有付款动作，因此没有 `PAYMENT_UNKNOWN`。真实资金未知时仍必须走既有 reconcile-only 锁账路径，不能依靠连接重建自动重放。

## 判定

连接池重建和控制壳动作中断通过；多连接/长 soak、真实 Playwright 中断和未知资金恢复仍是未验证闸门。
