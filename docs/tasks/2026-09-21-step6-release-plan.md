# 第⑥步统一发布方案（待用户确认执行）

更新时间：2026-09-21，UTC+8。范围＝工作台/CDK/卡片/设置及其已验后端修复，不只CDK。**本文是拟执行方案，不是已发布记录，也不构成执行授权。**

## 候选与依据

- 固定代码候选：`5e7e717935e3924fa299f77bdb7b0bb2d54cc05d`（纳入D-324恢复检查；替代旧2d41192，后者不含新运维验证器）。
- 拟release名：`20260921-step6-5e7e717`；prepare前检查同名目录不得已有不一致内容。
- 决策D-313～D-324；原型A与已有三份1440契约；联合核查、修复、迁移/恢复演练证据见docs/reviews下2026-09-21相关报告。D-323付款开关保持原样。
- 默认测试961 pass/0 fail/69 skipped；此前28迁移场景、6类订单恢复场景，新增14恢复检查场景通过。不是所有生产资金动作/全项目MySQL套件全绿。
- 候选相对当前⑤b没有browser-mvp文件变化，不重启本机常驻Browser池。

## 本轮只读核对（2026-09-21 03:07 UTC）

```text
current=/opt/pojia/releases/20260918-step5b-b0a36d4
schema latest=054_card_retirement
web active PID3053 / worker active PID2035 / bark active PID3105
ready HTTP200
非终态订单0 / active_browser_runs0
RUNNING任务0行 / card_stock_jobs(PENDING,RUNNING,REVIEW_REQUIRED)0行
recharge_attempts(ACTIVE,UNKNOWN)0行
accept_new_orders=true / dispatch_new_recharges=true
browser_payment_writes_enabled=true / card_auto_replenishment_enabled=true
```

这些只代表该次查询，不保证执行时仍空闲；维护开始前必须重查。

## DDL身份方案：迁移专用账号临时授权，随后撤回

只读确认身份：`pojia_migrator@172.17.0.1`。当前SHOW GRANTS为global USAGE + `pojia`库ALL，无SUPER。容器内root@localhost可用，根凭据在已有root-only秘密文件中，不抄到本机、仓库、命令日志或新配置文件。

拟执行方式：

1. 记录迁移账号原SHOW GRANTS；与上述基线不一致则停止复核。
2. 经现有容器内管理连接，仅为该准确身份临时授予全局SUPER（当前MySQL8.4.11、binlog=1/trust_creators=0创建触发器需要）。**不授予应用账号，不修改全局trust_function_creators，不新增生产账号。**
3. 正式`deploy-release.sh migrate`仍使用migration.env账号及版本化迁移runner，执行055～057及重复执行。预检/逐项结构验证/迁移锁均保留。
4. 无论迁移成功或失败，撤回本次加的SUPER；新连接SHOW GRANTS确认恢复基线。撤权失败则停止后续步骤，不以“稍后补”带过。
5. 保留迁移账号原有库级权限和身份，触发器DEFINER为该身份；不删除账号、不机械撤其TRIGGER/UPDATE等原有权限。

生产权限写操作尚未执行。下面是本机一次性隔离账户的真实验证，不是生产结果：

```json
{
  "mysql": "8.4.11",
  "migrated": ["055_cdk_issuance_and_expiry", "056_cdk_sales_metadata", "057_alert_incident_version"],
  "superRevoked": true,
  "incidentAfterReopen": 2,
  "definerIsMigrator": true,
  "repeatAfterRevoke": "三份均already applied",
  "globalTrustCreatorsUnchanged": true
}
```

测试库与账户已删除；全局配置未改。本轮没有给生产账号授权。

## 拟执行顺序与影响

### 1. 推送与prepare（不切生产）

用户批准后，确认工作区干净，将包含候选的本地提交推送现有origin；按固定候选构建/上传单提交release包，运行prepare的备份和全量manifest校验、依赖安装。失败不进入维护，不拼旧目录补文件。

### 2. 维护入口（会短暂停接单及页面可用性）

