# 项目决策账本

本文件记录用户已确认的业务原则、纠正、延期和正式变更。新上下文不得覆盖既有结论；改变结论必须说明新事实、原判断错误或用户偏好变化。

| ID | 决策 | 状态 | 依据/原因 |
| --- | --- | --- | --- |
| D-001 | v1 当前只做 ChatGPT Plus | 已确认 | 快速落地，产品扩展通过 `products` 预留 |
| D-002 | 卡同一时间最多绑定一个活动订单；完成并安全释放后可按 D-112/D-113 在容量内顺序服务其他订单 | 已被 D-112/D-113 修订 | 资金和退款仍逐单追踪，但不再把历史第一单绑定误作永久占用 |
| D-003 | MySQL 状态机和租约负责运行，AI不参与实时资金决策 | 已确认 | 重启恢复和确定性 |
| D-004 | 未知外部结果禁止自动重试 | 已确认 | 防止重复开卡、重复充值 |
| D-005 | 失败订单不把已兑换CDK退回可用 | 已确认 | 防止凭证重复使用 |
| D-006 | 卡不足提醒操作员；手动开卡是默认主流程 | 已被 D-029 替代 | 最新规则改为库存优先、人工补卡与受限自动补卡并存 |
| D-007 | 手动开卡后系统负责发现、隔离、校验和接管 | 已确认 | 支持批量且不逐张录入 |
| D-008 | 自动开卡保留为高级能力，本轮不继续扩展 | 已被 D-029 替代 | 最新规则已明确当前自动补卡参数和未来扩容方向 |
| D-009 | 充值确认保留资金闸门；支持单笔、批量，自动策略仅预留 | 已被 D-030 替代 | 保留资金栅栏，但取消正常订单逐单人工审批 |
| D-010 | 接单、准备/分卡、资金提交三个控制面分离 | 双Agent确认 | 防止批量确认扩大到未选订单 |
| D-011 | 供应商身份精确到供应商账户和环境 | 双Agent确认 | 支持换供应商、多账户和生产/测试隔离 |
| D-012 | 履约路线不可变并冻结到订单 | 双Agent确认 | 历史订单持续可查询，不受默认供应商切换影响 |
| D-013 | API和Browser共享充值尝试资金栅栏 | 双Agent确认 | 未知后禁止跨路线重付 |
| D-014 | 新发现卡先隔离，未经验证不得分配 | 双Agent确认 | 防止误导入历史卡或其他业务卡 |
| D-015 | 卡同步采用分层自动同步＋手动刷新 | 已确认 | 避免历史卡永久每小时请求 |
| D-016 | 退款仅识别提醒；确认与提取继续延期 | 已被 D-031 替代 | 最新规则不做自动退款识别或提醒，只保留原始证据和人工案件 |
| D-017 | 对账提前做最小运营账，不做完整会计 | 已确认 | 追踪CDK、卡、充值、余额和异常 |
| D-018 | 新卡台和充值供应商尚未确定，但顶层基础本轮完成 | 已被 D-038/D-039 替代 | Browser 主路线已确定为 HNSKJ 卡片来源 + ChatGPT Browser 执行器；ZZSHU 仅作旧系统兼容 |
| D-019 | 浏览器充值下一轮实现，本轮只预留执行器和隔离Worker边界 | 已被 D-038 替代 | Browser 已升级为未来 Plus 主执行链路，可立即进行设计、非付款 PoC 和仿真控制面，不再以 ZZSHU 主链稳定为前提 |
| D-020 | 不引入多租户、微服务、Redis、Kafka或完整会计 | 已确认 | 百单规模不需要 |
| D-021 | 最终方案必须固化；必要偏离先提交原因、影响和整改方案 | 已确认 | 防止长上下文导致范围漂移 |
| D-022 | 目标 ChatGPT 账号当前为 Plus 时禁止充值；Plus 是要购买的目标产品，目标账号必须不是当前 Plus 账号 | 已确认 | 2026-08-21 真实 ZZSHU 响应 `40030`：仅支持免费账号提交，当前账号套餐为 plus |
| D-023 | 不把“寻找支持 Plus 目标账号的 Provider”作为方向 | 已确认 | 上一版对抗式审查的建议与 D-022 冲突，已纠正 |
| D-024 | 真实单笔失败链路不等于正式成功链路已验收 | 已确认 | 2026-08-18 独立 Provider PoC 已成功开新卡、充值并取消续费；尚未验收的是正式 CDK→订单→Worker 成功闭环 |
| D-025 | 客户页面失败状态必须持续同步到终态；自动轮询不得在正常异步窗口内过早停止 | 已确认 | 本次真实链路超过 5 分钟，后端已失败但客户页未及时展示；已延长轮询到 30 分钟 |
| D-026 | 若卡台提供可用的既有卡余额充值 API，系统应优先复用该 API；接入前必须完成字段、权限、幂等和资金安全验收 | 已确认 | HNSKJ `POST /cards/{id}/recharge` 适配器和 `card_funding_attempts` 账本基础已实现并测试；真实执行、pending/unknown 对账和生产验证仍未完成 |
| D-027 | 原订单允许更换 Session，最多 3 次；更换窗口初始为 72 小时且可配置，不等同于 CDK 有效期 | 已确认 | 用户确认 Session 更换规则；仅限尚未产生充值资金影响前，过期后人工处理 |
| D-028 | 备用卡台先采用人工切换，不做自动故障转移；切换只影响新订单，旧订单保留原路线 | 已确认 | 用户明确要求；为未来容灾保留可替换适配层 |
| D-029 | 正常订单优先使用合格库存卡；库存不足时等待补卡并通知，人工补卡与受限自动补卡并存 | 已确认 | 当前自动参数：每次 1 张、每张 $16、每天最多 5 张；参数可配置并随规模提升 |
| D-030 | 已交付 CDK 代表客户已在系统外付款，兑换后自动履约；不逐单人工审批，但保留全局急停、单订单唯一资金尝试栅栏和未知结果锁定 | 已确认 | 满足即时履约和防止重复充值的双重要求 |
| D-031 | 退款当前只保留卡交易原始同步、可追溯字段和人工案件；不自动识别退款，不发送退款提醒，不自动提取 | 已确认 | 退款极少，避免投入过多自动化成本 |
| D-032 | 最终成功必须同时满足直充支付成功与 `is_subscription_cancelled=1`；支付成功但取消状态未知时进入等待/人工复核，禁止判失败或重付 | 已确认 | 完整交付包含取消自动续费 |
| D-033 | Session 可在原订单更换最多 3 次；72 小时窗口从第一次明确的客户可修复 Session/账号错误开始，库存或 Provider 等待不消耗时间和次数 | 已确认 | 客户体验与内部故障责任分离 |
| D-034 | CDK 只在对应客户已经付款后生成/交付，支持单个或一批已付款客户；必须记录生成、交付、补发、兑换和作废，不建立未付款预生成库存码 | 已确认 | “生成 CDK 即代表已付款”与批量管理同时成立 |
| D-035 | 卡片默认一单一卡、不得跨订单复用；特殊情况允许受控人工例外，系统不得自动复用 | 已被 D-112/D-113 替代 | 新规则允许在无活动分配、无资金未知/退款争议且未达全局容量时自动顺序复用；旧规则不再约束新订单 |
| D-036 | Browser 自动化现在单独窗口设计接口和异常边界，但不接生产；等 API 正式成功链路和阶段七灰度稳定后再开发联调 | 已被 D-038 修订 | 仍保持当前不接生产、不真实付款，但设计、非付款 PoC、仿真控制面和隔离联调不再依赖 ZZSHU API 成功链路 |
| D-037 | 后续实施顺序固定为追溯中心→Session/正确终态→自动履约→库存/补卡/recharge→后台统一操作中心→卡台人工切换→正式灰度→Browser与规模化 | Browser 部分已被 D-038 修订 | 共享订单、卡片和资金底座仍按既有阶段完善；Browser 设计、非付款 PoC 与仿真可独立并行，Browser 真实付款仍须单独确认和受控灰度 |
| D-038 | Browser 是未来 Plus 充值的主执行链路：HNSKJ 提供虚拟卡，隔离 Browser Worker 直接在 ChatGPT 官方页面购买 Plus并取消续费；它复用现有订单、卡片、资金栅栏、审计和后台 | 已确认 | 用户说明现有直充 API 可能很快不可用，目标是建立每天数百单且可独立运行的 Browser 自动充值能力 |
| D-039 | ZZSHU 不再作为 Browser 项目的依赖或投入方向；现有代码和历史数据仅作旧系统兼容，不要求当前删除 | 已确认 | 用户明确要求直接放弃 ZZSHU API，不在另一套系统上继续投入精力 |
| D-040 | Browser 项目的重大方向、运行事实、合同冻结、PoC、灰度和容量节点必须同步布盘到项目文档，不得只留在聊天上下文 | 已确认 | 保证其他窗口和模型能够从仓库单一事实源完整接收并继续实施 |
| D-041 | 新模型进入仓库时扮演架构与实施守护者，先按角色指南读取当前事实源；`v1/` 是共享业务核心，根目录 legacy Browser/Stripe/hCaptcha/代理默认是噪音和定点参考，不能整体恢复 | 已被 D-043 修订 | 噪音隔离仍有效，但“守护者”不足以表达用户要求的完整接班和继续实施职责 |
| D-042 | Browser 登录采用新的最小 Session Adapter：参考上号器的 Cookie 输入规则和 legacy 的分块/真实验证思路，但不安装扩展、不伪造 auth API、不补 Bearer、不以 Cookie 存在作为登录成功 | 已被 D-044 修订 | 真实证据门槛仍有效，但不应在未做跨地区 A/B PoC 前否定 auth overlay 和 Bearer 补丁的研究价值 |
| D-043 | 任何新模型进入仓库后都是当前项目接班执行者，必须从事实源、工作区和验证证据恢复上一模型停止点，并继续设计、编码、测试和交付；只有外部资金操作或会改变方案的缺失输入才需要再次询问 | 已确认 | 用户明确要求上一模型出问题时其他模型可以无缝接着干活，而不是只充当守护或审查角色 |
| D-044 | 菲律宾出口是 Browser 运行区域，不代表所有目标账号属于菲律宾；同一订单必须保持 sticky 菲律宾代理、locale/timezone/账单/币种显式记录。真实 Cookie、最小兼容层和 legacy auth overlay 通过非付款 A/B PoC 比较，overlay 即使改善页面导航也不能单独作为真实登录或付款证据 | 已确认 | 用户明确目标包含菲律宾周边及远距离账号；legacy 代码存在菲律宾浏览器画像、住宅代理和 session-sticky 设计，说明跨地区会话一致性必须先实证而非直接否定 |
| D-045 | Session A/B 的服务器事实必须来自绕过页面 route、`window.fetch` 和 localStorage 补丁的独立网络探针；legacy 精确 auth route 因后注册 `**/*` route 的 `continue()` 被越过，页面 auth 与服务器 auth 必须分别记录。三轮 Session、sticky 代理会话、实际出口 IP 或菲律宾国家验证不一致时禁止比较 | 已确认 | 2026-08-21 本地 Playwright route 顺序复现得到 `exactRouteCalls=0`、网络响应；无 Session 公开对照还证明 `/api/auth/session` HTTP 200 可以不含任何账号身份 |
| D-046 | Browser 充值的默认地域转换是“非菲律宾 Free 账号取得 Session → 菲律宾 sticky 出口执行”，目标账号基本不是菲律宾账号。实验主轴改为 Session 获取国家/距离与年龄，账号常用国家单独记录；单 Session Cookie 与完整 Cookie/device 材料作为第二实验轴，禁止把材料缺失误判为地域风控 | 已确认 | 用户纠正业务事实：获取 Session 的待充值 Free 账号基本不在菲律宾，只有充值执行阶段登录菲律宾 VPN |
| D-047 | 外部公开实现只作为实验线索：Cookie 材料采用 `SESSION_ONLY`/`CURATED`/`FULL_EXPORT` 三档；新增真实页面内 hosted Checkout discovery 和独立 `CHECKOUT_OBSERVATION_PERMIT`；Browser backend、Cookie policy、auth overlay、Checkout discovery 分别版本化。禁止采用超时自动换卡重提、URL 文字判成功和敏感支付 trace | 已确认 | 2026-08-21 核对多个 GitHub 源码、近期 issue 及官方 Playwright/Stripe 文档；公开实践相互矛盾且资金安全普遍弱于本项目，必须通过本项目菲律宾非付款 PoC 冻结 |
| D-048 | 风控判断的主要证据改为本项目可复现 A/B 和固定 commit 公开源码；官方底层文档只解释浏览器/支付状态语义，不用于推断 OpenAI 未公开风控。诺汇盛上号器只作为人工单 Cookie 注入参考，Browser Worker 必须清理冲突 Cookie、使用独立 Profile 并以独立网络身份验证取代 Cookie 存在徽标 | 已确认 | 用户指出官方不会披露内部风控；本轮复现 `zkky` 50 项测试发现 1 项发布配置失败，`Gpt-Agreement-Payment` 两种离线模式因缺失 `flows` 无法运行，上号器 10 项离线解析/权限测试通过但静态分析确认其没有真实身份验证 |
| D-049 | Session Loader v2 不猜测原始 Token 的 Cookie 家族，拒绝双 Session 家族输入；每轮使用临时 BrowserContext，注入前清理两组 Session Cookie，注入后验证最终集合；服务器身份按显式 `email`/`id` 类型与预期哈希比对，不一致、无法核对或同轮变化时禁止进入 Checkout；真实输入文件必须仓库外 `0600` | 已实现 | 2026-08-22 真实 Chromium Context 冲突清理测试通过，Browser/legacy 测试 26/26 通过，schema v2 无 Session 公开对照确认零预存 Cookie 且 HTTP 200 `WARNING_BANNER` 未被误判为登录 |
| D-050 | Browser 主链路跑通优先于维持现有 Provider 抽象、路线表结构、许可名称和后台页面不变；这些实现均可最小调整。硬不变量缩减为：单订单不得重复扣款、付款未知不得自动再付、账号→Checkout→卡片→扣款→开通/取消必须可审计 | 已确认 | 用户明确现有运营后台架构和资金栅栏实现可调整，只要 Browser 充值项目能完整跑通；调整不等于取消防重复扣款和未知结果锁定 |
| D-051 | “提链”升级为 Browser 主路径候选：账号 Context 创建 Checkout，优先提取完整 hosted 长链，再由同一菲律宾 sticky 出口下的独立支付 Context 打开；内部短链只作同账号 Context 回退。是否优于原上号器必须经同 Session、同出口、顺序非付款 A/B，不以 URL 生成或页面可打开判定成功 | 实验设计已被 D-054 修订，候选待真实 A/B 冻结 | hosted 候选仍有效；创建 Checkout 的比较改用隔离账号 cohort，同账号只做不创建 Checkout 的只读配对 |
| D-052 | Browser PoC 改为多赛道赛马：原上号器真实 Chrome、完整 Profile+CDP、Loader 同 Context UI、hosted 分离 Context、页面 Context 创建 hosted 分别隔离；共享输入、证据和淘汰合同，胜出 adapter 才接现有业务。Runtime、Session 材料和网络是实验轴，不为每种组合另建业务项目 | 已被 D-054/D-056/D-057 修订 | 赛道制仍有效；对抗式审查把完整 Profile 收敛为站点状态克隆、拆分只读/变更实验单位，并允许 Checkout 创建前的单一预验证 fallback |
| D-053 | 没有菲律宾出口时继续完成离线和非菲律宾功能筛选；普通菲律宾 VPN 只作为 PH/PHP 方向预筛，最终主路径必须在接近未来生产的菲律宾 sticky 出口下冻结。扩大 GitHub 调研只借成熟部件，不直接引入公开项目的自动验证码、地址生成、付款重试或云端 Session 上传 | 已确认 | 2026-08-22 扩大检查 17 个公开项目/上游并固定提交；Browser Cookie Bridge 37/37 离线测试通过，确认完整 Profile 迁移、lease、typed WAL、人工接管和 mock gateway 均有可复用实现思路 |
| D-054 | 多赛道实验拆为只读配对和 Checkout 变更 cohort：同账号只允许在不创建 Checkout 的 `AUTH_READ_ONLY` 中平衡顺序对照；任何 `CHECKOUT_MUTATING` lane 使用隔离账号 cohort，同一账号在同一实验窗口只进入一个变更 lane | 已确认 | 第一轮对抗式审查发现 Checkout 创建会改变账号/Session/风控状态，原“同 Session 顺序跑所有 lane”会产生不可逆顺序污染，不能作为公平 A/B |
| D-055 | 账号身份 HMAC、订单、卡片和 Checkout artifact 分别持有资源租约；Checkout 过期、打不开或页面漂移不等于确定失效，默认进入 `CHECKOUT_REVIEW_REQUIRED`，只有确定性失效证据和受控恢复授权才能在同一 attempt 重建 | 已确认 | 订单级资金栅栏无法阻止同账号跨订单并发；仅凭时间自动重建会制造多个可付款工件并扩大重复提交风险 |
| D-056 | 完整 hosted URL/fragment 是敏感支付工件，只能进入加密短期 artifact vault，普通数据库和证据只存 opaque ref 与哈希；`FULL_PROFILE_STATE` 改为 `CHATGPT_SITE_STATE_CLONE`，只读克隆 allowlist 内站点状态，不复制整个人 Profile | 已确认 | hosted authority 可能具备直接导航能力；完整 Profile 可能携带密码库、支付方式、其他站点状态和原地区残留，批量化会放大泄露和污染范围 |
| D-057 | 最终允许一个 champion 加最多一个独立验证的 fallback，但 fallback 只能在 Checkout 创建前按资格路由。付款许可覆盖 click、Enter、form submit、钱包和 3DS 最终确认；Checkout 或付款不确定后禁止切 lane 补付，人工接管必须原子转移控制所有权 | 已确认 | 真实环境可能不存在全体账号通吃的唯一 lane，但运行中换路会绕过唯一付款机会；按钮置灰不足以约束所有提交方式和人工/自动并发 |
| D-058 | 外部防封指南只吸收环境稳定、跨账号隔离、分阶段出口证明和变更后重验；指纹浏览器仅作为 `ANTIDETECT_LOCAL_PROFILE` runtime 候选，不成为当前依赖，不使用云 Profile/云同步/第三方 Session 托管，也不默认采用随机 Canvas、历史预热或硬件 ID 修改 | 待本地与 PH A/B 冻结 | 指南面向长期自有账号，与短时客户充值不同；指纹浏览器具备 Profile/代理/API 能力，但其自然度、ChatGPT 风控效果和敏感数据边界均未被本项目实证 |
| D-059 | B2 的恢复证据先采用本地 `0600` 追加式 JSONL WAL：事件带序列和哈希链、单写者锁并拒绝敏感权威；任何损坏或未知事件失败关闭，`PAYMENT_UNKNOWN` 重启后固定为 `RECONCILE_ONLY`，不得创建新 Checkout 或再次付款。该 WAL 是离线合同实现，后续仍由 MySQL 确定性状态机承担正式运行决策 | 已实现（离线） | 2026-08-22 完成重启、截断、篡改、乱序、重复事件、并发写和敏感字段测试；本地 Playwright iframe 仿真同时证明断连未知只消费一次提交，Browser PoC 63/63 通过 |
| D-060 | B2 可变操作统一采用 WAL intent/commit 边界；付款在任何 gateway 调用前必须持久化 `PAYMENT_SUBMITTING`。intent 后崩溃一律保守锁定，同一 operation ID 的重复投递只能返回既有恢复状态，不能再次执行外部动作；人工接管状态不确定时自动与人工双方都停手 | 已实现（离线） | 50 轮随机崩溃/1–5 次重复投递性质测试、真实子进程退出、租约过期和接管中断测试通过；350 单等效仿真为 350 submit、0 duplicate，Browser PoC 77/77 通过 |
| D-061 | 第一轮容量门槛采用“350 个合成订单的 24 小时等效负载”，不冒充连续 24 小时 soak；必须同时记录 submit 次数、重复次数、WAL 事件/体积、终态分布与耗时。通过后仍需补并发队列和连续 soak | 已实现（第一轮等效仿真） | 2026-08-22：350 单、350 submit、0 duplicate、3710 events、1,991,456 bytes、38.14 秒、9.18 单/秒；210 delivery complete、70 safe decline、70 payment unknown，全部恢复均禁止重付 |
| D-062 | Browser 下一主工程节点不因市场调研调整：依次完成 MySQL 事务映射及现有订单/Provider route/资金 attempt 接口、artifact vault/资源租约跨进程恢复、后台追溯/人工恢复接口、并发队列和连续 24 小时 soak。提链源码审查是非阻塞研究旁路；菲律宾 CDK 默认归入现有 CDK-API/Provider 路线，不另建系统，实际上游同源性待证据确认 | 已确认 | 用户指出市场研究顺序不能覆盖既定工程节点，并纠正菲律宾 CDK 应与主项目 CDK-API 充值按同一业务路线理解 |
| D-063 | Browser MySQL 映射复用现有 `recharge_attempts` 资金账：页面动作不写成 `provider_calls`；permit 消费、幂等 operation、`PAYMENT_SUBMITTING` checkpoint、run 和 attempt 状态在单一事务提交。首次 operation 才返回外部动作授权，重放返回禁止执行；未知结果同事务锁定 run/attempt/order 并建立对账案件 | 已实现（B2 MySQL v1） | 027 增量迁移、Repository、11 项定向测试、v1 全量测试、Docker MySQL 8.4 DDL 重放和真实 Repository 集成通过；生产 profile、派发和付款写开关均保持关闭 |
| D-064 | Browser hosted authority 使用独立 AES-256-GCM key ring 加密分表保存，资源 HMAC 使用另一把密钥；自动 Worker 必须同时持有账号、订单、卡片和已有 Checkout artifact 租约。只有 run 与全部资源租约过期且付款仍在安全前置状态时才能由新 owner 接管并恢复同一 artifact；过期只进入 review，付款提交/未知后只能对账 | 已实现（B2 恢复 v1） | 028 增量迁移、跨进程 Repository、全量 349 项测试及 Docker MySQL 8.4 两个集成场景通过；销毁会物理清零密文材料，生产派发/付款仍关闭 |
| D-065 | Browser 后台只返回脱敏运行元数据，不返回 authority、密文引用、lease token/hash 或资源 HMAC；人工接管按 REQUESTED→FROZEN→TRANSFERRED→RELEASED 转移同一 run。安全恢复必须明确确认未发生任何付款动作且不存在提交 operation；人工付款结果未知时同事务锁定 run/attempt/order 并进入对账 | 已实现（B2 后台 v1） | 现有后台新增 Browser 队列/详情/控制，API 要求登录、Origin、step-up、确认词和幂等 operation；31 项定向测试及 Docker MySQL 8.4 完整转移/未知锁账通过 |
| D-066 | 第二轮对抗审查判定 Browser 控制面方向正确，但在 Browser attempt/dispatch、付款后 Plus 激活/取消闭环、真实 BrowserContext 和并发 soak 四个 P0 闸门关闭前，不得宣称批量 Worker 或每日数百单已验证；审查另列 9 个 P1，详见 `docs/2026-08-22_browser-control-plane-adversarial-review-report.md` | 待用户确认 | 本条是审查结论和实施闸门，不改变现有资金边界；确认后按 P0→并发 soak→Worker 顺序推进 |
| D-067 | 当前无法从公开资料可靠估计“客户账号因充值被封控”的百分比；在获得分层 cohort 分母前，封控风险按未知且可能高度分层处理。最高原则转为可停止闸门：未知支付、跨账号共享运行环境、异常跨国切换、自动换卡/换 lane 均不得继续；单个无法解释的停用冻结相关 lane，两例相关事件冻结 lane+runtime/profile 组合 | 待用户确认 | 公开资料只说明可疑活动/安全风险可能导致临时暂停或停用，没有本业务组合的分母和误报率；详见对抗审查报告“关于客户账号因充值被封控的概率” |
| D-068 | Browser attempt 复用现有唯一 `recharge_attempts` 资金账；Browser route 可不绑定 Provider account、不得伪造 `provider_calls.create_direct`。付款确认不是最终成功，必须依次落盘 Plus 激活和取消确认；两者齐全后才可清算 attempt 并进入 `RECHARGE_SUCCESS` | 已实现 v1，待真实页面观察接入 | 031 增量迁移、Browser repository/recharge attempt repository、定向测试和合同已落盘；真实 BrowserContext/Session/Checkout 仍禁止付款，仅待非付款观察器接入 |
| D-069 | Browser `SUBMIT_RECHARGE` 在 Browser route 下只创建/复用 durable dispatch job，不调用 ZZSHU；job 仅保存订单、attempt、profile 引用，使用数据库短租约、幂等 key 和 `SKIP LOCKED` claim。真实 Worker 必须在每个页面动作前验证 lease，租约丢失立即停手 | 已实现 queue/lease v1，待真实 Worker 接入 | 032 增量迁移、dispatch repository、workflow handler 分支和 41 项定向测试通过；未启动真实 BrowserContext 或付款 |
| D-070 | 隔离 Worker control shell 在 claim 后先绑定 Browser run；每个 runtime action 前必须 heartbeat dispatch lease 并读取 run recovery state。lease 丢失、RECONCILE_ONLY、终态或控制权变化时，禁止调用浏览器 runtime | 已实现 control shell v1，待 Worker 进程循环接入 | `browser-worker-service.js` 与 3 项故障测试通过；当前只允许 mock/local runtime，不装载真实 Session、不创建 Checkout |
| D-071 | Browser Worker iteration 只负责 durable job 的 claim、control shell 绑定和受控 execute callback；无 job 返回 IDLE，execute 失败立即停止 control shell，租约等待过期恢复。不得在 loop 层自动重付、换卡或切 lane | 已实现 iteration v1，待独立进程入口接入 | `browser-worker-loop.js` 与 3 项 mock 测试通过；尚未接主 worker 进程或真实 Browser runtime |
| D-072 | Worker process wrapper 阶段性审查通过控制面方向，但进入真实非付款 BrowserContext 前必须补长动作 lease watchdog、受控 identity/profile/network resolver、独立进程 SIGTERM/崩溃重启 smoke；真实 BrowserContext 阶段需用户当次确认 | 待用户确认；mock 补强和子进程 smoke 已完成 | 审查报告见 `docs/2026-08-22_browser-worker-process-adversarial-review-report.md`；真实付款和生产 Worker 仍禁止 |
| D-073 | 进入真实非付款 BrowserContext 前的方向偏移审查通过：未绕开订单/资金栅栏、未伪造 Provider、未提前选 champion、未把观察偷换成付款，也未把防封控扩展成不可验证的指纹伪装。观察只验证 Session/身份/页面/Checkout 只读事实，真实付款和容量/封控率结论仍禁止 | 已通过；沿用用户本次确认 | 报告见 `docs/2026-08-22_browser-direction-drift-adversarial-review-report.md`；观察结束后必须再次做 cohort 级对抗审查 |
| D-074 | 当前先冻结 `NON_PH_FUNCTIONAL` 基线；菲律宾 IP/代理到位后必须新增独立 `PH_GENERIC` 或 `PH_STICKY_PRODUCTION_LIKE` manifest 与新 cohort，记录出口证明、runtime/profile/network 哈希，不覆盖或混并非 PH 结果 | 已确认 | 用户目前没有菲律宾出口；该输入到位后再开展菲律宾区域验证，不能用普通网络结果替代 |
| D-075 | 当前 `NON_PH_FUNCTIONAL` manifest 固定为 Playwright 本地 Chromium、临时 BrowserContext、`SESSION_ONLY`、无代理、`AUTH_READ_ONLY`；该 manifest 明确禁止 Checkout 创建、付款写入和菲律宾/付款晋级，网络改变必须新建 manifest/cohort | 已实现 | `browser-poc/manifests/non-ph-functional-baseline-2026-08-22.json` 与 manifest 测试落盘；仅作为非 PH 功能基线，不代表真实菲律宾风险或容量 |
| D-076 | 测试 Session 采用仓库外 `0600` 本地文件与一次性整理/校验脚本；只读首个 JSON、要求显式 `sessionCookieName`、敏感字段仅在内存中流转，日志只输出脱敏摘要，不直接粘贴聊天或把密文与密钥分开传递 | 已确认 | 对抗式审查见 `docs/2026-08-22_session-intake-adversarial-review.md`；当前附件因缺少 `sessionCookieName` 暂不能加载，未启动 BrowserContext |
| D-077 | 将 Session 整理器升级为通用 `secure-inbox`：仓库外 AES-256-GCM 密文、macOS Keychain 密钥、`add/list/materialize/purge` 四个最小命令；通用层不解释业务、不输出原文，Session/卡台/证据由适配器按需读取 | 仅有本机原型，未进入主线 | 原型源码目前只存在旧工作树的未跟踪文件中，主线不可重建；它不是当前 Browser 履约依赖。旧工作树在完成取舍前禁止清理。 |
| D-078 | 暂不把 `secure-inbox` 与 Browser Session 适配器绑定；Session 是按客户订单产生的临时履约材料，不是通用工具的业务核心。先保持通用安全收件独立，待 Browser 订单履约联调前再实现内存适配器 | 已确认 | 可降低当前范围和耦合；未来仍必须在进入订单执行前补 Session 字段校验、Cookie 家族确认和临时 Context 生命周期控制 |
| D-079 | `secure-inbox` 的用户界面收敛为单入口拖拽：文件拖到 `tools/secure-inbox-drop.command`，自动加密并只显示编号；`list/materialize/purge` 仅保留内部调试，不作为日常操作 | 仅有本机原型，未进入主线 | 主线缺少入口源码；不再把本机文件表述为项目已交付能力。 |
| D-080 | 用户入口进一步收敛为桌面弹窗直接粘贴：双击 `~/Desktop/安全收件箱.command`，粘贴内容并点击保存，工具加密后只弹出编号；拖拽仍作为文件输入的备用方式 | 仅有本机原型，非项目交付 | 桌面产物不属于可重建主线，当前 Browser 测试直接复用订单 Session 链路。 |
| D-081 | 正式用户入口升级为 macOS 菜单栏原生 App：点击顶部 `🔐` 图标打开多行 NSTextView，原样传递粘贴内容到本地加密核心；桌面 `.command` 保留为备用入口 | 仅有本机原型，未进入主线 | `tools/SecureInboxMenuBar.swift` 当前不在主线；旧工作树原型先保护，不作为 Browser 当前阻塞。 |
| D-082 | 通过同一 Session 的只读 A/B 实测确定 Cookie 家族：采用 `__Secure-next-auth.session-token`，拒绝 `__Secure-authjs.session-token`。next-auth 独立 `/api/auth/session` 返回用户与 accessToken；authjs 仅返回 `WARNING_BANNER` | 已验证 | 2026-08-22 临时 Chromium Context、无卡、无 Checkout、无付款；两种 Cookie 的服务器响应出现明确差异，页面 403/挑战页另行记录，不覆盖 Cookie 家族结论 |
| D-083 | NON_PH_FUNCTIONAL 观察只通过“服务器身份确认”窄目标；页面 403/挑战页使页面登录和 Checkout 观察保持阻塞，禁止将其解释为账号封控、PH 风控、付款成功或容量证据 | 已验证 | 对抗审查见 `docs/2026-08-22_nonph-observation-adversarial-review.md`；下一网络/PH cohort 必须新建 manifest，不覆盖当前结果 |
| D-084 | Browser Worker 并发先采用离线 Harness 验证控制壳：8 个异步 Worker 交错领取 240 个合成 dispatch job，重复执行必须为 0；该结果不替代 MySQL 多连接、独立进程、长租约或连续 24 小时 soak | 已验证（离线 Harness） | `docs/2026-08-22_browser-worker-concurrency-harness-report.md`；v1 全量 363 pass/34 skipped/0 fail，下一项补真实并发连接和 bounded soak |
| D-085 | 隔离 MySQL Browser 目标测试先行通过后再推进压力：dispatch、payment mapping、artifact vault/lease recovery 共 9 项通过；全量数据库测试出现 1 个既有补卡日限额异常，不能归因 Browser 或宣称全量全绿 | 已验证 | `docs/2026-08-22_browser-mysql-concurrency-stage-report.md`；下一项仍是多连接 claim/lease 压力和 bounded soak |
| D-086 | 隔离 MySQL 单 job claim race 通过：8 个独立连接同时 claim 同一 Browser dispatch job，只允许 1 个 worker 成功，重复 claim 为 0；该结果不替代多 job/续租/接管/soak | 已验证 | `docs/2026-08-22_browser-mysql-claim-race-report.md`；使用真实 `FOR UPDATE SKIP LOCKED` 路径，测试数据已清理 |
| D-087 | 隔离 MySQL 多 job/lease 验证通过：24 job、8 worker、24 unique claims、0 duplicate；合法 heartbeat 延长租约，过期后新 worker 成功接管 | 已验证（bounded） | `docs/2026-08-22_browser-mysql-multijob-lease-report.md`；不替代连续 24 小时 soak、数据库重启和长时间连接压力 |
| D-088 | Browser MySQL bounded soak 通过：20 轮持续到达、400 job、8 worker、400 claims、0 missing、0 duplicate、80 heartbeat；仍不替代独立进程/数据库重启和连续 24h soak | 已验证（bounded） | `docs/2026-08-22_browser-mysql-bounded-soak-report.md`；测试数据已清理，付款保持关闭 |
| D-104 | API 充值路径不增加独立账号预检；由充值 API 的权威响应判断资格。明确的 40030/账号不可充值属于充值前拒绝：保留审计、清除本地资金风险、订单回到 Session 可恢复状态，不删除账本、不重试、不换卡；只有外部结果未知时才进入 UNKNOWN 并禁止回退重付。 | 已确认 | 原误编号为第二条 D-069；2026-08-28 更正为 D-104。用户明确说明 API 本身就是充值动作，执行时发现账号问题即可回退；独立预检可能增加风控和重复访问风险 |
| D-089 | Plus 卡台路线在运营后台提供人工切换入口。切换只影响新订单，既有订单继续使用创建时冻结的路线；切换前要求目标路线只读检查开启、熔断关闭且不在重试窗口，并记录确认词、操作者和原因。暂不做自动故障切换。 | 已实现并部署 | 036 迁移、后台服务/API 和“卡台路线”视图已在当前生产 release；本次封账未执行路线切换 |
| D-090 | Browser 设计优先保证链路跑通、顺畅、稳定，其次保证资金安全；敏感信息采用够用保护，不为绝对隔离增加复杂系统。Browser 执行时可使用必要的完整卡资料和 Session，但普通日志、WAL、截图、录像和客户页面不记录原文。Browser 开始前必须原子建立唯一 attempt 并锁定订单/卡片；订单使用 `RECHARGE_PROCESSING` 表示正在处理，只有真正付款提交时才使用 `browser_run.payment_state=PAYMENT_SUBMITTING`。`RECONCILIATION_REQUIRED` 只核对不重付。 | 已确认；共享核心已实现并通过隔离 MySQL 验证，Browser adapter 待接线 | 用户 2026-08-26 确认：唯一资金记录和锁必要，但不应把尚未点击付款的 Browser 阶段提前表达为 `SUBMITTING`；正式合同及实现证据见 `docs/contracts/2026-08-26_browser-upstream-runtime-contract.md` |
| D-092 | 卡片库存同步采用 fail-closed：缺失 cardTypeId 只允许 Provider 快照唯一精确名称映射；历史 discovery 不自动重建；详情读取最多 3 次；AVAILABLE 每 10 分钟同步；低库存 Bark 同一 OPEN 事件只推一次，解除后重开才推送。 | 已实现、已部署并只读验证 | 生产只读合同、卡目录与一致性审计通过；当前 Provider 19/本地 6，critical/warning 均为 0；合同见 `docs/contracts/2026-08-27_card-inventory-sync-contract.md` |
| D-091 | API 真实订单完成后，Browser 工作线解除临时暂停。Browser 立即继续非付款工作（Worker、任务领取/租约/心跳/恢复、状态流转、dry-run、仿真、审计和只读合同）；卡片库存同步专项并行修复。卡片同步修复完成后再做 Browser readiness 只读交叉验证和非付款端到端 dry-run；真实 Browser 付款必须最后单独确认。 | 已确认 | 用户 2026-08-27 同意该顺序；API 订单 `PJV1-FqFnMiSKBtLGN14GyP7W` 已完成，Browser 不因 API 成功自动开启真实付款 |
| D-093 | 当前确认可用的卡片（尾号 6807、4744）只是当前运营事实，不构成永久卡片白名单；未来新开卡仍须经过统一发现、验证、同步和运营接管流程后，按实时证据决定是否进入可分配库存。不得把卡号写死在代码或规则中。 | 已确认 | 用户 2026-08-27 澄清：当前可用不等于未来只能使用这两张卡 |
| D-094 | 从“一卡一充”扩展为“一卡多充”：同一卡可顺序承载多个 Plus 订单。账本记录卡、订单、attempt、产品、金额、Provider 交易 ID 和状态，Provider 交易同步只作确认/补账证据。 | 已部署生产，待连续真实订单验收 | migration 043 新增订单侧关联并保留旧 `cards.order_id` 兼容指针；隔离 MySQL 已证明同一卡连续两单与达到上限停止分配 |
| D-095 | 每张卡默认最多成功支付 3 次，后台可在 1–4 间调整；分卡时事务内预留，付款确认后消费，明确未提交才释放，UNKNOWN/付款后失败保留占用。Provider `PURCHASE/SUCCESS` 只作确认和补账证据，注资/余额转出不计入。 | 已部署生产；当前生产值为 3，待连续真实订单验收 | API/Browser 共用消费账本容量门禁；后台设置只约束后续分配，不触发 Provider 调用 |
| D-096 | 新开卡默认采用 Provider 卡类型 ID `16`（`VISA-40024200`）。该选择是发卡规格，不绑定 Plus/Claude 等产品；一张卡可服务不同产品。 | 已确认并已更新生产设置 | 用户 2026-08-28 明确选择 `16`；生产 `default_card_type_id` 已由 `1` 更新为 `16`，接单/派发和所有 Provider 写开关仍关闭 |
| D-097 | Provider 卡类型 ID（如 `16`、`17`）不是永久稳定值，不得写死为永久白名单。每次目录同步发现新 ID 或属性变化时，先保存目录和费用快照并标记待确认；只有运营确认后才能设为默认/可用发卡类型。未知或映射不明确的类型继续 fail-closed，进入 `REVIEW_REQUIRED`。 | 已确认 | 2026-08-28 讨论确认；资金安全优先于自动扩展 |
| D-098 | 卡段采用“人工刷新目录 + 持久选择默认卡段”模式：运营点击刷新时读取并展示当前 Provider 卡段及费用；运营手动选择一个卡段后，后续开卡长期使用该选择，不要求每单选择。运营需要更换时再次调整即可。取消无意义的高频自动目录读取，降低 API 次数；新卡段仍先进入待确认，不会因刷新自动启用。 | 已实现并部署 | 2026-08-29 已部署卡段人工刷新与默认卡段持久保存，生产当前默认 `VISA-40024200`。 |
| D-099 | 库存评估提案：余额不足代表待补资金，不等于卡坏；资料未抓取到代表待刷新/读取失败，不等于卡不稳定。将卡片健康、资金准备、资料状态分开记录，最终再计算是否可分配；仅 Provider 明确终态或多次确认失败才判定不可用。 | 提案，待确认 | 2026-08-28 用户指出现有“不可分配”表述可能误导；详细评估见 `docs/INVENTORY_MINIMAL_MODEL_EVALUATION_2026-08-28.md` |
| D-100 | 库存数据按“先盘点、再停用展示、再软停用运行状态、最后才评估极少量物理清理”处理。真实卡、订单、交易、退款和审计证据不删除；低价值指标移到详情页。消费计数基础完成后再做盘点和清理。 | 已确认方向，待实施 | 2026-08-28 用户同意可删除/停用一批并要求规划；详细计划见 `docs/INVENTORY_REFACTOR_EVALUATION_DETAILED_2026-08-28.md` |
| D-101 | Provider 卡 `493`（尾号 `8590`）已确认：2026-08-18 曾用于一个 Plus 充值；因卡台更换服务器，该卡此后永久不可用。该卡作为历史已消费、永久停用卡保留追溯，永不进入可分配库存；在本地订单/Provider 交易主键证据补齐前，不自动回填消费账本，不删除历史记录。 | 已落地 `RETIRED`，历史账本仍不自动回填 | 生产运营覆盖已写入并回读；Provider 交易证据见 `docs/CARD_CONSUMPTION_PRODUCTION_AUDIT_2026-08-28.md` |
| D-102 | 当前卡片运营事实：尾号 `6807` 是当前可用于充值的卡；尾号 `4744` 虽可用但已专门用于 Claude，不再安排其他套餐。除这两张外的现有卡（包括尾号 `8590`）均因同一批卡台服务器更换而永久不可用、永不进入可分配库存。未来新开卡不受此历史批次结论影响，仍须按实时 Provider 证据重新判定；不得把 `6807/4744` 写成永久卡号白名单。 | 已在生产完整落地 | `4744/1065=PRODUCT_ONLY(claude)`，其余当前旧批次 17 张卡均 `RETIRED`；`6807/1477` 不设覆盖，仍受原有资格约束 |
| D-103 | 本项目是个人内部使用系统，优先保证链路跑通、操作顺畅、稳定和资金安全；不为“理论上更强的敏感信息隔离”引入过度复杂的架构。继续保留必要的密钥/日志最小保护，但卡片运营策略采用最小实现：优先在 `cards` 上增加少量明确字段（如 `allocation_policy`、原因和时间），不新增独立策略服务或复杂批次系统，除非实际需求证明必要。 | 已确认 | 用户 2026-08-28 再次强调系统纯自用、避免庞大化；与 D-090 一致。 |
| D-105 | 运营后台只提供一个全局“默认充值方式”入口，在 `API 充值` 与 `Browser 充值` 之间人工切换；不提供逐订单路线覆盖，也不要求运营每单选择。切换只影响切换后新创建的订单；订单创建时即冻结路线，既有订单不得被后台改线，付款结果未知时更禁止切换执行器。当前默认 API，Browser 完成生产灰度后可长期切为 Browser。 | 已实现并部署 | `f95e6bb` 复用现有 `fulfillment_routes`/executor profile，实现中文全局入口、Browser 专用 dispatch/heartbeat readiness、route-aware 领取、attempt+job 原子写入；生产安全窗口已验证 Worker 心跳门禁、默认路由切换和新订单 Browser 路线冻结。 |
| D-106 | 自动补卡采用最小规则：当可分配 Plus 卡为 0 时自动开 1 张 `$16` 卡；每日最多 5 张；使用当前默认卡段；不要求每单人工确认。阈值设为 0，避免还有可分配卡时提前开卡。只有真实订单需求或实际开卡任务存在时才读取/复核 Provider 规则与余额；空闲 timer 只查本地数据库。 | 已确认并启用；空闲读取修复待部署 | 用户 2026-08-30 明确“没卡就自动补卡”，并反复确认尽量减少按次 Provider API 调用。生产当前仍在 `NO_DEMAND` 时每 60 秒刷新 Provider；主线候选已修复。 |
| D-107 | 自动补卡不以 10 秒轮询作为最终方案。客户提交订单时应立即触发资源检查/补卡；定时器只作故障兜底，改为 60–120 秒，并且无 `WAITING_FOR_CARD` 订单时不触发 Provider 检查。 | 自动开卡已部署；余额补给候选已实现 | 自动开卡已改为订单驱动、60 秒兜底；自动补余额候选以 5 秒数据库任务领取实现快速响应，空闲时不调用 Provider。 |
| D-108 | 履约时限与资源决策：API 正常目标控制在 2 分钟内，Browser 正常目标控制在 5 分钟内。超出目标时不自动转人工，也不伪造失败；只要仍有可执行路径就继续运行并显示处理中，只有明确无法继续（资源不可得、确定性失败或资金状态无法安全判断）才转人工。资源优先级：存在合格但余额不足的卡时，先自动补足至订单最低余额；没有合格卡时，直接开一张已带 `$16` 余额的新卡。永久停用、产品专用或不符合资格的卡不算“有卡”。 | 已部署并开启资源补给，待首笔真实补余额和时延验收 | 自动开卡已部署；自动补余额候选已完成订单驱动、幂等、UNKNOWN 锁定、完成后恢复分配与取消订单清理。 |

