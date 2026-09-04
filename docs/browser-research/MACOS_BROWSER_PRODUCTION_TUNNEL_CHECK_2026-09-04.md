# macOS Browser 生产只读接入前置核对（2026-09-04）

## 本轮实际核对

- 本机 BitBrowser Local API 在 `127.0.0.1:54345` 返回 HTTP 200；未打开任何 Profile。
- 本机菲律宾代理配置文件权限为 `0600`；本轮未读取或打印代理订阅内容。
- 使用现有 SSH 身份对生产主机 `144.34.180.184` 做了 BatchMode 连接，成功建立到生产 MySQL loopback 的本地端口转发；随机本地端口探测成功后立即关闭隧道。
- 生产 `pojia-browser-worker.service` 仍为 `disabled/inactive`，未启动、未领取任务、未读取客户 Session、未调用 Provider/卡台、未付款。
- 生产 MySQL 确认仅监听 `127.0.0.1:3306`，没有把 3306 暴露为公网监听。
- 生产 `/etc/pojia/browser-readonly.env` 当前为 `root:pojia 0640`。这是与 systemd unit（`User=pojia`, `Group=pojia`）匹配的最小可读权限；不能误改为 `0600`，否则服务账号无法读取。macOS 本地 launcher 的独立环境文件才强制 `0600`。
- `run-macos-headed-worker.sh` 通过 shell 语法检查；Browser production-readonly 配置、macOS launcher、systemd 合同相关测试共 31/31 通过。
- 本机目标路径 `~/Library/Application Support/VibeBridge/browser-readonly.env` 当前不存在，launchd 服务也未加载；这是预期的未接入状态，不是故障。
- 生产 runtime 中存在数据库 URL 与共享加密 key，Browser readonly env 中存在 worker/profile 与三把 Browser key；本轮只核对“存在”，没有读取、复制或打印值。

## 结论边界

SSH target/key 和 loopback 隧道路径已具备可用证据，但仍未完成生产 Browser 只读 Worker 的配置文件创建、launchd 加载或队列接入。当前只能说“接入前置网络与权限路径已打通”，不能说 Browser 已接入生产或已具备客户订单履约能力。

下一次动作仍需单独批准：在仓库外创建不含 Session/PAN/CVC/API key 的本地 `0600` 环境文件，运行 launcher `--check`；通过后再安排一次不付款的生产形态只读 canary。Browser Worker 继续保持 disabled/inactive。
