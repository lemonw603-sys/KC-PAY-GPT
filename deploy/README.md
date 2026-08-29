# AI充值业务 v1 生产部署

当前首版部署目标是与现有服务共用一台 AlmaLinux 9 主机，但保持独立运行边界：

- MySQL `mysql:8.4.11` 容器只发布到 `127.0.0.1:3306`。
- Web 只监听 `127.0.0.1:3100`，公网入口由 Caddy 提供。
- Web、worker 与 Bark 通知进程使用无登录权限的 `pojia` 系统账号。
- `/etc/pojia/` 保存 root 管理的生产环境文件，不进入 Git 或发布包。
- Web 只通过 `/etc/pojia/card-read.env` 取得 HNSKJ 只读接管凭据，不加载包含充值供应商密钥的 `provider.env`。
- 供应商读写开关初始均为关闭；部署与数据库验证不会调用外部充值接口。

部署顺序：

1. 上传干净的提交产物和本目录配置。
2. 执行 `bootstrap-host.sh`，创建独立目录、账号、密钥和 MySQL 容器。
3. 上传已有的 `admin.env`，权限设为 `root:pojia 0640`。
4. 使用迁移环境执行数据库迁移，随后锁定迁移账号。
5. 安装并启动 Web、worker；配置 Bark Device Key 后再启用 `pojia-bark-notifications.service`。
6. DNS 生效后再导入 `pojia.caddy`，先校验后 reload，不能覆盖现有 Caddyfile。
7. 运行账号权限、回环监听、恢复测试和公网不可达验证全部留存证据。

日常运维统一使用 `pojia-ops.sh`，安装到服务器后可执行：

- `pojia-ops status`：查看 Web、worker、MySQL、备份定时器和最新备份。
- `pojia-ops backup`：立即创建并校验一份加密备份。
- `pojia-ops verify`：校验最新备份的哈希、解密和压缩完整性。
- `pojia-ops restore-test`：在无网络的临时 MySQL 容器中做真实恢复演练，不接触生产库。
- `pojia-ops check`：一次完成状态检查和最新备份校验。

生产迁移、停机顺序、Bark 演练和只读体检必须按
[`docs/PRODUCTION_PREP_RUNBOOK.md`](../docs/PRODUCTION_PREP_RUNBOOK.md) 执行；在运行手册的维护窗口步骤完成前，不得执行迁移或启用任何 Provider 写路径。

`bootstrap-host.sh` 不删除或改名任何现有容器，不修改 firewalld 和现有 Caddyfile。

Bark 配置保存在 `/etc/pojia/bark.env`，初始为 `BARK_ENABLED=false`。填入 Device Key 后安装并启动：

```bash
install -m 0644 deploy/server/pojia-bark-notifications.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now pojia-bark-notifications.service
```

真实直充写入统一使用 `pojia-recharge-gate.sh`，安装为 `/usr/local/sbin/pojia-recharge-gate`：

- `status [订单查询码]`：显示指定订单 Permit 状态；Provider 写开关和 Worker 状态必须另外用 `systemctl` 与只读体检核对。
- `arm <订单查询码> [分钟]`：在数据库事务中完成付款前复核、签发唯一短时 Permit，并打开数据库中的 `dispatch_new_recharges` 派发开关；它不会修改 systemd 环境文件。
- `close <订单查询码>`：在数据库事务中关闭 `dispatch_new_recharges` 并撤销该订单尚未消费的 Permit；它不会停止 Worker，已有订单轮询会继续运行。

不得直接编辑环境文件绕过 Permit。Permit 消费后任何失败都进入终态或人工核对，不自动再次创建直充订单。

## 独立 Browser production-readonly Worker

Browser 队列不由 `pojia-worker.service` 消费。独立单元为
`deploy/server/pojia-browser-worker.service`，现阶段只能执行 readonly canary，不具备付款能力。

安装前必须同时安装 `v1` 和 `browser-mvp` 依赖，并单独安装系统 Google Chrome：

```bash
npm --prefix /opt/pojia/current/v1 ci --omit=dev
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
  npm --prefix /opt/pojia/current/browser-mvp ci --omit=dev
install -o root -g pojia -m 0640 \
  deploy/server/browser-readonly.conf.example /etc/pojia/browser-readonly.env
install -o root -g root -m 0644 \
  deploy/server/pojia-browser-worker.service /etc/systemd/system/
systemctl daemon-reload
```

随后必须用真实非敏感值替换 env 模板中的占位符，并先验证：

```bash
systemd-analyze verify /etc/systemd/system/pojia-browser-worker.service
systemctl start pojia-browser-worker.service   # 仅在单独批准的 readonly canary 窗口
systemctl status pojia-browser-worker.service
```

本仓库不自动 `enable/start` 该单元。启动前要求：迁移 `001–040`
已完成、数据库 `browser_payment_writes_enabled=false`、指定 executor profile 为
`BROWSER/ACTIVE` 且 `productionWritesEnabled=false`、所有 Provider/卡资金写开关为 false。
不得将真实客户订单放入当前 readonly lane；它会在观察后通过
`abortBeforePayment()` 安全退回，不会完成充值。

共享 Session/card-material adapter 默认关闭。只在批准的非付款观察中，把独立 env 的
`BROWSER_SHARED_MATERIALS_MODE` 改为 `SHARED_ENCRYPTED_NONPAYMENT`；它复用 runtime env 中现有
`SESSION_ENCRYPTION_KEY_BASE64`，不接受原始 Session/PAN/CVC 环境变量。外部只读模式必须同步使用
确认词 `I-CONFIRM-EXTERNAL-READONLY-SHARED-MATERIALS-NO-PAYMENT`。`PAGE_ONLY` 隔离夹具可预检卡资料；
真实 ChatGPT 只读窗口必须再显式设置 `BROWSER_READONLY_HARNESS=CHATGPT_ACCOUNT_CHECKOUT`，目标必须精确为
`https://chatgpt.com/`。该 harness 只读取并注入 Session，不解密卡资料，依次核对登录、身份摘要、
当前订阅、Plus 入口和 Checkout 页面，然后安全退出；不填卡、不提交付款。

完整边界、环境项和本地 smoke 证据见
[`docs/browser-research/production-readonly-browser-worker-2026-08-27.md`](../docs/browser-research/production-readonly-browser-worker-2026-08-27.md)。

Browser 单元的最小停止/回滚入口（只影响 Browser，不停止旧 API Worker）：

```bash
systemctl stop pojia-browser-worker.service
systemctl disable pojia-browser-worker.service
systemctl reset-failed pojia-browser-worker.service

# 若本次发布同时切换了 /opt/pojia/current，再按发布记录恢复 previous release：
ln -sfn /opt/pojia/releases/<previous-release> /opt/pojia/current
systemctl daemon-reload
```

回滚后必须确认 `pojia-browser-worker.service` 为 `inactive/disabled`，数据库
`browser_payment_writes_enabled=false`，且没有活动 Browser permit/lease。不要通过回滚重新派发
`PAYMENT_UNKNOWN`/`RECONCILIATION_REQUIRED` 任务；这两类任务只能核对。