## 变更流程

任何偏离必须新增一条决策，至少包含：

- 新事实或原方案问题；
- 涉及的不变量、数据和资金风险；
- 备选方案；
- 推荐结论；
- 是否需要用户确认；
- 迁移、回滚和验收影响。

技术内部重构若不改变外部行为可以直接执行，但仍需在提交中引用相关验收编号。

| D-109 | 付款前权威门槛必须同时要求卡资料同步与卡交易证据同步均在 15 分钟内；交易证据过期时只读排队同步并重试，不得继续付款、换卡或重付 | 已实现并部署 | 2026-08-31 代码审查发现分配与付款前门槛错配；修复与定向回归见 `docs/2026-08-31_payment-preflight-transaction-evidence-fix.md` |

| D-110 | 当前工作线命名为“AI充值业务｜运营控制面收敛与自动补给”；自动补余额生产级闭环优先于后台入口收敛，但必须经过幂等、未知结果、对账和受控验证，不得由开始营业隐式打开资金写权限 | 控制面与自动补余额均已部署；补余额空闲验证通过，待首笔真实验收 | 2026-08-31 用户同意加速推进；入口见 `docs/ACTIVE_WORKSTREAM.md` |

| D-111 | 自动补余额允许同一卡片多次发生：SETTLED 仅表示上一笔补余额已结算并保留历史证据，不继续占用资金栅栏；只有 PREPARED、ACTIVE、UNKNOWN 阻止新的补余额任务。每次新的低余额事件使用新的幂等键和独立 attempt，仍禁止 ACTIVE/UNKNOWN 并发或未知后重付。 | 已部署并开启生产，待首笔真实补余额验收 | migration 042 已在空库执行；隔离 MySQL 已证明 SETTLED 后可创建精确金额的新 attempt，PREPARED 仍阻止重复任务 |

