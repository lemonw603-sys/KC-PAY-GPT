# 当前状态快照（2026-08-29 15:55 CST）

> 本文件只保留当前有效状态。历史过程查 `docs/HANDOFF_LOG.md`；本阶段封账证据查 `docs/PRE_INVENTORY_CONVERGENCE_SEAL_2026-08-28.md`。

## 代码与发布

- 当前生产代码提交：`bba4105`（从生产基线 `ef5afd5` 仅带入按订单需求同步过期候选卡的修复，不含延期的“开始营业”入口或 Browser 新代码）。
- 生产 release：`/opt/pojia/releases/20260829-order-demand-sync-bba4105`，为真实独立目录；上一版本回滚点：`/opt/pojia/releases/20260829-card-refresh-ef5afd5`。
- 可靠回滚点：`/opt/pojia/releases/20260828-fea0ffd-rollback`。
- 服务：Web、API Worker、卡片读同步、卡目录同步、Bark、备份均正常；Browser Worker 保持 `inactive/disabled`。
- 付费补卡 runner 已确认为 `inactive/disabled`，避免重启后每 10 秒唤醒并带入卡台写权限。
- 最新迁移：`040_card_operational_overrides`。

## 运行门禁与体检

- 生产服务器已独立复核：`acceptNewOrders=true`、`dispatchNewRecharges=true`、派发模式 `AUTOMATIC`；这是用户此前手动开启并决定继续保留的当前运营状态。
- `card_auto_replenishment_enabled=false`；每日自动开卡上限配置值为 `5`，但自动补卡未开启。
- `PROVIDER_WRITES_ENABLED=false`、`PROVIDER_CARD_WRITES_ENABLED=false`、`PROVIDER_RECHARGE_WRITES_ENABLED=false`。
- Browser systemd 单元强制 `BROWSER_PAYMENT_WRITES_ENABLED=false`，且服务未启动。
- 2026-08-29 09:07 CST 重跑生产 readiness：`ok=true`；活动任务、过期租约、UNKNOWN Provider 调用、资金风险、活动授权、开放对账案件均为 `0`，`blockers=[]`。
- 公网 ops/plus 的 live/ready 四个端点均 HTTP 200。
- 当前卡台只读目录共 20 张卡；目录同步与卡片详情读取通过。

## 卡片与库存事实

- `1477 / 6807`：不设运营覆盖；当前原始/有效状态均为 `ASSIGNED`，仍受订单绑定、余额、交易与消费账本限制。
- `1065 / 4744`：`PRODUCT_ONLY(claude)`，不分配 Plus。
- 当前其余 17 张旧批次卡：全部 `RETIRED`；未来新卡不继承这个结论。
- `1628 / 6185`：已分配给第二单真实 API 订单并完成 Plus 充值；不得再作为未使用库存自动分配。卡台 PURCHASE 最终结算状态仍待只读同步补证。
- Plus 实际可直接分配卡为 `0`，但有 `1` 张可补余额卡；`catalog.unresolvedActive=0`、`providerOnlyActiveCount=0`。
- 默认开卡卡段只决定未来开卡偏好，不再排除卡台当前公布的其他合法卡段；订单分配也不再要求卡片卡段等于订单创建时的默认开卡卡段。
- 原始 Provider/本地状态可以与运营覆盖不同；后台主视图已显示有效运营状态，不再把旧卡误展示为可分配。

## 订单与资金状态

- 已完成真实 API 订单 `PJV1-FqFnMiSKBtLGN14GyP7W`，使用 `1477/6807`，并完成取消续费。
- 已完成第二单真实 API 订单 `PJV1-uVsqgepiEHu3tfpQKQq-`，使用 `1628/6185`；外部直充单 `7025`，平台金额 `982.140000 PHP`，最终 `RECHARGE_SUCCESS` 且 `subscription_cancelled=1`。attempt 为 `SUCCESS/SETTLED`，无活动资金风险或开放对账案件。
- 验证用的遗留订单 `PJV1-4cK-yDhExDQbnpr8403G`已按“不充值”结论安全取消；它从未分配卡、未调用 Provider、未建立充值 attempt。
- 当前活动任务为 `0`，不存在该遗留任务反复调度/API 调用风险。
- 消费账本已部署；当前查询为空。历史真实订单发生于账本上线前，没有可靠主键证据时不自动回填。

