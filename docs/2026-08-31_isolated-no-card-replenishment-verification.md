# 隔离无卡与自动补给路径验证（2026-08-31）

## 范围

本次只验证无可分配卡、订单驱动开卡/补余额、卡片接管和幂等状态机。使用临时 MySQL 8.4.11，未连接生产数据库，未调用真实 Provider/卡台写接口，未开卡、补余额或付款。

## 环境与命令

- 临时容器：`mysql:8.4.11`，数据库 `pojia_test`，端口为本次动态分配的 `63680`；测试结束后已删除。
- 迁移：`MIGRATION_DATABASE_URL=mysql://root:root@127.0.0.1:63680/pojia_test node v1/scripts/migrate.js`，001–044 全部成功。
- 测试：

```bash
TEST_DATABASE_URL='mysql://root:root@127.0.0.1:63680/pojia_test' \
  node --test v1/test/mysql-integration.test.js \
  --test-name-pattern='inventory assignment accepts|stale safe candidate|card stock jobs require|order-driven balance funding|automatic replenishment reserves|pending card funding reconciliation|order-linked funding|a card with active or unknown funding'
```

## 结果

`38 tests / 37 passed / 0 failed / 1 skipped`。唯一跳过的是旧版 fake-provider 全流程夹具，测试文件已明确标注待按订单驱动路由重写。

通过的关键场景：

- 无可分配卡时订单进入 `WAITING_FOR_CARD`，并按需创建唯一自动开卡任务；
- 陈旧卡先排队只读同步，不在证据刷新前开卡或执行 Provider 写入；
- 自动补余额仅在生产能力启用时按订单排队；funding 成功、pending、UNKNOWN、幂等和恢复均通过；
- 新卡注册后可被等待订单接管；
- 卡片跨订单复用并在达到最大成功次数后停止分配；
- 开卡任务 lease、完成、每日限额和资金栅栏正确工作；
- 并发履约只产生一个资金尝试和一个 Provider create intent。

## 结论与边界

隔离环境证明当前代码的无卡/自动补给状态机可以运行，未发现需要立即修复的代码缺陷。该结果不等于生产卡台真实开卡成功；生产真实开卡、同步时延和后续充值仍需在明确承担开卡成本并禁止付款的受控验证中单独验收。
