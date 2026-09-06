# Browser 后台追溯与人工控制实施报告

## 结论

B2 后台追溯与人工恢复接口节点已完成。运营人员现在能在既有 Plus 后台查看 Browser run 的订单、资金 attempt、检查点、资源租约、artifact 状态、人工接管和对账关系，并通过受保护的状态机转移同一 run 的控制权。

该页面和 API 不返回 Checkout authority，也没有付款、换卡或重建 Checkout 的能力。本节点未接生产、未使用真实 Session/卡片、未执行真实页面操作。

## 实现

- 新增 `v1/src/services/browser-admin-service.js`；
- `create-app.js` 新增两个只读端点和一个 step-up 控制端点；
- `server.js` 复用现有 admin session、Origin 和 rate-limit 边界；
- 现有后台新增 Browser 队列、筛选、详情抽屉和控制按钮；
- 人工控制采用 `REQUESTED → FROZEN → TRANSFERRED → RELEASED`，安全释放时回到 `AUTOMATION`；
- 人工付款结果未知会原子锁定 run/attempt/order 并建立对账案件。

## 验证

- 后台 service/app/assets 定向测试：31/31；
- 隔离 Docker MySQL 8.4：跨进程 artifact 场景内真实执行列表/详情、请求、冻结、转交、安全释放、operation 重放、再次接管与人工付款未知锁账；1/1 通过；
- UI 静态隔离测试确认没有 authority recovery 字段引用；
- JavaScript/Node 语法检查通过；
- 页面和响应中均不选择 `secret_ref`、ciphertext、lease token hash、resource/account HMAC。
- v1 全量：357 项，328 通过、29 个无常驻隔离 MySQL 时按设计跳过、0 失败；两个一次性 Docker MySQL Browser 集成场景 2/2 通过。

## 下一节点

主工程顺序进入并发 Worker 队列、积压、长时间租约续期、故障注入和连续 24 小时 soak。Browser attempt/Worker 派发接入仍保持隔离且生产开关关闭；连续 soak 不能用现有 350 单等效负载替代。
