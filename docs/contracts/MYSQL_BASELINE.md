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
applied migration 002_workflow_fields
applied migration 003_order_intake_settings
applied migration 004_cdk_batch_index
```

第二次执行：

```text
migration 001_initial already applied
migration 002_workflow_fields already applied
migration 003_order_intake_settings already applied
migration 004_cdk_batch_index already applied
```

- 数据库共创建 10 张 v1 表；`002_workflow_fields` 为订单增加卡段和开卡金额字段，`003_order_intake_settings` 增加默认卡配置，`004_cdk_batch_index` 增加 CDK 批次查询索引。
- `schema_migrations` 准确记录四条迁移。
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
- Session 密文可在 worker 数据边界内正确解密，不需要明文落库。
- 开卡结果、订单状态、状态事件和下一任务在同一事务中提交。
- 直充外部订单号、`card_key`、状态事件和轮询任务在同一事务中提交。
- 人为制造后续任务唯一键冲突后，上述两组事务均整体回滚，不会留下“有卡无任务”或“有外部单号无轮询”的半状态。
- worker 领取 SQL 按运行开关过滤任务类型，被禁止的开卡/直充任务保持 `PENDING`，不会被领取后再判断。
- 关闭新充值后，已提交订单的 `POLL_RECHARGE` 仍可独立继续，不会被停单开关连带停止。
- 用本地假供应商完成 `CREATED -> RECHARGE_SUCCESS` 全链路，三个持久化任务均最终为 `COMPLETED`。
- 订单入口默认停单；只开启 `accept_new_orders` 但未配置卡段/金额时仍拒绝建单。
- 同一 CDK 并发提交两次时仅有一次成功；CDK 兑换、Session 密文、订单、创建事件和首任务原子落库。
- CDK 批次导入只写入 64 位 SHA-256；文件内重复和数据库已存重复分开计数，重复导入不新增记录。
- 生成模式发现任一历史哈希冲突时，本批已插入的其余新码也会回滚，不会产生无法完整交付的半批次。
- 客户可用大小写精确匹配的 `publicNo` 或原 CDK 哈希找回同一订单；状态迁移后客户查询结果会从 `QUEUED` 更新为 `PROCESSING`。

### HTTP 就绪

使用真实测试数据库启动 v1 服务：

```text
GET /health/live  -> 200 {"status":"ok"}
GET /health/ready -> 200 {"status":"ready"}
```

## 自动化证据

设置 `TEST_DATABASE_URL` 后执行 `npm test`：

```text
tests 69
pass 69
fail 0
skipped 0
```

测试覆盖：HTTP、安全响应头、配置失败关闭、旧模块隔离、MySQL约束、订单事务、任务并发、租约恢复、状态机和 Session 加密。

### 2026-08-17 后续复验

- 增加 `provider_calls` 真实落库用例。
- 验证嵌套 API Key、Token、PAN 和 CVV 进入 JSON 列前会被替换为 `[REDACTED]`。
- 增加任务 runner 的成功、重试、模糊提交 dead-letter 和未知 handler 隔离测试。
- 加入独立客户页、本地静态资源和旧运行时隔离断言后，v1 共 69 个测试；其中 9 个数据库集成用例已在 MySQL 8.4.11 上通过。

## 环境收尾

- 测试数据库已删除。
- MySQL 服务已停止。
- Homebrew 安装的 `mysql@8.4` 保留，后续合同测试可复用。
- Homebrew 自动更新曾使 `jlcodes99/cockpit-tools` Tap 进入未完成 rebase；已执行 `rebase --abort` 恢复到原提交 `28cae0d2`，工作区干净。