| D-112 | “每张卡最多成功充值次数”必须与跨订单复用一起落地：同一卡的第 1/2/3/4 次成功充值分别对应不同订单。不能只增加一个计数设置而继续用 `cards.order_id` 的单订单绑定限制，否则设置没有实际业务意义。第一版仍采用全局 1–4 次上限，不做单卡例外；以消费账本作为跨订单容量判断的权威来源。 | 已部署生产，待连续真实订单证明计数与释放 | migration 043、订单侧关联、分配时容量预留及后台设置已完成；同一卡两单成功、第三单达到上限停止的场景通过。 |

| D-113 | 次数上限、跨订单复用和自动补余额作为同一业务版本验收；实现上先改卡片—订单关联与容量门禁，再接入订单驱动/定时兜底补余额，最后一次候选发布。新规则立即约束未来分配，不改写既有订单历史；不提供单卡例外，保持全局 1–4 次。 | 已部署并开启自动补余额，待真实联合验收 | 迁移 001–043、隔离 MySQL 核心场景及 v1 全量串行回归通过；生产自动补余额已按用户确认开启，空闲零 Provider 充值调用 |

| D-114 | 自动补余额采用订单驱动而不是全库存预充值：`card_balance_recharge_enabled` 统一表示生产补余额能力；关闭时订单不创建资金 attempt、runner 不执行；开启后只有真实订单遇到一张合格低余额卡才创建精确差额 attempt。funding timer 每 5 秒只查数据库并领取任务，空闲零 Provider 调用；PENDING 对账每 15 秒先读一次余额，只有余额达到目标时再读交易。普通部署保留独立 systemd 门禁关闭。 | 候选 `95ee5ad` 已部署并在用户确认后开启生产；空闲零写调用验证通过，待首笔真实补余额验收 | 这是对“自动补余额一起做”和“尽量减少 API 次数”的统一落实；移除了无订单时扫描并预充所有低余额卡的旧 scheduler。 |


