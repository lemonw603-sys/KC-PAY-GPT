# Browser 真实单订单全链路验收方案｜2026-09-06

> 状态：验收方案已冻结；Browser LIVE P0 本地实现进行中，尚未部署或启用付款。
> 目标：用一张真实卡、一个真实 CDK 和一个真实 Session，尽可能一次覆盖从客户提交到 Plus 交付、取消续费、账本与对账的完整链路。
> 资金边界：在付款前证据全部通过之前，Browser 付款开关保持关闭。最终点击付款是本次唯一需要的资金动作确认。

## 1. 当前必须先修的 P0 缺口

当前不能直接开始真实付款。现场代码核对证明：

1. 生产可启动的 `production-readonly-worker.js` 只允许 `PRODUCTION_READONLY`，强制所有付款开关为 false，完成非付款观察后会安全退回 `CARD_READY`。
2. `payment-executor.js` 仍显式拒绝 `LIVE` 模式，返回 `LIVE_PAYMENT_ADAPTER_UNAVAILABLE`。
3. `live-chatgpt-payment-adapter.js` 只是独立、受闸门保护的点击边界，没有接入当前生产 Worker 组装。
4. 实际 Plus 激活观察、取消续费和卡交易核对还只有 mock 实现；付款未知协调器有独立代码和单测，但未接入实际运行调度。
5. 卡前 `BROWSER_PREFLIGHT` 复用了付款前的严格零税合同；但真实页面需在填卡+美国免税州地址+账单邮箱后才重报价为零税。卡前检查不应因初始 12% VAT 失败，零税必须放在填卡后、付款前强制检查。

因此先完成一个独立的 LIVE Worker 组装，不放宽已有 readonly Worker。它必须接通：生产订单/dispatch/run、Session 短时解密、卡资料短租约、持久化账单地址分配、填卡后严格零税重报价、唯一付款 intent/permit、单次提交、真实结果观察、Plus 激活、取消续费和有界付款未知核实。

### 2026-09-06 本地实现检查点

已完成：

- `BROWSER_PREFLIGHT` 改用卡前宽松税额合同，仍要求 PHP，不改动最终付款严格合同；
- LIVE adapter 固定卡→地址→Session 邮箱→重报价→严格零税→最终复核→intent→单次点击顺序；
- 非零税、非 PHP、算术不一致、控件漂移在 intent 之前停止，不制造假 UNKNOWN；
- 新增真实同源 Plus 激活与取消续费确认器，access token 不离开页面上下文；
- 备用卡账单地址已保留，Browser 卡源匹配已对齐订单冻结来源；
- LIVE dispatch 支持在 SQL claim 层限制精确订单，不是领取后才检查。

尚未完成：

- 从包含 `bc8ee2f..ff34feb` 的当前单一 HEAD 构建并部署候选 release；
- 部署后付款关闭的 LIVE `--check` 与订单级卡→地址→邮箱→零税回归；
- 真实订单和唯一真实付款验收。

第二批已完成：

- 可执行的 `production-live-worker.js` 入口与安全 `--check/--once`；
- 付款 UNKNOWN/付款已确认未收口时重开同一 Profile/Session 的只读 verifier 调度；
- HNSKJ 唯一交易匹配与手工卡 Browser+ledger transaction reader；
- 付款确认与后置核验计划原子建立，恢复按批准订单 SQL 限定；
- 本机单 Profile 公开页面回归（HTTP 200、无 Cloudflare、0 submit）。
- 隔离 MySQL 完整 Browser 回归：`154/154/0/0`；UNKNOWN 与付款已确认未收口均证明恢复阶段第二次付款调用为 0。

证据与准确边界见 `docs/BROWSER_LIVE_P0_IMPLEMENTATION_2026-09-06.md`。

### P0 退出标准

- LIVE 配置默认失败关闭，只有进程级开关+数据库开关+当次确认同时成立才能点击；
- 填写顺序固定为卡资料→账单地址→Session 邮箱→服务端重报价；
- 付款前页面与数据库租约任一变化必须停手，提交次数为 0；
- 点击后断网/超时只锁定该订单/账号/卡/run，自动只读核实，不第二次点击，不暂停其他订单；
- 真实 Plus/取消观察器和付款未知调度有定向、MySQL 集成和故障注入测试；
- 单 Profile 非付款回归可稳定到最终提交前，此时所有生产付款开关仍为 false。

## 2. 验收前状态快照

此阶段一次性完成，不逐项要求运营确认。

