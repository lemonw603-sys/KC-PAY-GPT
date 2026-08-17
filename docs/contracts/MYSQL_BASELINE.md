# MySQL 8 数据层验证基线

- 日期：2026-08-17
- 运行版本：MySQL 8.4.11
- 测试数据库：`pojia_v1_test_20260817`，验证后已删除
- 外部资金接口：未调用

## 结果

### 迁移

首次执行：

```text
applied migration 001_initial
```

第二次执行：

```text
migration 001_initial already applied
```

- 数据库共创建 10 张 v1 表。
- `schema_migrations` 中只有一条 `001_initial`。
- 第二次执行没有重复建表、重复约束或报错。

### 业务约束

真实 MySQL 集成测试确认：

- 同一个 CDK不能创建第二个订单，数据库返回唯一约束错误。
- 合法状态迁移会同时更新订单版本并写入一条事件。
- 非法跨状态迁移会回滚，订单状态、版本和事件数量不变。
- 两个 worker 并发领取同一份任务时只有一个成功。
- worker 崩溃后，过期的 `RUNNING` 租约可以被新 worker 领取。
- 租约恢复会增加尝试次数并记录新的 `leased_by`。
- `accept_new_orders` 和 `dispatch_new_recharges` 默认均为 `false`。

### HTTP 就绪

使用真实测试数据库启动 v1 服务：

```text
GET /health/live  -> 200 {"status":"ok"}
GET /health/ready -> 200 {"status":"ready"}
```

## 自动化证据

设置 `TEST_DATABASE_URL` 后执行 `npm test`：

```text
tests 15
pass 15
fail 0
skipped 0
```

测试覆盖：HTTP、安全响应头、配置失败关闭、旧模块隔离、MySQL约束、订单事务、任务并发、租约恢复、状态机和 Session 加密。

### 2026-08-17 后续复验

- 增加 `provider_calls` 真实落库用例。
- 验证嵌套 API Key、Token、PAN 和 CVV 进入 JSON 列前会被替换为 `[REDACTED]`。
- 增加任务 runner 的成功、重试、模糊提交 dead-letter 和未知 handler 隔离测试。
- 后续加入调用审计、任务 runner 和 workflow handler 后，v1 共 44 个测试；其中 4 个数据库集成用例已在 MySQL 8.4.11 上通过。

## 环境收尾

- 测试数据库已删除。
- MySQL 服务已停止。
- Homebrew 安装的 `mysql@8.4` 保留，后续合同测试可复用。
- Homebrew 自动更新曾使 `jlcodes99/cockpit-tools` Tap 进入未完成 rebase；已执行 `rebase --abort` 恢复到原提交 `28cae0d2`，工作区干净。