| D-115 | 建立 `docs/PROJECT_MAP.md` 作为整个项目唯一规划地图，同时覆盖总体目标、全部工作线、当前主阶段、状态、唯一执行顺序和退出条件。旧 ROADMAP/MASTER 计划继续保留历史证据，但不再独立推导下一步；生产事实仍由 `CURRENT_STATE.md` 负责。重大方向、阶段、生产状态或优先级变化时，地图与 CURRENT_STATE/DECISIONS/HANDOFF 同批更新。 | 已落盘并设为新窗口首读入口 | 用户要求防止多轮规划分散、遗忘和跑偏；`CLAUDE.md`、接班阅读指南、ACTIVE_WORKSTREAM、ROADMAP 和旧 MASTER 计划均已指向或声明地图优先级。 |

| D-116 | “开始营业”和只读 readiness 必须同时验证所选默认路线的真实执行能力，不能只看 Worker 心跳。默认 API 时，Worker 必须主动上报 `PROVIDER_RECHARGE_WRITES_ENABLED` 能力；权限关闭时后台明确阻断开始营业，生产体检报告 `api_recharge_execution_disabled`。这只暴露真实状态，不由 Web 后台隐式打开资金权限。 | 已实现并部署 | 2026-08-31 部署后 Worker 能力心跳为 true，readiness `ok=true/blockers=[]`。 |