| 项目 | 通过标准 |
|---|---|
| 代码/发布 | 本地 HEAD、生产 release、关键文件 manifest 一致；迁移最新且可回滚 |
| 服务 | Web/API Worker active；旧自动开卡仍 disabled；不允许无主测试 Worker |
| 资金底数 | RUNNING task、ACTIVE/UNKNOWN recharge/funding、活动 Browser run/dispatch 均为 0，或对每个非零项先明确归属 |
| BitBrowser | Local API READY；只启用 1 个验收 Profile；本机代理单实例及真实 HTTPS 出口通过 |
| 数据库连接 | 本机 Worker 使用受控 SSH 隧道；断线可见，不会转为重付 |
| 卡源 | 明确本单选定 HNSKJ 还是某个备用卡台；不自动回退 |

## 3. 卡片验收标准

充值完成后不以卡台页面一个余额字段直接宣布可用，必须核对：

1. 卡归属与本次选定 Browser 卡台一致；
2. 卡状态 active、在当前快照中、无 `RETIRED/PRODUCT_ONLY` 覆盖；
3. 可用余额至少 `$18`，且当前卡资料完整、未过期；
4. 无活动 assignment、无 ACTIVE/UNKNOWN 充值或补款 attempt、消费次数未超上限；
5. HNSKJ 卡：由当前 Provider 读证据或明确的可用替代证据确认；
6. 手工备用卡：必须重新导出该卡台的全部卡片快照，预览后原子提交，不用口头余额覆盖旧快照。

## 4. 单笔真实验收流程

### A. 订单创建前

1. 把全局默认充值方式设为“浏览器自动化充值”，并读回生产实际值；
2. 把 Browser 当前卡台设为本次指定来源，默认不接管旧订单，读回 selection version 和审计事件；
3. 只启动单个验收 Profile，先做一次无 Session/无付款的 ChatGPT 访问检查；
4. 记录卡余额、卡消费次数、账本、异常队列、Bark 通知去重底数和订单计时起点。

### B. 客户端提交

1. 用新 CDK + 目标 Session 提交；
2. 确认弹层展示从 Session 解析得到的目标邮箱，且只在客户确认后建单；
3. 建单后输入框不残留上次 CDK/Session，客户能看到状态时间线；
4. 同一 CDK/同一请求重放不得创建第二张订单。

### C. 建单与冻结

数据库必须在同一建单事务中证明：

- `executor_kind=BROWSER`；
- 订单 `frozen_card_provider_account_id` 等于提交时的 Browser 当前卡台；
- 只有一个 `ASSIGN_CARD` 和一个 `BROWSER_PREFLIGHT` 任务；
- 创建后再切换全局卡台不会改写该订单冻结来源；本次不实际为了测试而乱切卡台，以数据库与既有生产切换证据交叉验证。

### D. 卡前前置检查

必须在不读取 PAN/CVC、不建立资金 attempt、不点击付款的前提下完成：

- Session 成功注入；
- email/user/account 三项身份摘要与订单一致；
- 账号当前为 FREE，不是已有 Plus；
- 进入本次新建 Plus Checkout，页面结构、付款表单和安全卡字段可识别；
- 此阶段允许页面初始显示 12% VAT，但必须记录初始币种/小计/税/总额，`submitCalls=0`。

### E. 分卡、地址与付款前强校验

1. 只从订单冻结卡台分配一张合格卡；分配、assignment 和 `RESERVED` 消费账本一致；
2. 建立唯一 Browser dispatch/run/recharge attempt，无重复 claim 或重复 attempt；
3. 短时解密卡资料，按卡→免税州账单地址→Session 邮箱的顺序填写；账单地址合同要求的姓名正常填写，页面上另行标明为可选的“法律姓名”和手机号保持空白；
4. 账单地址分配写入 `browser_billing_address_assignments`，同一绑定参考重放得到同一地址，新绑定尽量使用低复用地址；
5. 等待服务端重报价后，必须同时满足：
   - 币种为 `PHP`；
   - 税额不高于 `₱0.01`；
   - `total = subtotal + tax`，误差不超过 `₱0.01`；
   - 总额以页面实际重报价为准，**不把 `₱982.14` 写死**；本次必须记录实际小计、税额和总额；
   - 必须恰好一个可见、可用的 `button[type=submit]`。
6. 付款前再读一次订单、卡、账本、租约、permit 和报价快照；任一项变化则不点击。

### F. 唯一真实付款点

