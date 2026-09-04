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
- 已在仓库外创建本机 `~/Library/Application Support/VibeBridge/browser-readonly.env`，权限 `0600`；配置使用 BitBrowser 六 Profile、headed 模式、生产 loopback 隧道和共享加密材料模式。配置加载器实测通过（`runtimeProvider=BITBROWSER`、6 profiles、payment executor=false），未启动 Worker。

## 只读 canary 结果

- 按确认启动了一次 `run-macos-headed-worker.sh`（`ONCE`）。生产数据库只读检查先返回 `READY`，随后 BitBrowser Profile warmup 在 `/browser/open` 被本地 API 拒绝。
- 对首个 Profile 做了单次脱敏复核，厂商返回“网络不通已停止打开浏览器”。因此本轮阻断点是 BitBrowser Profile 的网络/代理连通性，不是生产数据库、订单租约或付款逻辑。
- wrapper 已自动收尾：SSH 隧道监听已消失、Worker 退出；没有领取任务、读取客户 Session、调用 Provider/卡台或付款。
- 不再重复打开 Profile 以消耗每日额度。下一步先修复或验证 BitBrowser Profile 的代理连通性，再重跑一次只读 canary。

## 代理恢复后的复验

- 发现本机 mihomo 未运行；按既有 `0600` 配置启动后，HTTP 代理 `127.0.0.1:17897` 恢复监听，Cloudflare trace 实测 `loc=PH`、`colo=MNL`。
- 重跑一次 canary 后，生产 DB 检查仍为 `READY`；六 Profile warmup 在 BitBrowser Local API 10 秒超时（`BITBROWSER_API_TIMEOUT`），不是“网络不通”拒绝。已通过 Local API 对六个 Profile 发起关闭请求，全部 HTTP 200/success=true，确认没有残留打开窗口。
- 当前剩余问题是 BitBrowser Profile warmup/Local API 响应时间超过 10 秒，需要在不重复消耗额度的前提下单独调高只读 canary 的 API 超时并做一次受控复验。付款、订单和 Provider 路径仍未触碰。

## 60 秒超时复验

- 将仓库外本地只读 env 的 `BROWSER_BITBROWSER_API_TIMEOUT_MS` 调整为 `60000`，再次运行一次 `ONCE` canary。
- 结果：生产 DB 检查 `READY`；只读迭代返回 `IDLE`；Worker 正常退出（exit 0）。SSH 隧道已关闭，Profile 无残留打开窗口，mihomo 菲律宾代理继续监听。
- 本轮仍未领取订单、读取客户 Session、调用 Provider/卡台或付款。生产 Browser Worker 仍未启用。

结论：10 秒是本机 BitBrowser 冷启动的观测超时，不代表业务失败；60 秒配置可完成无任务只读 canary。后续只有在真实非付款任务下才能验证页面访问和长时吞吐。

## 结论边界

SSH target/key 和 loopback 隧道路径已具备可用证据，但仍未完成生产 Browser 只读 Worker 的配置文件创建、launchd 加载或队列接入。当前只能说“接入前置网络与权限路径已打通”，不能说 Browser 已接入生产或已具备客户订单履约能力。

下一次动作仍需单独批准：运行 launcher 的一次 `--check`/只读 canary（启动时才会建立 SSH 隧道和 Worker）。在此之前不加载 launchd，不领取真实订单，不付款。Browser Worker 继续保持 disabled/inactive。
