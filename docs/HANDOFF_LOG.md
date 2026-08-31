# 交接记录

## 2026-08-29｜卡段人工刷新部署

- 提交 `58dfe0d` 已部署至 `/opt/pojia/releases/20260829-card-segment-58dfe0d`，并切换 `/opt/pojia/current`。
- 部署后 `pojia-web.service`、`pojia-worker.service`、卡片只读同步/目录同步定时器均 active；健康检查正常。
- 本次未执行开卡、卡余额充值、付款、退款或提现；资金写入门禁保持关闭。
- 待管理员会话下验证刷新按钮和默认卡段持久化。

## 2026-08-29｜“开始营业”入口延期

- 用户决定暂不继续优化或部署“开始营业”快捷入口。
- 生产继续使用现有接单/派发分离开关；该入口代码保留在主线但不代表已上线。
- 需要后续补偿性回滚/部分成功测试后，才能重新评估生产启用。

## 2026-08-29｜指定卡余额充值入口延期

- 已确认当前后台“卡余额充值”页仅提供历史尝试查看与未知结果人工核对，没有指定卡发起充值的管理入口。
- 用户决定后期再做；当前不新增该入口，Provider 写入保持关闭。

## 2026-08-26｜Browser 上游合同纠偏与冻结

- 用户确认优先级：先保证充值链路跑通、顺畅、稳定，再保证资金安全；敏感信息不做导致系统复杂化的过度保护。Browser 执行时可使用必要的卡资料和 Session，普通日志/WAL/截图/录像/客户页面仍不记录原文。
- 代码交叉核验发现 Browser PoC 投影的 `order=CARD_READY/RECONCILIATION_REQUIRED`、`attempt=PENDING/OBSERVING`、card `AVAILABLE` 与共享核心正式状态不一致。共享核心实际在 `CARD_READY` 后原子创建唯一 `recharge_attempt`，把订单推进为 `SUBMITTING`；Browser dispatch 只接受 `attempt=PREPARED`、`funds=ACTIVE`、`executor=BROWSER`，Worker claim 后创建活动 `browser_run`。
- 用户随后确认进一步纠偏：保留“Browser 开始前建立唯一 attempt 并锁定订单/卡片”，但不把尚未付款的阶段提前命名为 `SUBMITTING`。目标合同改为订单 `RECHARGE_PROCESSING` 表示 Browser 正在处理，真正付款提交由 `browser_run.payment_state=PAYMENT_SUBMITTING` 表达。
- 已修正合同 `docs/contracts/2026-08-26_browser-upstream-runtime-contract.md` 和 D-090，并更新 CURRENT_STATE。合同明确 `RECONCILIATION_REQUIRED` 只核对不重付，`browser_run_id` 是正式运行审计锚点，不另造平行 `audit_ref`。
- 本轮只修改文档事实源，未修改 Browser/non-Browser 业务代码、迁移、数据库或生产；未调用卡台写接口、未执行付款。
- 下一步：先修改共享核心 Browser 路线的状态推进与 dispatch/run 资格，再由 Browser 工作线按同一合同修改 adapter/状态映射；之后做共享 dispatch → run → Session/卡资料 → Checkout 非付款联调。历史 API 路线不在本次改造中盲目改名。

### 同日对抗式审查

- 只检查重复付款、错误状态、无法恢复和跨线接不通等重大问题，确认 3 个 P0 实现缺口：permit-time 权威卡片/路线复核缺失；付款前 safe-abort/Session 修复没有原子闭环；`SUBMITTING → RECHARGE_PROCESSING` 不能只改入口，必须覆盖完整 Browser 资金状态链。
- 详细事实、影响和修复顺序已落盘 `docs/2026-08-26_browser-runtime-contract-adversarial-review.md`。这不是已发生事故；当前 Browser 真实付款未启用。

## 2026-08-25｜后台优化 1/3/4 落地 + A 非 Browser 后端只读审查

- 工作线：非 Browser。本轮业务改动仅前端 `v1/public/admin/assets/admin.js`（已提交），后端为纯只读审查。
- **后台优化（清单 1/3/4）已提交 `6e5eadc`**：
  - 清单3 去重：总览 Provider 健康卡不再重复渲染「本地可分配卡」（保留带低库存告警+下钻的 metric 卡）。
  - 清单4 导航身份自愈：引入 `state.nav` 与 `state.view` 解耦 + `setActiveNav` helper；exceptions 伪 view 不再把导航身份塌成 orders；异常队列内改筛选提交后导航归位到订单。
  - 清单1：按用户选择**保留**「异常队列」高频入口（三入口协调，非删除）。
  - 清单5 证伪剔除（交接所述 `admin-auth.js:65` 死代码不存在；真实文件 `admin-session.js` 中 `timingSafeEqual` 均为有效使用）。
  - 验证：`cd v1 && node --test` = **411/377/0/34**；本地全栈（独立 `pojia_local` 库）浏览器实测：导航自愈 ✓、去重 countInPage=1 ✓、console 零错误 ✓。
- **A 非 Browser 后端只读审查完成**，报告落盘 `docs/2026-08-25_non-browser-backend-readonly-audit.md`：
  - 8 个风险面（防重复扣款/凭证安全/认证授权/并发一致性/补偿·取消续费/分页边界/状态机迁移/订单追溯）全部过关，**无 P0/P1**。
  - 5 个 P2/P3 发现：①hnskj 502 归 uncertain vs 文档（代码更保守）；②余额门槛浮点比较（→B）；③`CARD_READY→CLOSED` 状态机缺 domain 边（cancelOrder 绕过 `assertOrderTransition`）；④card-funding 默认 `randomUUID` 幂等键（建议传稳定 key）；⑤redaction `nhs_` 前缀待确认。
- **B 窄屏响应式已修复**（`admin.css`）：`@media (max-width:900px)` 补 `.filters { repeat(auto-fill, minmax(140px,1fr)) }` + 搜索框独占行，消除 620–900px「查询按钮溢出视口」死区；浏览器验证 桌面 6 列无回归、700px 死区 4 列换行 btnVisible=true（btnRight=189≪700）。
- B 金额精度（发现②）：用户决定**暂不修，留作已知低优先项**（存储 DECIMAL(18,6)+`decimalNumbers:false` 精确字符串返回，3 处仅余额门槛直接比较、值域几十美元，实际不触发）。
- 本次提交：`admin.css`（窄屏）+ 本审查报告 + 本 HANDOFF 记录（`admin.js` 前已提交 `6e5eadc`）。DECISIONS.md / CURRENT_STATE.md 未动（含其他窗口/旧会话未提交改动）。
- C（UI 增量）用户决定**收尾不做**（UI 已成熟，A/B 已交付核心价值）。本轮到此，本地实测环境已清理（server 停、临时库 `pojia_local` 删，Browser 线库未动）。
- **下一会话接班入口**：`docs/NON_BROWSER_HANDOFF_2026-08-25.md`（操作性交接：避坑/已确证/待办/本地实测搭法，对应 Browser 线的 `BRFE_HANDOFF_2026-08-22.md`）。

## 2026-08-24｜接班核实：拆分开关闭环完整 + 测试基线校准（只读，未改业务代码）

- 窗口/工作线：非 Browser 接班执行窗口；本轮纯只读核实，未改任何 v1 代码/迁移/生产/其他窗口改动。
- **核实结论：上个会话“接单/自动充值拆成两个独立开关 + 后台文案改名”闭环完整、已提交、无缺失需补齐。**
  - service `admin-operations-service.js`：独立 `setOrderAcceptance` + `setDispatch`，联动已解除（开接单不再强开派发，注释明确）。
  - route `create-app.js:393/398`：`/operations/order-acceptance` + `/operations/recharge-dispatch` 两个 POST。
  - server `server.js:185-186`：`setAdminOrderAcceptance` + `setAdminDispatch` 已接线。
  - 前端 `admin.js:340/342`：接单/自动充值两组按钮，确认词/文案齐全（“开始/停止自动充值”）。
  - test `admin-operations-service.test.js`：覆盖 setDispatch 确认词与错误分支。
  - 落库证据：上述四文件均在提交 `64e464d`（fix: expose independent admin recharge dispatch control），文案收尾在 `c5eecfa`；工作区对这些文件无未提交改动（非丢失）。
- 测试基线：`cd v1 && node --test` 工作区实测 = **410 / 376 / 0 / 34（全绿）**；该值含 Browser 线未提交测试改动（`browser-dispatch-repository.test.js`、`browser-worker-service.test.js`，净 +143 行）。不再沿用文档旧值 409/375（未在纯提交态复跑）。
- 分支澄清：当前 checkout `codex/competitor-recharge-research-20260824` 与文档所述 `codex/mvp-zero-cost-ops-20260819` **同指提交 `c5eecfa`**，是同一 HEAD 的两个分支名，非分歧。
- 校正：`docs/ADMIN_OPTIMIZATION_LOG_2026-08-24.md` 在磁盘与 git 中均不存在（任务描述“可能在磁盘上”不成立），无需处理。
- 遗留（未动，非本线可改）：`DECISIONS.md` 决策 ID 重复 D-069/D-089/D-109 仍在（行 75/95/96/97/121/153）；其中 D-089/D-109 重复条目位于其他窗口未提交改动，按硬规则本窗口不改。
- 下一步：方向待用户拍板（候选：后台优化落地 / 非 Browser 主线深度审查 / 生产只读体检）。

## 2026-08-24｜全项目独立对抗式审查交接

