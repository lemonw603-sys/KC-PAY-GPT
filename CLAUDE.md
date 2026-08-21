# AI充值业务项目约定

> AI/工程 Agent 角色：本项目的当前接班执行者。上一模型退出、失败或上下文中断后，新模型必须从事实源和工作区恢复进度，继续设计、编码、测试、验证和交付，而不是重开项目或只做审查。新模型先读 `AGENTS.md` 和 `docs/AI_AGENT_ROLE_AND_READING_GUIDE_2026-08-21.md`，不要从根目录 legacy 文件开始漫游。

## 项目定位

这是 GPT Plus 自动充值与内部运营系统。客户使用 CDK 提交完整 ChatGPT Session；系统通过卡台 Open API 获取或分配一张专属虚拟卡，再由执行器完成 Plus 购买。未来主执行链路是 Browser Worker 直接操作 ChatGPT 官方购买和订阅管理页面。

第一版目标是建立可运营、可追踪、可人工兜底的最小闭环，不追求一次性覆盖所有充值方式。

## 单一事实源

- 产品与技术规格：`docs/V1_SPEC.md`
- 阶段规划与当前状态：`docs/ROADMAP.md`
- 外部接口合同与验证记录：后续放在 `docs/contracts/`
- 项目从起点到当前的完整历史交接：`docs/PROJECT_HANDOFF_FULL_HISTORY_2026-08-21.md`
- 跨窗口交接、生产横向平台、真实测试证据与事实/未验证边界：`docs/SINGLE_SOURCE_OF_TRUTH_2026-08-21.md`
- 用户确认后的最终需求基线：`docs/FINAL_REQUIREMENTS_BASELINE_2026-08-21.md`
- 当前 Plus 运营后台与最终需求的对齐审查：`docs/ADMIN_ALIGNMENT_AUDIT_2026-08-21.md`
- 用户确认的实施主线、阶段退出条件和 Browser 时序：`docs/IMPLEMENTATION_PLAN_FINAL_2026-08-21.md`
- Browser 自动充值执行器的需求、架构、接口和恢复基线：`docs/BROWSER_RECHARGE_EXECUTOR_BASELINE_2026-08-21.md`
- AI Agent 角色、必读顺序和仓库噪音地图：`docs/AI_AGENT_ROLE_AND_READING_GUIDE_2026-08-21.md`
- Browser Session 上号机制静态合同：`docs/contracts/2026-08-21_browser-session-bootstrap-static-analysis-report.md`

方向或范围发生变化时，先更新上述文档，再改实现。

## 第一版硬约束

- 仅支持 ChatGPT Plus。
- 一张卡默认只绑定一个本地订单，系统不得自动跨订单复用；特殊人工例外必须按最终需求基线核实资金/退款风险并完整审计。失败或状态不明确时绝不释放。
- 卡台开卡写请求必须使用稳定的 `X-Idempotency-Key`；超时和 502/503 只能用原 Key 重试。
- 任何付款执行器在提交结果不明确时都进入 `SUBMIT_UNKNOWN`，禁止自动重试、换卡或换执行器；Browser 点击付款后崩溃必须先对账，不能重新点击。
- 停止新订单与追踪已有订单是两个独立开关；停单不能停止状态轮询和退款同步。
- 客户侧不提供退款查询；退款、交易和余额提取仅在内部后台处理。
- 普通日志不得出现完整卡号、CVV、API Key、accessToken 或 sessionToken。
- 金额使用十进制定点值或最小货币单位，不使用 JavaScript 浮点数直接结算。

## 外部系统与执行目标

- 卡台：`https://card.hnskj.vip/api/open/v1`
- Browser 目标：ChatGPT 官方购买和订阅管理页面；实际域名、页面结构和支付/3DS依赖必须先通过非付款 PoC 冻结到 `docs/contracts/`。
- 旧直充系统：ZZSHU 只保留历史兼容，不参与 Browser 新链路设计和实施。
- 开源基线：`https://github.com/KC-CatK/KC-PAY-GPT`

业务层不得直接拼接外部 URL 或解析供应商/页面私有字段。HNSKJ 调用经过 `HnskjCardProvider`；ChatGPT 页面行为经过版本化 Browser Executor 和页面适配层。

## Fork 策略

- 保留一个未改动的上游基线分支，便于比较和同步。
- v1 继续保留现有 CDK、订单、后台、MySQL、任务、维护开关、通知和历史适配器；Browser Worker 只有在设计、非付款 PoC、仿真和单独上线确认完成后才允许注册和启动。
- 浏览器池、Stripe、hCaptcha、代理、地址、录屏截图等旧能力可以保留在 Git 历史或隔离代码中，但默认不得注册路由、启动 worker 或要求生产密钥。
- 不为“以后可能使用”而保留存在高危漏洞的运行时依赖；恢复旧能力时按当时版本重新审查并接入。

## 开发纪律

- 面对真实故障，先以实际请求、响应、数据库状态和供应商运行行为定位，再修改代码。
- 外部 API 响应必须做运行时 Schema 校验；未知状态进入人工处理，不能默认映射为成功或失败。
- 数据库状态迁移必须显式、可审计；任务处理使用租约和有界重试，不能让单个失败订单阻塞队列。
- 未经操作时确认，不创建 API Key、不真实开卡、不提交真实充值、不提取余额或销卡。
- Browser 项目的重大方向、运行事实、接口冻结、PoC/灰度/容量结论必须同步回写 Browser 基线、`DECISIONS.md`、合同和交接文档，不能只保留在聊天上下文中。
