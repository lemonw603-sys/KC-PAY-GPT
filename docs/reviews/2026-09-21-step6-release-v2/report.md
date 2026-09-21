# 第⑥步统一发布继续执行（含058）

授权D-328，在D-327边界上增加容量修复及验收。**最终发布成功，07:52 UTC独立复核。** 固定候选9b9f1812a709ca54b8f1b49a48a2e4c8a2669ad8；release20260921-step6-9b9f181，055～058。原66bfe98/8395fe3准备包保留未切换，旧⑤b目录保留。

8395fe3曾prepare成功，维护前旧备份恢复因摘要格式检查失败，未停接单。只读证实旧摘要188字符且JSON合法，仅generatedAt/discrepancyFingerprints，是旧版格式，不是密钥/业务数据损坏。9b9f181补严格旧格式兼容：仅058以前允许LEGACY_FORMAT，058后仍要求新版摘要。原始pre-maintenance-restore.log保留，不将失败改成通过。

前置本地证据：../2026-09-21-report-capacity/report.md，真实MySQL10项通过；默认1049/980通过/0失败/69跳过。实际存的是544字符指纹摘要，不是31348字符展示报告；对账规则、UI、付款开关及Browser代码不改。

最终旧格式兼容后默认1050 tests / 981 pass / 0 fail / 69 skipped。不是整个V2真钱验收。

## 实际执行证据

- [prepare-final.log](prepare-final.log)：固定9b9f181打包，1259项manifest通过；准备备份`pojia-20260921T073430Z.sql.gz.enc`。
- [pre-maintenance-restore-final.log](pre-maintenance-restore-final.log)：维护前真实备份隔离恢复63表，业务读取与3条Session/3批CDK解密通过；摘要明确LEGACY_FORMAT，尚无057所以触发器检查NOT_APPLICABLE_PRE057。
- 07:37:18.243 UTC通过正式setOrderAcceptance暂停接单，记录原设置/9timer/3服务/订单与CDK计数；oneshot自然结束，再核对orders/slots/tasks/funds/stock/funding/dispatch均0，停止三主服务。维护点备份`pojia-20260921T073840Z.sql.gz.enc`通过。
- [migration.log](migration.log)：受控wrapper在同一远端EXIT trap内临时授SUPER、执行正式migrate.js两遍、撤SUPER；不是手写业务SQL。055～058成功，第二遍全already applied。新连接再次确认Super_priv=N，原库级ALL/全局USAGE恢复，log_bin1/trust0不变。
- 独立列检查：setting_value=mediumtext/NOT NULL；CDK AVAILABLE21/REDEEMED37/REVOKED17，75条旧码均LEGACY、issued_at/expires_at空，状态数量与维护前相同。
- 候选日对账runner在Bark暂停时运行成功：摘要544字符，4个键完整，6个差异指纹，心跳07:40:53.992 UTC；汇总告警OPEN1/RESOLVED1。只执行原任务的报告/心跳/告警写入，没有订单、卡、资金写操作。日志保存在服务器root-only维护目录，不复制完整逐卡财务报告入仓库。
- [post-migration-restore.log](post-migration-restore.log)：新备份`pojia-20260921T074056Z.sql.gz.enc`恢复63表，businessRead=OK，Session3/CDK3解密，dailySummary=OK，alertTrigger=OK，incidentVersion=2。仅隔离容器补锁定DEFINER账号，完成后容器清理。
- [switch.log](switch.log)：正式switch重启web/worker/bark，live/ready200。脚本即时cwd曾打印`/`，未把它当成功依据；随后新SSH逐个核对实际PID/cwd均为新release，见下。
- ops安装到现场确认的`/usr/local/sbin/pojia-ops`，旧副本保留；源文件与安装文件SHA256同为`bb395e990d77c9e2ec54fadbce3ab9c5b626b720087fb74b5305cdd15f53e4a5`，帮助入口确认新版功能。
- 切换后启动真实日对账systemd单元复核新工作目录执行，Result=success/ExecMainStatus0，07:45:13结束；与前次同日执行复用摘要/告警key，没有批量重推历史通知。

## 切换后的独立检查

```text
current=/opt/pojia/releases/20260921-step6-9b9f181
web PID234748 / worker PID234751 / bark PID234754
三者active、Result=success、cwd均指向新release/v1
schema最新058、057、056、055
migrator Super_priv=N，global USAGE + pojia库ALL
9 timers active/enabled（与维护前相同）
accept=true / dispatch=true / browser_payment=true
card_auto_replenishment=true / card_balance_recharge=false
Plus API route=1；Browser Plus/5X/20X routes=0
browser heartbeat=2026-09-21T07:52:51.043Z
daily heartbeat=2026-09-21T07:45:12.849Z
daily summary length=544 / JSON_VALID=1
nonterminal=0 / active_browser_slots=0 / funds ACTIVE或UNKNOWN=0
public admin login=200
```

接单恢复审计：07:51:48.076 UTC，false→true，actor codex:step6-release-9b9f181-complete；其余8个原运行设置逐条对快照无变化后才恢复。维护快照及phase在`/opt/pojia/maintenance/20260921-step6-9b9f181/`，phase=released-original-state-restored。

正式只读服务验证：overview可读、CDK总75、供给策略6行、卡台2、日对账30卡、OPEN案例2。统计pending0/reserve0/done20/attention1/historical16/legacy21，不能把旧LEGACY码当已售或新库存。

HTTP明确Host的curl核验：登录页200，未登录管理overview401，admin.js/diagnostics.js/diagnostics.css/cdks.js/cdks.css内容SHA256与部署磁盘逐个一致。第一次Node fetch探针得到404，未据此判资产不一致；随后用与部署脚本一致的Host请求验证通过。没有生产登录后逐个点击资金按钮，读服务验证不冒充全UI真钱验收。

## 交付与边界

| 项目 | 结果 |
|---|---|
| 058容量修复 | 真实生产摘要保存/读回与恢复通过 |
| 第⑥步统一发布及新ops安装 | 完成，单提交构建/完整manifest/进程与HTTP验证 |
| 临时提权 | 已撤回并独立确认 |
| 原营业状态 | 已恢复，审计/快照对照通过 |
| 真实充值/开卡/退款/提现测试、旧码/历史case清理 | 未执行，不在本次范围 |
| ⑦⑧及各产品真实链路验收 | 未执行；先按既定计划实际使用第⑥步 |

本机Browser池未发出重启命令；8804用户演示、8899原型保留。生产隔离恢复容器均已清理。此次不能证明所有旧缺陷消失、异地备份/独立密钥获取已验收，或Pro自动化可启用。