- 日期/模型：2026-08-24，接班执行模型（本窗口）
- 工作线：跨两条线的只读独立审查（未改业务代码/数据库/生产）
- 本次完成：文档+代码+隔离测试交叉核验；独立跑 `node --test`（408/374/0/34）；逐项验证资金栅栏、开关默认、一卡一单卡资格、HNSKJ 幂等键、UNKNOWN 锁定、客户侧敏感隔离、后台 9 模块与敏感 step-up、Browser 独立队列。落盘 `docs/FULL_PROJECT_ADVERSARIAL_AUDIT_2026-08-24.md`。
- 修改文件：新增 `docs/FULL_PROJECT_ADVERSARIAL_AUDIT_2026-08-24.md`；更新 `docs/CURRENT_STATE.md`、`docs/HANDOFF_LOG.md`。未改任何 `v1/` 代码、迁移、配置。
- 验证命令与结果：`cd v1 && node --test` → 408 tests / 374 pass / 0 fail / 34 skipped（3.67s）。
- 未完成：成功充值/新卡开通/HNSKJ 真实写/SUBMIT_UNKNOWN 人工对账/退款/取消续费真实样本；200–300 单/天生产压测；Browser 真实付款。
- 未验证边界：无 P/D 级生产证据；当前生产真实状态未知（服务器是否修好待现场核验）；SINGLE_SOURCE(08-22) 与 CURRENT_STATE(08-24) 时间线冲突待对账。
- 禁止动作：不得在生产状态未知/未确认前真实开卡、卡余额充值、Plus 充值、退款、切卡台、启用 Provider 写、Browser 真实付款；不得覆盖/提交其他窗口未提交改动（含 `v1/src/db/repositories/browser-dispatch-repository.js` 等 Browser 工作线活跃改动）。
- 用户确认与更正（2026-08-24，见审查报告补充节）：①生产状态澄清——我方服务器正常，阻塞在卡台 HNSKJ 升级（开卡/卡余额充值写不可用），原"时间线冲突"不成立；②决策 ID 重复授权重编号，但 D-089/D-109 重复位于其他窗口未提交改动中，本窗口未改 `DECISIONS.md`，仅在报告给出重编号映射（D-134/135/136），待其提交后统一执行；③接单/派发联动=待议，不动；④后台导航不采纳前序 `ADMIN_CONSOLE_SIMPLIFICATION` 方案，改为由本执行者独立评估，评估前不动后台结构。
- 下一步唯一动作：可做我方生产只读体检（核实 release/迁移/服务/五类开关现场值，不做资金写入），并跟踪卡台升级完成；真实单笔测试等卡台写能力恢复后按方案执行。
- Git：分支 `codex/mvp-zero-cost-ops-20260819`；本次仅提交本窗口自建/更正的文档（审查报告、CURRENT_STATE、HANDOFF_LOG），未编辑 `DECISIONS.md`，其余未提交内容属其他窗口，不动。

## 2026-08-24｜真实全链路测试准备交接

- 工作线：非 Browser，API 单笔真实测试准备
- 本次完成：完成无资金预检；本地测试 408/374/0/34；公网四个健康端点 HTTP 200；制定真实单笔全链路测试方案。
- 关键文件：`docs/REAL_E2E_SINGLE_ORDER_TEST_PLAN_2026-08-24.md`、`docs/CURRENT_STATE.md`
- 当前阻塞：服务器尚未修好，未执行任何真实开卡、卡余额充值、Plus 充值、退款或余额提取。
- 未验证：生产现场 release/迁移/服务/Provider 只读状态、卡台升级后的 API 合同、成功订单闭环。
- 禁止动作：不得在服务器修复前打开资金写开关；不得真实写 Provider；不得把本地测试或 HTTP 200 当成生产成功。
- 下一步唯一动作：先完成服务器修复后的只读体检，再按真实单笔测试方案执行。
- Git：本窗口此前提交 `072a227`；本次交接文件待单独提交。

## 2026-08-24｜接续上一模型：接单/自动充值开关闭环

- 工作线：非 Browser，运营后台控制面
- 本次完成：把独立自动充值开关接通到 server、Express admin route 和后台按钮；修正旧测试对“开接单自动开派发”的过时断言；新增独立派发确认词测试。
- 修改文件：`v1/src/app/create-app.js`、`v1/src/server.js`、`v1/public/admin/assets/admin.js`、`v1/test/admin-operations-service.test.js`
- 验证：`npm test` → 409 tests，375 pass，0 fail，34 skipped。
- 未完成：浏览器实际交叉验证；生产部署；服务器/卡台修复；真实资金链路。
- 禁止动作：服务器修好和只读 readiness 通过前，不打开 Provider 写入，不执行真实开卡或充值。
- 下一步唯一动作：其他模型/本窗口先审查本次 diff 和后台 API/按钮，再决定是否部署。
- Git：当前变更待提交；工作区另有其他窗口未提交修改，不得混提。

## 2026-08-24｜协作分工确认

- 用户确认：本窗口作为非 Browser 工作线主负责人，继续负责运营后台、API、CDK、订单、库存、卡台、资金账本、生产前验证和最终单笔测试。
- 其他模型：暂停直接改代码；如需参与，仅执行明确隔离的只读审查或服务器检查，并将结果落盘后退出。
- 并行规则：不得两个窗口同时作为主负责人修改同一工作线；任何跨线或同文件修改先停下协调。

## 2026-08-24｜协作分工修订

- 用户修正：其他模型不是暂停改代码，而是负责本项目的升级、优化和改造实施。
- 其他模型职责：在明确范围内修改运营后台、API、数据层和相关实现；负责对应测试、验证和变更说明。
- 本窗口职责：作为项目统筹与验收窗口，负责需求/方向对齐、变更前审查、跨模块数据一致性核对、对抗式审查、集成验收、生产前闸门和最终真实链路安排。
- 约束：其他模型仍不得擅自改变已确认业务方向；涉及生产写入、资金、不可逆迁移或跨工作线架构变化必须先停下确认。每次升级/改造必须更新 CURRENT_STATE.md、HANDOFF_LOG.md，并说明修改文件、测试结果、未验证边界和 Git commit。

## 2026-08-24｜业务规则可质疑性补充

- 用户确认：已记录的业务规则不是天然正确或永久不可变。
- 执行要求：不得静默改变规则；但发现规则可能错误、过早定义、互相冲突或不适合当前实现时，必须主动指出，给出证据、影响和替代方案，待重新确认后再更新需求基线、决策和实现。

> 说明：本文件中“协作分工确认”关于其他模型暂停改代码的旧记录，已被后面的“协作分工修订”覆盖；当前以“其他模型负责升级/优化/改造，本窗口负责统筹/验收”为准。

## 2026-08-24｜前端升级负责人权限确认

- 用户确认：其他模型可作为前端产品与工程改造负责人，不仅限于视觉/UI；可自主进行前端信息架构、导航重组、交互、组件、API 调整、数据展示口径优化、前后端联动、性能优化及必要配套改造。
- 工作模式：其他模型负责设计→实现→联调→测试→浏览器验证→提交结果；本窗口负责方向审查、数据/业务一致性核对、对抗式审查和最终验收。
- 仅以下情况必须停下确认：改变项目核心方向；真实付款/充值/开卡/退款/提现/生产写入；删除历史数据或其他不可逆高影响变更。
- 其他变更不要求逐项请示，但必须说明影响、完成验证、区分事实与建议，并落盘重要结论。

## 2026-08-24｜措辞纠正

- 更正上一轮口头建议中的表述：不能写成“我方服务器和卡台都未修好”。当前有效记录是：**我方生产服务器被用户澄清为正常；阻塞在卡台 HNSKJ 升级导致开卡/卡余额充值写能力暂不可用**。
- 现场生产 release、迁移、服务和开关值仍未在本轮重新核验，因此“我方服务器正常”是用户确认/既有记录，不等于本窗口刚刚完成现场验证。
- “下一步先做前端升级”是建议，不是已执行事实；前端改造仍须以实际未提交 diff、测试和浏览器验证为准。

## 2026-08-24｜验证沟通节奏确认

- 用户要求：全系统验证按整体计划连续推进，不逐小节发送进度或反复请求确认。
- 执行方式：除非涉及真实资金/生产写入、不可逆高影响变更、权限或关键方向冲突，否则不中途打断；阶段性结果统一汇总，证据持续落盘。

## 2026-08-24｜全系统现场验证与付款前 dry-run 交接

- 工作线：生产只读、HNSKJ 只读、客户页付款前 dry-run。
- 已完成：SSH 现场核验 release/迁移/服务/定时器/开关/readiness；HNSKJ API `provider:read-check` 和卡目录只读同步；卡台网页余额/卡目录只读；客户页提交测试 CDK + Session 的付款前格式验证。
- 关键结果：生产 readiness 最终 `ok=true`，三类 Provider 写入和接单/自动充值均关闭；HNSKJ 只读余额 75.670000 USD、18 张卡、7 张 active；客户页返回 `账号 Session 格式不正确，请检查后重试`，没有创建近 30 分钟订单、没有付款页、没有付款动作。
- 未执行：开卡、卡余额充值、Provider 写、Plus 付款、确认购买、退款、提现、路线切换、开关开启。
- 残留/阻塞：生产 `tasks.id=22` 为 2026-08-22 遗留 `ASSIGN_CARD/PENDING`；卡目录同步后存在长期 `VALIDATING` intake batch；2 张上游 active 卡进入 quarantine/review；本轮未擅自清理这些生产记录。
- 未完成：运营后台登录后逐页交叉验证（Chrome 当前无已登录 ops 标签）；真实订单/卡资格/Permit/资金准备未建立；Browser 真实付款不在本轮范围。
- 修改文件：`docs/FULL_SYSTEM_VERIFICATION_2026-08-24.md`、`docs/CURRENT_STATE.md`、`docs/HANDOFF_LOG.md`；未修改业务代码、迁移、生产配置或其他窗口文件。
- 验证命令：SSH 只读现场命令、`npm run provider:read-check`、`npm run card:catalog-sync`、最终 `npm run preflight:readiness`、`cd v1 && npm test`（409/375/0/34）。
- 下一步：先由运营人员确认遗留 PENDING 任务与 VALIDATING intake batch 的处置方式；补齐 ops 后台登录会话后再做逐页只读交叉核验；Session 格式修复后才可重新做付款前 dry-run。任何真实付款仍需单独确认。

## 2026-08-24｜第二轮已登录后台交叉验证交接

- 工作线：生产/卡台只读复核、运营后台逐页交叉验证、客户付款前 dry-run。
- 已完成：重新核验生产 release/迁移/服务/开关/readiness；HNSKJ API 只读；接管已登录 `ops.vibebridge.top/admin`，逐页检查总览、订单、异常、资金证据、卡余额充值、卡台路线、Browser、卡片库存、CDK；客户页使用系统剪贴板尝试一次付款前 Session 格式验证。
- 关键后台证据：累计订单 3、自动处理中 1、三方对账异常 1、资金结果未决 0、卡余额充值待处理 0、待验证新卡 13、本地可分配卡 0；接单/派发关闭，追踪已有订单开启；当前路线 `LEGACY_HNSKJ_ZZSHU_V1`，备用未切换；Browser run 0；资金证据案例 0；CDK 可使用 10。
- 关键 dry-run 结果：系统剪贴板内容 279 字节且不是合法 JSON；客户页返回 Session 格式错误。未创建新订单、未分配卡、未产生 Permit、未调用 Provider 写、未进入付款页。
- 未执行：付款、确认购买、开卡、卡余额充值、退款、提现、路线切换、CDK 生成/作废/保存阈值等所有写按钮。
- 未完成/阻塞：需完整合法 Session JSON 才能继续到订单创建前；遗留 `ASSIGN_CARD/PENDING`、长期 `VALIDATING` intake batch 和 quarantine/review 卡未清理；真实 Plus 付款始终未执行。
- 修改文件：`docs/FULL_SYSTEM_VERIFICATION_2026-08-24.md`、`docs/CURRENT_STATE.md`、`docs/HANDOFF_LOG.md`；未修改业务代码、迁移、生产配置或其他窗口改动。