## 验证结果

- v1：467 tests / 429 pass / 0 fail / 38 environment-skipped。新增“过期安全候选卡按订单需求只排入一个只读同步任务”的真实 MySQL 集成测试；全新临时 MySQL 8.4、migration 001–040 下，`mysql-integration.test.js` 34/34 通过。
- Browser：只读 ChatGPT 账号/Checkout harness 合入后为 99 tests / 95 pass / 0 fail / 4 environment-skipped；隔离 MySQL 8.4 + 正式 production-readonly CLI/Chrome smoke 3/3 通过，配置/systemd 检查 10/10 通过。
- 当前已核验的最新部署前加密备份 `/var/backups/pojia/pojia-20260829T060414Z.sql.gz.enc` 已通过解密与 gzip 完整性校验。

## 当前未完成

### 2026-08-29｜ChatGPT 只读观察复验（当前停止点）

- 用户提供的 Session 已在本地一次性解析并通过 `validateChatGptSession()`；原文尾部附加文本被解析层截断，原文未写入日志、WAL、文档或 Git。
- 隔离 MySQL + Headful Chrome 实测：页面 HTTP 200、`/api/auth/session` HTTP 200、登录身份匹配、订阅状态 `FREE`；未读取真实 PAN/CVC，未填卡，`submitCalls=0`。
- 首次运行发现两个真实缺陷并已修复：Checkout 观察结果字段名 `cardNumber/cvc` 被安全对象检查误判为敏感字段；ChatGPT 官方首页标题存在 `ChatGPT: ...` 副标题变体；现已改为非敏感 presence 字段并允许官方标题后缀。
- 复验仍在 Checkout 导航阶段失败（当前证据码 `CHECKOUT_NAVIGATION_FAILED`），资金状态已安全清理：订单回 `CARD_READY`、attempt/funds `CLEARED`、run `FAILED_SAFE`、dispatch `CANCELLED`、无 payment permit/submit operation/活动租约。该失败尚未证明页面导航已通过，不能进入真实付款。
- 根因已定位：ChatGPT 方案弹窗的“升级至 Plus”是弹窗内、表单外的 `type=submit` 按钮，旧安全判断将所有 `type=submit` 一律拒绝，造成假失败；已收窄为仅拒绝处于表单内的提交控件。方案弹窗打开与 Plus 按钮已在 Headful 只读诊断中确认，未点击付款。
- 临时隔离容器与运行目录已停止并清理；未连接生产、未部署本轮改动。

