# Browser MySQL/并发阶段报告（2026-08-22）

## 已验证

隔离 Docker MySQL 8.4：`pojia-stage1-mysql`，测试库 `pojia_test`。

- Browser dispatch repository：通过；
- Browser execution MySQL mapping：通过；
- Browser artifact vault/资源租约跨进程恢复：通过；
- Browser 相关目标测试：9 pass、0 fail；
- 离线并发 Harness：8 Worker、240 job、0 duplicate；
- v1 无数据库配置全量：363 pass、34 skipped、0 fail。

## 全量数据库运行备注

在启用隔离 `TEST_DATABASE_URL` 的全量 v1 测试时，出现 1 个既有补卡日限额测试失败（`replenishment daily limit is adjustable and audited with today usage`）。该失败不涉及 Browser 文件或 Browser 表，Browser 目标测试仍全部通过；在修复或隔离该既有测试前，不把数据库全量结果称为全绿。

## 尚未完成

- 真正多连接同时 claim 同一批 Browser dispatch job 的独立并发集成场景；
- 长 lease heartbeat/过期接管的压力场景；
- 连续 24 小时 soak。

以上仍保持为下一闸门，不进入真实付款。