## 2026-08-24｜第三轮 Session 清理与 dry-run 交接

- 剪贴板整体 7430 字节，JSON 解析失败原因为尾部多 19 个非 JSON 字符；只在内存中截断到最后一个 `}`，得到 7409 字节 object。字段名和存在性已核对，未保存字段值。
- 使用清理后的 Session JSON + 测试 CDK 重试客户提交；页面明确返回“当前暂停接收新订单，请稍后再试”。浏览器 Network 事件显示没有 `/api/v1/orders` 请求。
- 结论：无 HTTP 状态码/服务端错误代码、无新订单、无卡片绑定、无 Permit、无 Provider/卡台资金动作、无付款页。接单开关保持关闭，未为 dry-run 擅自开启生产接单。
- 修改仅限 `FULL_SYSTEM_VERIFICATION_2026-08-24.md`、`CURRENT_STATE.md`、`HANDOFF_LOG.md`；Session 原文未进入日志/文档，系统剪贴板未被改写。

## 2026-08-24｜第四轮重试

- 09:14 UTC 重新核验 readiness 和客户 dry-run；接单/派发仍关闭，页面继续返回“当前暂停接收新订单”，Network 无 `/api/v1/orders`。
- 未开启任何开关，未执行付款或资金写操作；Session 原文未落盘。

## 2026-08-24｜Session 尾部与接单开关阻塞确认

- 现场结果：剪贴板 Session JSON 尾部多出 19 个非 JSON 字符；清理尾部后，前端本地解析通过。
- 当前直接阻塞：生产 `acceptNewOrders=false`，客户页面在提交前提示“当前暂停接收新订单”，未发出 `/api/v1/orders`；因此尚未进入订单、卡台、Provider、资金或付款阶段。
- `dispatchNewRecharges=false` 继续保持关闭；Provider 写入继续关闭。
- 未擅自开启接单开关。若继续做“创建订单但不派发、不付款”的 dry-run，必须单独确认临时开启 `acceptNewOrders`，并在测试后关闭。

## 2026-08-24｜Session 与开关风险最终对齐

- 用户确认并要求落盘：Session 是高敏感账号凭证，不能发聊天；用户只需将其放在自己的浏览器剪贴板/页面中，不负责手动切换后台开关。
- 测试配置对齐：订单创建测试可临时开启接单、保持派发和全部 Provider 写入关闭；派发测试即使 Provider 写入关闭，也可能产生任务/租约/卡片分配状态，不能称为零风险；Provider 写入和真实付款必须单独确认。
- 执行要求：先确保有合法完整 Session，再开接单；测试后立即关闭接单；不得在没有可用 Session 时先打开生产接单。
- 本次不执行真实付款、Provider 写入、开卡、卡余额充值、退款或提现。
- 交接当前事实：生产/卡台只读验证已完成，客户付款前 dry-run 曾被非法 Session 与接单开关阻断；运营后台第二轮逐页只读验证已完成；遗留 PENDING 任务、VALIDATING intake batch、quarantine/review 卡和历史 UNCERTAIN 仍未擅自处理。


## 2026-08-24｜纠正上一条落盘的事实/建议混淆

- 更正：上一条“Session 与开关风险最终对齐”把技术安全判断和测试建议写成了“用户确认”。该表述不准确。
- 当前正确分类：Session 脱敏/不进入聊天是安全保护要求；接单/派发/Provider 的组合是待执行的测试建议；除“当前禁止真实付款”和用户明确提供的运行条件外，不新增业务决策。
- 后续规则：只有用户明确确认或有本次运行证据的内容才能进入“用户确认结论/已验证事实”；其余必须标为建议、技术约束或未验证事项。

## 2026-08-24｜纠错执行而非仅记录

- 已执行实际纠正：重写 `CURRENT_STATE.md` 为单一当前状态，移除会误导新模型的旧结论和重复段落；在验证报告中明确标注历史 279 字节读取不是有效 Session 证据，并标出第一轮后台未登录状态已被第二轮覆盖。
- 今后发现错误时，优先修正事实源和当前状态，不只新增“错误说明”；历史记录仅保留可解释的时间线证据，并明确 superseded 状态。

## 2026-08-24｜长期工作原则确认

- 用户明确要求：以后发现问题必须修正问题本身，不能只记录问题。
- 执行规则：先定位→实际修正→验证修正结果→更新当前事实源；若暂时无法修正，必须明确阻塞原因和下一步，不得把“已记录”写成“已解决”。
## 2026-08-24｜Browser A1 长窗口核验与动作超时 fail-closed 修复

- 工作线：Browser 控制面/Worker，未接生产，未执行 Session、Checkout、卡片或付款写入。
- 本次完成：核验 detached 24 小时隔离 soak 完整日志和独立 MySQL 残留；360/360 claim、0 missing、0 duplicate、360 heartbeat，cleanup 与独立查询四类残留均为 0。修复 `browser-mysql-bounded-soak.js` 残留查询被 `rows.length` 清空后跳过的问题，并让 detached runner 通过 `BROWSER_SOAK_METADATA_PATH` 在结束时写 `COMPLETED/FAILED` 元数据。修复 Browser Worker 动作超时只返回错误但不终止 runtime 的缺口：现在超时触发 AbortSignal 并永久停止 control shell。
- 修改文件：`v1/src/services/browser-worker-service.js`、`v1/test/browser-worker-service.test.js`、`v1/test-support/browser-mysql-bounded-soak.js`、`v1/test-support/browser-detached-soak-runner.js`；新增 `docs/2026-08-24_browser-stage1-24h-soak-completion-report.md`；同步 `docs/CURRENT_STATE.md`、`docs/BRFE_HANDOFF_2026-08-22.md`、`docs/DECISIONS.md`。
- 验证命令与结果：`node --test v1/test/browser-worker-service.test.js` → 6/6；`cd v1 && npm test` → 410 tests / 376 pass / 0 fail / 34 skipped；`npm run test:browser-poc` → 11 files / 77 tests 通过；短 soak `TEST_DATABASE_URL=mysql://root:root@127.0.0.1:54741/pojia_test BROWSER_SOAK_METADATA_PATH=/tmp/browser-soak-metadata-20260824.json node v1/test-support/browser-mysql-bounded-soak.js --duration-ms=1000 --jobs=1 --workers=1 --delay-ms=1 --lease-seconds=60` → 4/4 claim、0 duplicate、4 heartbeat、残留 0、metadata `COMPLETED`；`git diff --check` 通过。
- 未验证边界：A1 网络级 KILL 风暴/长时间重连组合、A2 主从/故障转移、真实非 PH Session 页面、PH cohort、真实 Checkout/付款和生产 Worker 仍未验证。旧 24h metadata 仍是历史 `RUNNING`，以日志和独立查询为准；后续新 runner 会自动更新状态。
- 下一唯一动作：在不接外部付款的前提下，继续完成 `NON_PH_FUNCTIONAL` 只读观察器前置；若没有仓库外 `0600` Session 输入，只运行 manifest/观察器本地测试，不启动真实观察。
- Git：本窗口只提交上述 Browser Worker/soak 代码、测试和事实源；其他窗口未提交修改保持不动。

## 2026-08-25｜非 Browser 候选 release 集成对账

- 工作线：非 Browser 统筹/集成验收；竞品与 Browser 仍在独立 worktree，本次未修改其文件。
- 完成：从竞品 worktree 精确提取 3 个非 Browser 源文件和 3 个回归测试，提交 `f3bbe93`；修复 `CARD_READY -> CLOSED`、HNSKJ 502/503 的同键不确定重试分类、卡余额准备缺失幂等键时禁止自动生成 UUID。
- 验证：`git diff --check` 通过；定向回归 36/36 通过；`npm test` 369 通过、34 跳过（隔离数据库）、3 个环境/基线失败（Unicode worktree customer 静态页 500、两个 Browser 测试缺 playwright）。
- 候选静态资源指纹和精确文件清单已写入 `docs/2026-08-25_non-browser-release-reconciliation.md`。
- 当前分类：代码已验证、已提交、未部署；线上仍为旧 release `7587d44`；未执行开卡、余额充值、Provider 写入、Plus 付款、退款、提现。
- 下一步：取得单独部署确认后再打包/部署；部署后重新登录后台验收接单与自动充值两个独立控制项，并现场只读核对迁移/开关/systemd/运行 commit。

## 2026-08-25｜非 Browser release 已部署

- 用户已明确确认部署；部署前发现 `dispatch_new_recharges=true`，先停止 Worker，并将派发保护性关闭为 `false`；接单和 Provider 三类写入始终保持关闭。遗留 task 22（`ASSIGN_CARD/PENDING`）未清理。
- 候选从提交 `e32a6fd` 构建，服务端归档 SHA-256：`b0d7ee8394af959ae82fb3fd3e88546e9c52e0a2f23550f7678722e78664be8d`；release `/opt/pojia/releases/20260825-nonbrowser-e32a6fd-fixed` 的 242/242 manifest 校验通过。
- 迁移 001–037 全部 `already applied`；部署前备份 `/var/backups/pojia/pojia-20260825T032925Z.sql.gz.enc`，`pojia-ops check` 报告 `backup_integrity=OK`。
- 部署后 Web/Worker/Bark/卡只读同步/目录同步 active，付费卡库存 runner inactive；公网 `/health/live` 和 `/health/ready` 均 200；`/admin` 未登录 302 到登录页。
- 线上 admin.js/admin.css SHA-256 与候选一致；admin.js 已包含 `toggle-order-acceptance`、`toggle-recharge-dispatch`、两个新 POST 路由和“停止自动充值”；未认证 POST 路由返回 401 `admin_auth_required`。
- readiness 仍为 `ok=true`，接单/派发/Provider 写入关闭，资金风险、Permit、UNKNOWN Provider 调用、对账案件和 Browser 活动队列为 0；未执行开卡、余额充值、Provider 写入、Plus 付款、退款或提现。
- 下一步：有管理员会话后完成后台逐页只读验收；继续保持所有写入门禁关闭，不在验收过程中清理 task 22 或历史异常。

