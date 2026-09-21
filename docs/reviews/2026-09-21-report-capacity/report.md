# D-328日对账摘要容量修复

## 更正与依据

前轮31348字符是**展示报告**。本轮生产只读代理仅允许SELECT、将实际INSERT拦截到内存（不执行），捕获当前实际保存摘要**544字符**：date/generatedAt/discrepancyFingerprints/persistentFingerprints，共6个差异指纹。仍超过生产VARCHAR(255)，ER_DATA_TOO_LONG根因成立；“完整展示报告直接落库”的旧解释撤回。

生产列只读：COLUMN_TYPE=varchar(255)、IS_NULLABLE=NO、COLUMN_DEFAULT=null、COLLATION_NAME=utf8mb4_unicode_ci。

## 最小改动

- 新增058，仅将app_settings.setting_value扩大为MEDIUMTEXT NOT NULL；不新增表/服务，不修改报告内容/对账规则/UI，原设置值不变。文本按实际长度存储，不为每条设置预分配16MiB。
- 迁移恢复保护增加058指纹与类型校验：只允许原VARCHAR(255)或目标MEDIUMTEXT；意外类型拒绝；DDL后尚未写版本可安全续跑，记录058但类型未扩大则拒绝。
- 隔离恢复验证器核对058列类型；已有日对账摘要须JSON结构完整，并报告dailySummary=OK。没有摘要明确NOT_PRESENT，不伪称已验该数据。

## 验收

`node scripts/daily-report-capacity-rehearsal.mjs`真实隔离MySQL10项通过，详见[evidence.json](evidence.json)：

1. 30张合成卡、6条差异，057库只读成功但正式persist:true复现ER_DATA_TOO_LONG。
2. 正式迁移及重复运行成功，所有迁移前设置值逐条不变。
3. 正式服务保存摘要并读回，不保存cards完整报告。
4. 同日重复不误增连续性；跨日指纹保留；只读不写。
5. 真daily-reconciliation-runner完成摘要/心跳/一条OPEN汇总告警；未启动Bark发送器或付款Worker。
6. 超过64KiB的合成摘要存储边界样本无截断（只验证存储，不宣称处理了1500张真实卡）。
7. DDL后缺版本可续跑、意外LONGTEXT类型拒绝。
8. 全新无网络MySQL恢复后摘要逐字相等，正式恢复验证器解密/触发器/摘要检查通过。

默认1049 tests / 980 pass / 0 fail / 69 skipped。临时库清理后剩余0，恢复容器/临时密钥清理。没有修改生产数据或权限来做这批测试。

## 继续发布范围

D-328批准修复验收后继续D-327统一发布，迁移范围现在055～058；旧66bfe98准备包不复用。新增生产验收是运行一次原日对账任务（在Bark暂停时），独立读回摘要/心跳/汇总告警，再备份与隔离恢复；不写订单/卡/资金，不批量重推历史通知。生产步骤及最终结果另记发布记录。
