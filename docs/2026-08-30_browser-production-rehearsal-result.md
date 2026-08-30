# Browser 生产只读演练结果（2026-08-30）

## 结果

- VPS：`elegant-unicorn-1.localdomain`
- `systemd-analyze verify`：通过。
- 服务环境写开关：付款、Provider、卡资金均为 `false`。
- 首次启动演练：失败，原因是当前 release 缺少 `playwright` 依赖（`ERR_MODULE_NOT_FOUND`）。
- 补齐依赖并切换到候选 release 后再次启动：依赖问题已越过，但只读 Worker 报 `ProductionReadonlyConfigError / INVALID_BROWSER_WORKER_CONFIG`，说明生产 env 与当前候选版本的只读配置合同仍未对齐。
- 已立即执行 `stop`、`disable`，当前 `pojia-browser-worker.service` 为 `inactive/disabled`，避免持续重启。

## 判断

这是生产部署缺口，不是付款逻辑漏洞；但在补齐依赖并重新验证前，Browser Worker 不得启动，更不得进入真实付款。

## 下一步

在新的候选 release 中按部署文档安装依赖，并补齐生产只读 env 合同；先在服务器执行 `--check` 和只读 smoke，再重复启动/停止演练。
