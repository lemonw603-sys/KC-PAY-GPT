# Browser 生产只读启动/停止/回滚演练

历史演练候选：`/tmp/aicharge-main-46b2cc7.tar`。后续部署必须从当前主线重新构建，不得复用该旧包。

## 前提

- 仅在 SSH 已连接生产 VPS 时执行；
- 迁移 001–041、所有付款/Provider/卡资金写开关为关闭；
- 不放入真实客户订单，不读取真实 Session/PAN/CVC。

## 演练顺序

1. 备份当前 release 和服务状态；
2. 安装依赖并安装 `pojia-browser-worker.service`；
3. `systemd-analyze verify /etc/systemd/system/pojia-browser-worker.service`；
4. `systemctl start pojia-browser-worker.service`，观察启动与只读检查；
5. 确认无付款提交、无 Provider 写入、无活动资金 permit；
6. `systemctl stop` + `disable`，确认服务回到 `inactive/disabled`；
7. 如需验证回滚，恢复 previous release，再次 `daemon-reload`，不重新派发任务。

详细安装和停止命令以 `deploy/README.md` 为准。本文件不包含生产凭据，也不构成真实付款授权。
