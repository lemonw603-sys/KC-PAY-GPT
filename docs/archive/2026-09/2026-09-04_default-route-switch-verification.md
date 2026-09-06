# 默认充值方式切换验证｜2026-09-04

## 范围

验证 API/Browser 全局默认充值方式切换：入口、双向切换、事务回滚、已有订单路线冻结和副作用边界。未执行 Provider 写入、开卡、补余额或付款。

## 生产只读证据

- 当前 release：`/opt/pojia/releases/20260903-dark-surface-eba5331`
- `pojia-web.service`、`pojia-worker.service`：active
- `pojia-card-stock-runner.timer`、`pojia-card-funding.timer`：active
- `/health/ready`：`{"status":"ready"}`
- 生产 `admin.js` 包含默认充值方式控件及接口 `/api/v1/admin/operations/default-recharge-method`。

## 代码/隔离测试

命令：

```text
node --test test/provider-route-admin-service.test.js test/provider-route-service.test.js test/admin-operations-service.test.js test/app.test.js
```

结果：37 passed, 0 failed。

已验证：

- API→Browser 默认路线切换；
- Browser→API 路线切换基础；
- Browser dispatch gate 或心跳不满足时拒绝切换；
- 切换使用事务并记录审计事件；
- 只影响新建订单；
- 既有订单路线冻结；
- 切换不触发 Provider、卡片、充值或付款写入。

## 未验证边界

- 未使用管理员会话在生产页面实际点击；
- 未读取生产数据库当前默认路线值；
- 未在生产执行真实路线切换；
- 未创建真实订单验证路线冻结。

因此本报告证明代码和隔离行为正确，不能单独证明当前生产页面的动态状态或生产切换已实操。