## 2026-08-25｜部署后后台逐页只读验收完成

- 使用用户 Chrome 中精确的已登录 `Plus 运营后台` 标签页，刷新后读取最新 DOM；未点击开关、未提交表单、未生成 CDK、未创建任务。
- 总览确认“接收新订单”显示“已停止新订单”并提供“开始接单”；“自动充值（对已接订单自动购买 Plus）”独立提供“开始自动充值”。两个控制项已在实际线上页面分开显示。
- 逐页只读导航成功：总览、订单、异常队列、资金证据核对、卡余额充值、卡台路线、Browser 执行、卡片库存、CDK 管理。
- 本轮完成部署后运行时和后台只读验收；接单、派发、Provider 写入继续关闭，真实开卡、余额充值、Plus 付款、退款和提现均未执行。

## 2026-08-26｜Browser 上游合同 3 个 P0 共享核心修复

- 工作线：共享核心/Browser 上游资金控制；未修改 Browser 独立 worktree，未接生产。
- 完成 P0-1：`issuePaymentPermit()` 不再信任调用方 snapshot；在同事务内锁定并重新核验 attempt/order/route/card/Provider 绑定、卡状态、DECIMAL(18,6) 余额、卡资料和 15 分钟同步时效；snapshot 由服务端计算，付款 intent 前再计算，变化则拒绝。
- 完成 P0-2：新增单事务 `abortBeforePayment()`；只有没有 `PAYMENT_SUBMIT` 且 permit 未消费时，才可同时将 run 收口为 `FAILED_SAFE`、撤销 permit、失效 Checkout artifact 并清空密文、释放租约、取消 dispatch、清算 attempt/funds、释放 authorization、更新订单并写审计。已有付款证据时返回 `RECONCILE_ONLY`，不回退重付。
- 完成 P0-3：Browser route 从创建 attempt、dispatch、beginRun、permit、UNKNOWN、Plus 激活、取消续费到最终成功统一使用订单 `RECHARGE_PROCESSING`；API route 仍使用 `SUBMITTING`。
- 修改代码：`v1/src/domain/order-status.js`、`v1/src/db/repositories/recharge-attempt-repository.js`、`browser-dispatch-repository.js`、`browser-execution-repository.js`、`v1/src/services/browser-admin-service.js`，以及对应单元/MySQL 集成测试。
- 验证：定向 48/48 通过；临时 Docker MySQL 8.4 从 001–037 迁移成功，Browser 付款唯一性/UNKNOWN、pre-payment safe-abort、artifact/resource 恢复集成 3/3 通过。全量 `npm test` 为 415 total / 378 pass / 34 skipped / 3 fail，3 个可复现环境失败是 Unicode worktree Express `sendFile` 和缺少 `playwright` 包，非本次回归。
- 未完成/下一项：Browser 独立 worktree adapter 仍需按 `docs/contracts/2026-08-26_browser-upstream-runtime-contract.md` 接线；之后在付款写关闭下完成端到端联调和故障注入。未部署生产，未修改生产开关，未执行真实付款或卡台写入。

## 2026-08-27 生产只读 Browser Worker 形态核验

- 主线合并后构建只读候选 release `20260827-browser-readonly-58af6f2` 并部署到 `/opt/pojia/current`。
- 生产 readiness 现场通过：迁移 037、接单/派发关闭、Browser 付款写入关闭、Browser 队列活动任务 0；Browser executor profile 激活且 `productionWritesEnabled=false`。
- 新增并安装 `pojia-browser-worker.service`；本次启动只读 fixture smoke 通过后立即停止，未启用常驻服务。
- 生产机安装 Playwright Chromium 与依赖；未访问外部 ChatGPT、未读取真实 Session/PAN/CVC、未填卡、未付款、未调用卡台写接口。
- 本次仅验证生产进程形态和安全门禁，不代表真实 Browser 充值已可用；真实订单仍需另行确认和付款闸门。

## 2026-08-27｜卡片库存与自动同步专项修复

- 分支 `codex/card-inventory-sync-20260827`；未修改 Browser 自动化充值线、API 主流程或资金规则。
- 生产只读确认卡 1477 Provider `$16` 开卡、当前 `$0.07`、`cardType=VISA-40024200` 无 ID；本地余额 `$16`，两条同步任务 `REVIEW_REQUIRED/SCHEMA`；历史卡最多 495 条 discovery；低库存告警 OPEN/Bark SENT。
- 已修复 Provider aggregate Schema、cardType 唯一映射、baseline/discovery 去重、3 次读取失败、AVAILABLE 10 分钟、Schema 直达复核、Bark 去重与 route account 归属。
- 验证：隔离 MySQL 8.4 迁移 001–037；专项 54/54；真实 MySQL 33/33。未部署、未合并、未执行真实开卡/充值/付款/退款/提现；历史清理、FAILED 恢复和真实手动开卡仍未验证。

## 2026-08-27｜API 成功单后的跨窗口统筹顺序（待最终整合）

- 用户确认：API 真实订单完成后，Browser 临时暂停解除；Browser 先继续非付款工作，卡片库存同步专项并行修复。
- 顺序：Browser 非付款基础与控制面 → 卡片同步修复后 readiness 只读交叉验证 → Browser 非付款端到端 dry-run → 单独确认 Browser 真实付款。
- 本记录只记录统筹顺序，不替代 `DECISIONS.md` 的有效决策；Browser 不得自行实现卡片库存判断、修改 API 主流程或开启真实付款。
- 卡片库存专项需要额外核对本日志中已有修复报告与生产事实，避免把未部署/未合并的工作误认为线上已生效。

## 2026-08-28｜一卡多充账本接入与后台只读统计

- 已将消费次数账本接入 API/Browser 共享资金链：付款前原子预留、成功消费、明确未提交释放、UNKNOWN/付款后失败保留核对占用。
- 新增 migration 039 精确关联 `recharge_attempts`；新增后台只读接口 `/api/v1/admin/card-consumption`，不执行写操作。
- 验证：v1 `npm test` 443 total / 406 pass / 0 fail / 37 environment-skipped；隔离 MySQL 001–039 迁移可重复；账本并发、完整 MySQL、Browser MySQL 均通过。
- Git 提交：`e1d03d2`（账本资金链）、`a6e6634`（后台只读统计）。生产未部署，自动跨订单复用未启用。
- 下一步：仅生成历史订单/Provider 交易差异报告，先人工核对，不自动改历史；之后再评估后台前端展示。
- 已完成只读差异报告脚本 `v1/scripts/card-consumption-audit.js` 及测试；它只执行 SELECT，发现差异时输出卡号尾号、账本状态计数和 Provider transaction ID，绝不自动回填。
- 差异报告新增建议分类：Provider 成功消费多于本地账本时标记 `BACKFILL_REVIEW_REQUIRED`，本地多于 Provider 时标记 `LEDGER_REVIEW_REQUIRED`；两者都必须人工核对后才允许未来设计回填。
- 用户补充业务事实：Provider 卡 `493`（尾号 `8590`）在 2026-08-18 用于 Plus 充值，因卡台服务器更换后永久不可用。已附加到生产审计报告；没有仅凭口述自动回填账本或直接改生产状态。
- 2026-08-28 只读复核补充：卡 `493` 当前仍为 `active/AVAILABLE`、`order_id=NULL`、余额 `$0.01`；Provider 交易链显示 2026-08-18 成功开卡充值 `$16` → OPENAI purchase 成功 `-$15.97`（`agg_tx_190ywhd2bk93r`）→ `$0.01` 余额转出，另有 2026-08-19 一笔 OPENAI purchase 失败。生产订单/Provider 调用未发现可直接关联的本地订单主键；不得自动回填，需后续增加永久停用/历史归档处理。
- 用户补充确认当前卡片运营规则：现阶段只有尾号 `6807` 可用；`4744` 可用但已充值 Claude，仅针对该卡保留为 Claude 用卡，不再安排其他套餐。除此之外的所有现有卡（含 `8590`）均属于同一批卡台服务器更换导致的永久不可用状态，永不按可用卡分配。未来新开卡另行按实时证据判定。
- 生产只读核验（SSH `root@144.34.180.184`）确认当前 release 仍为 `/opt/pojia/releases/20260828-card-sync-43ca767`，其中不存在 migration 038/039 和审计脚本；因此本次未在生产执行审计，也未擅自部署。生产审计的前置条件是单独确认部署包含账本与审计代码。

## 2026-08-28｜最小卡片运营覆盖后台接口

- 新增 `v1/migrations/040_card_operational_overrides.sql` 对应的最小运营覆盖服务 `v1/src/services/card-operational-override-service.js`。
- 后台新增只针对运营覆盖的查询、设置、清除接口：`GET/POST/DELETE /api/v1/admin/card-operational-overrides`。
- 支持 `NORMAL`、`PRODUCT_ONLY`、`RETIRED`；`PRODUCT_ONLY` 必须指定产品；所有写操作仍受后台敏感写入门禁保护。
- 资格查询已统一排除 `RETIRED` 与不匹配 `PRODUCT_ONLY`；本次只完成代码与测试，未部署 migration 040，未写入生产覆盖数据。
- 验证：新增专项测试通过；此前全量测试 446 total / 409 pass / 0 fail / 37 skipped。
- 提交：`fc91d18`。

## 2026-08-28｜Browser 分支重新对齐并合入主线

- Browser 分支先对齐最新主线，确认未删除 migration 039/040、消费账本、卡片运营覆盖或既有文档。
- Browser 提交 `fe3d116`、`2d7160b` 已通过 `git diff --check`，无主线删除项；合并提交：`33ffd37`。
- Browser 测试：`89 tests / 85 passed / 0 failed / 4 skipped`。
- 合并后 v1 全量测试：`450 total / 413 pass / 0 fail / 37 skipped`。
- 仍未部署生产、未启动 Browser Worker、未开启付款写入、未执行真实付款。

## 2026-08-28｜卡片接管接受阶段尊重运营覆盖

- Provider discovery 仍保留为可审查记录，但显式接管前会读取 `card_operational_overrides`。
- `RETIRED` 或非 Plus 的 `PRODUCT_ONLY` discovery 不会被接管进入本地可分配 cards。
- 新增隔离测试覆盖 Claude 专用覆盖阻止接管；定向 intake/override 测试 `9/9` 通过。
- 提交：`92b1c06`。未部署生产。