| D-117 | 内部提醒只展示需要运营采取动作的 warning/critical。卡台余额变化继续发 Bark 并保留审计，但 info 历史不占后台提醒；订单等待卡提醒必须绑定订单并随取消/终态关闭；自动补给已开启时，低库存由系统按订单恢复，不再发送要求人工处理的低库存提醒。 | 已实现并部署 | migration 044 已关闭历史陈旧等待卡/低库存提醒；余额 info 证据继续保留。 |
| D-118 | 默认 API 路线长期开放 Worker 的最小真实充值权限：只设 `PROVIDER_RECHARGE_WRITES_ENABLED=true`；`PROVIDER_WRITES_ENABLED=false`、`PROVIDER_CARD_WRITES_ENABLED=false` 和 Browser 付款门禁继续独立关闭。 | 已确认并部署 | 用户在本次候选部署前明确确认；生产以独立 systemd drop-in 落地，Worker 进程环境和心跳已复核。 |

| D-119 | 2026-09-07 接班基线（用户确认）：系统目标是简单、稳定、好用；运营者只做五个决定（接单/路线/卡台/能否付钱/能否开卡补钱）、三件日常（发 CDK/处理订单/管卡片）；后台 9 页收成 5 页；密码与手打确认词全部取消；不设人为限速，不为未出现的风控加闸门。改动可以大，交接不能断：入口文件与地图始终反映当前事实，搬移改名留旧→新索引，保留回滚点。 | 进行中，见 `docs/PROJECT_MAP.md` §5 |
| D-120 | CDK 是付过钱的凭证：下单时绑定（REDEEMED），未付款终态（RECHARGE_FAILED/CLOSED）自动退回 AVAILABLE；任何付款证据（资金 UNKNOWN/SETTLED、账本 CONSUMED/RECONCILIATION、PAYMENT_SUBMIT）都不退回；同码同账号在原单进行中再提交返回原单；Session 重贴不限次数不限时间。 | 已实现并部署 `44b00cd`，生产订单未验证 |
| D-121 | Browser 结账创建由页面自身点击触发，不裸调 `backend-api/payments/checkout`（裸调缺页面签名头，Plus 返回「unusual activity」；实测页面点击同一请求体 200）。custom 模式无结账 URL，付款靠页面内嵌 Stripe（`client_secret`）。 | 已实测，规格 §5 步骤 2 |
| D-122 | 常驻身份策略：六个常驻 BitBrowser 身份顺序服务多单，不为每单新建窗口；每单结束清 session 与登录态 cookie（`oai-client-auth-info` 等），保留设备与 Cloudflare cookie；同一账号会话不得同时存在于两个身份。降低跨客户关联的投入顺序：一卡一单 > 出口 IP 数 > 窗口数。封控细节由 Codex 另行研究后再调整。 | 用户确认；实现见 `session-bootstrap`、上号器 1.2.1、常驻池 Worker |
| D-123 | 演练模式 `BROWSER_LIVE_STOP_BEFORE=SUBMIT`：同一条 LIVE 填写路径停在点击前，不申请 permit、不落付款意图；订单回 CARD_READY、资金栅栏清、身份页面保留。常驻池对失败 run 做分类安全中止，同一派发失败 3 次终态 `BROWSER_RETRY_LIMIT`。 | 已实现；09-07 一次演练成功停在点击前 |
| D-124 | 外部审查按 `docs/REVIEW_PROTOCOL.md`：Codex 审查员只读、有证据、分板块、有版本边界；审查记录与执行者处置记录分离；P0/P1 必须书面处置，拒绝 P0 由用户裁决；每批每板块不超过 10 条。 | 已建立，等第一批审查 |
| D-125 | 最低所需卡余额改为运营者可在库存页设置的正式设置项（只影响分配资格，不影响付款）；卡台双故障时可临时下调让备用卡具备资格跑演练，用完即恢复。 | 已实现并部署 `ed40c94`；09-07 临时 8 → 已恢复 16 |
| D-126 | 两个窗口曾并行执行于同一仓库与生产环境；用户指定分叉窗口继续执行，原会话停止。以后同一时间只允许一个执行窗口对生产与工作区动手，审查窗口只读。 | 已收口，见 `HANDOFF_LOG` 2026-09-07 末节 |
| D-127 | 后台首页只剩「五个决定」一行（接单 / 自动充值 / 浏览器真实付款 / 开卡补钱 / 当前卡台）、五个数字、需要处理的订单、内部提醒、开工检查；状态分布、设置列表、最近订单、CDK 退款分布、卡台健康块从首页删除。「开卡补钱」是一个决定，写两个设置（`card_auto_replenishment_enabled` + `card_balance_recharge_enabled`），两者不一致时显示「部分开启」；「浏览器真实付款」写 `browser_payment_writes_enabled` 并同步 `executor_profiles.productionWritesEnabled`，每次切换都落 `admin_setting_events`。 | 2026-09-07 | 用户确认五页结构稿后实施，`2bc0e12` |
| D-128 | 「需要处理」按 CORE_SPEC §1 阶段判定：RECHARGE_FAILED 只有存在付款证据（attempt `funds_risk_state` UNKNOWN/SETTLED，或 run `payment_state` PAYMENT_CONFIRMED/PAYMENT_UNKNOWN）才算需处理（FAILED_AFTER_PAYMENT）；付款前失败是 CLOSED_NO_PAYMENT，CDK 已退回，无事可做，不再进需处理列表与首页计数。首页「需要处理」由此从 8 降为 0（生产 8 单历史 API 路线失败单均无付款证据）。阶段与「需要我做什么」由 `v1/src/services/order-stage.js` 单点推导，列表与抽屉共用。 | 2026-09-07 | `0238601` |
| D-129 | 后台敏感操作不再要求二次密码：`sensitiveAdminGuards` 等同同源写守卫（登录会话 + Origin + 限流），动作只在对话框确认一次；`/api/v1/admin/step-up` 路由与 `hasStepUp` 保留到第 7 步接口清理再删。落实 D-119「密码与手打确认词全部取消」中的密码部分；Browser run 控制动作的确认词由前端自动填充，不再要求手打。 | 2026-09-07 | `9ccd2a7` |
| D-130 | 后台所有手打确认词取消（开卡「开N张」、卡充值对账「确认卡充值对账 <id>」、接管卡片、Browser run 控制词）：页面只弹一次对话框，服务器仍校验的字面词由前端自动填充；服务器侧校验保留（防止裸调接口误操作），不再作为人的输入。与 D-129 一起落实 D-119「密码与手打确认词全部取消」。 | 2026-09-07 | `91bd4f9` |
| D-131 | 付款前失败（Browser 安全中止到 RECHARGE_FAILED：资金栅栏 CLEARED、账本 RELEASED、未点击）必须同时释放卡绑定：ACTIVE 分配 → RELEASED，卡按余额回 AVAILABLE/DEPLETED，清 assigned_at 与本单指针；人工导入卡保留 MANUAL_IMPORT 免同步 tier；有其他活动分配的卡不动。付款后失败/不明仍保留占用（硬约束不变）。历史死单用 `scripts/release-failed-order-card.js` 修，只对无任何付款证据的 RECHARGE_FAILED 单生效并落 order_events。 | 2026-09-07 | `fbba5fe`；5501 已按此释放 |
| D-132 | 浏览器路线六个终态落 `operator_alerts` 并由常驻 Bark 服务推送：付款已确认、充值完成（info，只推 Bark，不占首页提醒）；付款前终止、付款被拒、Plus 已开通 20X 转人工（warning）；付款结果不明、核实需人工（critical）。同类型同订单去重，已解决再发生则重开。 | 2026-09-07 | `fbba5fe`，真实付款时首次验证 |
| D-133 | Pro 5X / 20X 是两阶段产品：第一阶段用同一套 Browser 链路买 Plus，第二阶段在同一账号、同一身份里走定价页 → Pro → 5x/20x → Upgrade 到「Confirm plan changes」弹窗（卡为已绑定的那张，按比例抵扣）。不走免费账号直购 Pro（用户判断可能拒付）。首次真实 20X 单只跑到弹窗停下不点 Pay now，等真实客户单再点。CDK 按产品生成；每产品单独的最低卡余额（初始与 Plus 相同，Pro 上线真实付款前须调到能覆盖 Plus + 升级）。 | 2026-09-07 | `0073d45`；用户 09-08 决定 |
| D-136 | 「付款后要重新登录」根因确证并根治:客户提交的 session(`/api/auth/session` JSON)只含 chatgpt.com 应用层 token,其 accessToken 短命且**无法刷新**(刷新需 auth.openai.com 认证层,实测该域只有 Cloudflare cookie);accessToken 一过期,backend-api(accounts/check、订阅)全 401、前端掉回 free。付款走前端结账页(session cookie 登录态)能成功,付款后验证/升级用 accessToken 就失败。修复三点:①付款后恢复阶梯不再重注入订单旧 token(`96ac467`),用浏览器付款后的登录态;②navigator 支持 Plus 账号经 `#pricing` 打开套餐弹窗做 stage 2(`58db552`);③取 session 的正确姿势=从活跃已登录页面刷新后再取(accessToken 新鲜)。实测:有效 session 下 accounts/check 200/Plus,navigator 自动跑到「Confirm plan changes」弹窗(今日应付 ₱7,939 / 卡 5501)、Cancel 收尾。结论:付款后不需要客户重新登录,只要 session 采集时是新鲜的登录态。 | 2026-09-08 | `96ac467`+`58db552`;真实单 PJV1-_VjINYXkOLLdiBrjpSZo |
| D-135 | `orders.cdk_id` 不再唯一（迁移 051 改普通索引 `idx_orders_cdk_id`）。CDK 退回（付款前关闭/失败）后由后续订单再次绑定是既定行为，但 001 的 `uq_orders_cdk_id` 让同一 CDK 的第二单 INSERT 撞唯一键→500。「一 CDK 同时只绑一活动订单」改由 `cdks.order_id`（`uq_cdks_order_id`）+ 入口 `FOR UPDATE` 与 `status=AVAILABLE` 条件更新保证；历史订单保留自己的 `cdk_id` 作追溯。同时全局错误处理器对未预期错误记 method/path/name/code/errno/message（不含请求体）。 | 2026-09-08 | `bf2f25c`，release `20260908-cdkreuse-bf2f25c`；生产复现单 PJV1-1llPonXqruRkU71jurLQ |
| D-134 | 付款后 ChatGPT 可能把页面踢到登录页（用户手动升级时遇到）。自动化不持有密码，只允许无密码恢复阶梯：① 页内探测会话 → ② 只清页面登录态 cookie（保留 session/设备/Cloudflare）回首页再探 → ③ 重注入原 session 材料 → ④ 交人工/客户重贴。阶梯任何一级都不碰付款。 | 2026-09-07 | `1e8449c`（阶梯与只读演练脚本），执行器接入进行中 |
| D-137 | LIVE 付款适配器在**付款前失败**（drift/超时/租约丢失）时必须清空已填的安全卡字段，不再只在点击提交后（`submitted`）清。原逻辑把卡号留在可复用的结账页：①PAN 残留在常驻浏览器页面里；②重试复用同一结账页会撞「secure field is not empty」守卫→CHECKOUT_DRIFT，把一次瞬时抖动放大成硬性 4 次失败 + RECHARGE_FAILED。修复保留「RECONCILE_ONLY 保持表单」的原意（该路径 `return` 不清，用 `holdForReconcile` 区分），账单地址/邮箱等非 PAN 字段不清。 | 2026-09-08 已实现 + 单测更新，未部署（本地池 Worker 从源码运行）| 现场：退款测试账号 8dd16df66497 的 Plus 单 PJV1-gEKsTevDVt6dnCvMs9Jr 连续 4 次 CHECKOUT_DRIFT、**未扣款**（attempt CLEARED、`noExternalPaymentAction`、卡 2911 余额未动）。实测同结账页零税机制正常（填 AK/US 账单地址 VAT 12% ₱117.86→0%，₱1,100→₱982.14=历史成功额）、卡/账单/邮箱字段各 1、提交控件 `button[type=submit]` 齐全，判定 attempt-1 为瞬时渲染抖动、2–4 撞残留卡号 not-empty。改 `live-chatgpt-payment-adapter.js`；`live-chatgpt-payment-adapter.test.js` 断言改为「付款前 drift 后 cc-number 必须为空」，`live+nonpayment+executor` 共 22 测通过。该单仍 RECHARGE_FAILED（未扣款），补跑需新 attempt。 |
| D-138 | **不做「Plus→20X 升级」自动化服务。** 已 Plus 账号想升 20X 的客户由运营手动升级（业务量很小）；系统 20X 单继续只接 free 账号（executor 遇已 Plus 账号 abort ACCOUNT_ALREADY_PLUS 的护栏保留）。理由：自动化升级需先解决"升级弹窗能否换成本单卡付补差价"等未验证前提，且给系统引入不确定性，收益不匹配。方案 A（已 Plus 账号只读演练 stage2）随之取消。当前目标收敛为：验证系统能否把 free 账号完整充到 20X（stage1 真付 Plus → stage2 补差价）。 |
| D-139 | **真单自动化失败一次，立刻转人工，事后再查。** 2026-09-09 第一笔 Browser 真单（`PJV1-VHl_`）：预检因租约 120s 不够重来 3 次（11 分钟），改 900s 后到结账页被 OpenAI 拒（403→刷新 500），执行者又花了 ~20 分钟边修边查，最后用户用上号器手动充值。规则：真单上任何一步失败或卡超 5 分钟 → `stop-live.sh` → 用户手动 → `close-manually-fulfilled-order.mjs` 收口；诊断在事后做。**结账页 403 根因未查清前，自动付款不再上真单**。 |
| D-140 | **09-09 真单 403 根因已定位并修复：注入的 session cookie 必须放在 `.chatgpt.com` 域，不能按 `{url}` 放成 host-only。** 机制：客户提交的是 `/api/auth/session` JSON（只有 token），`session-bootstrap.js` 用 `{url}` 注入 → host-only `chatgpt.com` cookie；ChatGPT 自己在 `.chatgpt.com` 轮换/下发同名 cookie，两者互不覆盖 → 浏览器同时带两套 session-token → 后端判会话过期 / 结账页 403。此前所有到过结账页的运行都用的是上号器装好的常驻登录态，从未真正走过注入路径。对照实验（同一 free 测试号、同一 Lane4 窗口、同一菲律宾出口、同一导航代码，不付款）：①现有代码注入 → 首页后两套 cookie 并存，导航器报"session has expired"，backend-api 全 403；②改 `.chatgpt.com` 域注入 → 网站轮换原地覆盖、只剩一套，会话正常；③继续点升级 → 结账页打开，₱ 报价出现，无 4xx/5xx。修复：无 domain 的 cookie 一律 `domain: .chatgpt.com`（`__Host-` 前缀按规范保持 host-only）；顺带 openPricingSelectors 加 "Rejoin Plus"（曾买过 Plus 的 free 号首页按钮）。**状态：本机代码已改 + 单测；真单未验证**。D-139 的"不上真单"解除，下一笔真单可按自动化跑，仍受 D-139"失败一次即人工"约束，是否上由用户定。 **更正（2026-09-10，审查 F-27）**：本机 WAL 显示 09-07 与 09-08 有 7 次 host-only 与 `.chatgpt.com` 同名 cookie 并存却到达结账页、其中 1 次付款成功，"并存即 403"的因果未坐实；修复保留为候选（无害），真单待验；真单再 403 按 D-139 转人工，不沿此方向再查。本决策不重开。 | 2026-09-09 用户决定 | 待真付一次 20X 才能验闭环；不付款前提下 stage1 已 rehearsal 验、stage2 代码已审 |
| D-141 | **Free 直购 20X 作为新流程，真单后实现；在它验收前 D-133 的两阶段仍是 Pro 单的当前路径。** 用户 2026-09-10 提出希望增加"直接从 Free 升级到 20X"的流程。代码显示当前至少四处要改：结账导航 stage1 写死买 Plus（`shared-live-composition.js`，e27ac92）；结账模式只盯当前页，而免费账号点 Upgrade to Pro 会在新标签打开 Pro 结账页（09-07 23:41 演练观察）；付款后确认只认套餐名含 plus（`chatgpt-post-payment-verifier.js`），Pro 会被判未确认；Pro 单付款后动作是去开升级弹窗（`production-live-pool-worker.js`）。从未观察过的：Pro 结账页的表单与零税重报价、付款后 `accounts/check` 的 Pro 套餐字符串、档位按钮的稳定性（09-07 点到过、09-08 超时）。顺序：先用一个 free 号只读观察（不付款）→ 改四处 + 单测 → 演练 → 真单。09-08 的"直购可能拒付"判断由此次真单验证。 | 2026-09-10 用户定方向，待实现 | 不在今天的真单上边修边试；两阶段路径今天照跑 |
