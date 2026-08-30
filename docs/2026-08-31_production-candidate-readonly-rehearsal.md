# 生产候选只读演练｜2026-08-31

## 候选包
- 提交：`8da5127`
- 归档：`/tmp/20260831-preflight-8da5127.tar`
- SHA-256：`52f606b43a1ad5ee0b4c7d2004a2d741a158e134447d815576644b07eef6a78c`

## 服务器与步骤
- 主机：`144.34.180.184`（`elegant-unicorn-1.localdomain`）
- 候选 release 解压到 `/opt/pojia/releases/20260831-preflight-8da5127`
- 远端重新安装 v1/browser-mvp 生产依赖，均无漏洞报告
- 临时切换 `/opt/pojia/current` 到候选，仅启动独立 Browser readonly unit
- `systemd-analyze verify` 通过
- Browser Worker 启动成功：`active`、`Result=success`、`NRestarts=0`、`ExecMainStatus=0`
- 日志显示 READY 后持续 IDLE；无 Browser 任务被领取、无页面付款动作
- 手动停止后状态 `inactive`
- trap 自动恢复 current 到 `/opt/pojia/releases/20260830-card-sync-wording-d230273`

## 恢复后核验
- `pojia-web.service`：active
- `pojia-worker.service`：active
- `pojia-browser-worker.service`：inactive / disabled
- 公网 `https://ops.vibebridge.top/health/live`：`{"status":"ok"}`
- 公网 `https://ops.vibebridge.top/health/ready`：`{"status":"ready"}`

## 边界
本次没有启用 Browser Worker，没有执行 Provider/卡台写入、开卡、充值、付款或真实订单；生产 current 已恢复原 release。候选 release 保留在服务器供后续可逆部署确认。