## 2026-08-28｜公网只读健康核验

- `https://ops.vibebridge.top/health/ready` 返回 HTTP 200，响应 `{"status":"ready"}`。
- `https://plus.vibebridge.top/health/live` 返回 HTTP 200，响应 `{"status":"ok"}`。
- 本次仅访问公开健康端点；未登录后台、未修改生产配置、未执行 Provider/卡台写操作。

## 2026-08-28｜生产服务器只读核验

- SSH 只读连接成功：hostname `elegant-unicorn-1.localdomain`。
- 当前 release：`/opt/pojia/releases/20260828-card-ledger-43ab997`。
- 服务状态：`pojia-web.service active/running`；`pojia-worker.service inactive/dead`；`pojia-browser-worker.service inactive/dead`；卡片读取/目录同步 timer active。
- 当前 release 已包含 migration 039，但不包含 migration 040；因此卡片运营覆盖表尚未部署生产。
- 直接运行 `v1 npm run preflight:readiness` 未成功，原因是命令环境未注入 `DATABASE_URL`；这不是 readiness 结论，不能据此推断数据库故障。
- 未执行任何生产写入、重启、部署、开卡、充值或付款。

## 2026-08-28｜生产部署 migration 040 与 Worker 恢复

- 经用户明确允许后，先执行生产加密备份并校验：`/var/backups/pojia/pojia-20260828T034333Z.sql.gz.enc`，`backup_integrity=OK`。
- 构建并上传候选 release：`/opt/pojia/releases/20260828-bef3bcb-040`；包含当前 main 的 v1、browser-mvp 和 migration 040。
- 生产迁移从 001–039 已应用，新增成功应用 `040_card_operational_overrides`。
- Web 已重启，`pojia-worker.service` 已启动并保持运行；Browser Worker 仍为 disabled/inactive。
- 生产 readiness（使用 `/etc/pojia` 运行环境只读执行）：`ok=true`、latest migration 040、worker heartbeat 2 秒、资金风险 0、UNKNOWN Provider 调用 0、活动授权 0、阻断项为空；接单和派发仍为 false。
- 公网 `/health/ready` 仍返回 HTTP 200。
- 未开启 Provider 写入、卡台写入、Browser 付款写入；未执行开卡、充值、付款、退款。

## 2026-08-28｜生产后台只读路由验收

- `/admin` 返回 302 到 `/admin/login`，后台入口正常。
- 新增运营覆盖 API、卡片库存 API、Provider 路由 API 在未登录时均返回 `401 admin_auth_required`，说明路由已加载且认证门禁生效。
- 本轮未使用管理员会话，不读取或修改生产业务数据。

## 2026-08-28｜生产卡片运营覆盖写入（经用户确认）

- 已在生产写入两条最小覆盖：Provider account `00000000-0000-4000-8000-000000000101`。
- 外部卡 `493`（尾号 `8590`）：`RETIRED`，原因“同批卡台服务器更换，已确认永久不可用，禁止分配”。
- 外部卡 `1065`（尾号 `4744`）：`PRODUCT_ONLY`，产品 `claude`，原因“已用于 Claude，保留为 Claude 专用，不分配 Plus”。
- 写入后立即只读回读确认两条记录正确。
- 未对未知外部卡 ID 批量猜测或写入；其余旧批次卡需后续取得明确 Provider ID 清单后再处理。
- 本次未改变接单、派发、Provider 付款或卡台写入开关。

## 2026-08-28｜生产覆盖与运行开关只读复核

- 覆盖表只读回读：`1065=PRODUCT_ONLY(claude)`、`493=RETIRED`，与已确认规则一致。
- `accept_new_orders=false`、`dispatch_new_recharges=false` 仍保持关闭。

## 2026-08-28｜现有旧批次覆盖补齐与资格审计修正

- 生产 Provider 只读快照确认当前可见卡 19 张：`1477`、`1065` 及其余 17 张旧卡。
- 按已确认规则保留 `1477/6807` 不设覆盖、`1065/4744=PRODUCT_ONLY(claude)`；其余 17 张当前旧批次卡全部写为 `RETIRED`。该快照不影响未来新开卡。
- 修正 card consistency audit：已被 `RETIRED` 或 `PRODUCT_ONLY` 覆盖的未接管 Provider 卡不再重复报“未映射关键故障”，但保留 suppressed 计数。
- 生产资格审计复核：`ok=true`、19 Provider 卡、6 本地卡、critical=0、warning=0、suppressedOverrideCount=13。
- readiness：`ok=true`、migration 040、资金/UNKNOWN/授权均为 0、接单与派发仍关闭。
- 部署中发现候选目录最初因 `cp -a` 复制软链接而非内容，已立即修正为真实不可变目录 `/opt/pojia/releases/20260828-eab5567-fixed` 并复核 current 指向正确。未造成业务数据丢失或资金动作。

## 2026-08-28｜库存后台收敛前整体封账

- 当前主线/生产对齐到 `d8954bd`，release 为 `/opt/pojia/releases/20260828-d8954bd-sealed`；可靠回滚点为 `/opt/pojia/releases/20260828-fea0ffd-rollback`。
- 重跑本地全量测试：v1 454 total / 417 pass / 0 fail / 37 skipped；Browser 89 total / 85 pass / 0 fail / 4 skipped。
- 生产 readiness 重跑通过：`ok=true`、migration 040、activeTasks 0、expiredLeases 0、uncertainProviderCalls 0、activeOrUnknownFundsRisk 0、activeRechargeAuthorizations 0、blockers 0。
- 生产卡片审计：Provider 19、本地 6、critical 0、warning 0；HNSKJ/ZZSHU 只读合同通过；ops/plus 的 live/ready 均 HTTP 200。
- 最新加密备份 `/var/backups/pojia/pojia-20260828T043251Z.sql.gz.enc` 通过 SHA-256 完整性校验。
- 对抗复查发现 `pojia-card-stock-runner.timer` 处于 inactive 但 enabled，而其 service 显式启用 Provider 卡写入权限。这与当前“自动补卡关闭”不对齐，且主机重启后可每 10 秒唤醒。已直接修正为 inactive/disabled，并确认数据库 `card_auto_replenishment_enabled=false`。
- 已更新 `CURRENT_STATE.md`、主规划、路线图、决策状态和交接索引；历史 Browser 全量排查报告已标注为历史快照。
- 阶段报告：`docs/PRE_INVENTORY_CONVERGENCE_SEAL_2026-08-28.md`。下一动作为 A2 库存后台信息收敛；不重做 A1，不删除真实追溯数据，不开启付费写入。


## 2026-08-28｜库存后台收敛版本生产部署

- 用户明确确认部署提交 `2c75d31`。
- 以 `git archive` 构建真实不可变 release：`/opt/pojia/releases/20260828-2c75d31-inventory`，未通过复制 current 软链接构建。
- 原子切换 `/opt/pojia/current` 完成；切换前 release 为 `/opt/pojia/releases/20260828-d8954bd-sealed`，可回滚。
- `pojia-web.service`、`pojia-worker.service` 重启后均 `active`；`pojia-browser-worker.service` 与 `pojia-card-stock-runner.timer` 继续 `inactive/disabled`。
- 发布后 `https://ops.vibebridge.top/health/live`、`/health/ready` 与 `https://plus.vibebridge.top/health/live`、`/health/ready` 均 HTTP 200。
- `pojia-ops check` 通过：MySQL running、Bark/backup 正常、最新备份 `/var/backups/pojia/pojia-20260828T055851Z.sql.gz.enc` 校验 `backup_integrity=OK`。
- 未认证后台 API 返回 `401 admin_auth_required`；未执行任何开卡、充值、付款、退款或配置写入。
- 生产写入闸门保持关闭：接单、派发、Provider 写入、Browser 付款、自动补卡均未开启。
- 备注：静态资源当前版本参数为 `admin.css?v=8`（以线上实际响应为准，非预期的 v18 文档描述已不采用）。

### 2026-08-28 14:05 CST｜发布后只读体检补充

- `preflight:readiness`（生产运行环境、只读 Provider 开关）返回 `ok=true`，migration 040；activeTasks/expiredLeases/UNKNOWN/资金风险/活动授权/活动卡任务/对账案件/DEAD Bark 均为 0，worker 心跳约 1 秒。
- `card-consistency-audit`：Provider 19、本地 6、critical 0、warning 0、suppressedOverrideCount 13。
- `provider:read-check`：HNSKJ account 67、USD、7 卡类型、可见卡 19；ZZSHU connection ok。

### 2026-08-28｜收敛版本线上静态交叉核验

- 线上 `/admin/login` 可访问；`admin.js?v=8` 返回 127,421 bytes。
- 静态资源包含“可分配、使用中、暂不可用、永久停用、余额不足”等收敛文案；旧主视图文案“待验证新卡”“同步积压”未出现在该脚本中。
- 本窗口当前未取得管理员浏览器自动化控制权，因此未将静态检查冒充为登录后的视觉验收；登录后布局/数据展示仍需在可控浏览器会话中完成。

### 2026-08-28｜库存分类与同步运行核验补充

- 生产 `pojia-card-read-sync.timer`、`pojia-card-catalog-sync.timer` 均为 active；最近一次 catalog sync 成功返回：Provider 总卡 19、Provider active 8、inactive 11、assigned 2、depleted 2、available 0、unresolvedActive 0、statusConflict 0。
- 四类主视图不是卡台原始状态的直接复制，而是由只读同步写入的状态/余额/资料、订单绑定以及 `card_operational_overrides` 共同计算的有效运营分类。
- 因此“余额不足”表示本次同步观察到余额低于 Plus 最低要求，属于可恢复阻断，不等于永久坏卡；“永久停用”来自明确运营覆盖，不会被普通同步覆盖。
- 本次核验没有发现同步任务失败或未解析 active 卡；但页面数据仍以最近一次成功同步为准，卡台真实可用性不能仅凭单次目录同步证明。

### 2026-08-28｜一卡多充状态口径澄清

- 当前生产仍为“一卡一单”：已绑定订单即显示“使用中”，不再分配；这不是遗漏，而是当前防止未知付款结果下误复用的运行边界。
- 规划中的“一卡多充”已完成消费计数账本基础（默认上限 3 次），但跨订单自动复用尚未启用。
- 启用后应将展示细化为“使用中（已用/上限）”与“已达使用上限”；“已达使用上限”不得标记为“永久停用”。永久停用仅用于人工确认的永久失效卡。

