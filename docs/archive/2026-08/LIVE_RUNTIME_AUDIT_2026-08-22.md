# 运行时排查记录（2026-08-22）

## 目的与边界

本次只读复核用于回答“是否已经把整套系统排查全”。没有执行开卡、既有卡充值、直充、提现、退款、真实 Browser 付款，也没有访问或输出任何密钥、Session、完整卡资料或生产数据库行。

证据优先级：现场 HTTP 响应 > 生产发布记录/数据库证据 > 当前工作树代码与测试 > 规划及历史文档。

## 已现场复核

| 项目 | 结果 | 证据 |
|---|---|---|
| `https://ops.vibebridge.top/health/live` | 通过 | HTTP 200，`{"status":"ok"}` |
| `https://ops.vibebridge.top/health/ready` | 通过 | HTTP 200，`{"status":"ready"}` |
| `https://plus.vibebridge.top/health/live` | 通过 | HTTP 200，`{"status":"ok"}` |
| `https://plus.vibebridge.top/health/ready` | 通过 | HTTP 200，`{"status":"ready"}` |
| `https://ops.vibebridge.top/admin` 未带会话访问 | 符合保护预期 | HTTP 302，跳转 `/admin/login`；未读取或提交登录凭据 |
| 生产 HTTPS 响应头 | 通过基础检查 | 返回 HSTS、CSP、`X-Content-Type-Options: nosniff` 等安全头；本次未作完整渗透测试 |
| 本地 legacy + v1 测试 | 通过 | legacy 85/85；v1 360 通过、34 跳过、0 失败 |
| 本地 Browser PoC | 通过 | 11 个文件、77 个测试通过；均为离线/本地仿真 |
| `git diff --check` | 通过 | 当前工作树无空白错误 |

## 仍未能通过当前工具直接证明的内容

以下事项不能从公网健康接口推断，当前也没有可安全复用的 SSH/生产 shell 会话或可审计的只读 HNSKJ 凭据输入，因此不写成“已核实”：

1. 当前 `/opt/pojia/current` 实际指向的 release、systemd 服务状态、生产迁移版本和生产数据库关键表；
2. 当前 HNSKJ API Key 的 `/account/profile`、`/account/balance`、`/card-types`、`/cards` 只读结果；历史材料对此存在 401 与后续同步正常的时间差证据，必须以当前只读请求定案；
3. 当前生产是否仍保持 `accept_new_orders=false`、`dispatch_new_recharges=false` 及所有 Provider 写开关关闭；只能引用最近落盘发布记录，不能冒充本次现场核验；
4. 生产阶段三 release 是否包含当前工作树中的阶段四/Browser 文件；当前工作树有大量 Browser 未提交/未跟踪文件，不能据此推断生产已部署；
5. 真实免费目标账号成功链路、真实卡余额充值、新卡付费开卡、`SUBMIT_UNKNOWN`、人工 UNKNOWN 恢复、卡台切换和 Browser 真实付款。

## 本次发现的事实性不一致

- 当前工作树 `v1/src/providers/hnskj-card.js` 已有 `rechargeCard()` 方法及幂等键/金额校验；部分历史文档仍写“适配器尚未实现”。正确表述应为：**代码已实现并有隔离测试，生产注册、真实写入和现场验证未完成**。这些历史文档保留为历史快照，不应覆盖当前事实源。
- 当前 `card-funding-scheduler.js` 和 `card-stock-job-service.js` 仍使用固定的旧 HNSKJ account ID。它们不能被表述为已支持卡台替换/备用卡台。
- 生产健康接口 200 只能证明 Web 层存活/就绪，不能证明 Worker、MySQL 业务数据、Provider 凭据或资金写链路可用。

## 最终判定

因此，不能声称“所有运行时事实都已排查完”。目前可以确定的是：**代码、迁移、文档、隔离测试和公开 Web 健康面已系统排查；生产 release/数据库/卡台当前只读状态仍需一次具备现场凭据的只读核验。** 在该核验完成前，不得开启任何资金写开关，也不得把隔离测试当成生产成功验收。

## 追加尝试：环境归属未证明（2026-08-22）

另一窗口返回了以下结果：`/opt/pojia/current` 无输出、`systemctl` 和 `pojia-ops` 不存在、`DATABASE_URL` 和 `HNSKJ_API_KEY` 未配置；公网 `ops`/`plus` 的 live/ready 仍为 HTTP 200。

这组结果只能证明该窗口所连接的环境不是可识别的生产服务器（或没有进入生产 shell），不能据此推断生产路径不存在、数据库未配置或 HNSKJ 凭据失效。R0 服务器核验仍未完成；公网健康结果继续只代表 Web 层可达/就绪。

随后确认该环境为本机 macOS：`hostname=Lemons-MBP-2293.local`、`whoami=lemon`、`pwd=/Users/lemon/code/AI充值业务`、`uname=Darwin arm64`，且 `/opt/pojia` 不存在。因此这不是生产服务器，相关命令输出不具备生产状态证据效力。

## 生产 VPS 只读核验完成（由已登录生产终端回传，2026-08-22）

已确认实际生产主机为 `elegant-unicorn-1.localdomain`，当前 release 为 `/opt/pojia/releases/20260822-stage3-8a3134d`。Web/Worker、MySQL、只读卡同步、卡目录同步和 Bark 服务均在运行；卡库存付费 runner timer 保持 inactive。

生产 readiness 返回 `ok=true`，最新迁移为 `026_automatic_fulfillment_funds_fence`；活动任务、过期租约、UNKNOWN Provider 调用、活动资金风险、活动充值授权和 DEAD Bark 通知均为 0，阻断项为 0。`acceptNewOrders=false`、`dispatchNewRecharges=false`，三个 Provider 写开关均为 false。HNSKJ 只读检查和 ZZSHU 连接检查均通过，read-check exit 为 0。

本次没有配置修改、部署、重启、开卡、卡充值、直充、付款、提现或退款。该结果完成了 R0 生产只读基线；它不等于阶段四已部署、正式成功单已验收或 Browser 已接入。

## 完成最后核验所需的最小输入

只需要一个已登录生产服务器的只读终端会话，按 `docs/PRODUCTION_PREP_RUNBOOK.md` 执行第 0、6 节并保存脱敏输出；另需在写开关全部关闭时运行 `v1/scripts/provider-read-check.js`。不需要用户提供或在聊天中粘贴密钥。
