# 生产前安全准备运行手册

> 目的：在不执行开卡、直充、退款或余额提取的前提下，完成迁移、备份、Bark 和只读体检。
> 本手册不授权任何 Provider 写调用；出现未知状态时立即停止并保留证据。

## 0. 操作前快照

先验证候选来自一个确定提交且没有旧 release 叠加文件：

```bash
scripts/verify-production-release.sh \
  /opt/pojia/releases/<candidate> \
  /opt/pojia/release-bundles/<candidate>/source-manifest.sha256
```

必须返回 `release_manifest=OK`；出现任意 missing、changed 或 extra 都停止部署。候选只能由 `scripts/build-production-release.sh` 通过 `git archive` 构建，禁止复制 current 后局部覆盖。

以 root 执行并保存完整输出：

```bash
date -u
readlink -f /opt/pojia/current
systemctl is-active pojia-web.service pojia-worker.service \\
  pojia-card-read-sync.timer \\
  pojia-card-catalog-sync.timer pojia-bark-notifications.service
pojia-ops status
```

同时保存：当前发布清单哈希、`schema_migrations` 版本、应用设置、活动任务/租约、Permit、资金风险尝试和 Bark `DEAD` 数量。

在外部网络执行网络边界检查：

```bash
nc -vz -w 5 ops.vibebridge.top 3306
```

预期结果必须是连接失败或被防火墙拒绝。若公网 3306 可以建立 TCP 连接，立即停止本手册后续步骤，先关闭公网暴露；不得尝试 MySQL 登录。生产机本地的 `127.0.0.1:3306` 才允许可达。

## 1. 进入维护窗口

迁移和恢复演练前，停止可能领取资金任务的进程和定时器：

```bash
systemctl stop pojia-card-stock-runner.service
systemctl stop pojia-worker.service
```

不要停止只读同步，除非供应商限流或数据库维护另有要求。停止后必须确认：

- 活动开卡任务为 0；
- 活动充值 Permit 为 0；
- 活动资金风险尝试为 0；
- 过期租约为 0；
- 不确定 Provider 调用为 0。

如果任一条件不满足，不得继续迁移或启用 Bark，先人工处理并保存证据。

## 2. 备份和隔离恢复

```bash
pojia-ops backup
pojia-ops restore-test
pojia-ops verify
```

恢复测试必须使用无网络临时 MySQL，不得连接生产库，不得启动 Worker。确认备份文件、校验文件和恢复密钥均不进入项目目录；另行确认已有异地加密副本和分离保存的恢复密钥。

## 3. 执行迁移

只使用迁移专用账号：

```bash
cd /opt/pojia/current/v1
npm run migrate
npm run migrate
```

第二次执行必须只报告 `already applied`。迁移完成后锁定或撤销迁移账号，并保存迁移版本和命令输出。

## 4. 恢复只读服务

迁移确认成功后，先启动 Web 和只读能力；资金 Worker 和卡库存付费执行器保持停止：

```bash
systemctl start pojia-web.service
systemctl start pojia-card-read-sync.timer pojia-card-catalog-sync.timer
```

客户接单开关保持关闭，数据库中的 `dispatch_new_recharges` 保持关闭。

## 5. Bark 验证

配置 `/etc/pojia/bark.env` 后：

```bash
systemctl enable --now pojia-bark-notifications.service
```

使用普通内部告警验证：

- 手机收到消息；
- 正文不包含 Session、PAN、CVV、API Key 或完整 CDK；
- 两个 runner 并发时只有一个领取；
- `SENDING` 超时后能够重领；
- `DEAD` 恢复需要显式确认词并留下审计记录。

## 6. 只读上线体检

```bash
PROVIDER_WRITES_ENABLED=false \\
PROVIDER_CARD_WRITES_ENABLED=false \\
PROVIDER_RECHARGE_WRITES_ENABLED=false \\
npm run preflight:readiness
```

然后执行 Provider 只读检查。若 HNSKJ 仍返回已知的 401，立即停止，不重复尝试密钥，也不转入任何写调用。

## 7. 退出维护窗口

仅在迁移、恢复、Bark 和只读体检全部通过后恢复服务。第一笔真实订单前，继续保持：

- `pojia-worker.service` 停止或无可领取资金任务；
- `pojia-card-stock-runner.timer` 停止；
- `card_auto_replenishment_enabled=false`；旧 timer 不得随发布恢复；
- 所有 Provider 写开关关闭；
- 没有活动 Permit、UNKNOWN 或资金风险尝试。

真实订单按 [RUNBOOK.md](./RUNBOOK.md)「1. 来单」执行（单笔、Lane4 单窗口、付款开关当次开当次关）。早期小批量稿已归档：[archive/undated/SMALL_BATCH_RUNBOOK.md](./archive/undated/SMALL_BATCH_RUNBOOK.md)（历史，只作追溯）。