## 2026-08-28｜独立全系统审查统筹复核与修正

- 独立报告已纳入 `docs/INDEPENDENT_FULL_SYSTEM_AUDIT_2026-08-28.md`；统筹复核见对应 adjudication 文档。
- 已确认并修正 Git worker 模板的 recharge 写开关为 false；生产现场原本即为 false，没有发生资金写入。
- 已将重复的第二条 D-069（API 不做独立预检）更正为 D-104，业务语义不变。
- 当前主线 v1 全量复跑：456 total / 419 pass / 0 fail / 37 skipped。
- 纠正独立报告两个不准确点：HANDOFF_LOG 实际已有 08-27/08-28 记录；同步吞吐按 15 分钟新鲜度理论约 60 张，不是 40 张。规模风险保留为放量前事项。
- 生产只读补验通过：release、服务/开关、readiness、健康端点、备份、Provider/卡片审计和运营覆盖均与当前事实源一致。

## 2026-08-28｜Browser 数据库重启恢复验证完成

- Browser 分支提交 `6dfdff7` 修正旧 backlog 测试夹具的订单状态（`SUBMITTING`→`RECHARGE_PROCESSING`），并增强重启恢复断言；合并提交 `39cd53d` 已进入 main。
- 隔离 MySQL 8.4 真实 `docker restart`：24 个任务恢复领取 24/24，重复 0，心跳 24，旧 lease/token 拒绝，付款提交 0，残留 0。
- Browser 最新非付款回归 16/16；定向 dispatch/shared 回归 17/17；未连接生产、未读取真实 Session、未填卡、未付款。
# 2026-08-28 后台全量问题复查与最小修复

- 生产只读核验：当前 4 单（成功 1、失败 1、关闭 2），等待 Session 0，对账案件 0；卡片 6 张（ASSIGNED 2、AVAILABLE 2、DEPLETED 2）。4744 对应 Provider 卡 1065，运营覆盖为 `PRODUCT_ONLY/claude`，因此不在 Plus 本地 cards 列表。
- 新报告：`docs/ADMIN_FULL_REASSESSMENT_2026-08-28.md`，逐项区分生产事实、代码事实、待验证边界。
- 修复：低库存告警不再在 OPEN/SENT 状态被同步路径反复 reopen；Provider 余额变化复用余额快照建立去重 Bark 告警；修复提醒标题对齐、CDK 筛选换行、同步接管按钮位置。
- 验证：v1 定向测试 81 通过、1 跳过、0 失败。未执行生产写操作。
- 下一步：订单详情默认精简/技术证据折叠；卡片页增加 Provider 全目录和运营覆盖展示；核对成功订单异常的具体触发代码；通过浏览器截图做 UI 交叉验收。

# 2026-08-28 卡片目录可见性补充

- 卡片库存接口和页面现会展示不在本地 `cards` 表的 `RETIRED`/`PRODUCT_ONLY` 运营覆盖行（包括 4744/Claude 专用），仅作只读可见性，不计入 Plus 可分配库存，也不可点击进入本地卡详情。
- 定向 v1 测试：81 通过、1 跳过、0 失败。

# 2026-08-28 订单详情收敛

- 订单详情默认保留核心履约/资金信息；第 7 个区块起的卡片分配历史、Session 历史、成本明细、交易、时间线、后台任务等统一收进“技术证据”折叠区，数据仍保留、没有删除。
- UI 代码测试：82 通过、0 跳过、0 失败。

# 2026-08-28 对账原因可读化

- 对账案件列表现在把已知 case code 映射为中文原因，并同时保留原始 code（如缺少付款证据、金额不一致、提交结果未知），不再只显示笼统类型。
- 页面相关测试：82 通过、0 跳过、0 失败。

# 2026-08-28 生产页面交叉检查边界

- 对 `https://ops.vibebridge.top/admin` 做了只读 HTTP 检查：返回 200，但仍引用生产旧版 `admin.css?v=8`，页面 HTML 尚未包含本地新增的 `stock-card-actions`。因此本轮代码改动尚未进入生产，不能把本地测试当作生产视觉验收结果。
- 生产部署和登录态下的浏览器视觉验收仍待单独确认；本次没有改生产配置或执行资金动作。

# 2026-08-28 后台修复版本生产部署

- 用户明确确认部署；从当时 `main` HEAD 构建真实独立 release：`/opt/pojia/releases/20260828-admin-fixes-22f46e2`，原子切换 `/opt/pojia/current`。
- 首次切换后发现新 release 尚未安装 `v1/node_modules`，readiness 因缺少 `zod` 失败；立即在新 release 执行 `npm ci --omit=dev` 并重启 Web/Worker。最终 Web、Worker、Bark、卡片读同步和目录同步均 active；Browser Worker 与自动补卡 timer 继续 disabled。
- 最终 readiness：`ok=true`，migration 040，active tasks/过期租约/UNKNOWN Provider/资金风险/活动授权/卡任务/对账案件/DEAD Bark 均为 0；接单和派发均 false。
- 发布前加密备份：`/var/backups/pojia/pojia-20260828T100723Z.sql.gz.enc`，哈希、解密和 gzip 完整性校验均通过。
- ops/plus 两端 live/ready 均 HTTP 200；线上静态 `admin.js` 已包含“技术证据”折叠，`admin.css` 已包含 `stock-card-actions`。未登录 `/admin` 返回登录页，所以不能把它的旧 `?v=8` 资源版本冒充登录后后台版本。
- 未开启接单、派发、Provider 写入、Browser 付款或自动补卡；未执行开卡、卡充值、Plus 付款、退款或提现。

# 2026-08-28 余额告警部署后复核修正

- 部署后只读复核发现余额告警首版把 Provider 对象插入文案，产生了两条错误的 `[object Object]` 告警；这是本窗口新增代码的真实缺陷，已立即修正为 `hnskj` Provider code，并将两条错误告警标记为已解决，避免继续通知。
- 修正提交：`fe9f1c3`；新 release：`/opt/pojia/releases/20260828-admin-fixes-fe9f1c3`。
- 修正后 Web/Worker active，`pojia-ops check` 通过，备份完整性仍为 OK；未开启任何 Provider/资金写开关。

# 2026-08-28 卡台告警中文化

- `hnskj` 只是代码内部的卡台标识，不是给运营人员看的名称。余额变化通知现改为“当前卡台余额由 X 变为 Y”。
- “卡台余额/开卡规则只读同步失败”提示已改为白话：“卡台余额或开卡规则暂时没有更新成功，系统已暂停使用旧数据开卡，请稍后刷新。”
- 修正 release：`/opt/pojia/releases/20260828-admin-alert-wording-7dc63b5`；`pojia-ops check` 通过，所有写开关保持关闭。

# 2026-08-29 低库存提醒按运营模式收敛

- 生产 `card_auto_replenishment_enabled=false`，当前人工开卡；此前仅因阈值低就反复提醒，和实际可人工补卡的运营方式不匹配。
- 代码现仅在自动补卡启用时发送“低库存”预警；仍有订单真正进入 `WAITING_FOR_CARD` 时，保留一次必要的阻塞提醒。
- 定向测试：87 通过、6 跳过、0 失败。已部署 release：`/opt/pojia/releases/20260829-inventory-alert-9466fdb`。
- 部署后将当前 1 条不再适用的 OPEN 低库存告警标记为 RESOLVED；没有开启任何 Provider/资金写入。

# 2026-08-29 新卡识别与“有卡但需补余额”语义修复

- 生产现场发现 Provider 新卡 `1628/6185`：active、卡段 17、余额 `$5`、资料完整；旧规则因默认开卡卡段为 16 将其错误标记为 `CARD_TYPE_MISMATCH`。
- 提交 `262bd4d` 修复接管规则：接受卡台当前公布的全部合法卡段，默认卡段只决定未来开卡偏好。定向回归和全量测试通过；部署 `/opt/pojia/releases/20260829-card-segments-262bd4d`。
- 将旧的错误 discovery 精确恢复为待验证并重新读取；最终 `1628` 接管成功，目录 `unresolvedActive=0`、`providerOnlyActiveCount=0`。该过程只调用卡台读取接口，没有开卡、卡充值或付款。
- 继续核验发现四个同源问题并以提交 `51a4b7a` 修复：后台不再把“可直接分配 0”展示成“没有卡”；卡读取统一使用 Plus 最低余额；可补余额卡能进入既有卡充值调度；订单分配不再错误限制为默认开卡卡段。
- 第二版生产 release：`/opt/pojia/releases/20260829-fundable-inventory-51a4b7a`。卡片读同步后，`6185` 正确为 `DEPLETED / 余额不足，充值后可重新判定`，余额 `$5`，未绑定订单。
- 生产后台事实：可直接分配 0、待补余额 1、自动补卡关闭、低库存状态 false、相关 OPEN 告警 0。
- 验证：v1 459 total / 422 pass / 0 fail / 37 environment-skipped；全新临时 MySQL 8.4 四个集成套件 37/37；生产 readiness `ok=true`、公网 ops/plus ready 200、`pojia-ops check` 和最新加密备份完整性通过。
- 所有资金写开关、接单、派发、Browser 付款、自动开卡和卡余额充值继续关闭；本轮没有执行真实资金动作。

## 2026-08-29｜部署后卡片库存只读同步复验

- 通过已登录生产后台“卡片库存 → 只读同步全部”，加入 7 张卡队列，等待后刷新完成；未执行任何 Provider/资金写入。
- 卡 1477/6807：状态 `invalidating`、已分配、余额 `0.07 USD`、资料/交易同步 `08/29 09:50`；`CARD_RECHARGE 16 USD` 与 `PURCHASE 15.93 USD` 成功交易证据已显示。
- 订单 `PJV1-FqFnMiSKBtLGN14GyP7W`：充值成功、三方一致、卡片核对 15 分钟内已更新、平台金额 `982.140000 PHP`、直充单号 `6294`。
- 库存：可分配 0、使用中 1、暂不可用 1、永久停用 17；卡台余额 `$47.36`、剩余开卡额度 292、自动补卡关闭。
- Console 仅有 CSP inline-style 阻止错误；业务只读 GET 请求均 200。详细报告：`docs/2026-08-29_card-inventory-readonly-sync-verification.md`。
- 下一步：由统筹窗口审查报告；保持所有资金写开关关闭，不部署额外变更。