- 库存后台收敛已部署生产（2026-08-28），并已通过发布后公网健康、服务状态、备份完整性和未认证路由验收；后台浏览器交叉验收仍待使用管理员会话执行。
- 已实现卡段人工刷新（`POST /api/v1/admin/card-stock/provider-refresh`）与默认卡段持久保存（`POST /api/v1/admin/card-stock/default-card-type`）；刷新仅调用 Provider 只读接口，不恢复高频自动读取。
- “开始营业”入口代码已在主线但暂不部署；生产继续使用现有分离开关。该入口的部分成功回滚优化延期。
- 已新增低复杂度“开始营业”入口：通过只读就绪检查后才同时开放接单与自动派发；库存不足会明确提示，不会误报卡台故障。
- 自动跨订单复用卡片尚未开启。
- Browser 真实付款尚未验证；仍按独立 Browser 工作线推进非付款联调，真实付款必须另行确认。
- Browser 独立线提交 `1d02c78` 已由统筹审查并以主线提交 `d6f9bf3` 安全合入：attempt 与 run 的 executor profile 现在必须一致，漂移时以 `EXECUTOR_PROFILE_CONFLICT` fail-closed；该 profile 同时进入权威付款 snapshot。合入后语法检查与相关 adapter/runtime/repository 测试 **46/46** 通过；未部署 Browser Worker、未连接生产、未执行付款。
- Browser 首次灰度前只读就绪补强已由统筹审查并以 `1516c67` 合入：readiness 强制 migration 039/040，CLI 同样强制 payment executor=false/MOCK，并补齐 Browser 专属停止/回滚入口。主线复验 90 tests / 86 pass / 0 fail / 4 skipped；仍未部署生产 Browser Worker。
- Browser 共享 Session/卡资料 production adapter 已由独立线提交 `ddad4f1`，经统筹复验后以主线提交 `58c0d4e` 合入：只通过当前 `browser_run` 读取 v1 现有密文和当前 attempt 的 `RESERVED` 消费预留；不建立第二套存储、不调用卡台、不填卡、不付款。正式 production-readonly smoke 9/9 配置检查与 3/3 隔离 MySQL/Chrome 流程通过；未部署生产、未读取真实材料。
- Browser 只读 ChatGPT 账号/Checkout harness 已由独立线提交 `7abbe51`，经统筹审查后以主线提交 `7065b60` 合入：身份摘要逐项匹配，订阅状态区分免费/Plus/其他付费/未知；真实观察阶段只读取 Session，不解密 PAN/CVC；页面入口和 Checkout 仅做只读识别。主线 Browser 99 tests / 95 pass / 0 fail / 4 skipped，production-readonly smoke 10/10 + 隔离 MySQL/Chrome 3/3；未部署生产、未访问真实 ChatGPT、未付款。
- 第二单 API 灰度已完成；临时充值写权限已关闭，单笔 Permit 已撤销。卡台已读到 `PURCHASE 15.76 USD`，余额由 `$16.00` 降为 `$0.24`，资金扣减与消费金额一致；2026-08-29 07:16 UTC 再次单卡低频只读同步后，交易仍为 `PROCESSING / UNSETTLED`。同步任务已正常完成，绝不因未结算而重付。
- 本单暴露出“分配要求 15 分钟新鲜、定时同步默认 60 分钟”的窗口错配。按订单需求只同步 1 张过期候选卡的低调用量修复已通过安全分支 `bba4105` 部署；生产健康和 readiness 正常。
- 2026-08-29 13:21 CST 公网复核：ops/plus 的 live/ready 四个端点均 HTTP 200。
- Browser 下一步不是直接付款：需要一次性提供专用非客户测试账号的隔离订单/Session、身份摘要、批准网络出口和 Chrome 主机，运行 `CHATGPT_ACCOUNT_CHECKOUT` 非付款观察，冻结当次真实页面合同；通过前不部署、不读取真实客户材料、不填卡、不付款。
- Browser profile 绑定合入后的 v1 全量回归：465 total / 428 pass / 0 fail / 37 environment-skipped。
- 卡余额充值目前仅有后台记录/核对视图，指定卡发起充值的管理入口暂缓开发；生产 Provider 写入继续关闭。

## 2026-08-29 卡片库存只读同步复验

- 已登录生产后台执行“卡片库存 → 只读同步全部”，页面提示加入 7 张卡同步队列；等待后刷新完成。全程未执行开卡、卡充值、付款、退款、提现或任何写开关操作。
- 卡 1477（卡号末四位 6807）详情：卡台账户 `00000000-0000-4000-8000-000000000101`、卡段 1、状态 `invalidating`、已分配、余额 `0.07 USD`、资料/交易同步时间 `08/29 09:50`。
- 交易证据：`CARD_RECHARGE 16.000000 USD SUCCESS` 与 `PURCHASE 15.930000 USD SUCCESS` 均已显示并持久化；chargeback 监控记录仍保留。
- 订单 `PJV1-FqFnMiSKBtLGN14GyP7W` 现显示“充值成功 / 三方一致 / 卡片核对 15 分钟内已更新”，平台金额 `982.140000 PHP`，直充订单号 `6294`。
- 库存总览：可分配 0、使用中 1、暂不可用 1、永久停用 17；卡台余额 `$47.36`、默认卡段 VISA-40024200、剩余开卡额度 292；自动补卡关闭。
- Console 唯一错误为 CSP 阻止 inline style，未发现业务请求失败；只读 GET 接口均 HTTP 200。
- 详细报告：`docs/2026-08-29_card-inventory-readonly-sync-verification.md`。
