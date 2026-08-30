# AI充值业务项目约定

> AI/工程 Agent 角色：本项目的当前接班执行者。上一模型退出、失败或上下文中断后，新模型必须从事实源和工作区恢复进度，继续设计、编码、测试、验证和交付，而不是重开项目或只做审查。新模型先读 `AGENTS.md` 和 `docs/AI_AGENT_ROLE_AND_READING_GUIDE_2026-08-21.md`，不要从根目录 legacy 文件开始漫游。

## 项目定位

这是 GPT Plus 自动充值与内部运营系统。客户使用 CDK 提交完整 ChatGPT Session；系统通过卡台 Open API 获取或分配一张专属虚拟卡，再由执行器完成 Plus 购买。未来主执行链路是 Browser Worker 直接操作 ChatGPT 官方购买和订阅管理页面。

第一版目标是建立可运营、可追踪、可人工兜底的最小闭环，不追求一次性覆盖所有充值方式。

## 单一事实源

- 当前生产/代码快照：`docs/CURRENT_STATE.md`（库存后台收敛前封账：`docs/PRE_INVENTORY_CONVERGENCE_SEAL_2026-08-28.md`）
- 产品与技术规格：`docs/V1_SPEC.md`
- 阶段规划与当前状态：`docs/ROADMAP.md`
- 2026-08-28 统一执行主线：`docs/MASTER_EXECUTION_PLAN_2026-08-28.md`（对抗审查：`docs/MASTER_EXECUTION_PLAN_ADVERSARIAL_REVIEW_2026-08-28.md`）
- 外部接口合同与验证记录：后续放在 `docs/contracts/`
- 项目从起点到当前的完整历史交接：`docs/PROJECT_HANDOFF_FULL_HISTORY_2026-08-21.md`
- 跨窗口交接、生产横向平台、真实测试证据与事实/未验证边界：`docs/SINGLE_SOURCE_OF_TRUTH_2026-08-21.md`
- 协作与交付执行协议：`docs/PROJECT_OPERATING_PROTOCOL.md`
- 用户确认后的最终需求基线：`docs/FINAL_REQUIREMENTS_BASELINE_2026-08-21.md`
- 当前 Plus 运营后台与最终需求的对齐审查：`docs/ADMIN_ALIGNMENT_AUDIT_2026-08-21.md`
- 用户确认的实施主线、阶段退出条件和 Browser 时序：`docs/IMPLEMENTATION_PLAN_FINAL_2026-08-21.md`
- Browser 自动充值执行器的需求、架构、接口和恢复基线：`docs/BROWSER_RECHARGE_EXECUTOR_BASELINE_2026-08-21.md`
- Browser 当前完成项、准确停止点和下一动作：`docs/BROWSER_CURRENT_STATUS_2026-08-22.md`
- Browser 子项目 BRFE 的跨窗口接班入口：`docs/BRFE_HANDOFF_2026-08-22.md`
- Browser 五阶段大闸门推进路线：`docs/2026-08-22_browser-execution-roadmap.md`
- AI Agent 角色、必读顺序和仓库噪音地图：`docs/AI_AGENT_ROLE_AND_READING_GUIDE_2026-08-21.md`
- Browser Session 上号机制静态合同：`docs/contracts/2026-08-21_browser-session-bootstrap-static-analysis-report.md`
- Browser hosted Checkout 提链研究、A/B 矩阵和后台可调边界：`docs/2026-08-22_browser-checkout-link-research-report.md`
- Browser 多赛道 PoC、网络证据等级和胜出规则：`docs/2026-08-22_browser-multi-lane-poc-baseline.md`
- Browser 多赛道第一轮对抗式审查与强制修订：`docs/2026-08-22_adversarial-review-browser-multi-lane-report.md`
- Browser 多赛道实验单位、资源租约和敏感 Checkout 工件合同：`docs/contracts/2026-08-22_browser-multi-lane-experiment-contract.md`
- Browser 离线 WAL、重启恢复与本地 Playwright 页面仿真实施报告：`docs/2026-08-22_browser-offline-wal-local-mock-implementation-report.md`
- Browser WAL-backed 编排、崩溃恢复和 350 单等效容量报告：`docs/2026-08-22_browser-durable-orchestrator-capacity-report.md`
- Browser MySQL 事务映射实施报告：`docs/2026-08-22_browser-mysql-transaction-mapping-implementation-report.md`
- Browser MySQL 订单/资金 attempt 接口合同：`docs/contracts/2026-08-22_browser-mysql-transaction-mapping-contract.md`
- Browser artifact vault/资源租约跨进程恢复实施报告：`docs/2026-08-22_browser-artifact-vault-resource-lease-recovery-implementation-report.md`
- Browser artifact vault/资源租约恢复合同：`docs/contracts/2026-08-22_browser-artifact-vault-resource-lease-recovery-contract.md`
- Browser 后台追溯/人工控制实施报告：`docs/2026-08-22_browser-admin-trace-and-control-implementation-report.md`
- Browser 后台追溯/人工控制合同：`docs/contracts/2026-08-22_browser-admin-trace-and-control-contract.md`
- Browser 提链/扫码/菲律宾自助充值市场工具评估：`docs/2026-08-22_browser-marketplace-tool-assessment-report.md`
- 扩大 GitHub 固定提交调研与可复用轮子清单：`docs/2026-08-22_browser-automation-github-expanded-research-report.md`
- 外部账号安全指南与指纹浏览器适用性评估：`docs/2026-08-22_external-guide-browser-fingerprint-assessment-report.md`
- 本次只读运行时核验与未证明边界：`docs/LIVE_RUNTIME_AUDIT_2026-08-22.md`
- 当前执行顺序修订（不改变业务方向）：`docs/EXECUTION_PLAN_REVISION_2026-08-22.md`