## 2026-08-29｜卡段人工刷新与持久默认选择（已部署）

- 新增管理员卡片库存卡段人工刷新入口及后端路由 `POST /api/v1/admin/card-stock/provider-refresh`；仅调用 Provider `cardTypes/accountBalance` 只读接口并更新既有 snapshot，不执行开卡、充值或付款。
- 新增默认卡段保存路由 `POST /api/v1/admin/card-stock/default-card-type`，校验当前新鲜 snapshot 中的合法卡段后写入既有 `app_settings.default_card_type_id`。
- 前端卡段下拉变更后持久保存，普通库存刷新不触发 Provider 读取；未恢复高频自动读取。
- 测试：`npm test` 全量 461，424 通过、0 失败、37 环境跳过；新增路由认证/调用测试通过。
- 已部署至 `/opt/pojia/releases/20260829-card-segment-58dfe0d`；Web/Worker 与健康检查正常。管理员页面按钮的最终交叉验收仍待完成。

## 2026-08-29｜低复杂度“开始营业”入口（未部署）

- 新增后台“开始营业”按钮及 `POST /api/v1/admin/operations/start-business`。
- 入口先只读检查服务概览、数据库可用性、卡台规则/余额、默认卡段及库存；可分配库存为 0 时明确返回“可用卡库存不足（可分配/待补余额）”，不误报卡台故障。
- 检查通过后仅开启接收新订单与既有自动派发开关；不自动开卡、不自动充值，Provider 写入闸门保持独立。
- 本地 `npm test`：462 total / 425 pass / 0 fail / 37 skipped。尚未部署或生产验证。

## 2026-08-29｜库存刷新按钮语义澄清（未部署）

- 将补卡执行记录的“刷新”改为“刷新本地列表”，成功后明确提示“本地列表已刷新（未同步卡台）”。
- 将“只读同步全部”改为“同步卡台余额和交易”，避免运营误把本地 GET 刷新当成卡台同步。
- 仅修改文案与成功反馈，不改变接口、任务或资金行为；尚未部署。

### 部署更新

- 已从生产基线 `58dfe0d` 单独制作安全发布提交 `ef5afd5`，不包含延期的“开始营业”入口。
- 已部署 `/opt/pojia/releases/20260829-card-refresh-ef5afd5`；Web、Worker、卡片只读同步/目录同步定时器及健康检查正常。

## 2026-08-29｜Browser attempt/run 执行配置绑定已合入主线（未部署）

- Browser 独立线提交 `1d02c78` 已由统筹逐项审查，并以主线提交 `d6f9bf3` 合入；只带入本轮 Browser 代码、测试和运行报告，没有合并 Browser 分支历史。
- 修复内容：共享 adapter 显式读取 `recharge_attempts.executor_profile_id`，要求它与 `browser_runs.executor_profile_id` 一致；权威付款 snapshot 再次核对并纳入 `executorProfileId`，漂移错误码为 `EXECUTOR_PROFILE_CONFLICT`。
- 主线复验：`npm --prefix browser-mvp run check` 通过；adapter/runtime/repository 定向测试 **46/46 passed**。
- 随后执行 v1 全量回归：465 total / 428 pass / 0 fail / 37 environment-skipped。
- 边界：本轮未部署生产 Browser Worker、未连接生产、未读取真实 Session/PAN/CVC、未填卡、未付款，也未改变生产写开关。

## 2026-08-29｜第二单真实 API 全链路成功

- 客户提交 CDK + Session 后创建订单 `PJV1-uVsqgepiEHu3tfpQKQq-`；使用卡 `1628/6185`。
- 用户当次明确允许真实付款后，临时打开 recharge-specific 写入并签发单笔 Permit；`create_direct` 仅调用 1 次，外部订单号 `7025`。
- 最终订单 `RECHARGE_SUCCESS`，平台金额 `982.140000 PHP`，Plus 已开通且自动续费已取消；attempt 为 `SUCCESS/SETTLED`。
- 完成后 Provider 账户写权限恢复为 false，Permit 撤销；readiness `ok=true`，活动任务、UNKNOWN 调用、活动资金风险和开放对账案件均为 0。
- 卡台读到 `PURCHASE 15.76 USD`；05:59 UTC 再同步后余额由 `$16.00` 降至 `$0.24`，扣减金额一致。交易状态仍为 `PROCESSING`，后续只读补证，不重付。
- 现场发现 15 分钟分配新鲜度与 60 分钟定时同步错配；主线已实现仅在真实订单等待时按需同步一张过期候选卡的低 API 调用修复，测试 466 total / 429 pass / 0 fail / 37 skipped；随后已按下述安全分支部署。
- 详细证据：`docs/2026-08-29_second_api_real_order_verification.md`。

### 按需同步缺陷安全部署

- 用户明确确认部署。为避免把主线中延期的“开始营业”和 Browser 代码带入生产，从当前生产基线 `ef5afd5` 制作仅含三处运行时/测试变更的安全提交 `bba4105`。
- 安全分支回归：464 total / 427 pass / 0 fail / 37 environment-skipped。
- 部署前备份：`/var/backups/pojia/pojia-20260829T060414Z.sql.gz.enc`，加密备份完整性通过。
- 新 release：`/opt/pojia/releases/20260829-order-demand-sync-bba4105`；回滚点：`/opt/pojia/releases/20260829-card-refresh-ef5afd5`。
- 部署后 Web、Worker、卡片只读同步/目录同步、Bark 均 active；readiness `ok=true`，活动任务/未知调用/资金风险/对账案件均 0；Provider 三个写开关均 false；ops/plus 四个 live/ready 均 HTTP 200。

### 按需同步真实 MySQL 回归补齐

- 新增集成用例覆盖真实订单遇到一张交易证据超过 15 分钟、但资料/余额/绑定均安全的候选卡。
- 全新临时 MySQL 8.4、migration 001–040 下验证：第一次只创建一个 `PENDING / requested_by=worker` 的单卡只读任务，订单进入 `WAITING_FOR_CARD`；第二次调用不重复排队；卡不提前绑定、无 Provider 调用。
- `mysql-integration.test.js` 34/34 通过；v1 无数据库全量 467 total / 429 pass / 0 fail / 38 environment-skipped。
- 此项只补测试，不需要再次部署生产。

### 第二单卡台交易低频补证

- 2026-08-29 07:16 UTC 只针对 `1628/6185` 排入一次只读同步；任务正常 `COMPLETED`。
- 卡余额仍为 `$0.24`；`agg_tx_3eskrt48lubis` 仍为 `PURCHASE 15.76 USD / PROCESSING / UNSETTLED`。
- 该状态只表示卡台尚未给出最终结算，不改变订单成功、取消续费和禁止重付结论。

## 2026-08-29｜Browser 首次灰度前只读就绪补强已合入（未部署）

- Browser 窗口提交 `2fd3aa0` 已由统筹审查，并以主线提交 `1516c67` 合入。
- production-readonly readiness 现在强制 migration 039/040；直接 CLI 与 systemd 一致要求 payment executor=false/MOCK；补充 Browser-only stop/disable/回滚入口。
- 主线复验：语法检查通过；Browser 90 tests / 86 pass / 0 fail / 4 environment-skipped。
- 仍缺 production Session/card-material adapter、真实 ChatGPT 非付款观察、LIVE payment/post-payment adapter 和服务器部署/回滚演练；未部署、未真实付款。

## 2026-08-29｜Browser 共享密文材料 adapter 已合入（未部署）

- Browser 独立线提交 `ddad4f1` 经统筹审查与复验后，以主线提交 `58c0d4e` 合入。
- adapter 只凭当前 `browser_run` 读取 v1 现有 `orders.session_ciphertext`、`cards.card_credentials_ciphertext`，并强制 run/attempt/order/profile/route/provider 以及消费预留一致；不建第二份材料库、不调用卡台。
- readonly lane 只注入 Session cookie 做页面观察，卡资料只做内存格式/绑定预检；`fieldsWritten=0`、`submitCalls=0`，随后 safe-abort 清理资金栅栏。
- 统筹复验：Browser 94 total / 90 pass / 0 fail / 4 environment-skipped；production-readonly smoke 的配置/systemd 9/9、隔离 MySQL + CLI/Chrome 3/3 通过。
- 未部署、未连接生产、未读取真实 Session/PAN/CVC、未访问真实 ChatGPT、未付款。下一缺口是保持付款关闭的真实 ChatGPT 只读登录/身份/页面观察。

## 2026-08-29｜Browser ChatGPT 账号/Checkout 只读 harness 已合入（未部署）

- Browser 独立线提交 `7abbe51` 经统筹审查后，以主线提交 `7065b60` 合入。
- 新增一次性 `CHATGPT_ACCOUNT_CHECKOUT` harness：Session bootstrap → `/api/auth/session` 身份逐项匹配 → 同页面订阅状态检查 → 免费账号才继续 Plus 入口和 Checkout 只读识别 → `abortBeforePayment`。
- 真实观察阶段只读取订单 Session，不解密或读取 PAN/CVC；不会点击付款、不创建付款 permit、不调用 Provider。
- 对抗式审查修复：身份不再“任一字段匹配即通过”；订阅接口漂移独立归类为 `ACCOUNT_STATUS_UNKNOWN`；Session/card 读取前立即复核租约；真实观察不再无必要读取卡资料。
- 统筹复验：Browser 99 tests / 95 pass / 0 fail / 4 skipped；production-readonly smoke 配置/systemd 10/10，隔离 MySQL + Chrome 3/3；`git diff --check` 通过。
- 未部署、未访问真实 ChatGPT、未读取真实 Session/PAN/CVC。下一步只需一次性准备专用非客户测试账号的隔离订单/Session、身份摘要、批准网络出口与 Chrome 主机，然后执行只读观察并冻结真实合同。
## 2026-08-29｜ChatGPT 只读观察复验与当前停止点

