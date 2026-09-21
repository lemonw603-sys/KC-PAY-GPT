# D-324恢复检查修正

**本地实现与隔离验收完成，生产未安装/未恢复/未改权限。** 付款开关不改（D-323）；CDK、订单、付款规则及057迁移SQL不变。本报告证明恢复检查机制，不代表生产异地备份及分离密钥已经验收。

## 依据与改动

- D-322实测：全新MySQL导入63表成功，但缺少057触发器DEFINER时UPDATE报1449。D-324用户批准补身份/必要权限步骤及功能检查。
- 运维修正，无页面原型变更；既有工作台C/营业条乙-3/CDK A不动。
- 原始负例及四条付款收口证据：`../2026-09-21-step6-safety/`。
- 本轮只读确认密钥配置文件权限：`ssh … 'stat -c "%a %U %G" /etc/pojia/runtime.env'` → `600 root pojia`。未读取输出凭据，没有生产SQL写入。

入口变化：`deploy/server/pojia-ops.sh` 的restore-test不再只验表数，必须调用同版本 `v1/scripts/verify-restored-backup.mjs` 成功后才输出 `restore_test=OK`。帮助文字同步更新；恢复身份及实际灾备步骤在 `docs/PRODUCTION_PREP_RUNBOOK.md` §2，部署入口说明在 `deploy/README.md`。

验证器通过docker exec连接本次临时MySQL的Unix socket，不使用DATABASE_URL。要求准确临时容器名、恢复标签、running、network=none、无映射端口；已知057触发器结构/两个字段/迁移记录一致才验。缺失的 `pojia_migrator@172.17.0.1` 仅在临时库按显式prepare模式建立，ACCOUNT LOCK，仅获告警表SELECT/UPDATE/TRIGGER。默认模式缺身份报错；已有账号权限不足不自动补权；未知身份/可执行对象拒绝。

恢复后读取订单与CDK关联，对最新最多3条Session及3批CDK用原密钥解密/检查结构。密钥文件只解析白名单键、不执行、不打印密钥或明文；接受0600/0640，拒绝组可写及其他用户访问。缺样本不能证明解密，直接报未验证错误。

057功能验证使用合成告警，OPEN→RESOLVED→OPEN轮次必须为2，再ROLLBACK并检查探针已消失。不更新恢复出来的真实告警。旧备份无057明确显示NOT_APPLICABLE_PRE057；半迁移不能伪装为旧版本。只在容器创建成功后登记清理，避免名称碰撞误删其他容器。

## 验收结果

最终真实MySQL隔离演练：2026-09-21 04:20:30～04:21:24 UTC（12:20～12:21 UTC+8）。复现命令：

```bash
node scripts/restore-functional-rehearsal.mjs
npm --prefix v1 test
```

脚本调用**正式shell的restore_test函数**，只替换合成备份/密钥路径，保留导入、验证调用和EXIT清理；再用专用无网络MySQL验证负例，不以模拟数据库替代。生产CLI仍要求root。

| 验收承诺 | 原始结果 | 状态 |
|---|---|---|
| 真正功能检查后才报成功 | 正确备份：businessRead=OK，sessions=1/cdkBatches=1，incidentVersion=2，restore_test=OK | 通过 |
| 密钥错误不得报成功 | Session错密钥及CDK错密钥均RESTORE_DECRYPTION_OR_SHAPE_FAILED；正式shell无restore_test=OK | 通过 |
| 身份检查与最小权限 | 默认缺身份RESTORE_DEFINER_MISSING；prepare后仅表级SELECT/UPDATE/TRIGGER、account_locked=Y；重复执行不改账号 | 通过 |
| 权限/规则异常不自行修补 | 权限不足拒绝；缺触发器、未知DEFINER、半迁移均拒绝 | 通过 |
| 老备份/缺样本如实显示 | 无057显示NOT_APPLICABLE_PRE057；无Session样本RESTORE_DECRYPTION_SAMPLE_MISSING | 通过 |
| 配置权限 | 0640接受，0644拒绝RESTORE_KEYS_FILE_PERMISSIONS | 通过 |

[完整14项原始证据](evidence.json)。[默认测试输出](unit-tests.txt)：1030 tests / 961 pass / 0 fail / 69 skipped（新增3条验证器单测）；跳过的旧MySQL项目不算通过。bash语法、Node语法、git diff检查通过。

清理：专用业务库剩余0；本轮带恢复标签的临时容器剩余0；临时密钥、合成备份及目录清理，无新worker。用户8804演示和常驻进程未动。没有删除用户业务数据。

## 发布与剩余边界

- 新验证器没有被server/worker导入，只在运维恢复检查运行，不增加日常业务流程。
- 单提交发布候选必须包含新脚本；运维命令安装需另行确认，安装后核对哈希。从release路径直接调用ops脚本可保证用同一release验证器；只复制一个脚本却没有配套验证器时必须失败，不能降级旧检查。
- 生产迁移账号配置不能照抄临时ACCOUNT LOCK用户；真正恢复须按已批准账号方案恢复原身份/必要权限及独立密钥。全局SUPER不是触发器运行所需权限，临时演练未授予它。
- 数据量很大时的恢复耗时、生产最新备份样本、异地副本与独立密钥可获取性、实际恢复后真实业务全链路仍待单独验收。
