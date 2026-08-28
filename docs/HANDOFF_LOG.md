# 交接记录

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