- 输入：用户提供的 Session 文件；仅在隔离 MySQL + Headful Chrome 使用，原文不进入输出或持久化。
- 已证实：页面和 `/api/auth/session` 可达；身份匹配；订阅为 `FREE`；未填卡、未付款、`submitCalls=0`。
- 已修复：只读 Checkout 结果字段命名导致安全检查误报；ChatGPT 首页官方标题存在副标题变体导致页面漂移误报。
- 最新复验已通过 Checkout 只读阶段：登录、身份、免费订阅、Plus 入口、Checkout 和安全字段均成功，`submitCalls=0`；尚未进入付款。
- 已新增付款通道设计合同：先 Mock 回归，再单独确认后实现 LIVE 适配器，成功必须同时确认付款、Plus 激活和取消续费；未知结果禁止重付。
- Mock 回归已完成：14 项通过、0 失败；LIVE 适配器仍明确不可用，未连接生产或执行真实付款。
- 付款执行器对抗复查修复：付款确认后核验器/记录器异常现在返回结构化 `POST_PAYMENT_UNKNOWN`，不再冒泡为可能重试的错误；新增测试通过。
- 新增 `browser-mvp/src/live-chatgpt-payment-adapter.js`：默认禁用、精确确认词门禁、付款结果无观察器则强制 UNKNOWN；测试 2/2 通过，未接生产。
- 复查并补强提交后卡字段清理；未知或异常结果不形成重试路径，测试保持 2/2 通过。
- BrowserPaymentExecutor 现在显式把 page 传给适配器，其他层不接触页面/卡字段；付款状态测试 7/7 通过。
- 对抗复查发现：LIVE 适配器原先在 operationId 缺失时可能先完成页面填写甚至点击，再报参数错误；且观察结果未携带提交选择器。现已在副作用前校验并补齐合同字段；新增测试通过（commit 99dd076）。
- 后续联调确认安全字段名映射与当前选择器一致；新增 3DS/挑战异常清理测试，全量测试 102 通过、0 失败、4 跳过。
- 根据统筹确认，付款门禁仅保留防重复付款、结果可追踪和基础绑定等硬条件；3DS/验证码及付款后核对均按实际出现/需要触发，不提前阻断正常流程（commit af619c5）。
- 已完成门禁收敛复查并记录：106 测试中 102 通过、0 失败、4 因缺少测试数据库跳过；生产付款仍关闭。
- 错误分类进一步明确：付款前确定性问题为 `PRE_SUBMIT_FAILED`（可修正）；付款后不确定性为 `PAYMENT_RESULT_UNKNOWN`（只对账、不重付）。
- Browser 离线 soak 已运行成功；没有生产网络或资金写入。
- 生产部署模板和只读 smoke 配置复核通过：Browser 付款开关为 false、模式为 MOCK。
- 状态更正：此前“真实付款前就绪”仅指代码/隔离测试层；Browser 旧 worktree 报告仍显示生产 Session/card adapter、真实非付款观察和部署演练未完成，当前不得进入真实付款。
- Browser worktree `7abbe51` 与主线不兼容，直接合入会删除/回退主线后续付款门禁和文档；已改为逐文件选择性比较，不直接 cherry-pick。
- Browser 最新报告确认无新增提交；下一步为备份差异后可逆对齐 `main@a6ba908`，再判断是否存在可安全恢复的最小只读补丁。
- 已建立标签 `browser-stale-7abbe51-backup` 保存旧分支，当前主线未合入其差异。
- 已执行可逆对齐：`codex/browser` 现在指向 `main@9093c03`，旧分支保存在 `browser-stale-7abbe51`；对齐后全量测试通过（103/107，4 跳过）。
- 对齐后只读 Worker smoke 成功（含隔离 MySQL 与安全门禁）；未连接生产、未付款。
- 已生成未部署候选归档 `/tmp/aicharge-main-46b2cc7.tar`；check、全量测试和 diff 检查通过。
- 已整理生产只读演练手册；实际演练需 SSH 会话，尚未执行。
- 生产只读启动演练发现当前 release 缺少 Playwright 依赖，已 stop/disable 清理，未产生付款或 Provider 写入；补齐依赖前禁止再次启动。
- 补齐依赖后的候选启动继续暴露 `INVALID_BROWSER_WORKER_CONFIG`；已恢复旧 release、reset-failed 并保持服务 disabled。下一步是对齐只读 env 合同。
- 已对齐只读 env 合同并完成候选 release 的 READY/IDLE 启动、停止和回滚；当前服务 inactive/disabled，无资金写入。
- 已建立余额不足卡付款前停止测试手册；原始 Session 不落盘，仅记录脱敏摘要和流程证据。
- 根因定位：官方方案弹窗的“升级至 Plus”按钮为表单外 `type=submit`，旧规则过宽导致假失败；现已改为只拒绝表单内提交控件，并补充说明。
- 权威收口：订单 `CARD_READY`；attempt/funds `CLEARED`；run `FAILED_SAFE`；dispatch `CANCELLED`；无活动 permit、付款提交记录或资源租约。
- 未部署、未执行真实开卡/卡充值/付款；下一步是继续只读定位 Checkout 导航失败并补测试，之后再更新本文件与 Browser 合同。
# 2026-08-30｜Browser 生产形态非付款安全窗口

- 已备份生产 Browser env、systemd 单元和控制面状态；备份目录：`/var/backups/pojia/browser-nonpayment-20260830T084134Z`。
- Browser Worker 使用 `EXTERNAL_READONLY + SHARED_ENCRYPTED_NONPAYMENT + CHATGPT_ACCOUNT_CHECKOUT` 通过配置检查并 READY/IDLE；付款执行器保持 `false/MOCK`，Provider/卡台写入全部关闭。
- 临时切换默认充值方式为 Browser，通过正常客户入口使用测试 CDK 创建订单 `PJV1-TZmbNEpYNd0Gs_YgRKF_`；数据库确认订单创建时正确冻结 Browser route。
- 正常派发在分卡阶段以 `CARD_STOCK_EMPTY` 停止，订单进入 `WAITING_FOR_CARD`。生产没有余额达到 `$16` 的可分配 Plus 卡，因此未创建 recharge attempt、Browser job/run/lease，也未访问 ChatGPT。
- 已纠正此前“使用余额不足卡仍可沿真实订单链路进入 Checkout”的错误计划：真实生产链路必须先通过卡片余额和可分配资格，不允许靠改库或降低最低余额绕过。
- 测试订单已通过正式取消服务关闭；CDK 已兑换并绑定该订单，不得复用。默认 API、接单/派发、Browser gate/Worker/env 已全部恢复。
- 恢复后活动 task、ACTIVE/UNKNOWN attempt、Browser job/run/lease 均为 0；Web/API Worker active，ops/plus 四个公网 live/ready 均为 HTTP 200。
- 详细报告：`docs/2026-08-30_browser-production-nonpayment-window-result.md`。

# 2026-08-30｜按明确指令手动开卡

- 通过正式库存任务服务创建并执行 1 张、金额 `$16`、卡段 `16` 的手动开卡任务；预计总扣款 `$16.58`。
- Provider 当时规则快照显示开卡允许、账户余额 `$36.30`、剩余额度 `292`；自动补卡保持关闭。
- 任务 `986d345d-e4b6-4ad6-b770-ef447c3b6f74` 完成，新增卡 Provider id `1839`、尾号 `1013`，余额 `$16.00`，已同步接管为 `AVAILABLE / ACCEPTED`，未绑定订单。
- 仅临时进程开启 `PROVIDER_CARD_WRITES_ENABLED=true`；常驻服务及其他 Provider 写权限未开启；未创建订单、未充值、未付款。
- 详细报告：`docs/2026-08-30_manual-card-opening-result.md`。

# 2026-08-30｜启用“无卡自动补卡”

- 用户明确要求没有可分配卡时自动补卡，不再逐单人工确认。
- 生产设置：`card_auto_replenishment_enabled=true`、`card_stock_low_threshold=0`、`card_replenishment_daily_limit=5`；默认卡段/金额为 `16` / `$16`。
- `pojia-card-stock-runner.timer` 已 `active/enabled`，每 10 秒检查；当前 1 张可分配 Plus 卡，最近日志为 `STOCK_SUFFICIENT`，没有新增开卡。
- 自动任务执行前仍校验 Provider 规则、账户余额和目录；充值/付款写入保持关闭。
# 2026-08-30｜订单驱动补给提交部署

- 用户确认部署 `main`；从提交 `dd0037b` 构建不可变 release `/opt/pojia/releases/20260830-order-replenishment-dd0037b`。
- 部署前回归：v1 `439 pass / 0 fail / 38 skipped`；Browser `103 pass / 0 fail / 4 skipped`；`git diff --check` 通过。
- 部署前 release `/opt/pojia/releases/20260830-browser-routing-4dadf79` 保留为回滚点；通过原子切换更新 `/opt/pojia/current`。
- 生产验证：Web/Worker active；`pojia-ops status` 正常；ops/plus live/ready 均 HTTP 200。
- Browser Worker `disabled`；Provider 写入、卡台写入、真实付款均未开启或执行。
- 未执行开卡、补余额、提交订单或任何资金写入；本次仅发布订单驱动补给逻辑。

# 2026-08-31｜一卡多单与自动补余额联合版本生产部署

- 用户已确认部署候选提交 `068c070e06d31cbe284438c62e48efae8f66cab0`。
- 目标 release：`/opt/pojia/releases/20260831-card-reuse-068c070`；部署前回滚点：`/opt/pojia/releases/20260831-preflight-8da5127`。
- 依赖安装首次因 `/opt/pojia/.npm` root-owned 缓存失败；未影响旧 release。随后使用 `/tmp/pojia-npm-cache-068c070` 独立缓存成功安装 v1 与 browser-mvp 依赖，语法检查通过。
- 生产 migration 042/043 已执行；第二次迁移全部 `already applied`。最新迁移为 `043_order_assigned_card`。
- 原子切换后 Web/Worker active，库存 runner timer active/enabled；Browser Worker inactive/disabled，card funding timer inactive/disabled。
- 本地/公网 live 与 ready 均返回正常；`pojia-ops check` 通过，最新加密备份 `/var/backups/pojia/pojia-20260830T235805Z.sql.gz.enc` 完整性 OK。
- 部署后只读 readiness：`ok=true`、`latestMigrationNumber=43`、活动任务/过期租约/未知 Provider 调用/资金风险/开放对账案件均为 0，`blockers=[]`；接单与派发保持部署前 `true`，未擅自改变。
- 发现并修正候选 unit 描述与生产 timer 漂移：生产原为 10 秒触发，已更新为 60 秒；候选 `deploy/server/pojia-card-stock-runner.timer` 同步修正。runner 日志显示连续 `NO_DEMAND`，无额外开卡。
- Provider 写权限仍保持关闭：`PROVIDER_WRITES_ENABLED=false`；常驻 Web/Worker 的卡台与充值写权限均关闭，未执行真实开卡、补余额、付款、退款或提现。