方向或范围发生变化时，先更新上述文档，再改实现。

## 第一版硬约束

- 仅支持 ChatGPT Plus。
- 一张卡同一时刻最多绑定一个活动订单；完成一单并释放活动分配后，可在全局 1–4 次成功充值上限内顺序服务后续订单。容量以消费账本为权威；失败或付款状态不明确时保留占用，绝不释放或换卡重付。
- 卡台开卡写请求必须使用稳定的 `X-Idempotency-Key`；超时和 502/503 只能用原 Key 重试。
- 任何付款执行器在提交结果不明确时都进入 `SUBMIT_UNKNOWN`，禁止自动重试、换卡或换执行器；Browser 点击付款后崩溃必须先对账，不能重新点击。
- 停止新订单与追踪已有订单是两个独立开关；停单不能停止状态轮询和退款同步。
- 客户侧不提供退款查询；退款、交易和余额提取仅在内部后台处理。
- 普通日志不得出现完整卡号、CVV、API Key、accessToken 或 sessionToken。
- 金额使用十进制定点值或最小货币单位，不使用 JavaScript 浮点数直接结算。

## 外部系统与执行目标

- 卡台：`https://card.hnskj.vip/api/open/v1`
- Browser 目标：ChatGPT 官方购买和订阅管理页面；实际域名、页面结构和支付/3DS依赖必须先通过非付款 PoC 冻结到 `docs/contracts/`。
- Browser 主链路跑通优先于保持现有 Provider/路线表/许可命名和后台页面不变；允许最小调整。不得调整掉的只有防重复扣款、付款未知锁定和端到端审计。
- “提链”当前是候选而非已验收结论：必须区分 hosted 长链与依赖账号 Session 的内部短链；与原诺汇盛上号器先做同账号、同菲律宾 sticky 出口的只读配对，会创建 Checkout 的比较使用隔离账号 cohort。
- Browser PoC 采用隔离赛道，不把所有兼容逻辑堆入一个执行器；赛道表示架构，Runtime/Cookie/网络表示公共实验轴。失败赛道留证后归档，最终只接入 champion 和最多一个可在 Checkout 创建前路由的预验证 fallback。
- 没有菲律宾出口可以继续 OFFLINE/NON_PH 筛选；普通菲律宾 VPN 只作预筛，最终结论需要接近未来生产的菲律宾 sticky 出口。
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
