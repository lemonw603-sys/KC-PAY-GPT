# 破甲 v1 生产部署

当前首版部署目标是与现有服务共用一台 AlmaLinux 9 主机，但保持独立运行边界：

- MySQL `mysql:8.4.11` 容器只发布到 `127.0.0.1:3306`。
- Web 只监听 `127.0.0.1:3100`，公网入口由 Caddy 提供。
- Web 与 worker 使用无登录权限的 `pojia` 系统账号。
- `/etc/pojia/` 保存 root 管理的生产环境文件，不进入 Git 或发布包。
- 供应商读写开关初始均为关闭；部署与数据库验证不会调用外部充值接口。

部署顺序：

1. 上传干净的提交产物和本目录配置。
2. 执行 `bootstrap-host.sh`，创建独立目录、账号、密钥和 MySQL 容器。
3. 上传已有的 `admin.env`，权限设为 `root:pojia 0640`。
4. 使用迁移环境执行数据库迁移，随后锁定迁移账号。
5. 安装并启动两个 systemd 单元，验证回环健康检查。
6. DNS 生效后再导入 `pojia.caddy`，先校验后 reload，不能覆盖现有 Caddyfile。
7. 运行账号权限、回环监听、恢复测试和公网不可达验证全部留存证据。

日常运维统一使用 `pojia-ops.sh`，安装到服务器后可执行：

- `pojia-ops status`：查看 Web、worker、MySQL、备份定时器和最新备份。
- `pojia-ops backup`：立即创建并校验一份加密备份。
- `pojia-ops verify`：校验最新备份的哈希、解密和压缩完整性。
- `pojia-ops restore-test`：在无网络的临时 MySQL 容器中做真实恢复演练，不接触生产库。
- `pojia-ops check`：一次完成状态检查和最新备份校验。

`bootstrap-host.sh` 不删除或改名任何现有容器，不修改 firewalld 和现有 Caddyfile。

真实直充写入统一使用 `pojia-recharge-gate.sh`，安装为 `/usr/local/sbin/pojia-recharge-gate`：

- `status [订单查询码]`：显示三个 Provider 写开关、Worker 和指定订单 Permit 状态。
- `arm <订单查询码> [分钟]`：先签发唯一、短时、一次性 Permit，再开启 ZZSHU 写入并重启 Worker。
- `close [订单查询码]`：先关闭 ZZSHU 写入并重启 Worker，再撤销未消费的 Permit。

不得直接编辑环境文件绕过 Permit。Permit 消费后任何失败都进入终态或人工核对，不自动再次创建直充订单。