1. 先在 MySQL 提交唯一 payment intent 与短时 permit，再点击页面提交；
2. 付款 adapter 对本次 operation id 最多执行一次页面点击；
3. 明确拒绝：核实账号仍 FREE 且无扣款后，标记明确失败，不重付；
4. 结果未知：进入 `SUBMIT_UNKNOWN / VERIFYING_PAYMENT`，只做账号/Checkout/卡交易只读观察，同一 operation 不得再点击；
5. 若出现 3DS 或新式验证页，本单安全停在人工处理，不自动绕过；这可证明安全分支，但不算完整成功验收。

### G. 付款后交付收口

完整成功必须全部满足：

- 同一账号身份复核匹配，Plus 已激活；
- 进入订阅管理并确认已取消续费，不只是点击了取消按钮；
- Browser run=`COMPLETED`，recharge attempt=`SUCCESS/SETTLED`，order=`RECHARGE_SUCCESS`；
- 卡消费账本=`CONSUMED`，活动 assignment 已释放，卡余额/可再用次数按实际结算收敛；
- HNSKJ 路线后续读交易/余额；手工卡路线用 Browser 结果+本地账本先收口，下次完整快照校准；
- 路线化对账不使用旧 `cards.order_id` 或硬编码 ZZSHU，成功单不制造假“三方对账”异常；
- 客户页面最终显示成功和目标邮箱，且能看到提交/创建/处理/成功的历史时间；
- Bark 只发送真实需要的一次结果通知，不循环提醒“等待卡片”或已解决异常。

## 5. 一票否决条件

任一项出现即不允许点击付款：

- 不是 Browser 路线或订单冻结卡台不对；
- Session 身份未三重匹配、账号不是 FREE；
- 分配卡不属于冻结来源、余额不足、资料不完整或有未决资金状态；
- Checkout 不是 PHP、税额非零、金额算术不一致或提交按钮形态漂移；
- run/dispatch/attempt/permit/资源租约不唯一或已过期；
- 无法开启付款后真实结果观察和未知核实调度。

## 6. 证据包

验收完成后必须留下一份脱敏、可回放的证据包：

- 订单号、冻结 route/卡源、任务/run/attempt/dispatch 标识与时间线；
- 付款前后身份摘要和订阅状态；
- 初始报价与填写后报价（币种/小计/税/总额）；
- 付款 intent/permit/唯一 submit operation 的审计证据；
- Plus 激活、取消续费、卡账本、对账和客户状态证据；
- 每个阶段的用时，用于后续优化单笔时间和 1→3→6 Profile 放量。

证据中不保存完整 Session、PAN、CVC、API Key 或可重放的 Checkout 权限。

## 7. 整体通过标准

只有以下全部成立，才能宣布“Browser 首笔真实全链路已跑通”：

1. 客户只做 CDK + Session 提交和一次确认，无额外人工搬运数据；
2. 系统使用建单时冻结的 Browser 卡台，正确分卡和分配账单地址；
3. 最终报价为 PHP、零税、金额一致；
4. 对外付款点击恰好一次；
5. 同一目标账号 Plus 激活且续费取消确认；
6. 订单、attempt、run、卡消费账本、assignment、对账、客户状态和通知全部一致；
7. 未出现重复订单、重复付款、跨卡台错分、敏感信息日志泄漏或循环 Bark。

## 8. 本次不顺带验收的内容

为了避免用一单真实订单承担无意义风险，本次不验收：

- API 充值路线（已有历史实单，不浪费本次 Browser 样本）；
- 已停用的每分钟自动开卡；
- 3 或 6 Profile 并发容量（首单通过后分级验收）；
- 为测试而反复切换卡台或制造一笔第二次真实扣款；
- 与本单无关的后台视觉全量验收。

## 9. 执行顺序

1. 先修复第 1 节 P0 缺口，完成自动测试和单 Profile 非付款回归；
2. 使用单一 commit 构建候选 release，备份、部署并保持付款关闭；
3. 核对充值后卡的权威证据，并将选定卡源设为 Browser 当前卡台；
4. 运营者再提交新 CDK + Session，系统自动跑到付款前零税快照；
5. 统筹一次性汇报订单/身份/卡/报价/permit 证据，只就最终真实付款请求一次确认；
6. 点击后自动完成结果观察、Plus、取消续费、账本/对账/客户状态，最后关闭付款开关和单 Profile Worker；
7. 回写精确 release、订单时间线、通过/未通过项与下一阶段。
