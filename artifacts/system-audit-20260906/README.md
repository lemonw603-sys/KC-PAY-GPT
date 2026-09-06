# 非付款关联缺陷复现

运行：在 /Users/lemon/code/AI充值业务 执行 `node artifacts/system-audit-20260906/reproduce.mjs`。

结果见 result.json。脚本调用实际模块，CDK部分使用假数据库；无真实Session、卡号、付款或外网调用。断言用于证明当前缺陷存在，不是修复通过测试。修复后应更新为新的预期行为，并补真实隔离数据库和组装集成测试。

## 补款并发复现

新建独立MySQL8.4数据库audit_fixture（仅本机、临时凭证），设置AUDIT_MYSQL_PORT运行funding-concurrency.mjs；不要对生产或已有数据库运行。脚本创建最小表验证实际repository.begin并发竞争；输出funding-result.json。测试实例已清理。

## 导入与后台反馈

在项目根运行 node artifacts/system-audit-20260906/import-boundaries.mjs、admin-refresh.mjs、source-switch-feedback.mjs。分别使用合成表格、实际前端监听函数配模拟DOM/API；输出同目录JSON，不访问生产。

## 完整数据库导入验证

import-db.mjs须在新建独立MySQL8.4的audit_fixture数据库执行，AUDIT_MYSQL_PORT指定其本机端口；脚本执行48份迁移并写合成数据，不可对生产/共享数据库运行。验证同PAN不同序列号、活动assignment下身份变化、空快照；结果import-db-result.json。用过的测试实例已清理。

## 资金判据与旧响应

funding-reconcile-boundary.mjs用真实repository和假数据库验证结算判据；customer-stale-poll.mjs用实际客户轮询函数和受控Promise验证旧响应覆盖。均在项目根node执行，无真实请求。

## 跨源竞争与共享限流

import-source-race.mjs在全新audit_fixture MySQL运行，使用AUDIT_MYSQL_PORT，执行全部迁移；不可复用生产/已有库。admin-rate-budget.mjs完全离线模拟同IP的查询消耗额度。结果见同目录JSON。

## 进程崩溃

funding-crash.mjs用独立audit_fixture最小数据库，AUDIT_MYSQL_PORT指定本机端口；真实子进程在提交意图后被SIGKILL，测试恢复入口。不可用共享/生产数据库；容器已清理。public-http-result.json只记录无凭证公网HTTP探测，不代表登录后UI验收。