- 用正式应用设置服务/连接池将接单关闭，保存原值并审计；不直接改库，不连带改变付款/自动供卡配置。
- 记录项目9个timer原active/enabled状态。迁移时暂停它们的调度，避免并发写；不更改enable配置。包括stock、funding、funding-reconcile、card-read-sync、catalog-sync、highvcc-snapshot、operator-watch、daily-reconciliation、backup。
- 已启动的oneshot资金服务让它自然结束；**不强杀可能正在开卡/付款的任务**。无法确认结果或出现REVIEW_REQUIRED/UNKNOWN即停下，先处理，不继续DDL。
- 确认无在途订单/活动Browser账号槽/资金尝试/运行任务后，停止服务器web、worker、bark；本机Browser池和8804演示不动。
- 再做一次维护点备份并验证；如执行隔离恢复演练，先核实资源余量，不将校验和验证称作恢复成功。

### 3. 迁移

按上节临时授权方案，从准备好的release执行055～057；再执行必须全部already applied。独立检查列/索引/触发器/迁移版本，以及原有码状态数量未被意外改写。撤权并再次确认权限/DEFINER。

迁移后在维护状态新建一份备份，再从**已准备的候选release路径**直接调用其`deploy/server/pojia-ops.sh restore-test`（显式传该份备份），不要用仍指向旧current的验证器。先检查内存/磁盘余量。新版检查只在无网络临时容器补已知锁定DEFINER、表级必要权限，代表性解密和告警探针通过才输出OK；失败保持维护，不删生产身份/结构，不自动扩大权限。该演练不代替独立密钥/异地副本验收。

### 4. switch与复验

- `deploy-release.sh switch`切换同一release并重启web/worker/bark；接单仍关闭，相关timer仍暂停。
- 独立新连接验证三进程实际cwd/PID、ready、登录与受保护端点、静态资源版本、四页读接口、CDK分类/期限字段；不额外创建真实CDK、开卡、充值或作废旧码当测试。
- 本机Browser心跳在服务恢复后只读核对，不重启、不放真实演练单。
- 全部通过后按维护前快照恢复接单与timer运行状态；不擅自打开原先关闭的开关或定时器。原业务自动执行恢复，不另外发起资金测试。
- 同一批准窗口安装新版运维入口：现场用`command -v pojia-ops`及`readlink`确定准确安装目标，安全保存旧脚本，再从此release安装`deploy/server/pojia-ops.sh`，独立核对哈希与配套验证器文件。不能猜安装路径或只换入口不交付验证器。`backup/verify/status`原语义不变；本轮尚未安装。

## 失败收敛与回退

- 任何资金结果未知、结构冲突、权限撤回失败、备份/manifest/健康失败，都停止后续步骤。
- 迁移前失败：不切版本，恢复已改变的维护状态（确认无资金风险后）。
- 迁移中失败：先撤临时SUPER，保持接单/资金执行暂停；依据结构证据决定续跑，不自动删列、删触发器或直接倒回整库。
- 切换后复验失败：可以把代码链接退回事前确认的⑤b目录，但维持维护状态，**不照抄自动恢复所有worker的回滚命令**。新字段保留，旧代码不保证新有效期/告警轮次语义，未确认兼容之前不恢复营业。
- 若需要回退运维入口，使用本窗口已保存的旧文件并核对哈希；不能把旧版表数检查的OK当作新的功能恢复验收。新版入口找不到配套验证器时会明确失败。
- 备份调度不应因失败而被长期停掉；在DDL结束、库可读后恢复其原状态。其余服务按证据和故障性质恢复，不猜。

## 本次确认不包含

- 作废那批自用老码、真实开卡/充值/退款/提现测试。
- 第⑦、第⑧步实施。
- 永久扩大应用或迁移账号权限、修改数据库全局安全配置。
- 生产历史通知批量重推、清理历史订单/遗留任务。

批准方式：用户明确同意按本方案现在执行第⑥步统一发布（含推送、备份、维护、临时授权/撤权、迁移与切换、隔离恢复检查及运维入口安装）。实际动手前重查停止条件，发现与计划不符就停下报告。
