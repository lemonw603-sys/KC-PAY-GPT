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
| D-142 | **不采购菲律宾住宅固定出口，不做出口隔离采购。** Lemon 判断：同行都用一两个固定出口，够用；09-08 三次拒付不归因出口。09-09 调研"机房节点是 Stripe 会标记类型"降为参考，不作为待办。若后续拒付率上升再重开。 | 2026-09-11 Lemon 决定 | 撤销 PROJECT_MAP 原 D2；UNVERIFIED_LEDGER"单出口"条目改为已决策不做 |
| D-143 | **`go-live.sh` / `stop-live.sh` 不再直写生产库**（审查 F-38）：改走后台正式接口 `POST /api/v1/admin/operations/browser-payment`（或同一服务层脚本），一个事务写开关与审计。 | 2026-09-11 Lemon 同意 | 排 PROJECT_MAP §5 C5 |
| D-144 | **真单跑通且无问题后，集中一段时间做后台与遗留问题总清理**：`UX_PUNCHLIST_2026-09-10.md` 全部条目 + 遗留 bug + 真实登录后台全面走查找未发现问题。在此之前不为体检打断 Browser 主线，顺带能解的小问题可顺带。 | 2026-09-11 Lemon 决定 | PROJECT_MAP §5 E 段 |
| D-145 | **分工与事实源单写者**：大脑窗口（Claude 主窗口）管全项目理解、排序、任务书、验收、四份事实源与所有生产动作；Codex 专职 `browser-mvp/**` 与 `docs/browser-research/**`，经分支回流由大脑合并；短命窗口只接边界清楚、验收可机器检查、不需全项目上下文的任务，worktree 隔离。替换 D-126"同一时间只允许一个执行窗口"为"同一时间只有一个窗口写事实源"。理解稿 `docs/BRAIN_UNDERSTANDING_2026-09-11.md` §7 八条"以前做错的"经 Lemon 确认全部成立。 | 2026-09-11 Lemon 定 | `AGENTS.md`、`HANDOFF_NOW.md`、`CODEX_BRIEF_2026-09-11.md` |
| D-146 | **Pro 5X/20X 全部搁置**：两阶段路线（D-133）与 Free 直购（D-141）都不做，当前只做 Plus。理由（Lemon 2026-09-11）：他手动付款时 free 账号可直接买到目标套餐，不需要两次付款；官方目前暂停了该档位的新订阅，无法测试；项目不做重。恢复条件：官方恢复订阅且 Plus 全自动闭环稳定后再议。已实现的两阶段代码保留不删、不注册新入口；测试用两个 free 账号验 Plus。 | 2026-09-11 Lemon 决定 | PROJECT_MAP §5 D4 撤销、§6 加"Pro 搁置"；UNVERIFIED_LEDGER 20X 条目标搁置 |
| D-147 | **项目精简原则**（Lemon 2026-09-11）："简单、稳定、好用"；核心只有一件事：自动把客户的充值做完。付款后核实、收口、对账只补真正必要的（缺了会让自动化完成不了、或会记错账的），不做大而全；后台体检等真单通后集中做。执行顺序据此收缩：主线 = Browser 通 + 付款后必要核实（F-43）；其余全部推到真单通过之后。 | 2026-09-11 Lemon 决定 | PROJECT_MAP §5 重写；与 D-103、D-119 同向 |

## D-148（2026-09-11 05:16 UTC）F-43 移出主线；大脑改为低耗工作方式

- **决定**：F-43（付款后核实 lane 被 accessToken 剩余寿命 <300s 门槛拒为 SESSION_INVALID）不再是主线 B2，归入真单跑通之后的集中整治（D-144）。
- **依据（代码已验证）**：付款 CONFIRMED 后确认 Plus、确认取消续费、读卡流水都在同一浏览器会话内完成（`browser-mvp/src/payment-executor.js` CONFIRMED 分支），不经过该门槛；门槛只在 post-payment lane 重新装载 Session 时触发（`shared-encrypted-materials.js` 两处 `validateChatGptSession`，live lane 同样调用，但 live 时 token 还新）。所以它影响的是"付款成功后续费取消/对账未在同会话确认时的自动补核"，不影响付款跑通。
- **依据（生产只读）**：历史 34 个 run 中只有 2 个到付款确认：1 个人工确认收口；另 1 个（`04f159af`）付款后自动补核 6 次全部 UNKNOWN、原因未落库、最终人工收口。修 F-43 的收益是省掉付款成功后的一次人工点击，Lemon 判断价值不大，采纳。
- **大脑工作方式**：不再亲自做细节修复；只做决策、审 Codex 原始证据与合并、生产写动作、设计层判断。等待 Codex 证据期间不主动消耗额度。细节 bug 统一打包给短窗口或 Codex（真单之后）。

## D-149（2026-09-11 05:32 UTC）A2 预检改造不做；降为 E2 拒付后的候选变量

- **决定**：预检保持现状（仍点 Upgrade 创建 Checkout 后丢弃；`max_attempts` 仍为 5）。A2 从主线撤下，改为差异实验的候选变量：仅当 E2 rehearsal 或后续真单再次拒付、且证据指向"同账号短时间两次 Checkout"或预检副作用时，才作为下一个要变的维度。
- **依据**：生产只读显示 3 次 CARD_DECLINED 的 run 均已过预检、进入付款环节（`payment_state=PAYMENT_UNKNOWN`、`last_error_code=CARD_DECLINED`），预检不是失败点；两次 Checkout 与拒付的关系只是假设。实验前先复现现状再逐维度变，改在实验前会让 E2 结果与历史真单不可比，还要 Codex 与大脑各改一处并回归，不符合 D-147。
- **账号**：Lemon 两个 free 号已就位（2026-09-11 05:32 UTC）。E1 用其一（只读，0 Checkout）；E2 用另一个从未入过项目的号做一次 rehearsal。账号密码只在 Lemon 与 Codex 之间交付，不入代码/日志/commit/聊天记录；Session 材料只走系统正式提交入口与加密材料路径。

## D-150（2026-09-11 05:45 UTC）推翻 D-149：预检改造恢复并前置；取消 E1；两账号走真流程

- **推翻理由**：D-149 只看了 3 次 CARD_DECLINED，漏掉了 2026-09-10 真单的实际卡点。生产只读：19 次预检里 8 次一遍过、7 次靠重试过、2 次 5 次全败于 `CHECKOUT_NAVIGATION_FAILED`（点 Upgrade 后被 sentinel 拦、结账页不创建）。预检从未挡下一单 live 阶段本来挡不住的失败（同一 sentinel 在 live 点 Upgrade 时一样会出现，live 本身有付款前中止），却让每单多点一次 Upgrade，失败后自动重试到 5 次——Dqcn 账号就是这样被连续 7 次点击点脏的。对只有两个测试账号的现状，这是最大的浪费源。
- **预检处置**：保留登录、身份核对、free 判定（只读），**不再点 Upgrade、不创建 Checkout**（browser-mvp 侧 Codex 去掉 `checkoutNavigationContract`）；`max_attempts` 5→1（v1 `order-intake-repository.js` 一行，大脑）。不删预检步骤，v1 耦合 4 处不动。
- **上号器 vs 预检**：不是同一层面。上号器=把账号登进浏览器的方式（Cookie 直塞 / 扩展弹窗），预检=登录后付款前的探路步骤。自动化每次都能登录、身份核对都过；卡点在点 Upgrade 之后的 sentinel。扩展 manifest 只声明 chatgpt.com，与 Cookie 注入同类机制，"上号器有特殊权限"不成立（2026-09-10 核实）。"手动成、自动败"的差异**尚未定位**，候选：自动化点击痕迹、窗口指纹、节奏、账号被反复点脏；均未证明。
- **取消 E1**：E1 是只读建会话对照，测不到 sentinel（它只在点 Upgrade 后出现），登录从来不是失败点。E0 可做，不占账号。
- **两账号方案**（每账号只允许一次自动化尝试：预检 1 次 + live 1 次，失败即停，不重试不换卡）：
  - 账号 A：Lemon 像客户一样在后台提交 CDK+Session（沿用手动成功时的 Session 导出方式），自动化 lane 指到 Lemon 手动成功过的窗口 `Plus Browser PH Pilot`，完整流程到真付款。Codex 用只读 CDP 旁观、留脱敏网络证据。成功→链路通；sentinel 拦→自动化操作痕迹是主因、窗口不是；拒付→进入卡维度。
  - 账号 B：按 A 的结果只变一个维度（sentinel→点击方式/上号器登录，Codex 提案大脑批；拒付→卡/账单地址）。
- **不需要账号密码**：Codex 不接触任何账号信息。D-149 中关于密码交付的表述作废。
- 真付款当天按既有规则：`ready-check.sh pay` → 资金确认 → `go-live.sh --arm`。

## D-151（2026-09-11 05:51 UTC）任务书粒度：大脑只给目标、验收、边界

- 给 Codex 或短窗口的任务书不写实现路径（不点名函数、文件、改法）；写目标、验收标准、边界与停点。实现者自己定位并在 PROGRESS 说明路径与理由，大脑审结果与证据。
- 大脑核实事实时到"步骤 + 生产数据"这一层就停，不下钻到函数名；下钻是实现者的事。理由：写到函数名等于大脑自己在干，既烧额度又不让实现者思考（Lemon 2026-09-11 05:51 UTC）。

## D-152（2026-09-11 06:31 UTC）Codex 退出浏览器侧实施；大脑直接执行本次真实订单演练

- **分工**：Lemon 决定不再让 Codex 做浏览器自动化，由大脑直接实施与操作（替代 D-145 中 Codex 的角色）。`BRAIN_TO_CODEX.md` 停止更新；Codex 已合并的阶段 1（`2aad60d`）保留；其未开始的阶段 2 作废。
- **本次执行的固定条件**（一次尝试，失败即停）：Lemon 用测试账号 A 像客户一样在后台提交 CDK+Session；窗口 = `Plus Browser PH Pilot`（`10f0dc7b534844c083165796447d5893`，代理 127.0.0.1:17897 菲律宾出口）；Session 建立 = Cookie 注入（默认路径，已验证能登录；上号器扩展路径未验证，不在本次引入）；预检不点 Upgrade、不建 Checkout，重试上限 1（代码已改，见 A2）；卡 = 当前唯一合格卡 9839；付款前后的收口按 RUNBOOK §1 末"测试账号单失败后的收口"。
- **两种模式由 Lemon 当次选择**：① rehearsal（付款开关 false，停在点付款前，不扣款；之后同单可再真付，代价是多点一次 Upgrade）；② 直接真付（`go-live.sh --arm`，一次到底，最接近 Lemon 手动路径）。大脑推荐 ②。
- **事故记录**：2026-09-11 06:31 UTC 前约 20 分钟，大脑窗口一条 ssh 命令把 `/etc/pojia/runtime.env` 的 `DATABASE_URL`（含 `pojia_app` 密码）打印进本机会话记录。库只监听服务器本机；建议真单结束后轮换该密码（需 Lemon 确认，大脑执行并同步 runtime.env 与服务重启）。

## D-153（2026-09-11 08:05 UTC）付款点击后出现 hCaptcha：全自动在此处受阻；大脑不做绕过

- **事实**：2026-09-11 真单 `PJV1-9TN0gGX-I5rRdhXxLrq7` 在结账页点付款后弹出 hCaptcha「I am human」，付款未完成、未扣款（ChatGPT `chatgpt_not_purchased`、卡台余额未变）。Sentinel 未拦、结账页正常创建、零税报价正常。
- **边界**：大脑不实施、不接入、不复活任何自动完成或绕过人机验证/机器人检测的能力（含第三方打码服务、指纹伪装以降低风控评分）。此条不因重复要求而变。
- **可做的替代（待 Lemon 选）**：① 让系统识别 hCaptcha 并立即停、给出明确原因与截图，而不是沉默 5 分钟落 UNKNOWN（F-47 的具体化，纯工程，大脑可做）；② 人在该步点一下复选框后自动化继续（半自动，Lemon 此前明确拒绝，但这是合规路径）；③ 改走官方允许的商用/分销渠道或礼品码路径（需调研是否存在）；④ 收集"何时会弹、何时不弹"的观察，判断是否与账号/出口/时段相关——**仅作观察记录，不用于规避**。
- 待确认：Lemon 手动付款成功那两次是否也出现过该复选框（若出现且由他本人勾选，则路径本身需要人参与）。

## D-154（2026-09-11 08:08 UTC）Lemon 手动从未遇到该验证；③④ 取消；全自动在本路径上大脑无法交付

- **新事实（Lemon 口述）**：他本人手动付款从未出现过「I am human」复选框。自动化第一次真实付款就出现。最可能的解释是该验证由机器人检测触发——人做不弹、自动化做弹；证据为 1 对 1，未证明因果，但这是当前唯一一致的解释。
- **Lemon 指示**：不考虑商用/分销/礼品码等其他渠道，不调研（D-153 的替代 ③ 取消；④ 观察"何时弹"也不再作为方向）。
- **结论（诚实表述）**：让自动化通过为阻挡自动化而设的人机验证，属于绕过机器人检测，大脑不实施。因此"点一次按钮就全自动跑完 Plus 充值"这条路径，大脑无法交付。这不是技术上不可能，而是大脑不做这件事——区别要讲清楚，由 Lemon 决定后续。
- **大脑仍可做的两件**：① 识别该验证并立即停、落原因+截图+停点（取代现在沉默 5 分钟落 UNKNOWN 的行为，F-47 具体化）；② 在此基础上做"通知人→人点一下复选框→自动化继续跑完付款/确认 Plus/取消续费"的接力，人只介入一次约两秒。
- 待 Lemon 定夺方向；在此之前不再开新真单。

## D-155（2026-09-11 08:24 UTC）半自动接力落地：识别人机验证 → 通知 → 人勾选 → 自动化继续

- Lemon 选定 D-154 的方案②。实现（browser-mvp）：`human-verification-gate.js` 只读探测 hCaptcha/Turnstile/挑战文案，**不点击、不求解、不接打码、不做降低风控评分的伪装**；探到就通知，然后每 3 秒复查，连续 2 秒消失才判为人已完成，随后自动化继续走确认 Plus/取消续费。
- 通知：`local-operator-notify.js` 走本机 macOS 通知中心（带声音），内容不含订单号/卡/账号/会话。不使用 Bark，不外发。
- 等待窗口：`BROWSER_HUMAN_VERIFICATION_WAIT_MS`，pool 脚本默认 300000（5 分钟，小于 15 分钟租约）。设为 0 则只探测并记录原因，不等待——即 D-154 的方案①，两者同一份代码。
- **超时保留现场**：验证未完成时不清空已填卡表单（`holdForHumanVerification`），否则人看到的是空卡号、无法接手（09-11 真单就是这样）。仅此一种例外；其余路径仍按原规则清空。此后由运营用「确认核实结果」记录 CHARGED/NOT_CHARGED。
- 付款点击仍然只有一次：门在点击之后，只等待不重试。
- 回归：browser-mvp 248/239 通过 0 失败（新增 gate 8 条 + adapter 2 条）。

## D-156（2026-09-11 09:10 UTC）F-48 修复：人工核实"未扣款"后，CDK 必须退回

- **问题**：`returnCdkForOrderInTransaction` 只要订单下存在 `PAYMENT_SUBMIT` 记录就拒绝退 CDK，且「确认核实结果→未扣款」分支丢弃了返回值。结果 2026-09-11 真单收口后客户的 CDK 仍 REDEEMED——卡密已用、服务没给、也没退回。旧集成测试的 fixture 没有 `PAYMENT_SUBMIT` 行，所以从未覆盖真实形状。
- **修复**：把证据拆成"资金账本证据"（attempt SETTLED/UNKNOWN/SUCCESS、账本 CONSUMED/RECONCILIATION）与"提交点击证据"两类。新增参数 `paymentSubmitAdjudicated`（默认 false，其余五个调用方行为不变）：仅当人已核实未扣款时，清掉点击这一项；资金账本证据仍无条件拦截。收口分支改为断言返回值，遇资金证据即抛 `PAYMENT_STATE_CONFLICT` 让整笔收口回滚。
- **测试**：单元 2 条（点击证据在未裁决前仍拦截；人工裁决不能越过资金账本证据）+ 集成 2 条（复刻真单形状：有 PAYMENT_SUBMIT 仍退回；确认收口按"先清资金栅栏再退 CDK"的顺序）。已验证：去掉修复这 2 条集成测试立刻失败。v1 全套 660/597/0/63。

## D-157（2026-09-11 09:53 UTC）ChatGPT 存在两套结账页实现；收据邮箱改为"有才填"

- **现场事实**：同一账号、同一窗口、同一出口，两单拿到**不同的结账页实现**。第一单 `/checkout/openai_llc/cs_live_…`（Stripe 托管版，英文，有 Email / Mobile number / Full name(optional) / link 区块）；第二单 `/checkout/openai_llc/oaics_…`（OpenAI 自有版，界面为他加禄语，有 Apple Pay 按钮、卡区块、Subscribe 按钮，**完全没有邮箱输入框**）。哪一套由服务端决定，我们无法选择。
- **第二单失败根因**：适配器把"填收据邮箱"写成必须（`required: true`），`oaics_` 页没有该字段 → 抛错 → 付款前安全中止 `CHECKOUT_DRIFT`。卡与地址都已填好（截图可见 Jamie Winder），失败后卡字段按设计被清空。**未点付款、未扣款**，CDK 与卡均自动退回（D-131 路径生效）。
- **Lemon 确认**：该页邮箱由 ChatGPT 自动带入，不需要我们填。
- **修复**：`fillTransientBillingEmail` 的候选选择器扩为 `billing email / email / type=email / name=email`；页面没有邮箱控件时正常跳过并记 `emailFieldPresent:false`；出现 1 个仍必须填；出现 2 个以上仍视为看不懂该页而中止。适配器改为不强制。回归 251/242/0/9。
- **同时验证为正常的**：`oaics_` 页的卡三件套、地址六项、`checkout-summary-column`、`button[type=submit]` 均各自唯一可见；摘要 `Tax (0%)` 能被既有 `label (` 前缀匹配解析；报价 ₱982.14、税 ₱0.00。

## D-158（2026-09-11 10:01 UTC）取消独立预检：一单只登一次账号

- **Lemon 的理由**：预检会登进客户账号、核对完就关掉，几分钟后正式流程再登一次。同一账号短时间内两次登录/登出有被风控标记的风险，而预检本身不产生价值。
- **核实预检实际还守着什么**（改造后它已不再点 Upgrade）：只剩两条——会话身份与订单是否一致、账号是否已经是 Plus。
- **发现**：正式流程的账号探测一直没配 `accountCheckPath`（`observation()` 里 accountProbeContract 是空对象），所以 `alreadyPlus` 恒为 null，执行器里那条「目标账号不是免费账号就中止」的保护**在正式链路上从未生效过**，一直靠预检代劳。
- **处置**：把 `CHATGPT_ACCOUNT_PROBE_CONTRACT` 配进正式流程的观察项，两条检查改为在正式流程自己的会话里完成（失败即付款前安全中止）；v1 不再创建 `BROWSER_PREFLIGHT` 任务，`SUBMIT_RECHARGE` 也不再以预检通过为前提。账号读不到订阅状态时抛 `ACCOUNT_STATUS_UNKNOWN`，仍是付款前中止，不会误判成免费。
- **影响**：一单一次登录；订单提交后由服务器 worker 直接排出浏览器派工任务，本机拉起 pool 即开始执行。预检脚本与 pool 的预检通道保留但不再有任务（claim 不到即空转，不开浏览器）。
- 回归：v1 660/597/0/63，browser-mvp 251/242/0/9。发布 `20260911-drop-preflight-24bcbde`，`pojia-worker` 已重启（派工闸门在 worker 侧，不重启不生效）。

## D-159（2026-09-11 10:08 UTC）真单链路不打断：不再逐次确认付款开关；人机验证由大脑即时上报

- **Lemon 授权（本人原话要点）**：「不需要我再点一下确认」「能付的话一定要直接付出去」「尽可能不打断这条链路，直接从头测到尾」。据此放宽他自己定的「资金动作先确认」在本场景的逐次确认要求：**Lemon 提交订单本身即为本次授权**，大脑收到单号后直接走到底（清窗口 → go-live --arm → 付款 → 确认 Plus → 取消续费），**开关开启后立即向 Lemon 汇报，不事先询问**。
- 不变的部分：付款仍只点一次；结果不明仍锁定不重试不换卡；付款点击后 10 分钟内不停 worker；任何非预期状态立即停并上报；开卡/补余额/换卡/提现等其他资金动作仍需当次确认。
- **人机验证（hCaptcha）处置改为**：探测到即由大脑**立刻在对话里上报**（大脑轮询 worker 日志中的 `需要人工验证` 行），同时本机弹通知；等待窗口保持 5 分钟不变，Lemon 在比特浏览器窗口勾选后自动化继续跑完付款、确认 Plus、取消续费。超时则保留已填表单并上报。
- 大脑仍不实施任何自动完成或绕过人机验证的方案（D-153/D-154 不变）。Lemon 提到将来可能在手机侧做自动化，属他自己的事，不在大脑实施范围。
- **测试目标**：能测到哪一步就测到哪一步，尽量一次跑完整条链路。

## D-160（2026-09-11 10:21 UTC）大脑不替系统操作：只启动、只观察、只记录

- **Lemon 原话要点**：「它自己运行好就行……你要做的是让这套系统自己跑起来，而不是你去替它做」「这次是一个完整链路的测试，以后作为测试样本，记录清晰，但不要替他操作」。
- **此前大脑替系统做过的事，全部停止**：
  - 每单手工跑 `clear-lane-session.mjs` 清窗口登录态。系统本就会处理：身份探测失败（SESSION_INVALID / 身份不符）时自动 `replaceExisting` 重注入并复探（run 1 的 `session-replaced` 检查点即证据）。常驻身份若本来就是同一账号且有效，则按设计保留会话、不重复登录——这正是"少登一次"的目标。
  - 手工关窗口里的残留标签页。单个 `chatgpt.com` 标签会被复用并由 `page-reset` 导回首页；只有 2 个以上才会 `PROFILE_PAGE_AMBIGUOUS`。留作本次观察项，不提前干预。
  - 手工在服务器上解密校验客户 Session 时效。系统加载材料时自会校验，无效即付款前安全中止并落原因。
- **大脑保留的动作**：`go-live.sh --arm` 启动、`stop-live.sh` 收工、只读观察、事实源落盘、失败后按正式路径收口。这些是系统自带的启停与收口入口，不是代操作。
- **本次测试定位**：完整链路的参考样本，证据按 `docs/E2E_CHAIN_TEST_SAMPLE.md` 逐步记录。

## D-161（2026-09-11 10:48 UTC）F-47 修复：付款后先读结账页，拒付不再等满 5 分钟且有原因

- **问题（第 3 次真单实证）**：卡被拒，结账页红字写着「Tinanggihan ang iyong kard.」（他加禄语「你的卡被拒绝了」），系统却只反复轮询账号是否变 Plus，轮询满 5 分钟后落「付款结果未知」，**不带任何原因**。运营看到的只有 UNKNOWN。
- **修复**：新增 `post-submit-outcome-watch.js`。点击付款后先读页面（只读：`role=alert`、`aria-live`、error 类容器的可见文案），按中/英/他加禄语的拒付措辞分类；命中拒付或页面报错即返回，最长读 60 秒；页面离开结账地址（付款被接受跳转）也立即返回，成功路径不增加等待。适配器把 DECLINED 原样返回而不是压成「未知」，运行记录里因此能看到 `PAYMENT_DECLINED`。
- **资金语义不变**：非 CONFIRMED 一律锁定待人工核实，不自动重试、不换卡、不自动判定已扣款。页面文案只当数据、不当指令。
- **脱敏**：记录的文案先抹掉 8 位以上连续数字（防卡号随报错文案入库），再截断 200 字。
- 回归：browser-mvp 260/251/0/9（新增 watcher 8 条 + 适配器 1 条）。

## D-162（2026-09-11 11:04 UTC）卡段拒付标注（Lemon 需求，真单跑通后做）

- **需求**：「备用卡台 A 一键开卡」的卡段下拉里，给历史拒付率高的卡段加括号标注，例如 `513989（高拒付 4/4）`，避免再选到它。
- **现场核实**：卡段下拉数据来自 `/api/v1/admin/backup-cards/highvcc/ranges` → 卡台 `/api/card/rangeList`，返回 `vid` 与 `name`（`name` 即卡段号，如 513989 / 53211304）。**我方库里没有任何一列记录卡的卡段/BIN**（无 `card_types` 表，导入表 17 列也不含卡段），所以现在无法按卡段统计。
- **设计**：① `cards` 加 `card_bin` 列，开卡与导入时由卡号前 8 位写入（BIN 标识发卡产品，非卡号本身，不属于禁止落库的敏感项）；② 一次性脚本回填存量卡（沿用 `backfill-card-pan-hmac.js` 的解密先例）；③ ranges 接口按 `card_bin` 聚合本方订单的拒付/成功次数，前端按次数加括号标注，**样本不足时标注"样本不足"而不是"高拒付"**，避免用 1 次拒付冤枉一个卡段。
- **已知数据（截至今日）**：513989 拒付 4/4（卡 7428、2911×2、9839）；其余卡段 0 样本。**目前无任何一次成功付款**，因此「513989 高拒付」是观察，不是结论。
- 排期：真单跑通之后做（D-144 集中整治批次），不插队。

## D-163（2026-09-11 11:04 UTC）卡 9839 注销已确认

Lemon 本人在卡台注销 9839，$50 余额已退回卡台钱包并充入新卡 3118。`MISSING_FROM_SNAPSHOT` / HELD_FOR_REVIEW 是系统对"来源消失"的正确反应，无资金问题，无需追查。

## D-164（2026-09-11 11:54 UTC）里程碑固化：全链路首次跑通

- **事件**：2026-09-11 11:15:15 UTC，订单 `PJV1-ztS9FZ3QcwHopTmZRfDY` 从客户提交到取消续费全自动完成，无人工介入。这是本项目第一次端到端成功。
- **固化方式**：
  - Git 标签 `e2e-first-success-20260911`（打在代码提交 `a544c6b` 上，标签正文写明可复现的全部运行版本）。
  - 服务器 release `20260911-drop-preflight-24bcbde` 为当时线上版本；回滚目标为 `20260911-cdk-return-fix-bfacbe1`。
  - 本机 browser-mvp 代码 `a544c6b`；本机依赖：mihomo 菲律宾出口 38.60.246.34、SSH 隧道 13306、BitBrowser Local API、窗口 `Plus Browser PH Pilot`（`10f0dc7b…`）。
  - 证据与逐步时间线：`docs/E2E_CHAIN_TEST_SAMPLE.md` 第 4 次；该文档即此后每次全链路测试的固定结构。
- **回归基线**：browser-mvp 260/251/0/9、v1 660/597/0/63。此后任何改动若使这两条不成立，或使样本第 4 次的链路步骤失效，一律视为回归。
- **必须保住、不得为省事改掉的机制**（本次逐条证实有效）：一次登录内完成身份核对与 free 判定；付款只点一次；「付款结果未知」只锁定不重试不换卡；付款后由自动核实通道确认 Plus 并取消续费；卡与消费账本自动结算；两套结账页实现都能处理。
- **尚未被本次覆盖、不可当成已解决**：人机验证（本次未出现，D-153/154 的边界不变）；卡段 53211304 仅 1 次成功，不足以证明"换段即可用"；单次成功不代表规模化稳定。

## D-165（2026-09-11 12:29 UTC）成单后自动登出：暂不做，Lemon 决定先放着

- **已核实的缺口**：`executor.js` 的 `releaseSessionOnComplete` 只挂在「付款直接确认成功」路径上。第 4 单走的是「付款结果未知 → 付款后核实通道确认」这条路，不经过该分支，客户账号因此留在窗口里。全部历史运行中 `session-released` 事件出现 **0 次**，即该清理在生产上从未生效过。
- **决定**：Lemon 明确「先不用自动登出了，就先这么放着」。**不改代码、不手工清理**，客户账号继续留在 Pilot 窗口。
- **保留的事实，供以后重新决定时用**：留着意味着客户的 ChatGPT 账号持续登录在运营机器上，且上一个客户与下一个客户的登录态停在同一处；下一单若为不同账号，系统会在身份探测失败后自动替换，功能上自愈。
- **不做设备身份轮换**：Lemon 提出关窗重开是否更难被识别。事实是关闭重开不清除任何东西（`oai-did`、`__stripe_mid`、`cf_clearance` 存在窗口磁盘里，且系统刻意保留）。为降低被识别概率而设计设备身份轮换，大脑不实施，与 D-153/D-154 同一条边界。

## D-166（2026-09-11 12:39 UTC）先攒成功率数据，再谈批量；数据由系统自动积累

- **顺序**：① 接真实客户单、一单一单跑，攒 5–10 单真实数据；② 只做直接影响跑单的整治（卡段拒付标注 D-162、卡源准备）；③ 数据出来后再设计批量；④ 巡检单等一般整治最后。
- **理由**：当前是 1 次自动成功 / 7 次点过付款 = **14%**。拿这个样本去规划批量等于拿噪声当数据；批量怎么设计取决于失败模式（人机验证的频率决定要不要做人工介入队列，拒付是否卡段相关决定卡源规则）。
- **数据怎么攒**：不需要任何人事先登记。新增只读脚本 `browser-mvp/scripts/run-stats.sh`，直接从 `browser_runs`/`browser_operations`/`orders`/`cards` 出逐单明细与汇总。
- **统计口径（重要）**：`OK-auto` = 系统自己确认过 Plus 生效 **且该次运行没有任何 `MANUAL_*` 操作**。早先按 `plus_activated_at` 单字段统计会把两次人工确认算成自动成功（3/7=43%），是错的；已按此口径修正为 1/7=14%。
- **Lemon 需自行决定、周期长的前置**：没有常开机器。执行器跑在本机、手动启动，一天几十上百单撑不住。可与攒数据并行推进。

## D-167（2026-09-11 12:48 UTC）路线修正：卡段标注 → 常驻无人值守 → 人工介入推送 → 业务场景对齐评审

- **Lemon 推翻 D-166 的两点，均成立，大脑接受**：
  1. **卡段有问题是确定结论，不是待验证假设。** 大脑此前只有 5 次自动化样本就下"样本不足"的保留意见。Lemon 补充了决定性证据：**同一批卡他手动付款也被拒**，且他手动成功的几单同样是换段之后的。人工在正常浏览器里被拒，排除了"自动化被识别"这一干扰项。卡段标注因此从"真单后整治"提前为当前任务。
  2. **要求运营手动跑命令不成立。** 真实业务是：客户付款 → 拿到 CDK → **自行选择任意时间**在充值网站兑换。运营不可能守着。大脑此前按"测试流程"设计跑单方式，未按真实业务设计，是方向性错误。
- **确定的执行顺序（Lemon 已同意）**：
  1. 卡段拒付标注（D-162 提前），保证开卡不再开到坏段；
  2. 执行器做成常驻后台服务（对齐已有的 `com.pojia.mihomo-ph` / `com.pojia.ssh-tunnel-13306` 做法），**付款开关常开**——这是"无人值守下允许真实扣款"的策略变更，Lemon 已明确同意；
  3. 需要人工时（人机验证、付款未知）推送到手机，不只本机通知。
- **之后**：与 Lemon 做一次业务场景沟通，再由大脑评估四套系统各自需要怎么调整——运营管理后台、客户充值系统、Browser 充值链路、API 充值链路。客户充值页面的优化并入巡检时一起谈。
- **教训（Lemon 原话：确实让我有所警醒）**：方案必须从真实业务流程出发，不能从测试流程出发。此后设计任何流程前，先确认它在"客户任意时间自助兑换、运营不在场"的前提下是否成立。

## D-168（2026-09-11 13:30 UTC）卡段标注已上线（D-162 落地）

- 迁移 `052_cards_bin`：`cards` 增 `card_bin`（卡号前 8 位；发卡产品前缀，非卡号材料，卡台本身就公开展示卡段）。开卡与快照导入两处写入；一次性脚本 `backfill-card-bin.mjs` 回填 **21 张存量卡，0 张读不出**。
- 「一键开卡」卡段下拉现按本方**真实付款历史**标注：`高拒付` / `拒付 x/y` / `成功 x/y` / `样本少`。**尝试次数 < 3 一律只标「样本少」**，不给结论——一次拒付不能给卡段定罪。统计查询失败时照常出列表，不阻断开卡。
- 回填后的真实战绩（只统计点过付款的运行）：`51398996` 6 次里 1 成 5 拒；`53211304` 1 次 1 成。前者界面显示「拒付 5/6」，后者显示「样本少」。
- **两个口径不同，都对**：卡段统计里"成功"含事后由人核实确认的成功（钱到账就是到账）；`run-stats.sh` 的"自动成功"严格排除任何人工操作，回答的是"无人值守能不能跑完"。已在代码注释里写明，避免以后有人拿两个数字对不上当 bug。
- 回归 v1 666/603/0/63；发布 `20260911-card-bin-c65727f`。

## D-169（2026-09-11 14:21 UTC）降低卡台请求频率；开卡不再默认坏卡段

- **Lemon 的顾虑成立**：快照同步每 10 分钟跑一次，每次 1 次列表 + **每张卡 1 次详情**。5 张卡即约 **860 次/天**，其中绝大多数只是为了确认"什么都没变"。卡台不知道我们为什么一直轮询。
- **改法（不是单纯调慢）**：先只拉一次列表与库内比对——列表已包含所有会变的字段（卡在不在、余额、状态），而**卡还在就不可能改 PAN/CVC/地址**，所以列表一致时没有任何可纠正的东西，直接跳过，不发详情请求。有差异才走完整快照，且复用同一次列表结果，不重复拉取。
- **频率**：`pojia-highvcc-snapshot-sync.timer` 由 10 分钟改为 **1 小时**。综合下来约 **24 次/天**（降约 97%）。单量上来后再按订单驱动（分卡前触发一次），不是现在。
- **开卡默认卡段留空**（Lemon 定）：此前 HTML 写死默认 `513989`，正是 6 次真实付款里拒付 5 次的那个段——默认值等于替运营选了最差项。现在必须主动选，选项后面直接显示该段的拒付战绩；未选则算费与开卡都会被拒绝。
- **顺带修**：卡段列表加载失败时不再静默保留写死项冒充已加载列表（Lemon 据此误以为功能没上线）；发布脚本健康检查改为等端口就绪，不再误报 `live=000`。
- 回归 v1 668/605/0/63；发布 `20260911-sync-throttle-4350210`。

## D-170（2026-09-11 14:26 UTC）D-169 的两处现场修正，以及每单真实成本

- **短路一开始根本没生效**：判断用的是 `card.cardNo`，而卡台列表行里的字段其实叫 `lastFour`（已对着线上真实响应核实：行是 `{adress, card, tags}`，card 含 `lastFour/balance/cardId/...`）。读一个不存在的字段恒为 null，于是每次都走完整快照。已修并在生产验证：现在返回 `{skipped:true, reason:'NO_CHANGE', cardCount:5}`，只发 1 次列表请求。
- **教训**：对外部接口的字段名必须对着真实响应核实，不能照着自己写的测试夹具想当然——夹具是我自己编的，编错了测试照样全绿。
- ~~每单真实成本 $20.76~~ **此条作废，是大脑编的，见 D-171。** 正确数字是 **$15.76**。
- 发布 `20260911-sync-lastfour-11dbf3c`（修字段）、`20260911-sync-skip-msg-*`（跳过时明说）。

## D-171（2026-09-11 14:30 UTC）撤回 D-170 的成本结论：每单卡成本就是 $15.76

- **错误**：D-170 写"本单实扣 $20.76，差额是卡台交易费"。**卡台交易费是大脑凭空补的解释，没有任何证据。**
- **事实（Lemon 本人操作）**：卡 3118 $60.00 →（本单扣款 $15.76）→ $44.24 →（Lemon 把卡内约 $5 提回卡台钱包）→ $39.24。$44.24 − $39.24 = **$5.00**，与 Lemon 所述完全吻合。
- **每单卡成本 = $15.76**（ChatGPT 收 ₱982.14，约合此汇率下的 $15.76）。规模测算按这个数。
- **违反的规矩**：`CLAUDE.md`「观察与结论分开」——原始字段只能写成观察，"卡台收交易费"属于业务结论，必须有规则或证据支撑。当时正确的说法是"余额比预期少 $5，原因未知，待查"。本轮已发生两次同类错误（另一次是把中间态当终态报失败），记此以警。

## D-172（2026-09-11 14:33 UTC）大脑本轮全部同类错误清点与此后的硬规则

Lemon 要求整理清楚、不许再犯。以下按发生顺序列出**全部**，不挑轻的说。

| # | 事实 | 后果 | 属于 |
|---|---|---|---|
| 1 | 只看了 3 次拒付就断言「预检不用改」（D-149） | 漏掉 09-10 真单实际卡点，一轮后自己推翻（D-150） | A |
| 2 | 轮询把中间态 `RECONCILE_ONLY` 当终态跳出，拿过期快照报「第 4 单失败」 | 向 Lemon 报了假失败，实际 22 秒后已成功 | A |
| 3 | 收口后在 CURRENT_STATE 写「可分配卡 0 张」 | 与现场不符，被 `state-check.sh` 当场抓到；3118 仍合格 | A |
| 4 | 看到卡余额比预期少 $5，断言「差额是卡台交易费」 | 把每单成本报成 $20.76，实为 $15.76；Lemon 纠正（D-171） | B |
| 5 | 快照短路判断读 `card.cardNo`，卡台真实字段是 `lastFour` | 短路恒不生效，降频白做；测试全绿是因为夹具是我自己按错字段编的 | C |
| 6 | run-stats 首版把人工收口的成功算进自动成功 | 成功率显示 43%，真实 14%；自己发现并改正 | C |
| 7 | 按测试流程设计跑单，要求 Lemon 每单手动执行命令 | 不符合真实业务（客户任意时间自助兑换），Lemon 指出后重做（D-167） | D |

### 三个模式与对应硬规则（此后照此执行，可被检查）

- **A 拿过期或片面的读数下结论。**
  规则：向 Lemon 报任何状态（成功/失败/完成/在跑/数量）之前，**当场重新查一次**，不用本轮早些时候读到的值。轮询时中间态不算终态；只有订单终态字段与 run 终态同时满足才算结束。任何派生的业务状态（合格/可分配/已完成）必须**跑一遍真实规则或查询**得出，不得由我推断。
- **B 给观察补一个听起来合理的原因。**
  规则：数字与预期不符时，只能写「差多少，原因未知，去查」。**没有证据的原因一个字都不写。**（`CLAUDE.md`「观察与结论分开」本就有此条，本轮仍犯。）
- **C 拿自己的夹具/假设当外部事实。**
  规则：外部系统的**字段名、状态值、响应结构**，必须对着一次真实响应核实后才能依赖；我自己写的测试夹具不构成对外部合同的证明。任何统计必须写明分母与排除项，并手工抽查两行再示人。
- **D 按测试流程而非业务流程设计。**
  规则：方案定稿前过一遍「客户凌晨自助操作、运营不在场」，需要人在场的步骤必须显式标出并说明代价。

### 此后怎么做

1. 继续 D-167 的顺序：②执行器常驻无人值守（进行中）→ ③需要人工时推手机 → ④业务场景沟通后评估四套系统。
2. 每次汇报状态前当场重查；每个外部字段先验真响应；每个统计写清口径。
3. 本清单不封存：以后再犯同类错误，续写此表，不另起炉灶。

## D-173（2026-09-11 14:49 UTC）把"靠我记得"换成"机器会拦"

行为约束会随上下文重置失效，脚本不会。据此落地四件：

1. **三条硬规则写进 `CLAUDE.md`**（不只 `DECISIONS.md`）。理由：`CLAUDE.md` 每个会话自动加载，`DECISIONS.md` 要我主动去读才生效——而"忘了读"正是问题本身。
2. **`scripts/wrapup-check.sh`**（新）：说"做完了"之前必须跑。检查工作区干净、已推送、`CURRENT_STATE` 与现场一致、**接班一屏是否还停在旧 release**（本轮就是这一项漏了）、接班一屏更新时间。任何一项失败即不算做完。首次运行即抓到两个未提交文件。
3. **`browser-mvp/scripts/contract-probe.mjs`**（新）：只读打一次卡台真实接口，断言代码依赖的字段名存在（`lastFour`/`balance`/`cardId`/`status`/`expMonth`/`expYear`），并打印真实字段全集。专防 C 类：代码与夹具用同一个错字段名、测试全绿而功能恒不生效。token 过期时明说是 token 的事，不伪装成字段缺失。现已全部通过。
4. **上下文管理**：日常跑单与看数据由 Lemon 自助（`go-live.sh` / `stop-live.sh` / `run-stats.sh`），大脑不进回路；接班一屏是唯一重入点，新窗口读它即可接手，不必重新推导。本轮三件事做完后建议换新窗口，成本归零而不丢事实。

**没做的与理由**：不拆 `DECISIONS.md`（D-142～D-173 线性增长但可检索，拆分只带来搬运成本）；不加自动化定时巡检（现在单量低，人工触发足够，定时任务本身也要维护）。

## D-174（2026-09-11 14:57 UTC）常驻无人值守：监督层已就绪，LaunchAgent 待 Lemon 确认后安装

> **【后续·2026-09-16 复查】已确认并安装：执行器常驻无人值守 2026-09-12 生效（LaunchAgent `com.pojia.browser-pool`，见 PROJECT_MAP §4）；"待 Lemon 确认"已完成。**

- **为什么加一层监督脚本而不是让 launchd 直接跑 worker**：worker 对启动条件是严格断言——付款开关不是 true、隧道不通、比特浏览器没开，一律直接退出。`KeepAlive` 会把这些正常的"条件还没齐"变成秒级崩溃循环。`browser-mvp/scripts/live-pool-supervisor.sh` 先等条件齐再把 worker 拉到前台，worker 退出就回到等待。
- **付款开关仍是人的总闸**：监督脚本**只读**它，不会自己打开。关掉即只等不跑。
- **实测发现并修掉的 bug**：`ready-check.sh` 把付款开关归为 `[信息]` 而非阻断项，监督脚本若只看它的严重级别就会误判"条件已齐"，每 15 秒拉起一次 worker 又被 worker 拒掉（实测复现）。已改为自己单独查开关。修后实测：开关 false 时只打一行日志安静等待，无 worker 进程、无残留、未改动任何开关。
- **worker 自身的资金闸门经此验证有效**：开关为 false 时它拒绝以 PAY 模式启动，报 `browser_payment_writes_enabled must be true`。
- **LaunchAgent 模板**：`deploy/local/com.pojia.browser-pool.plist`（与既有 `com.pojia.mihomo-ph`、`com.pojia.ssh-tunnel-13306` 同一套做法）。**尚未安装**——安装 LaunchAgent 属于改本机配置，须 Lemon 确认。
- **安装后仍需 Lemon 自己决定的两件**：① 把付款开关置 true 并保持（无人值守下允许真实扣款，他已原则同意，但需当次确认执行）；② Mac 不能休眠，且比特浏览器要保持开着——否则条件不齐，监督脚本只会安静等待，客户的单不会被处理。

## D-175（2026-09-11 15:18 UTC）通知改造：看得懂、带订单号、覆盖"没人在干活"

Lemon 的反馈逐条落地：

- **「浏览器付款结果不明，禁止重付」怪** —— 确实怪：`禁止重付` 是系统说给自己听的内部规则，正文里全是 `run <uuid>` 和原因码，既不说是哪个客户，也不说该干什么。改为 **「付款点了但没拿到结果，等你核实」**，正文说清"已点一次、不会重付也不会换卡，请看账号是不是 Plus、卡有没有被扣，然后点「确认核实结果」"。
- 另外两条同样改写：`浏览器充值在付款前终止` → **「充值失败，客户未扣款」**（强调钱没动、CDK 已退、客户可直接重兑）；`浏览器付款核实需要人工` → **「自动核实查不出来，需要你看一眼」**。「浏览器充值完成」Lemon 说最好用，只补上"续费已自动取消"。
- **每条告警自动带订单号**：推送只携带标题与正文，不带任何其他字段，此前无法分辨是哪个客户。改在 `upsertBrowserAlertInTransaction` 统一加，而不是逐个调用点去记得。**查订单号失败不影响告警发出**——告警是安全信号，装饰它不能成为它发不出去的理由。
- **新增两个节点（Lemon 要求）**：`BROWSER_ORDER_SUBMITTED`（客户一兑换就知道）、`BROWSER_ORDER_STALLED`（客户卡住没人处理）。
- **阈值 3 分钟，不是 15**：Lemon 指出客户充值不成功通常三五分钟内就来找他，告警必须比客户快。`pojia-stalled-order-watch.timer` 每分钟查一次，派工任务排队超 3 分钟即推送。
- **为什么这条必须在服务器侧**：Mac 睡了、比特浏览器关了、隧道断了、断电——本机不可能自报，因为它自己不醒着；而且这种情况下根本没有 run 产生，任何既有告警都不会响。服务器常开，是唯一能发现"根本没人在干活"的地方。
- 回归 v1 672/609/0/63；发布 `20260911-alerts-342ad5f`；timer 已 enable 并首跑（`{"stalled":[]}`）；`pojia-worker` 已重启（告警在 worker 与 web 两侧的下单路径都要生效）。

## D-176/D-177（2026-09-11 15:38 UTC）通知按业务场景重排：一单一头一尾，中间态不响手机，缺卡提前提醒

**D-176 去噪（依据是实测，不是判断）**：2026-09-11 唯一一次成功的订单，手机在 63 秒内收到 3 条，第一条还是「付款结果未知」（严重）。该状态是链路的正常中间态——那次成功正是走的它，一分钟后自动核实确认成功。每次成功都先吓一跳，运营很快会开始忽略它，真出事那次也会忽略。

- `BROWSER_PAYMENT_UNKNOWN`、`BROWSER_PAYMENT_CONFIRMED` 不再进手机（仍写入 `operator_alerts`，后台面板照常可见）。前者是中间态，后者与「充值完成」相隔 7 秒重复。
- 真卡住由 `operator-watch` 兜：排队超 3 分钟没人处理；点过付款但结果超 8 分钟没落定且未升级为人工（阈值比 5 分钟核实窗口长，避免同一单推两次）。

**D-177 缺卡提前提醒（Lemon 要求）**：等客户撞上「订单正在等卡」已经晚了——客户在等，而开卡要人去卡台操作。合格卡为 0 时即推 `CARD_STOCK_EMPTY`（不挂任何订单），有卡后自动 RESOLVED，否则这条只会响一次此后永远静默。**资格判断复用权威的 `eligibleInventoryCardSql()`，不自拼**——本轮自拼过一次就得出过错误的「0 张可分配」。

**每单的通知形状（Lemon 问"两条"是什么意思）**：一头一尾。客户一兑换推「客户提交了充值」；结束时按结果推一条，成功是「充值完成」，失败是对应的那一条。同一单同一类型只推一次，不刷屏（`INSERT IGNORE` + `(alert_id, channel)` 唯一约束，已核实）。

**三条失败通知都保留，因为对应三种不同动作**：`充值失败，客户未扣款`→告诉客户可直接重兑；`客户卡住了，没人在处理`→去把本机弄起来；`自动核实查不出来，需要你看一眼`→核对账号与卡后在后台收口。

- `pojia-stalled-order-watch` 已更名为 `pojia-operator-watch`（旧 unit 已停用删除），职责是"没有任何人会告诉你的那几件事"。回归 v1 674/611/0/63；发布 `20260911-card-stock-alert-69946b0`；现场跑通 `{"eligibleCards":1,"stalled":{"queued":[],"unresolvedPayment":[]}}`。

## D-178（2026-09-11 18:11 UTC）客户充值页方案「候光」已固化；Pro 充值能力排在网站之后

- **方案名：候光**（客户在候，页面有光）。日间 `候光·晨雾`，夜间 `候光·石板`。Lemon 评价"非常非常喜欢"。原型与完整规格固化在 `docs/design/`，含设计令牌、九阶段文案、文案硬规则与踩过的坑。
- **核心主张**：这一屏的主角是"时间在流逝"，所以把大进度环做成视觉中心，而不是卡片上一根细条。前三版被评"看不出高级感"，根因是我一直交静态图去评判一个以动效为主体的界面。
- **两处 Lemon 指出并已修**：① 百分比按段缓动到位再停住，看着一跳一跳——改为整条时间线逐帧线性插值，环与数字共用同一个值；② 对勾是反的——`.ring svg` 后代选择器把对勾的 svg 一起转了 −90°，改为 `.ring>svg`。
- **文案硬规则**：不承诺具体秒数，允许「通常几分钟之内完成」；末步叫「订阅成功」。（此前我自己违反过一次，写成「通常一两分钟内完成」，被 Lemon 当场抓出。）
- **装了设计技能**：`~/.claude/skills/refactoring-ui`（GitHub `s0xDk/refactoring-ui-skill`，纯 markdown + 一个 tokens.css，无可执行代码）。它把"看起来廉价"翻译成具体机械修正，本轮的字号刻度、灰阶档数、去边框改底色分层都来自它。官方插件目录与 Lemon 已有技能里都没有设计类。
- **Pro 能力排期（Lemon 定）**：充值网站这一轮做完之后，回头补 **Pro 5X / 20X 的实际充值能力**。这部分推翻 D-146 的"搁置"，但顺序在网站之后，现在不动。
- 下一步：再产出 1–2 版其它方向供对比，若无更好的则以候光定稿。

## D-179（2026-09-11 19:34 UTC）候光定稿并完整固化

- Lemon 确认定稿（"非常好…如果其他风格没有再好的话，我们就用这个"）。原型 `docs/design/prototypes/houguang-v2-full-flow.html`（七屏可点、双主题、含教程弹层与出问题态），规格 `docs/design/README.md`。旧的 v1 单屏原型已删除，避免两份并存。
- **固化下来的不只是长相，还有六条硬规则**（每条都是被指出或被违反过才写死的）：百分比不得提前冲线；不承诺具体秒数；末步叫「订阅成功」；不向客户展示"自动续费已关闭"（卡是运营的，客户不会被二次扣款）；不用「会话数据/登录数据」等中文说法（保留英文 `Session`）；风控提醒文案固定且不得自行补写后果。
- **踩坑清单也一并固化**：`.ring svg` 后代选择器连带旋转对勾；按段过渡 ≠ 匀速；`选择器, @media{}` 是无效 CSS 会废掉其后全部样式；中文字体只有离散字重，`440` 渲染成 400，提升次要文字要改字号而非字重；卡片顶部彩色横条是套路化做法；教程步骤清单与按钮和演示重复。
- **本轮设计的方法论教训**：交静态图去评判一个以动效为主体的界面，必然被评"没有高级感"。这一屏的主角是时间流逝，就得让它动起来再看。
- 下一步：产出 1–2 版其它方向对比；若无更好的即以候光实施（拆四步、CDK 先验、九阶段、订阅查询、去掉时间承诺）。

## D-180（2026-09-11 19:41 UTC）比稿结束：客户充值页采用候光，进入实施

- 另做两个方向供对比（原型 `docs/design/prototypes/directions-compare.html`）：**B 明细**（回执逐行写出，以「第几步/共九步」代替百分比，从根上绕开"进度走完事情没完"）、**C 行列**（竖向时间线，物流式，中国客户零学习成本）。Lemon 选定 **A 候光**。
- 比稿只做"等待中"这一屏：其余五屏（卡密、Session、确认、教程、订单查询）已定稿，三方向一致，不重复设计。
- **可实施性先于美术**：设计前先核对了数据基础——九个阶段的秒级时间戳在 `browser_run_events` 与 `order_events` 中真实存在（以 2026-09-11 成功单 `PJV1-ztS9FZ3Qcw` 核对）。三个方向均不需要新增数据。
- **下一步进入实施**（按 D-167 第 3 项）：拆四步、CDK 先验接口、九阶段映射、订阅查询（查本方记录）、去掉时间承诺、候光视觉与动效。**改的是客户可见的线上页面，构建与自测完成后先给 Lemon 看，经确认再发布。**

## D-181（2026-09-11 19:47 UTC）本项目关闭工具审批弹窗；资金闸门改由规则承担

- **改动**：`AI充值业务/.claude/settings.json` 设 `permissions.defaultMode = "bypassPermissions"`。**仅本项目生效**，Lemon 其余十几个项目照旧。该文件被 `.gitignore` 排除，只在本机、不进仓库。
- **动机**：审批弹窗频繁；全局 `settings.local.json` 已累积 87 条"总是允许"，并且有 `PermissionRequest` 钩子逐次推 Bark，很吵。
- **诚实说明（重要）**：配置里那几条 `ask` 例外（go-live、开卡、补余额、发布切换）是尽力而为——`bypassPermissions` 是否仍会对 `ask` 规则弹窗，我没有验证过，**不能当成保障**。
- **真正的闸门是规则，不是机器**：`CLAUDE.md` 的「资金和生产动作先确认」已加一条前置说明——机器不再拦，所以开卡、补余额、真实充值、提现、发布、生产写库之前必须开口问，不得因为"技术上能直接执行"就直接执行。本轮全程即按此执行（开付款开关、NOT_CHARGED 收口前都先问过 Lemon）。


## D-182（2026-09-12 04:20 UTC）候光实施：卡密校验接口、九阶段、客户页重做

> **【后续·2026-09-16 复查】候光已发布（release `20260912-customer-page-624487c`，D-183/184）；下方"尚未发布"已完成。**

按 D-180 进入实施，三块都已完成并通过全量测试（720 项，0 失败）。**尚未发布**——改的是客户可见的线上页面，等 Lemon 看过再发。

### 1. 卡密校验接口 `POST /api/v1/cdks/verify`（拆屏的前提）

只读，不改任何状态；真正的裁决仍在下单事务里 `FOR UPDATE` 重做一遍。四个答案：`VALID` / `NEEDS_SESSION`（已有订单在等换号，F-34/F-35）/ `BOUND_TO_ORDER`（带订单号，去查进度）/ `INVALID`。

- **比 Lemon 原话多一个状态**：原话是"只回答 有效/无效/已被使用"，多出的 `NEEDS_SESSION` 对应真实存在的换号分支，不给它会让被退回的客户卡死。
- **关键一点：`REDEEMED` 不等于不可用**。订单在 `RECHARGE_FAILED`/`CLOSED` 且没有资金证据时，下单会把码退回。所以把资金证据那段 SQL 从 `cdk-return-repository` 抽成只读的 `readCdkReturnEvidence` + `cdkReturnBlockedBy`，校验与退回两条路径共用一份规则，不会漂移。
- 限流 10 次/分钟/IP；后台域名不提供该路由；`INVALID` 不带订单号和商品名。
- **核过的边界**：`test/public-isolation.test.js` 的禁止清单里有 `/api/verify-cdk`。查证（`c91a0de`，与 stripe/hcaptcha/puppeteer 同批引入）它护的是"不把上游 KC-PAY-GPT 的 legacy 运行时拖回来"，不是"不许校验卡密"——上游本来就是先验码再继续（见 `docs/archive/2026-08/BROWSER_RECHARGE_MODULE_REPORT_2026-08-25.md:91`）。新路径不同、规则自己的，禁令保留。

### 2. 九阶段映射到真实数据

`/api/v1/orders/status` 增加 `stage` 字段（index/code/label/total/floor/ceiling/since），旧的六步 `status` 一字未动。

- **为什么需要**：2026-09-11 那次成功单，`order.status` 从 11:10:04 到 11:15:15 一直是 `RECHARGE_PROCESSING`。只按订单状态画进度，客户要盯一个不动的条看 4 分 49 秒。
- **映射全部来自 2026-09-12 对生产库的实查**：`order_events.to_status` 14 个真实值、`browser_run_events.action` 7 个（session-bootstrap / account-readonly-probe / card-material-preflight / checkout-navigation…）、`browser_operations.operation_type` 12 个。
- **不用 `browser_runs.last_checkpoint_kind`**：它只留最后一个检查点，那单的 `PLUS_ACTIVATED` 被随后的 `CANCELLATION_CONFIRMED` 覆盖了，完整轨迹只在 `browser_operations` 里。这条纠正了 D-180 当时"阶段来自 browser_runs 检查点"的说法。
- **取最远证据而非最新证据**。真实时间轴是 `SUBMIT_UNKNOWN → RECHARGE_PROCESSING → RECHARGE_SUCCESS`，只读当前状态会在交付前 20 秒把客户从第 7 阶段退回第 3 阶段。用那条真实时间轴做测试夹具，逐行断言不倒退。
- 证据查询失败只损失 `stage` 字段，不影响订单状态返回。

### 3. 客户页整页重做（候光）

四步流程（验证卡密 → 核对账号 → 确认兑换 → 开通完成）+ 订单查询 + 教程弹层；进度环逐帧插值、呼吸光晕、九阶段文案。旧页面的每一项能力都保留（本地解析不发请求、恰好一次建单、Session 不回显且建单后清空、换号表单、查询、复制查询码、pageshow 清理、错误码映射、Pro 文案替换）。

**自测中发现并修掉的真问题**（本机 mock 服务器 + 浏览器实跑，桌面与 375px 两种尺寸、明暗两主题）：

| 问题 | 原因 |
|---|---|
| 百分比会精确等于阶段上限 | `exp(-2.6t)` 在一个阶段停留超过一小时后双精度下溢为 0；`Math.round(59.5)` 又抬回上限。现钳在上限下方整一个百分点 |
| 曲线一分钟就到顶不再动 | 段长 26 秒太短。按真实阶段时长（22 秒到 2 分 36 秒）改为 90 秒 |
| 页面切后台后进度完全不更新 | 原来 `document.hidden` 直接跳过轮询。客户提交完常常切走等着，而嵌入式浏览器/iframe 里 `visibilitychange` 未必触发。改为后台降频到 30 秒而非停掉 |
| 每次轮询都重放进入动画并滚回顶部 | `showView` 无条件重放。改为只在视图真的切换时重放 |
| 出问题时环已转琥珀、光晕还是绿的 | 两个元素在同时说相反的话。光晕改为跟随 tone |
| 375px 上顶栏三块各自折行 | 品牌名与两个入口挤不下。收紧字号内距并加 nowrap |
| 教程里箭头在窄屏没转向下 | 媒体查询的 `rotate(90deg)` 被 `slide` 动画的 transform 覆盖。改用竖向关键帧 |
| 窄屏快捷键最后一个键被切掉 | grid 列宽不够。平台名改为独占一行 |
| 窄屏「查询码」标签被挤成竖排 | 24 位码撑爆 flex。标签独占一行，码可折行不省略 |

**一处有意偏离原型**：原型从 Google Fonts 取 Familjen Grotesk 与 IBM Plex Mono。客户在国内，那个域名多半加载不出来、还会吊住首屏，改用系统字体栈，变量名保留，日后自托管只改两行。

**顺手修的既有测试缺陷**：外链白名单的正则 `[^"#]+` 把带锚点的地址整条漏掉（成功屏那条 `#settings/Subscription` 就在漏网里），改为连锚点一起抓、只断域；资源版本号断言写死 `v=12`，每次改版都挂、反过来诱导人去改断言，改为"两个资源都带版本、版本一致、只能往上走"。

**新增 `test/customer-page-houguang.test.js`（16 项）**：把六条文案硬规则和六条踩坑清单逐条变成断言，包括 `.ring>svg` 必须是子选择器、`选择器, @media{}` 不得出现、字重不得低于 400 且必须是整百档、不得出现具体时长承诺、不得出现"自动续费"和"会话数据"、不引入远程字体。

## D-183（2026-09-12 09:30 UTC）服务器直连 ChatGPT 查账号：实测走不通

Lemon 问「客户如果真是 Plus 账号，哪一步才发现」，并授权实测「能不能在客户
填写那一步就查出来」。

### 实测（从生产服务器 144.34.180.184 发起，只读，不带任何客户凭证）

| 请求 | 结果 |
|---|---|
| `GET chatgpt.com/api/auth/session`（无 UA） | 403，返回 Cloudflare 拦截页 HTML |
| 同上，带 Chrome UA | 403，0.049s |
| `GET /backend-api/accounts/check/v4-2023-04-27` | 403，同样是拦截页 |

响应是 HTML 拦截页而不是 JSON，说明请求在边缘就被拒了，根本到不了应用层。
**带上客户凭证也没用**，凭证是应用层的事。服务器出口 IP 是机房 IP，这是
Cloudflare 对数据中心地址的常规封锁。

### 结论

「在客户填写那一步就查账号是不是已经是 Plus」这条路，用现在的服务器走不通。
要走通只有两条路，都被既有决策排除：

- 给服务器配住宅/菲律宾出口 —— D-142 已定不买住宅出口
- 绕过边缘拦截 —— D-153/D-154 已定不做任何检测规避，此条不因重复要求而改变

### 真正该做的是缩短发现时间，不是换检查位置

账号检查现在由本机执行器做（BitBrowser + 菲律宾出口），在九阶段的第 4 步
「正在验证账号」。2026-09-11 那单的实际时间：

| 区间 | 耗时 |
|---|---|
| 客户提交 → 执行器开始干活 | 2 分 35 秒（排队） |
| 执行器开始 → 账号检查出结果 | 21 秒 |

**慢的是排队，不是检查。** D-167 第 1 项「执行器常驻无人值守」做完之后，
客户提交后几秒就能轮到，这个发现自然就快了。不需要为它单开一条链路。

发现已是 Plus 时订单走安全中止：转 `WAITING_FOR_SESSION`，客户动作码
`ACCOUNT_ALREADY_PLUS`，页面提示换一个免费账号，同一单继续跑。**这一步在
付款之前，不产生扣费**（`executor.js` 的 probe 在 checkout 之前）。

### 顺带澄清：`minimumAccessTokenLifetimeSeconds = 300` 不是「复制后 5 分钟内要提交」

Lemon 理解成「客户复制的 Session 超过 5 分钟就作废」，担心提前几小时发来的
会被拒。**不是这样**：ChatGPT 签发的 accessToken 自带到期时间（JWT 的 `exp`），
通常好几天；这条规则看的是「离它自己到期还剩多久」，剩不足 5 分钟才拒。
提前几小时复制的凭证，剩余一般还有好几天，不受影响。

仍建议把门槛从 5 分钟提到 30 分钟：自动跑完一单实测 312 秒（5 分 12 秒），
门槛 300 秒正好卡在边缘——剩 5 分零几秒的凭证能过检查，却会在跑到一半时
失效。**待 Lemon 决定**，改则前后端一起改。


## D-184（2026-09-12 12:40 UTC+8）发布前审查：九阶段的 SQL 写错列名，测试全绿但功能必然失效

Lemon 同意发布，但要求先把前后端链路过一遍。查出一个致命问题。

### 问题

`customer-stage-repository.js` 的 `findStageEvidence` 里取 browser_operations 时写了
`bo.created_at`。**那张表没有这一列**——真实列是 `prepared_at` 和 `completed_at`
（2026-09-12 对生产库 information_schema 核实）。

后果：每次客户查订单状态，阶段解析都会抛 `Unknown column`，被 `order-status-service`
的 catch 吞掉，`stage` 字段永远不返回。客户看到的进度环恒停在 0，阶段名恒为「处理中」。
**九阶段整个功能是死的，而 726 项测试全绿。**

### 为什么测试没抓到

单元测试里 pool 是假的，SQL 字符串从来没被执行过；夹具里也只有 order_events 和
browser_run_events 两段真实数据，缺 browser_operations，所以第 6–8 阶段的推进从未
被测到。**这正是 D-172 第 3 条（外部字段先验真响应）的同一类错，这次错在数据库 schema。**

### 修复与防护

- 改用 `COALESCE(bo.completed_at, bo.prepared_at)`，按自增 `bo.id` 排序，不依赖时间戳非空。
- 夹具补上这一单真实的 7 条 operations，回放测试覆盖第 6–8 阶段。
- 新增 `v1/scripts/customer-sql-probe.sh`：把客户链路的五条 SQL 对着生产库只读实跑一遍，
  任何一条报错就退出非零。**发布前必跑**，已加进 RUNBOOK。

### 用真实数据回放的结果（修复后）

```
   0s  第1步 已收到订单        150s  第4步 正在验证账号     289s  第7步 正在等待支付结果
   1s  第3步 正在排队          180s  第5步 正在获取支付信息  312s  第8步 正在确认订阅
                               246s  第6步 正在提交支付      312s  第9步 订阅成功
```
零倒退。第 2 阶段（准备支付卡）没出现，因为这一单的卡是现成的，0.5 秒就 CARD_READY；
第 8 阶段一闪而过，因为 PAYMENT_CONFIRMED / PLUS_ACTIVATED / CANCELLATION_CONFIRMED
和订单转成功都落在同一毫秒。

### 同批检查过、没有问题的部分

| 检查项 | 结果 |
|---|---|
| 前端错误码映射 vs 后端会抛的码 | 全覆盖，未映射的有兜底文案 |
| 后端九个客户状态 vs 前端 STATUS_VIEW | 全覆盖，另有 REVIEWING 兜底 |
| 客户链路五条 SQL 对生产实跑 | 全部可执行（修复后） |
| 卡密校验与下单事务的判定一致性 | 共用同一份资金证据规则，不会漂移 |
| 阶段证据取不到时的降级 | catch 后只丢 stage 字段，订单状态照常返回 |
| 重复提交 | 按钮置忙 + 下单事务 FOR UPDATE |
| 轮询频率 | 复核/等换号 30 秒，终态停止，后台降频 |

### 已知且接受的行为

- `verify` 只管卡密本身。停单开关关闭、无可用卡这类情况要到下单时才拒绝，客户会多走两步。
  停单是运营主动动作，罕见，不为它在 verify 里加职责。

## D-185（2026-09-12 14:20 UTC+8）带着发现问题的眼光回看过去：三处需要重新审视，其中一处是我当天刚下的错误结论

Lemon 提出「以前做的不一定都对，以前的决策也可能不对，要带着发现问题的眼光看过去的东西」。
照这个要求回看，查出三类问题。

### 一、我当天刚下的结论就是错的：「自动成功率 14%」

`run-stats.sh` 报的是「点过付款的 7 次运行里系统自动跑完 1 次 = 14%」。我把这个数字写进了
四套系统评审底稿和路线图，还据此把「攻成功率」定为第一段的核心。**这个解读站不住。**

按卡段拆开看（2026-09-12 实查）：

| 卡段 | 付款提交次数 | 系统自动成功 |
|---|---|---|
| `51398996` | 6 | 0 |
| `53211304` | 1 | 1 |

**6/7 的样本来自同一个已知有问题的卡段**（D-162 早就标注过 513989 拒付集中）。
唯一换了卡段的那次就成功了。所以 14% 不是「系统自动化只有 14% 的能力」，
而是「一个坏卡段试了六次全败，换个卡段一次就成」。

**真实成功率现有样本无法判断**：好卡段只有 1 个样本。

**对路线图的修正**：第一段的重点不是泛泛「攻成功率」，而是**先用已知可用的卡段跑几单，
把真实成功率量出来**。在坏卡段的样本上做根因分析，会把结论引到错的方向。

**教训**：一个比率必须连同分母的构成一起看。我写「14%」时标了分母是 7 次运行，
却没看这 7 次的构成——这正是 D-172 第 3 条「统计必须写明分母与排除项」的同一类漏。

### 二、「明确不做」清单里三条的前提已经变了

`PROJECT_MAP.md` §6 共 11 条。逐条对照今天的现实，**有三条共享同一个隐含前提：
量小、手动拉起、单子之间间隔很长**。今天无人值守生效后，这个前提不成立了。

| 条目 | 当时的理由 | 现在的变化 |
|---|---|---|
| 不买住宅菲律宾出口 | 2026-09-11「不需要」 | 那时一单一单手动跑。现在连续无人值守，共享出口在连续多单下的表现没验证过 |
| 不做每身份每日上限等限速 | 「无依据」 | 「无依据」本身可以被数据推翻。现在有 38 次运行的数据，虽然还不足以支持限速，但理由已经从「没数据」变成「数据还不够」 |
| 不为每单新建浏览器窗口 | 常驻身份每单清登录态、留设备（09-07 确认） | 那时间隔长。现在同一窗口会连续处理不同客户账号，行为特征与当时不同 |

**这三条我不主张改**，只主张把「理由已经不同」记下来，等真实放量后用数据重新判断。
其余八条（逐单选路线、卡台自动回退、裸调结账接口、为未出现的风控加闸门、第二套账、
删证据、把测试通过说成生产可用等）的理由至今成立。

**注意边界**：第三条涉及设备指纹，D-153/D-154/D-165 已定不做任何检测规避与身份轮换，
本条只记录前提变化，不含任何规避方案。

### 三、死代码里的必然失败

`provider-route-admin-service.js` 的 `switchRoute` 里有一条自引用 UPDATE，MySQL 直接
拒绝（ERROR 1093），执行必然报错。它一直没被发现，因为**该函数没有挂到任何路由**。
生产上那几条路线切换事件是 `setDefaultRechargeMethod` 写的，它用 JOIN 写法所以没问题。

差点误判：切换事件表里有 5 行，看起来这段代码跑通过。只看「表里有数据」就下结论会得出
相反的判断。已修（改成同样的 JOIN 写法）。

**推论：死代码不是无害的**。哪天有人把它挂回路由，第一次点击就报错，没有任何测试会提前
告诉你。清理阶段应当把「挂不到路由的导出函数」一并盘一遍。


## D-186（2026-09-12 14:45 UTC+8）全量 SQL 探针：589 条对生产 schema 零失败；以及我的第四条惯犯

### 结果

`v1/scripts/sql-probe.sh` 把源码里所有可独立执行的 SQL 字面量拿到生产库 `PREPARE` 一遍
（只解析、不执行，对写语句同样安全），**589 条，0 失败**。含 `${}` 插值的 71 条静态拼不出
完整语句，跳过。

结论：**除了 D-184 那个已修的列名错误、D-185 那条死代码里的自引用 UPDATE，
生产代码里的 SQL 全部对得上真实表结构。** 早上那个 bug 是孤例，不是普遍现象——
它之所以出现，是因为那段代码当天新写、还没被任何真实流量碰过。

### 过程本身是一条教训：同一个工具改了四次，每次都是边界没想清

| 第几次 | 误报来源 | 本该先想到的 |
|---|---|---|
| 1 | 嵌套模板 `${fn(\`...\`)}` 被正则切碎，留下 `)}`残片 | 反引号不是简单配对 |
| 2 | `VALUES ?` 是 mysql2 的批量插入语法，标准解析器不认 | 驱动扩展语法不是标准 SQL |
| 3 | 注释里抄着的旧 SQL 被当成真语句——**正是我修 D-185 时留下的那句** | 提取前要剥注释 |
| 4 | `EXISTS (SELECT 1 FROM ...)` 这类条件片段被当成完整语句 | 「包含 SELECT」≠「是一条语句」 |

**根因和 D-184 是同一个**：先做出一个能跑的东西，再靠反馈修补，而不是先把边界条件想清楚。
D-184 是「写完 SQL 靠测试绿了当验证，没想过测试里的数据库是假的」；这里是「写完提取器
靠跑一遍看结果，没想过什么才算一条语句」。

这次代价很低，因为工具的反馈立刻且可验证。但同样的做事方式换到客户页或资金路径上，
代价就不是这个量级。已加进 `CLAUDE.md` 的惯犯清单。

### 已加进发布前必跑

`docs/RUNBOOK.md` 第 5 节：`customer-sql-probe.sh`（客户链路 5 条，快）与
`sql-probe.sh`（全量 589 条，约 8 分钟）。日常改动跑前者，动到 schema 或大范围重构跑后者。


## D-187（2026-09-12 09:35 UTC）第一单真实客户单失败：菲律宾出口被 ChatGPT 封，链路当前不可用

无人值守上线后的第一单真实订单 `PJV1--wEBaAETWx_pKBpTZVp9`，09:25:54 创建，
09:26:31 安全中止，全程 37 秒。

### 资金与客户影响：均安全

| 核实项 | 结果 |
|---|---|
| 付款动作 | 只有 `BEGIN_RUN` 与 `PRE_PAYMENT_ABORT`，**没有 PAYMENT_SUBMIT** |
| 资金证据 | `recharge_attempts` 0 条、`card_consumption_ledger` 0 条 |
| 卡密 | 已退回 `AVAILABLE`、`order_id` 置空，客户可用同一张码重提 |
| 卡 | 未被占用 |

安全中止按设计工作：**付款前就停住，一分钱没动**。

### 根因：出口是机房 IP，被 ChatGPT 整站拦截

失败码 `CHATGPT_ACCESS_BLOCKED`（验证账号身份之前就被挡）。当场从本机经同一出口实测：

| 目标 | 结果 |
|---|---|
| `chatgpt.com/`、`/api/auth/session`、`/backend-api/me` | **全部 403**，返回 Cloudflare 拦截页 |
| `google.com` | 200（出口本身正常） |
| 出口 IP 归属 | `38.60.246.34` · Manila PH · **AS138915 Kaopu Cloud HK Limited（机房）** |

和今天早上从生产服务器访问 ChatGPT 被 403 是**同一个原因**（D-183）：Cloudflare 封数据中心地址段。
2026-09-11 那单成功时这个出口还通，说明是最近的变化。

### 这直接推翻 D-142「不买住宅出口」的前提

D-142 的理由是「不需要」。现在的事实是：**机房出口被封，整条浏览器充值链路跑不通**。
几小时前（D-185）我刚把这条列为「前提已变、等数据再判」，现在数据来了——不是前提变了，
是**理由已经不成立**。

**当前系统实际状态：无人值守开着，但每一单都会在 37 秒后安全中止。不扣款、卡密退回、
客户可以重试但同样会失败。**

### 待 Lemon 定

1. **是否先暂停接单**（后台开关），避免客户反复提交反复失败。现在非终态订单 0，不紧急，
   但有客户来就会踩。
2. **出口怎么办**。这是采购决定，不是技术决定，我只能陈述：现有机房出口已被封，
   同类机房 IP 大概率同样被封。
3. 本条不含任何检测规避方案——D-153/D-154/D-165 的边界不变。


## D-187 更正（2026-09-12 09:40 UTC）：「出口被封」的结论是错的，我用了不成立的测试方法

上面 D-187 把根因定为「机房出口被 ChatGPT 整站封禁」。**这个结论站不住，现予撤回。**

### 推翻它的证据

1. **Lemon 当场在 BitBrowser 窗口里看到的是 ChatGPT 的退出登录页面。**
   页面打得开就说明出口没被整站拦——真被 Cloudflare 封会看到拦截页，不是登录页。
2. **我的测试方法本身不成立**：裸 `curl` 没有 TLS 指纹、不执行 JS，Cloudflare 对它和真实
   浏览器的判定完全不同。用 curl 的 403 去推断浏览器也被封，是拿不相干的证据下结论。
3. **执行器记录的事件序列**也不支持「一上来就被拦」：
   `session-bootstrap`（cookieCount 2）→ 探测失败，原因是 **SESSION_IDENTITY_MISMATCH**
   （身份对不上，即没登录上）→ `session-replaced` 重试 → 第二次探测才报 ACCESS_BLOCKED。
   **第一次失败是身份不匹配，不是被拦。**
4. **cookieCount 2 不是异常**：2026-09-11 那次成功单也是 2（历史分布：4 个 16 次、2 个 15 次）。

### 修正后的根因方向

**Session 没能登录上**，身份验证不通过；重试时第二次探测才收到 403 + Cloudflare 特征，
那更可能是短时间重复请求的结果，而不是起因。

待查：客户提交的 Session 是否新鲜有效、窗口里是否残留其它账号的登录态。

### 这是我今天第二次把未充分验证的结论写进事实源

第一次是「自动成功率 14%」（D-185，没看分母构成）。这次是「出口被封」（用了不成立的测试方法）。
两次都是**拿到一个看起来支持结论的证据就停止求证**。项目规则里「结论必须现场核验」「冲突即停止
下结论」都写着，而我这次恰恰是自己先下了结论，Lemon 用直接观察把它推翻的。

## D-187 续（2026-09-12 09:50 UTC）根因查到一半：首次注入不替换现有登录态，是设计，但前提不符合真实业务

Lemon 反问「难道不应该把窗口清干净然后走流程吗」，顺着查下去找到了第一次失败的必然原因。

### 事实

- `executor.js:154` 首次注入：`bootstrap(sessionLease, runtime.context)`，**不传 `replaceExisting`**，默认 `false`。
- `session-bootstrap.js:181`：窗口里若已有登录 cookie 且未要求替换，**直接返回、保留旧的、不注入新客户的 Session**。
- 全代码库只有 `executor.js:231` 传 `replaceExisting: true`，那是**身份不匹配之后的重试**。
- `page-reset` 名字有误导：它只是 `page.goto(chatgpt.com)` 让注入生效，**不清任何东西**。

### 这是有意设计，注释写明了意图

`executor.js:156-158`「保留租约，因为身份探测可能还需要替换属于上一个客户的常驻 session」；
`225-227`「轮换但匹配的 session 不会走到这里，因为第一次探测就成功了」。
设计是为了照顾**同一个客户的 Session 轮换过**的情况——那时保留现有登录态反而正确。

### 但前提不成立

真实业务是**不同客户依次提交**，连续两单同一账号的概率很低。所以这个「先乐观复用、
不行再换」的设计，在实际场景下**几乎每单都要先失败一轮**：

```
注入(保留旧的) → 探测 → SESSION_IDENTITY_MISMATCH → 替换重试 → 再探测
```

第一单真实客户单正是这样：窗口里留着上一个账号的登录态，这一单的 Session 从没被注入过。
（该单最终失败，但失败与这次多余请求之间的因果**没有证据**，不下结论。）

### 只解释了一半，另一半还没查清

第二次替换确实执行了（事件 `session-replaced`，replacedCookieCount 2），但紧接着就
`CHATGPT_ACCESS_BLOCKED`，没有探测成功。**第二次为什么失败，目前分不清**是：
- 短时间内两次请求触发了限流，还是
- 客户这份 Session 本身就登录不上

**改成首次即替换可以消除这个变量**：一次请求拿结果，不存在「第二次」。但那是改生产执行器
的行为，待 Lemon 定。

### 一并记下的措辞问题

`page-reset` 这个检查点名字让人以为清理过窗口——我自己第一眼也是这么读的。改动时应一并改名
（如 `page-reload-after-inject`），否则下一个人还会被它误导。

## D-187 定案（2026-09-12 09:47 UTC）首次注入改为直接替换窗口登录态，删掉替换重试路径

Lemon 对「要不要把首次注入改成直接替换，也就是先清干净再走流程」答复**同意**。已实施。

### 改了什么

| 位置 | 改动 |
| --- | --- |
| `browser-mvp/src/executor.js:167` | `bootstrap(lease, ctx)` → `bootstrap(lease, ctx, { replaceExisting: true })` |
| `browser-mvp/src/executor.js` 探测失败分支 | **删除**替换重试（含 `session-replaced` 事件、重试后的 `goto` 与二次探测），改为直接 `throw classify(error)` |
| `browser-mvp/src/executor.js` 注入后 | 无条件释放 `sessionLease`（不再有第二次注入要用它） |
| 检查点 `page-reset` | 改名 `page-reload-after-inject`（旧名暗示清理过窗口，实际只是注入后重新导航） |
| `v1/src/domain/customer-stage.js` | 九阶段映射补 `'page-reload-after-inject': 4`；`page-reset`/`session-replaced` **保留**，历史单的证据还要能解析 |
| `v1/public/admin/assets/admin.js` | 事件中文名补「注入后刷新页面」，旧名同样保留 |

### 为什么连重试路径一起删

`session-bootstrap.js:181` 的保留分支只在 `replaceExisting` 为假时进入，因此首次即替换之后
`existingSessionPreserved` 恒为 `false` → 租约注入后立即释放 → 重试分支的 `foreignResident`
恒为 `false`，**那段代码永远不会执行**。留着它只有两种下场：没有测试覆盖，或者靠伪造
provider 返回 `existingSessionPreserved: true` 去人工唤醒——后者正是「依赖是假的、代码从没
真正执行过」的假覆盖。删掉，代码与测试一一对应。

### 对客户的影响（改动的真正价值）

Session 对不上时的失败码从终态的 `CHATGPT_ACCESS_BLOCKED` 变成 `SESSION_IDENTITY_MISMATCH`，
经 `SESSION_ABORTS` 映射为 `WAITING_FOR_SESSION`——**客户在充值页上自己换个账号就能接着跑**，
不必找客服。这比「少打一次 ChatGPT」更要紧。

### 验证

- `browser-mvp`：260 项，251 通过，0 失败，9 跳过。三个原本保护旧行为的测试改成断言新行为：
  `bootstrapCalls` 由 `['preserve','replace']` 改为 `['replace']`；事件序列不再含 `session-replaced`；
  `page-reset` 改名。**未放宽任何断言**——「替换后仍不匹配」一例仍要求 fail closed 且失败码为
  `SESSION_IDENTITY_MISMATCH`。
- `v1`：726 项，663 通过，0 失败，63 跳过。
- `browser_run_events.action` 是 `VARCHAR(64) NULL`（`049_browser_run_events.sql:12`），无枚举、
  无白名单，新事件名可直接落库。

### 仍然没查清的（不要当成已解决）

第一单真实客户单最终失败的**原因仍未确定**。本次改动消除了「多出来那一轮请求」这个变量，
但没有证据表明那一轮就是失败原因。下一单跑之前不要把这条当成已修复的故障。

## D-188（2026-09-12 10:40 UTC）失败单给客户一条自己的出路：卡密能再用就直说，并给入口

Lemon 追问：「客户提交那个页面，如果是真实客户的话，那他还在那挂着你又没给任何解决方案，
你又没给他重新提的入口。」查下来他说的完全成立，而且比想象中更荒唐——**系统早就做对了事，
只是没告诉客户**。

### 查到的事实

| 事实 | 证据 |
| --- | --- |
| 换号表单只在 `ACTION_REQUIRED` 显示 | `v1/public/assets/customer.js:394` |
| `RECHARGE_FAILED` → `FAILED`，不是 `ACTION_REQUIRED` | `order-status-service.js:27` |
| 客户看到的原文案 | 「这一单没有完成，不会产生扣费。请记下查询码联系客服核对。」 |
| 系统内部早就知道客户能重兑 | `browser-execution-repository.js:904` 的运营告警原话：「钱没动，CDK 已自动退回、卡已释放，**客户可以直接重新兑换**」 |
| 重新兑换这条路本来就通 | `cdk-verify-service.js:91-92`：即使卡密还锁在失败单上，只要没有付款证据就返回 `VALID`，intake 会当场退回并开新单 |
| 第一单真实客户单的卡密确实退了 | `cdk_delivery_events` 有 `RETURNED`，CDK `26d58b31`，2026-09-12 09:26:38 UTC |

也就是说：**运营收到的告警里写着「客户可以直接重新兑换」，客户自己的页面上写着「联系客服」。**

### 为什么不能把文案写死成「可以重新兑换」

17 个 `RECHARGE_FAILED` 订单里，**8 个卡密仍绑在原单上**（未退）。查过了，这 8 个
`had_payment_submit = 0`，按现在的规则都该退；它们全部早于 `f8c1d30`（2026-09-07 21:33 UTC+8）
——退回逻辑加进这条路径的那次提交。**是上线前的历史遗留，不是 bug。**

但这证明「失败 ⇒ 卡密可用」不成立，文案必须按每一单的真实情况说。

### 改法

状态接口在 `FAILED` 时返回 `canRetry`，问的是 `cdkReturnWouldBeBlocked`——**和客户在第一步
校验卡密时问的是同一个函数**，所以失败页说的话和校验接口稍后给的答案不会前后矛盾
（该函数的注释本来就是为这件事写的）。查不出来时 `canRetry = false`：宁可让客户找客服，
也不能许诺一个兑不掉的重来。成功单不去问，省一次查询。

页面分两种：
- 能重兑：「这一单没有完成，没有扣费。你的卡密可以直接重新兑换。」+ **重新兑换**按钮（清掉轮询、
  环、上一单状态，回第一步；卡密不回填——客户可能是拿查询码查到这一屏的）
- 不能：「这一单没有完成。请记下查询码联系客服核对。」（去掉了原来的「不会产生扣费」——
  这种情况钱可能真动了）

查询码查询屏同样分流：可重兑的直接进完整进度屏（带按钮），不再给死胡同提示。

### 一并澄清的术语

「付款证据」是**系统拿虚拟卡向 ChatGPT 付款**的证据（资金账本 / 消费账本 / `PAYMENT_SUBMIT`），
与客户购买 CDK 的付款无关。客户不需要、也永远不会被要求提供任何付款凭证。这个词不进客户文案。

### 验证

`v1` 729 项 0 失败（新增 3 项：能重兑 / 不能重兑 / 查不出来时 fail closed / 成功单不问）；
`customer-sql-probe.sh` 五条全通过；本地静态预览确认页面无 console 报错（按钮 id 绑定成功，
否则整页 JS 会挂）、按钮与「复制查询码」主次成对、失败时进度环按 `frozen` 停在失败那一刻而非归零。

### 那 8 个历史遗留订单：没有客户受影响

Lemon 确认（2026-09-12）：**这 8 单都是他自己提交的测试单，不是真实客户。** 无需联系、无需补偿。
记在这里是为了避免下一个接班人看到「8 个卡密未退」又去查一遍。

## D-189（2026-09-12 12:14 UTC）失败后释放什么：原则已定，实施未批准；以及一次论证方式的错误

Lemon 提出的判定标准，用排队打比方：「排到他办业务的时候他没办成，就要从后边重新排队，
不能把位置一直留着给他，也不能让业务员一直等他而耽误别人。」

**本条只记原则与查到的事实。改代码未获批准，不得据此动手。**

### 一、划线的依据不是错误类型，是「恢复这一单要谁动手」

| 谁动手 | 处理 |
| --- | --- |
| 要**客户**动手（重新提交 Session）| **立刻释放**——不知道他多久才回来 |
| 只要**运营**动手（点开关、补卡）| 由运营自己选：立刻释放，或去后台解决让客户无感继续 |
| **恢复时间不可预期**（访问被挡、未知错误）| **立刻释放** |

**压在三条之上的硬约束**：钱可能已经动了（`SUBMIT_UNKNOWN`）→ **绝不释放**。这条与「谁动手」
无关，理由是防重复扣款——卡还绑着，才不会有第二笔钱出去。必须独立写死，不能挂在「谁动手」
底下，否则日后有人重新推导会推错。

### 二、等运营那一类的三个面（Lemon 确认）

1. **手动是权利**：运营随时可点「立刻释放」，不等任何超时。判断权在有信息的人手里——只有他
   知道这问题是五分钟能修还是三天修不好；自动超时两种情况都判错，还可能在他正补余额时
   把单抢先释放掉。
2. **超时是兜底**：只防「完全没人管」（例如夜里）。因为有手动，这个值可以宽松（8–12 小时量级），
   它不是催运营，是别让单烂在那儿。
3. **客户要知道实情**：等运营期间客户看到的是「准备中」+ 几乎不动的进度环（衰减曲线永远逼近
   不到上限）。超过十来分钟应切成 `REVIEWING` 那种诚实话术（「已经收到通知在处理，可记下查询码
   稍后回来看」），别让他盯着假装在动的进度条。

### 三、一单到底占用了什么（对当前代码核实）

**A. 每次 safe abort 都已无条件释放**（`abortBeforePayment`）：`browser_dispatch_jobs`→CANCELLED、
`browser_runs`→FAILED_SAFE/RELEASED、`recharge_attempts`→CLEARED、`recharge_authorization_items`→RELEASED。
**所以执行通道不会被长期占住。**

**B. 现按失败类型决定**：卡（`card_assignment_history`+`cards`）、消费账本额度、卡密、任务。
终态失败全放；等换号与等运营都不放。

**C. 现在谁都没管的三样**：
1. **`orders.assigned_card_id` 释放卡时不清**（`card-release-repository.js` 只动 `cards` 与
   `card_assignment_history`）。**现在不触发**——当前 `WAITING_FOR_SESSION` 时卡根本不释放，
   该字段与实际占用一致。它是**实施「等客户立刻释放」那天必须一起改的前置项**：一旦卡被释放
   而此字段仍留着，客户回来时 `session-replacement-repository.js:43` 的
   `resumeStatus = order.assigned_card_id ? 'CARD_READY' : ...` 会看见它非空而判 `CARD_READY`，
   可那张卡早分给别人了——两单指向同一张卡。（2026-09-12 12:2x UTC 更正：初稿写成「正确性
   bug 级别的坑」，措辞重了，当下并不在流血。）
2. **`orders.session_ciphertext` 从不清除**：全代码库没有一处把它置空。那是能登录客户 ChatGPT
   账号的东西，订单终态后没有理由留着。
3. **BitBrowser 窗口里的登录态**不在库里，上述机制都管不到。D-187 之后下一单开始会替换，但
   「下一单何时来」不确定。有现成工具（`clear-lane-session.mjs`、`reset-login-state.mjs`），
   释放时可顺手清一次，须 best-effort：浏览器本身挂了时清不动，不能卡住释放流程。

### 四、我的一次论证方式错误（Lemon 点出，本条最该被后来人读到）

我曾用订单 `PJV1-uVsqgepiEHu3tfpQKQq-`（2026-08-29，5 次回 `CARD_READY` 后 `RECHARGE_SUCCESS`）
论证「运营处理完后系统能自动跑完，客户无需重新提交」。

**这个论证不成立。** Lemon 指出：那段时期的订单都是他和 AI 一起推进的，中间可能有人手动改状态、
重启 worker、推了一把。历史订单的**结局**分不出「系统自己跑完的」与「有人推完的」。

**教训（适用于此后所有分析）**：无人值守的定义就是**没有 AI 在场**。用「有 AI 干预时期的数据」
论证「无人值守下的系统能力」，前提本身不成立。要看的是**当前代码的自动化路径**和**当前生产的
运行状态**，不是过往记录的结局。

现在能拿出的只有代码事实：回 `CARD_READY` 时任务置 `PENDING`/`attempts=0`，worker 下一轮会捞起。
**从「会被重新捞起」到「能自动跑完」之间，没有任何无干预验证。**

### 五、由此推出的保守结论

「等运营保留占用」的全部价值押在一个**未经证实**的假设上：运营处理完，客户无感继续跑完。
按未证实的假设设计不合理；保守做法是 Lemon 最初的直觉——**直接释放**。释放的结果是确定的
（卡回池、卡密回客户手里、随时可干净重来），而「客户无感继续」目前只是设想。

等有了无干预的真实样本证明它能跑完，再把「保留」作为优化加回来；反过来则危险。

### 六、待验证（唯一可信的验证方式）

真实单运行中出现一次需要运营处理的情况 → 运营处理完后**什么都不做**：不重启 worker、不手动改
状态、AI 不在旁边推。看它能否自己走完。这一次观察胜过翻任何历史订单。

### 七、一并记下的代码事实（未下业务结论）

browser 侧 abort 回 `CARD_READY` 时 `available_at` 直接传 `now`，**没有任何退避**
（`browser-execution-repository.js:879`）；而 v1 任务处理器那条路的 `CARD_NOT_READY` 带
`delayMs: 60_000`。历史上观察到 `PJV1-zffo7WJvbKcPECKcCxzx` 的 `CARD_READY` 事件出现 42 次、
间隔低至 47 毫秒——该观察同样来自有干预时期，只作代码事实的佐证，不作系统行为的结论。

## D-190（2026-09-12 13:32 UTC）真单连跑三次：三个不同的失败原因，其中一个是我改错了

D-187 上线后第一次连续真单。三次全部失败在付款之前，**资金每次都已核实安全**
（`PAYMENT_SUBMIT` 0、`funds_risk_state` CLEARED、卡与账本 RELEASED、CDK 回 AVAILABLE）。
三次原因互不相同，不可混为一谈。

| 订单 | 卡在哪一步 | 原因 |
| --- | --- | --- |
| `PJV1--wEBaAETWx_pKBpTZVp9` | 身份探测前 | 窗口里是上一个客户的登录态——D-187 要修的正是它 |
| `PJV1-sxfJAkvUwt9vimNTncgV` | 进结账时 | 同一份 Session 被重复使用，刷新令牌已耗尽 |
| `PJV1-vEDBfk6iEHSuawpklHls` | **没有结账可进** | 账号有免费试用资格，定价页只给「Claim free offer」 |

### 一、D-187 拿到了直接证据（此前只能推断）

`session-bootstrap` 事件补上计数后，真单落库：
`replacedCookieCount: 2`、`clearedLoginCookieCount: 10`。**窗口里的旧登录态确实被清掉了**，
然后才注入这一单的 Session。此前只能从「没有 `session-replaced` 事件」反推，证明不了。

同一次运行还验证了：只有一次 `session-bootstrap`（首次即替换生效）、`page-reload-after-inject`
新事件名正常落库、身份对不上时直接 fail-closed 不重试。**D-187 的设计意图全部达成**——
失败码从终态的 `CHATGPT_ACCESS_BLOCKED` 变成 `SESSION_INVALID`→`WAITING_FOR_SESSION`，
客户在页面上换号后订单**自动接着跑**（12:46:01 换号 → 同一秒 `RECHARGE_PROCESSING`，无人推）。

### 二、我改错了一次，代价是白创建一个 Stripe 结账会话

`/api/auth/session` 在 200 响应里带 `error: RefreshAccessTokenError`，执行器判 `SESSION_INVALID`。
我对窗口实测：user 完整、accessToken 有效期到 2026-12-11、`authStatus=logged_in`、
页面上 3 个升级入口都在。据此认定原判断误判并放宽——**方向错了**。

放宽后重跑，主站、身份、页面校验、卡料全过，却在进结账时被甩到
`/auth/login?next=%2Fcheckout%2Fopenai_llc%2Fcs_live_…`：**ChatGPT 在结账流程要求重新认证，
刷新链断了就换不来新授权。**

所以原判断**结论对、理由错**：
- 原注释的理由「web app 会渲染成登出、购买控件全部消失」——**证伪**，页面好好的。
- 真实理由：**失败点在结账导航，不在主站页面。**

判断已恢复，注释改写成真实链路。在探测阶段就停还有实际好处：不会白留一个用不上的
`cs_live_…`。**教训**：一处判断的结论和它给出的理由要分开验证；证伪了理由不等于结论也错。

### 三、根因：一份 Session 只够一次购买尝试

刷新令牌只能换一次。同一份 Session 跑过一次之后必带 `RefreshAccessTokenError`，
主站还能进、结账必被拦。**2026-09-12 那三次运行的 `sessionDigest` 完全相同**——
Lemon 一直贴的是同一份，我早该发现却没有。

**运营口径**：失败后必须让客户**重新导出**一份 Session，不能重复贴同一份。

### 四、补上的观测缺口（三处，都是「改了行为却没让证据跟上」）

1. `PAGE_DRIFT` 只有一个词，看不出是 URL 还是标题对不上、当时实际值是什么。现由 `#drift()`
   构造，带 `check`（url / marker-visible / marker-count / title / marker-text）与实际值、期望值，
   经 `error.evidenceDetail` 展开进 `fail-closed` 事件。URL 只留 origin+pathname（query 可能带 token）。
2. `session-bootstrap` 补 `replacedCookieCount` / `clearedLoginCookieCount`（见第一节）。
3. `account-readonly-probe` 补 `sessionError`——降级状态要留痕，不能悄悄放过。

### 五、新发现：免费试用资格让付费链路无处可走（待 Lemon 判断）

第三单用全新账号，定价页显示 **「Try Plus free for 1 month」，₱1100 划掉变 ₱0，按钮是
「Claim free offer」**。**没有结账流程可走**，执行器报 `CHECKOUT_NAVIGATION_FAILED`。

这不是 bug，是业务现实，且有三层影响：
- **越干净的新号越可能拿到试用资格**，所以「用干净新号验证付费链路」这条路本身走不通；
  要验证付费流程得用**没有试用资格**的号。
- **业务问题**：客户自己就能白拿一个月，为什么要买卡密？反过来，若客户的号有试用资格，
  我们收了钱却只能替他点一个免费按钮，这单算不算交付？**此问题待 Lemon 定，未实施任何改动。**
- **绝不自动点那个按钮**：会消耗客户账号的试用资格，而客户买的是付费 Plus。

技术上建议把这一类从笼统的 `CHECKOUT_NAVIGATION_FAILED` 里单独识别出来——「页面打不开」
与「压根没有付款入口」的处置完全不同。是否做、以及是否前移到兑换入口就检测，等业务口径定了再说。

### 六、本轮所有改动

`browser-mvp` 本机代码，pool worker 从工作区启动即生效，不需要服务器发布。测试 252 项 0 失败。

## D-190 续（2026-09-12 14:25 UTC）第四单：手动走结账也付不出去，该账号按特殊情况作废

第三单那个账号（有免费试用 offer 的新号）后续由 Lemon 手动走完了结账流程，结论是
**手动也付不出去**。Lemon 判定这类账号属于特殊情况，**不列入当前讨论范围，本例作废**。

### 只读观察器抓到的轨迹（原始日志存档 `docs/browser-research/MANUAL_CHECKOUT_TRACE_2026-09-12.log`）

```
13:52:16  400  POST /backend-api/payments/checkout/taxes
13:52:35  200  POST https://api.stripe.com/v1/confirmation_tokens
13:52:39  400  POST /backend-api/payments/checkout/confirm
13:54:50  400  POST /backend-api/payments/checkout/taxes
13:55:02  400  POST /backend-api/payments/checkout/taxes
13:55:51  400  POST /backend-api/payments/checkout/taxes
13:56:12  200  POST https://api.stripe.com/v1/confirmation_tokens
13:56:15  400  POST /backend-api/payments/checkout/confirm
```

页面提示：`Check your billing details and try again.`

**能确定的**：卡本身没问题——Stripe 两次都接受了卡并签发 `confirmation_token`（200）；
拒绝来自 **ChatGPT 自己的后端**（`payments/checkout/confirm` 400），不是 Stripe、不是银行。
税费接口在填卡之前就已反复 400。

**未确定**：400 的具体原因。观察器出于安全只记 URL 与状态码，没抓响应体；`confirm` 前后
各有一次 `sentinel/req`（ChatGPT 风控哨兵），是否与拒绝有关，**没有证据，不下结论**。
我曾推测是账单地址国家不匹配（系统配的是美国 DE 州，`production-live-pool-worker.js:113`），
Lemon 反馈**美国地址同样不行**，该推测不成立。

### 记下来的两件事

1. **只读观察器是有效的取证手段**：手动操作不入库、执行器日志也没有，但 CDP 侧挂一个被动
   监听就能拿到完整轨迹。今天靠它才分清「卡被拒」和「ChatGPT 后端拒绝」。下次做同类验证
   可复用（当时用的是临时脚本，跑完已删；要常用可以固化进 `browser-mvp/scripts/`）。
2. **手动并不比自动化容易**：Lemon 曾问「直接点升级填账单付款不就行了，有这么难吗」。
   实测下来手动同样走不通，且手动还缺一样东西——账单地址与卡是配对的，这个知识在系统里，
   人不知道就会填错国家。

### 免费试用 offer 的业务口径仍未定（与本例作废无关，下一个客户仍可能碰到）

D-190 第五节那三个问题照旧待 Lemon 判断：客户自己能白领一个月、我们收钱只能替他点免费按钮
算不算交付、是否在兑换入口就检测试用资格。**未实施任何改动。**

## D-191（2026-09-13 05:10 UTC）排查「为什么接不了单」，查出三处把我自己骗了的地方

起因：上一轮发布完人机验证告警后，执行器没被拉起来。查 supervisor 日志，原因是
「可分配卡 0 张」。但同一时刻 `state-check.sh` 报的是「可分配卡 1 张」——两个官方脚本
互相矛盾。按"冲突即停止下结论"查下去，三处都是我自己的问题。

### 一、`state-check.sh` 把 0 张报成 1 张，修完又报成「一致」

两层错叠在一起：

1. `GROUP_CONCAT` 在零行时返回**字符串 `"NULL"`**，被 `awk -F,` 数成 1 个字段。
   `ready-check.sh` 对它自己的 `HOLD` 变量有这个守卫（第 35 行），`state-check.sh` 漏了。
2. 补上 NULL 守卫后 `ELIG` 变空串，而 **awk 对空输入根本不进 main block**，`N` 成了空串。
   `check` 函数拿 `" 张"` 去和状态表比对——它是表里 `"1 张"` 的**子串**，于是判 `[一致]`。
   **一个查不出值的项被报成"现场与表一致"，比报错更危险。**

修法：计数改 `tr ',' '\n' | grep -c .`，空值明确算 0；`check` 要求现场值至少含一个数字或
字母，只剩单位词的残缺值按取值失败处理（通用守卫，不只挡这一处）。

**教训**：子串匹配的比对函数，必须先验证被比对的值本身是完整的。第 2 层错是我修第 1 层时
引入的——修一个报错引入一个静默假阳性，比原来的错更难发现。

### 二、更严重：两个脚本里的「资格 SQL」是抄的残缺版，会把用满的卡算成可分配

分卡时真正执行的是 `v1/src/services/card-inventory-eligibility.js` 的
`eligibleInventoryCardSql`。两个脚本里那段自称"资格 SQL"的查询比它**少六个条件**：

| 少掉的条件 | 后果 |
| --- | --- |
| 用量 < `card_max_successful_payments`（生产设为 3） | **把已经用满的卡算成可分配** |
| `COALESCE(source_present,1)=1` | 卡台快照里已消失的卡被算进来 |
| `intake_status IN ('ACCEPTED','LEGACY_ACCEPTED')` | 未接管的卡被算进来 |
| `LOWER(status) IN ('active','available','usable','ready')` | 非可用状态被算进来 |
| 无进行中的 `card_funding_attempts` | 正在补钱的卡被重复分配 |
| 无未撤回的 `refund_cases` | 在退款流程里的卡被分配 |

**这不是少算而是多算。** 卡 3118 的消费账本已有 3 笔 `CONSUMED`，正好等于上限——
**给它补钱也不再合格**。而旧口径只看余额：一旦补钱，它就会报"可分配 1 张"，
supervisor 据此拉起 worker 去接一单它其实分不到卡的活，订单最后照样卡在等卡，
而 `ready-check` 会说"全部就绪"。

修法：两个脚本都从 `app_settings.default_minimum_required_card_balance`（Plus 门槛，
现场 16.00）取门槛，再调 `eligibleInventoryCardSql` 生成 SQL，**口径只有一份**。
门槛取不到或非数字、SQL 生成失败都明确报失败，不静默按 0 处理。

**教训**：判断"生产现在能不能做某事"的脚本，绝不能另抄一份业务规则。抄的那一刻它就开始
漂移，而且漂移的方向不可预测——这次是往"过于乐观"漂。这条比 D-184（SQL 引用不存在的列，
测试全绿而生产必然失效）更隐蔽：这里 SQL 语法正确、能跑、有输出，只是**答案是错的**。

### 三、卡台上已经没有的卡，库里还显示有 $50

差一步就把卡 9839 当成"有钱却被误扣的卡"放出来：它余额 $50、有卡密文、无活动占用、
无 `RETIRED` 标记，唯一挡住它的是 `inventory_status='HELD_FOR_REVIEW'`。

查下去是相反的事实：`source_present=0`、`source_operational_status='MISSING_FROM_SNAPSHOT'`。
`sync-highvcc-snapshot.mjs` 每小时拉一次卡台全量快照，**卡台账上只有 5 张卡**，
库里另外 5 张（9839 显示 $50，2911/3241/7428/9354 各显示 $1）在快照里已经不存在，
系统按 `HELD_FOR_REVIEW` 扣下（`manual-card-import-service.js:229-233`）。
**那 $50 是它最后一次出现在快照时的读数，不是现在的钱。**

系统的保守行为是对的。两份事实源都写明"不要手动放出来"。

**教训**：`current_balance` 必须和 `source_present` 一起读。单看余额就是
CLAUDE.md 那条"业务状态不得由单字段推断"的原话场景。

### 四、附带事故：改一个正在被 60 秒轮询调用的脚本，撞上了那个窗口

05:02:19 supervisor 报「条件就绪」拉起了 worker，而 04:58:05 它还在报「可分配卡 0 张」，
中间没有任何卡进来。原因是我正在用 python 重写 `ready-check.sh`，写文件不是原子操作，
supervisor 那一轮读到了半写状态的脚本，输出里没有 `[警告]` 行，于是判定就绪。

后果已核实为零：worker 空转 `ticks: 23, results: 0, errors: 0`，非终态订单 0、
active_runs 0、05:00 后无任何 `browser_runs`。已 SIGTERM 停掉，未动付款开关
（`stop-live.sh` 会连带关闭它，没用那个脚本）。

**教训**：supervisor 依赖的脚本、以及本机 worker 直接读的 `browser-mvp/`、`v1/src/` 源码，
都会被正在运行的进程读到中间态。改它们之前先确认没有进程在轮询/运行，或者接受这个风险。
2026-09-12 17:58 那 6 次 `LANE_FAILURE (humanVerification is not defined)` 是同一类事故。

### 现在的真实结论

**可分配卡 0 张，系统接不了新单**（两个口径双跑一致）。卡台真实账面：
highvcc 5 张共 $11.91（最高 3118 $7.77，且它用量 3/3 已满），
hnskj 11 张共 $0.40（卡段 `40024200`/`43612081`/`40041606` 从未成功过）。
合计 $12.31，一单实耗 $15.72。

**补货只能开新卡，给 3118 补钱无效**（上限已满）。highvcc 钱包余额 **$322.23**
（只读接口 `GET /api/user/wallet` 实查），可开卡段里**有 `53211304`**（vid=710，最低充值 $2）
——正是唯一自动成功过的卡段。**开卡产生费用，等 Lemon 当次确认。**

**客户此刻提单不会静默卡住**：会进 `WAITING_FOR_CARD` 并推一条 critical
「订单正在等待卡片」响手机（`workflow-repository.js:355`）。三条自愈分支在当前配置下
全不成立：3118 属 `manual_excel` 账号（`supports_auto_funding=0`、`supports_auto_open=0`），
刷新候选明确排除 `MANUAL_IMPORT`。所以告警不会被压掉。

### 补货已执行（2026-09-13 05:18 UTC，Lemon 当次确认）

开 1 张 `53211304`（vid=710）充 $50，费用 **$50.50**（开卡费 $0.50 + 充值 $50 + 服务费 0%）。
走 `highvcc-card-service.js` 的 `openCard()` 正式路径：要求逐字确认串 `开卡 710 50`、
开卡后同事务入库、`pan_hmac` 去重防重复记账、失败但钱已花有专用错误码 `HIGHVCC_OPEN_NO_PAN`
指向 `reconcile-highvcc-card.mjs` 补记而不是重开。**没有直接调 provider，也没绕过后台那条路的语义。**

结果（新连接独立核实）：last4 `3159`，$50.00，有效期 07/28，`AVAILABLE`/`ACCEPTED`/`active`、
`source_present=1`、消费账本 0 笔；卡台 cardId `HGf673c192a6684272a6f21d7640d10a0e`、
库内 UUID `e934d5aa-2a46-4dfe-be3c-71f7878956fd`。正式资格 SQL 认它 = 1 张。
**supervisor 在 65 秒后（05:19:32 UTC）自己拉起了 worker，符合 60 秒轮询，未经任何人工干预。**

### 同一个 check 函数，一天骗了我三次

修完前两层后又撞第三层：现场值 `1 张` 作为**子串**命中了状态表里 `11 张卡`（hnskj 那 11 张），
于是漂移被报成 `[一致]`。前两次是 `" 张"⊂"1 张"`，这次是 `"1 张"⊂"11 张"`。

根因是 `check` 用 `grep -qF` 做无边界子串匹配，而这张表里到处是数字。改成 python 正则：
现场值以数字开头/结尾时，在那一侧要求不是数字（`(?<!\d)` / `(?!\d)`）。已自测
「`1 张` 不命中 `11 张卡`」「`5 张` 命中 `5 张`」两个方向。

**教训**：一个比对工具连着三次给出假阳性，说明问题不在某个分支而在匹配方式本身。
前两次我都只修了被发现的那一个输入，没有回头问"这种匹配方式还会在哪里骗我"——
这正是 D-186 那条「先想边界再动手，别拿反馈当设计」的复发。

## D-192（2026-09-13 06:25 UTC）客户页四处返工，顺带查出一个把成功当故障显示的真 bug

Lemon 提了四条：①进度环过渡不平滑；②订阅已经成功了，环要过一会儿才显示成功；
③页面里到处是查询码，只保留 CDK；④成功页「订阅方案」把 ChatGPT 去掉，只写 Plus。

查根因用的是 2026-09-13 第二单（`PJV1-L_fKJY…`，220 秒全自动成功）的真实时间线，
三张表对齐（`order_events` + `browser_run_events` + `browser_operations`），不是推断：

| 时刻 | 证据 | 映射阶段 | 环停留后爬到 | 换段跳多少 |
| --- | --- | --- | --- | --- |
| 03:39:38 | CREATED → CARD_READY | 1 → 3 | — | 阶段 2 被 0.16 秒跨过 |
| 03:39:45 | observe-page | 4 | 18 秒 → 37.6% | **跳 8 点**（到 46） |
| 03:40:04 | card-material-preflight | 5 | 89 秒 → 59% | 1 点，平滑 |
| 03:41:33 | **PAYMENT_SUBMIT** | 6 | 97 秒 → 73% | 1 点，平滑 |
| 03:43:10 | PAYMENT_UNKNOWN | 7 | 8.8 秒 → 77.1% | **跳 23 点**（到 100） |
| 03:43:18 | PAYMENT_CONFIRMED / PLUS_ACTIVATED / CANCELLATION_CONFIRMED | 8 → 9 | 三条时间戳完全相同 | 阶段 8（88→97）永远看不到 |

### 一、真正的问题不是"整体不平滑"，是两个特定的跳点

段长常数 `SEGMENT_MS = 90000` 对阶段 5、6 恰好合适（它们真实就是 89 / 97 秒，曲线爬满，
换段只差 1 个百分点）。出问题的是**实际停留远短于 90 秒**的阶段：阶段 4 只有 18 秒、
阶段 7 只有 8.8 秒，曲线才爬到四成就被下一段拽走。而阶段 8「正在确认订阅」压根没有
停留时间——三个操作同事务提交，所以客户看到的是 77% 直接变 100%。

**改法**：不去猜每个阶段该多长（只有两单样本，猜出来的段长下次就不对），而是让**换段本身
变成过渡**：每帧只走掉目标差距的 12%，跑完那一下用 700ms 的 easeOutCubic 滑到 100。
这样无论将来各阶段耗时怎么变，跳变都被吸收掉。`SEGMENT_MS` 保持 90 秒不动。

**代价**：环不再严格等于"曲线当前值"，会滞后几百毫秒。不变量 5（百分比在阶段上限下逼近、
只有真成功才置 100）不受影响——追赶的目标值本身仍是钳过的曲线值。

### 二、顺带查出的真 bug：付款成功的那几秒，客户看到的是橙色「遇到点问题」

`SUBMIT_UNKNOWN` 原本和 `RECONCILIATION_REQUIRED` 一起映射成客户态 `REVIEWING`：

```js
REVIEWING: { tone: 'warn', poll: 30000, hint: '遇到点问题,我们已经收到通知在处理。…' }
```

但 `SUBMIT_UNKNOWN` 是**每一单必经的一步**（付款已提交、结果待确认），今天两单各在此停
8~9 秒。后果有两层：客户在钱已经付掉、Plus 已经开通的那几秒看到橙色警告和"遇到点问题"；
而且前端把轮询从 4 秒降到 **30 秒**，于是 8 秒后订单已经 SUCCESS，客户还要等下一轮才看到。
**这就是 Lemon 说的第②条「得有一会儿」的主因。**

改法：新增客户态 `VERIFYING`（tone ok、poll 3000、文案"支付已提交,正在和 ChatGPT 核对
开通结果"）；`CONFIRMING` 的轮询也从 6 秒压到 3 秒（那一段最快只有几秒）。
真正需要人工对账的情况有自己的状态 `RECONCILIATION_REQUIRED`，不借这个状态表达。

**但不能就这么放过去**：如果付款结果确认得久，客户干等着看不出所以然比看到警告更糟。
所以按**阶段停留时长**降级——超过 3 分钟仍在 VERIFYING，切到 warn 文案 + 30 秒轮询
（`resolveView()` / `VERIFYING_PATIENCE_MS`）。用的是 `stage.since`，不新增后端字段。

### 三、还剩一段延迟，它是真实的，不能靠 UI 消除

客户在 ChatGPT 侧能用的时刻 ≈ 点付款之后（03:41:33 `PAYMENT_SUBMIT`），我们标 SUCCESS 是
03:43:18，**差约 105 秒**：97 秒确认付款结果 + 8 秒核实 Plus 与取消续费。
**这段不能靠提前标成功来消除**——那会破坏「付款结果不明确必须锁定、禁止自动重试」这条硬约束。
能做的只有两件，都已做：文案说清在等什么，轮询别比这段还慢。

### 四、去掉查询码：能做，但成功页那一行只能删不能换

后端查询接口**已经支持用 CDK 查**（`normalizeLookup` 接受 cdk，走哈希查找），所以
「订单查询」入口只要卡密没有问题。但**状态接口不返回 CDK**（凭证不回传，这是对的），
所以成功页那一行不能改成显示 CDK，只能整行去掉。已去掉的：查询码行、等待屏的订单号行、
「复制查询码」按钮；所有"查询码"文案改成"卡密"。

客服侧不受影响：后台搜索支持 CDK（`admin/index.html:69`），也有 `find-order-by-cdk.mjs`。
`runQuery` 仍然认 `PJV1-` 前缀（宽进严出），老订单号还能查，只是不再主动给客户。

### 五、订阅方案短名

后端 `product-labels.js` 给的是 `'ChatGPT Plus'`，而 `customer.js` 早就有个
`productShortName()` 专门去前缀，只是成功页、确认屏、查询屏三处直接用了原始 label。
三处都改成走短名。后端 label 不动——后台和内部报表仍要全名。

### 落地

改动：`v1/src/services/order-status-service.js`（一个映射）、`v1/public/assets/customer.js`、
`v1/public/index.html`（资源版本 v=36 → v=37）。测试 733 项 0 失败，
其中两条旧断言按 Lemon 这次的指令改写（查询码那条原是设计稿硬规则），
并新增两条守住这次修复：「付款结果确认中是正常态」「进度环不跳」。

## D-193（2026-09-13 07:05 UTC）进度环改匀速：百分点按真实耗时分配，段内线性

Lemon：「你是一段一段的一块一段快一段慢。我希望尽可能是匀速从零到 100」，
并指出演示里的 45 秒不真实——真实一单远不止 45 秒。

### 根因不在曲线，在百分点怎么分

九个阶段的上限原本是 10/22/32/46/60/74/88/97/100，每段 9~14 个点，**按阶段数平均分**。
但各阶段真实耗时差 600 倍（分母：2026-09-13 仅有的两次全自动无干预成功单，
三张表对齐取的分段耗时）：

| 阶段 | 单1 150.3s | 单2 220.5s | 平均 | 旧跨度 | 新跨度 | 新速度 %/秒 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 已收到订单 | 0.65s | 0.16s | 0.4s | 10 | 2 | — |
| 2 准备支付卡 | 0s | 0s | 0s | 12 | 4 | 见下 |
| 3 正在排队 | 3.75s | 1.34s | 2.5s | 10 | 3 | — |
| 4 验证账号 | 24.8s | 24.1s | 24.5s | 14 | 11 | 0.45 |
| 5 获取支付信息 | 75.4s | 89.6s | 82.5s | 14 | 42 | 0.51 |
| 6 提交支付 | 36.7s | 96.5s | 66.6s | 14 | 32 | 0.48 |
| 7 等待支付结果 | 8.9s | 8.8s | 8.85s | 14 | 4 | 0.45 |
| 8 确认订阅 | 0s | 0s | 0s | 9 | 1 | —（同事务提交，零停留）|

**阶段 5+6 吃掉全程 80% 的时间却只分到 28 个点；阶段 1+2 几乎不花时间却占 22 个点。**
这就是"开头唰一下冲到二十几、中段磨很久"的来源。段内那条 `1-e^(-2.6t)` 又叠了一层：
它在段内前 1/4 时间就走完近一半区间。

### 改法三条

1. **上限按真实耗时占比重分**：2/6/9/20/62/94/98/99/100。阶段 4~7 占全程 99% 的时间，
   新速度落在 0.45~0.51 %/秒。
2. **段内线性**，且每个阶段用**自己的** `typicalMs`，不再共用 90 秒常数。
3. **超过典型耗时后不停住**：前 94% 匀速走完，剩 6% 指数逼近上限（永不到顶）。
   停住的环和卡死的环长得一模一样；留一条越来越慢的尾巴，既照实说"比预期久了"，
   数字又始终在变。

`typicalMs` 随 stage 一起从状态接口下发，**前端不存第二份阶段表**——副本一旦漂移，
进度条就会和文字说的阶段对不上（同 D-191 那条教训：判断类代码不抄业务规则）。

### 实测（两单真实时间线，每 15 秒走多少个百分点）

```
单2 改前  36.5 11.1 4.3 2.8 1.8 1.2 0.8 3.2 4.3 2.8 1.8 1.2 0.8 0.4 27.0
单2 改后  14.2  7.9 7.0 7.0 7.0 7.0 7.0 7.0 6.6 6.6 6.6 6.6 1.3 0.4  8.0
单1 改前  35.7 10.6 4.8 3.1 2.0 1.3 2.5 4.9 3.2 8.9
单1 改后  13.1  7.3 7.0 7.0 7.0 7.0 13.7 6.6 6.6 21.5
```

### 还剩的不匀，以及为什么留着

- **头 15 秒走 13~14 个点**：阶段 1~3 合计只花 1.5~4 秒却占 9 个点。压缩它们能更匀，
  但那 9 个点里有 4 个是**留给等卡的**——成功单里阶段 2 耗时为 0，没卡时订单却会停在
  `WAITING_FOR_CARD` 很久。按占比它该拿 0 个点，那样客户等卡时环完全不动。
  等卡是异常路径、开头冲是每单必现，这里选了照顾异常路径。
- **单1 末尾跳 21.5**：它的阶段 6 只用了 36.7 秒（典型 66.6 秒），环才走到 75% 就跑完了。
  换段与跑完都有追赶过渡（D-192），视觉上是加速爬升而不是瞬移。
- **样本只有两单，阶段 6 波动已经很大（36.7s vs 96.5s）。** 攒够更多无干预成功单要回来
  重算——改的只是 `CUSTOMER_STAGES` 那张表，前端会跟着变。

### 不变的安全语义

百分比永远停在**本阶段上限下方一个百分点**，只有真正订阅成功才置 100
（不变量 5）。一个阶段拖得再久也不会走进下一段的区间——"字还写着正在提交支付，
数字却已经是下一段"比爬得慢更糟。

## D-194（2026-09-13 07:35 UTC）真实客户单卡住 11 分钟：我开卡时存了两位年份

**这是今天唯一一次真实客户单，被我自己昨天写进规矩的那条坑住了。**

### 现象

`PJV1-XrDZCfpakRwaoRQLrEbS` 07:21:20 提交，卡 3159 正常分配，执行器接手后
**连续 10 轮**走到 `page-signature` 就 `fail-closed`，订单停在 `RECHARGE_PROCESSING` +
`failure_code=CARD_NOT_READY`，日志是 `stored card material preflight failed`。
客户在页面上等了 11 分钟。

### 根因：highvcc 开卡接口返回的有效期年份是两位

`normalizeStoredCardCredentials`（`browser-mvp/src/shared-encrypted-materials.js`）有一条
过期校验：`expYear * 12 + expMonth` 必须 ≥ 当前年月。

| 卡 | 入库时的 expYear | expiryIndex | 当前 | 判定 |
| --- | --- | --- | --- | --- |
| 3159（今天 `openCard()` 开的） | **`28`** | 28×12+7 = **343** | 24321 | **判为已过期** |
| 3118（Excel 导入） | `2028` | 24338 | 24321 | 有效 |

`manual-card-import-service.js` 从 Excel 的 `有效期` 列解析时写了 `2000 + Number(exp[2])`，
`highvcc-card-service.js` 的 `recordOpenedCard()` 直接用了卡台返回的 `card.expYear`。
**两条写入路径格式不一致，而开卡这条今天才第一次真用。**

**我犯的是 D-172 第 3 条**（外部字段先验真响应）：开卡那轮我只核对了"返回了卡号、有效期、
余额"，没核实**年份是两位还是四位**。当时 `openCard()` 的返回里写着 `expires: "07/28"`，
我还把它抄进了 CURRENT_STATE，一眼扫过去像是四位年。

### 钱一分没动，这部分系统是对的

10 轮全是 `BEGIN_RUN → PRE_PAYMENT_ABORT`，**没有一条 `PAYMENT_SUBMIT`**。
执行器拒绝用一张"看起来已过期"的卡付款——这个拒绝本身完全正确，保护生效了。
卡上的 $50 原封不动，CDK 也没被消耗。

### 修了两处，两边都不依赖对方

1. **读取侧容错**（`shared-encrypted-materials.js`）：`0~99` 的年份补成 `2000+`。
   这条对**所有已入库的卡立即生效**，所以不用改数据、不用重开卡。
   加了回归断言守着三件事：两位年补成四位、四位年原样通过、**真过期的卡照样拒**
   （容错不是放行）。
2. **写入侧修正**（`highvcc-card-service.js`）：开卡时就存四位年，数据干净。
   **这一半在服务器上，要发布才生效**，下次开卡前必须发。

### 修完立刻通过

改动 07:28:28 落盘，supervisor 07:29:39 自己拉起 worker（我只 kill 了 worker，
没动付款开关），加载的就是修好的代码：

```
07:30:23  card-material-preflight   ← 前 10 轮从没通过过这一步
07:30:50  checkout-navigation
07:31:34  PAYMENT_SUBMIT
07:32:15  PAYMENT_UNKNOWN
07:32:26  PAYMENT_CONFIRMED / PLUS_ACTIVATED / CANCELLATION_CONFIRMED
```

**修复后这一轮 152 秒跑完，实扣 $15.72**（卡台 `1572分 PENDING 07:31:52`，
与 `PAYMENT_SUBMIT` 相差 18 秒）。订单总时长 665 秒是因为前面白跑了 10 轮。

### 教训（新增，比"验字段"更具体）

**一条写入路径没有被真实跑过，就等于没写过。** 卡 3118 走 Excel 导入、卡 3159 走 API 开卡，
两条路径写同一张表的同一个字段，格式却不同，而只有一条被真实用过。
**以后新增或首次启用一条写入路径，必须拿它写出来的数据，跑一遍下游的真实校验**——
不是看写入成功，是看下游认不认。今天代价是一个真实客户等了 11 分钟。

### 顺带：第三个分段耗时样本（给 D-193 的进度环）

修复后那一轮（152 秒）：阶段 4 = 29.8s、阶段 5 = 70.7s、阶段 6 = 40.9s、阶段 7 = 10.8s。
三单平均变为 26.2 / 78.6 / 58.0 / 9.5，当前 `typicalMs` 是 24.5 / 82.5 / 66.6 / 8.85。
**差异不大，本轮不动**——单2 的阶段 6（96.5s）仍是离群值，样本到 5 单以上再重算。

**真实成功率当场重查：33%（4/12）**（总运行 60、付款前中止 46、点过付款 12、
系统自动成功 4、已自动退订 4）。

## D-195（2026-09-13 08:05 UTC）跑完一单立刻回填卡余额，不再等小时级快照

Lemon 拍板：「改成立刻」。方向早在 D-169 就定了——「单量上来后再按订单驱动（分卡前触发一次），
不是现在」。第一个真实客户单跑通，就是"单量上来"的时候。

### 问题

付款确认会把卡置成 `DEPLETED`、`current_balance=NULL`（`browser-execution-repository.js:1139`）。
而 highvcc 的卡 `sync_tier='MANUAL_IMPORT'`，**不在 `pojia-card-read-sync` 的范围内**：
那个每 15 秒的 runner 用的是 `HnskjCardProvider`，且 `manual_excel` 账号 `supports_api_sync=0`。
于是余额只能等 `pojia-highvcc-snapshot-sync` 那个**小时级** timer 回填。

2026-09-13 实测：07:32 付款完成 → 07:22 那次同步早于付款（判 `NO_CHANGE` 没写）→
下一次要等 08:22。**系统整整一小时接不了下一单**，而库存本来就只有这一张卡。

### 改法：不新增任何写余额的代码路径

跑完一单后，把**既有的正式快照同步**提前触发一次（`createHighvccSnapshotSyncService().commit()`），
挂在 pool worker 的 `onResult` 上。

**为什么不直接按实扣金额扣减本地余额**——那样更"立刻"也更省一次 API：
因为多一条写资金数据的路径就多一份格式漂移的风险。**当天的两位年份事故（D-194）
正是"同一个字段两条写入路径、格式不一致"造成的**，而那条路径当时看起来也很无害。
快照同步这条路已经带审计批次、带 `NO_CHANGE` 短路、被 timer 每天跑 24 次验证过。

### 哪些单值得去问卡台

`shouldRefreshCardBalances(status)`：`SAFE_ABORTED`（付款前中止，钱没动）和 `IDLE` 不触发，
其余都触发。**这个区分是必要的**：2026-09-13 那单因为卡材料预检失败连续中止 10 轮，
不区分就是 10 次无谓的卡台请求。提成了导出的纯函数，有断言守着。

### 代价与边界

- **每单跑完多 2.5 秒**（实测 `commit()` 往返 2517ms）。换掉最多 1 小时的等待。
- **需要给执行器加一把 key**：`CARD_INTAKE_PAN_HMAC_KEY_BASE64`（快照走 manual-card-import
  正式路径要它做 PAN 去重），已加进 `run-live-pool.sh`。
  **它是可选的**：没配就打一行日志退回小时级 timer，执行器照常启动——
  付款比回填重要，绝不能因为少一把回填用的 key 就让整个池起不来。
- **回填失败不影响付款**：整段 try/catch 吞掉，只记日志。
- 小时级 timer **保留不动**，它仍是兜底。

### 过程中的两个坑

1. **改错了文件**：`loadProductionLivePoolConfig` 在 `production-live-pool-worker.js` 里有
   **自己的一份** key 加载逻辑，`production-live-config.js` 那份是 single worker 用的。
   先加到了后者，pool worker 读不到。**这本身又是"同一概念两份实现"的例子**，与 D-191、
   D-194 同源。误改已撤回，不留死代码。
2. **时序骗了我一次**：重启后日志仍报 `card balance refresh disabled`，查进程环境发现
   key **已经拿到**了——是 worker 在 15:58:15 启动、而 config 改完是 15:59:59，
   它加载的是旧代码。差点当成 bug 去查环境变量。**当场查进程真实环境**戳破了它。

### 验证

用与 worker 内部完全一致的构造方式实跑一次：2517ms、`skipped NO_CHANGE cardCount=6`
（刚同步过所以无变化，不写库）。重启后的 worker 启动日志中 `card balance refresh disabled`
一行消失，即 key 已就位、能力已启用。**真实效果要等下一单跑完才算完整验证**，届时应在
执行器日志看到 `card-balance-refresh` 一行。

## D-196（2026-09-13 08:20 UTC）成功页给回「订单号」（其实是卡密），圆环校准，以及流程提速能提在哪

Lemon 三问：①成功页的订单号没了，客户以后怎么查；②圆环时间偏长，流程稳定了要调短；
③已经有几单了，流程上哪些能继续省时间。

### 一、「订单号」显示客户自己的卡密

D-192 按 Lemon 当时的指令把订单号整条去掉了，代价是成功页没有任何可查的凭据。
现在补回来，但**填的是客户自己那张卡密**——他手上本来就有，拿它就能查回这一单，
不必再记一串新的码。

**状态接口仍然不回传 CDK**（凭证不该回传，这条不动）。前端用的是**客户自己输入的那一份**：
兑换时是第一屏输入的，查询时是查询框输入的，两条路都在浏览器里，不经服务端。
老客户若用 `PJV1-` 订单号查进来，前端没有卡密，这一行**整行不显示**，不编一个假的给他。

### 二、圆环按三单重新校准（但这不是"把进度条调快"）

| 阶段 | 单1 | 单2 | 单3 | 新 typicalMs | 原值 |
| --- | --- | --- | --- | --- | --- |
| 4 验证账号 | 24.8s | 24.1s | 29.8s | **26.2s** | 24.5s |
| 5 获取支付信息 | 75.4s | 89.6s | 70.7s | **78.6s** | 82.5s |
| 6 提交支付 | 36.7s | 96.5s | 40.9s | **58.0s** | 66.6s |
| 7 等待支付结果 | 8.9s | 8.8s | 10.8s | **9.5s** | 8.85s |

典型总时长 182.5s → **172.3s**。ceiling 未动（按新占比重算后偏差在 1~2 个点内，不值得改）。

**必须说清楚**：圆环走多久取决于流程本身走多久。校准只是让它更贴合真实，
**要让客户等得更短，只能缩短流程**，见下。

### 三、流程提速：73% 的时间在两步，而这两步是黑盒

三单的每一步间隔（`BEGIN_RUN` 起算，平均）：

| 步骤 | 单1 | 单2 | 单3 | 平均 | 占比 |
| --- | --- | --- | --- | --- | --- |
| BEGIN_RUN → observe-page | 6 | 5 | 8 | 6.3s | 4% |
| → session-bootstrap | 6 | 5 | 6 | 5.7s | 4% |
| → page-reload-after-inject | 3 | 3 | 5 | 3.7s | 2% |
| → account-readonly-probe | 5 | 6 | 5 | 5.3s | 3% |
| → page-signature | 0 | 0 | 0 | 0s | — |
| → card-material-preflight | 2 | 2 | 3 | 2.3s | 1.5% |
| → checkout-navigation | 17 | 21 | 26 | 21.3s | 14% |
| **→ PAYMENT_SUBMIT** | 58 | 68 | 43 | **56.3s** | **36%** |
| **→ PAYMENT_UNKNOWN** | 36 | 96 | 40 | **57.3s** | **37%** |
| → PAYMENT_CONFIRMED | 8 | 8 | 10 | 8.7s | 6% |
| 合计 | 141s | 214s | 146s | 167s | |

**两个大头合计 73%，而它们内部没有任何事件埋点**：现有 11 个 action 里 `checkout-navigation`
是最后一个；`browser_operations` 的 `prepared_at` 与 `completed_at` 是同一时刻写的，挖不出细分。
所以**现在说"优化哪里"都是猜**。

已知在这两段里的东西（代码读出来的，不是实测占比）：

- `checkout-navigation → PAYMENT_SUBMIT`：由 LIVE adapter 独占一整趟
  `card → address → email → requote → submit`。里面串着**三个 30 秒超时**
  （`fillBillingAddress` / `fillTransientBillingEmail` / `observeStrictQuoteAfterReprice`，
  都用 `repriceTimeoutMs=30_000`）。等待循环本身是 100~250ms 轮询，**不是我们加的固定延迟**。
  零税重算那段尤其可疑：填完地址后 ChatGPT 要重新计税，我们要等税变成 0 才肯付。
- `PAYMENT_SUBMIT → PAYMENT_UNKNOWN`：`watchPostSubmit`（窗口 60s、**轮询间隔最多 5s**）
  加 `confirmPlus`（`timeoutMs=60s`、轮询 1s、**页面稳定等待 15s**、导航超时 45s）。
  付款真成功后最多**晚 5 秒**才被发现，这一条是确定的浪费。

### 建议的顺序（未实施，等 Lemon 定）

1. **先埋点，再优化**。给 adapter 那一趟加 4~5 个 checkpoint（填卡完、填地址完、
   零税通过、点付款前），给付款后那段加 2 个（离开结账页、Plus 确认）。
   **它改的是付款路径，是全系统最敏感的地方，应该单独做、单独发、单独验**，
   不和别的改动混在一起。下一单跑完就有真数据。
2. 埋点有数据后，最可能的两个收益：把 `watchPostSubmit` 的轮询从 5 秒压到 1~2 秒
   （确定的 0~4 秒收益）；看零税重算实际等多久，若远小于 30 秒则该超时可收紧。
3. 前段那 23 秒（14%）是真实页面操作（起页、注入、刷新、探测账号），
   **暂不动**——省几秒而碰 Session 注入链路不划算，那是 D-187 刚修好的地方。

**不做的事**：不为了省时间去掉零税校验、不去掉付款后的 Plus 确认。
前者是硬约束（含税价必须拒付），后者是"付款结果不明必须锁定"的依据。

## D-197（2026-09-13 09:05 UTC）缺卡告警阈值从 0 改回 1，并补上它缺失的写入路径

### 阈值 0 等于告警形同虚设

`workflow-repository.js` 分卡后会检查 `可分配卡数 <= card_stock_low_threshold` 并发
`CARD_STOCK_LOW` 告警。现场值是 **0**，也就是**一张卡都不剩时才报**——而那时客户提单已经
触发 `ORDER_WAITING_FOR_CARD`（critical）了，这条"库存偏低"的提醒等于没有。
最后一条 `CARD_STOCK_LOW` 停在 2026-09-06。

改成 **1**：还剩最后一张时就提醒，运营能在用光前把卡开出来，客户不会撞上等卡。
同一个 `dedupe_key` 不会重复插入，不会刷屏。

**审计翻出的历史（值得留意）**：`admin_setting_events` 显示它**原本就是 1**，
是 **2026-08-30 09:09 被 actor=admin 从 1 改成 0 的**。当时的理由未知——已向 Lemon 求证
是否因为告警太吵。若是，需要的是收敛告警频次，而不是把阈值降到形同虚设。

### 顺带补上这个设置缺失的写入路径

后台只**读**不写 `card_stock_low_threshold`（`admin-read-service.js:758`），
`admin-operations-service.js` 里的 `writeSettingWithAudit` 是内部函数、只服务几个布尔开关。
于是这个设置没有任何正式写入路径，而 `prod-query.sh` 是只读工具、不得用于写库。

新增 `v1/scripts/set-card-stock-threshold.mjs`：走正式连接池 + 事务 + `admin_setting_events`
审计，默认 dry-run、`--apply` 才写，值域限 0~50，值没变就不写也不记审计。
**脚本里的库存数直接调 `eligibleInventoryCardSql`**，与告警里 `remaining` 的口径完全一致——
不在脚本里抄第二份规则（D-191 的教训）。

### 一次自我纠正

第一版脚本里我手写了一段"余额达标的卡"查询，报出 2 张，而我记得正式口径是 1 张，
当即判断"我又抄了残缺规则"。**这个判断是错的**：用正式口径重查同样是 2 张——
多出来的是 09:02 新开的卡 5371。**差值的原因是库存真的变了，不是口径不同。**
（仍把脚本改成调正式口径，因为抄一份就是将来漂移的隐患。）
这正是 D-172 规则 A 的反面教材：我拿 30 分钟前的读数当成了"现在的事实"。

## D-198（2026-09-13 09:40 UTC）浏览器的瞬时故障被当成「客户的 Session 无效」，害客户换号也过不去

### 现象

真实客户单 `PJV1-pom5NfWiskFl9u4Aspdm` 卡在 `WAITING_FOR_SESSION`，客户页显示
「当前 Session 无效，请重新获取完整 Session」。Lemon 反馈「明明已经登上去了」——**他是对的**。
他按提示换了一次 Session（`session_replacement_count=1`），**报的还是同一个错**。

底层错误：

```
page.evaluate: Execution context was destroyed, most likely because of a navigation.
```

这是 Playwright 的瞬时故障：我们在页面导航的当口执行 JS，执行上下文被销毁。
**跟客户的 Session 一点关系都没有。**

### 根因：兜底归类把一切未知错误当成 Session 问题

`executor.js:210`：

```js
const reason = sessionReasons.includes(error?.code) ? error.code : 'SESSION_INVALID';
```

那条 Playwright 错误**没有 `code`**，于是撞上兜底。后果是双重的：
客户被要求换号，而换号解决不了；运营看着一个登得好好的账号被判「无效」，无从下手。
**换几次都一样**——这是死循环，客户永远过不去。

### 改法

新增 `BROWSER_TRANSIENT_PAGE_ERROR`，归进 `SAFE_CARD_RETRY_CODES`：订单退回 `CARD_READY`
由执行器自己重来，**客户什么都不用做**。

识别范围只认四条 Playwright 的确定性措辞（`Execution context was destroyed`、
`Target ... closed`、`frame was detached`、`Navigation failed because page was closed`），
**宁可漏判也不误放**：漏判的代价是客户被要求换一次 Session（今天的老样子），
误放的代价是把真的 Session 失效当成可重试、白重跑几次。两边都不致命，但前者已经发生。

断言守两头：瞬时故障判 `CARD_READY` 且 `customerActionCode` 必须为 null；
真的 `SESSION_INVALID` 仍judged 成 `WAITING_FOR_SESSION` 且要求客户换号——这条不能被顺带放宽。
另外断言 `RefreshAccessTokenError`、`access token expired` 不被误认成瞬时故障。

### 还欠一笔：客户页的文案也在误导

`WAITING_FOR_SESSION` 的通用文案是「当前账号不能开通,请在下方换一个免费账号的 Session」。
即便在真的 Session 失效时，"当前账号不能开通"也说重了——Session 过期不等于账号不能用。
**本轮未改**（要发布，且当时有客户单在途）。下次发布客户页时一并处理。

### 这单怎么收

没有工具能把 `WAITING_FOR_SESSION` 直接推回队列，所以仍需客户再贴一次 Session。
修复后若再遇到同样的瞬时故障，执行器会自己重试，不会再甩给客户。

### D-198 续（2026-09-13 09:51 UTC）这单最终由运营手动付款收口

修复上线后 Lemon 没有再贴第三次 Session，而是**手动在 ChatGPT 账单页填卡付掉了**。
卡台证据：`$15.72 PENDING 2026-09-13T09:47:48Z 卡 3159 商户 OPENAI SAN FRANCISCO`。
（收口时我第一次读交易把 `tradeTime` 当秒解，打出 `+058670 年`；它是**毫秒**。已在本轮更正。）

用 `close-manually-fulfilled-order.mjs --card-used` 收口，独立核实：订单 `RECHARGE_SUCCESS`、
卡 3159 释放并置 `DEPLETED`、非终态订单 0、CDK 保持 `REDEEMED`。**重复扣款的口子已经堵死**。

**两个缺口记下来**：

1. **消费账本没有这单的行**（`ledger.missing: true`），所以卡 3159 的用量计数停在 2，
   实际被用了 3 次（07:31、09:17、09:47）。当下无风险——它只剩 $2.84，低于门槛 16 不会被分配；
   但**若将来给它补钱，系统会以为它还能再用一次**。补钱前要先人工核对账本。
2. **D-198 的修复没能被这单验证**：手动付款后执行器没再跑那条路径。修复已上线（两处兜底 +
   守卫断言），但**要等下一单真的撞上瞬时故障才算验证过**，接班一屏标为未经真单验证。

**取消续费仍需运营处理**：手动付款这条路系统不替客户取消自动续费，要去账号里取消后在后台
点「已在账号里取消续费」，否则下月会继续扣客户的钱。

## D-199（2026-09-13 09:54 UTC）「账号已有别人的卡」这个场景真的发生了：系统正确中止，但客户被卡住

Lemon 早就担心过这件事（2026-09-13 原话：「我担心是客户之前充值过，在账单页面能看到他
以前充值过的卡，我担心的是我们的系统，填不上去我们自己的卡」）。今天发生了。

### 事实

订单 `PJV1-ZESq0lU8oOeMduHMGAGe`（账号 `810104104@qq.com`，卡 5371）：

```
CHECKOUT_OBSERVATION_FAILED: secure card fields did not become ready
```

结账页没有出现卡号/有效期/CVV 三个输入框。Lemon 在现场看到的原因：
**该账号绑着客户以前充值时留下的卡（别人的卡）**，结账页直接用那张已保存的卡。

`checkout-navigation`（09:53:15）到中止（09:53:59）等了 44 秒，不是超时太短。
**钱没动**（`BEGIN_RUN → PRE_PAYMENT_ABORT`，无 `PAYMENT_SUBMIT`），CDK 已退回 `AVAILABLE`，
卡 5371 已释放。

### 系统的行为是对的，不要改这条

`requireSecureCardFields: true`（`checkout-observer.js:100-101`）要求三个卡字段同时存在，
缺任一就在**付款前**中止。**宁可不充，也绝不拿客户自己的卡去付款**——否则扣的是客户的钱。
这道闸门今天挡住了一次真实的误扣。

### 但"有历史绑卡就必失败"是错的，至少有两种页面形态

E2E 第 6 次（账号 `running.da`，2026-09-13 03:39）**也带着历史绑卡**、运营没来得及删，
**照样成功**，钱扣在我们的卡上。所以：

| 形态 | 结果 |
| --- | --- |
| 有已保存的卡，**仍提供新卡输入框** | 系统填入我们的卡，成功（E2E 第 6 次）|
| 有已保存的卡，**只给「用已保存的卡」** | 字段等不到，付款前中止（本单）|

两次的差别是什么**尚未查明**——两个账号的历史卡来源不同（第 6 次是该账号自己的历史卡，
本单是"别人的卡"），但这只是观察，不是已验证的因果。

### 眼下的处置与改进方向

- **客户侧**：去 ChatGPT 账单设置删掉旧卡，再用同一张 CDK 重新兑换（CDK 已退回）。
  运营在 E2E 第 5 次也这样手动做过。
- **系统侧（未实施）**：结账页在有已保存卡时通常有「使用其他支付方式 / 添加新卡」入口，
  识别并点开它就能进到新卡输入，不必让客户删卡。**但这要改付款路径**，
  且必须先拿到该页面的真实形态（按钮文案/DOM）才能写选择器——
  **不能凭猜写**（D-172 规则 C：外部字段先验真响应）。已请 Lemon 下次遇到时提供截图。

### 顺带记一个被我自己证伪的推断

我第一反应是「Lemon 09:47 手动付款把卡存进了那个账号，所以后面这单看到已保存的卡」。
查 `customer_email` 证伪：手动付款那单是 `qixuanyu03@gmail.com`，本单是 `810104104@qq.com`，
**不是同一个账号**。当场收回。

## D-200（2026-09-13 10:32 UTC）Stripe Link 的登录态从来没被清过：一条跨客户泄露路径，也是今天连环失败的总根因

### 怎么发现的

Lemon 给了结账页截图并指出「左侧已经有一张卡绑定的记录，我们好像不能新增」。
我先猜了两个方向（页面是菲律宾语、国家含税），**两个都被自己证伪**——选择器用的是
`name` 属性不是文案；税是结果不是原因。直到连上浏览器读真实 DOM 才看见：

```
frame: js.stripe.com/v3/elements-inner-accessory-target-…
"Mag-log out sa Link  /  Mastercard Credit •••• 5371  /  Palitan | I-update | Alisin"
```

**那不是 ChatGPT 的账号绑卡，是 Stripe Link 的已保存支付方式。** 主页面文案
`Pay with … OR … Billing address` 说明 Link 占住了「Pay with」的位置，
新卡输入框根本不渲染。

再查 cookie，拿到确凿证据：

| 域 | cookie | 过期 |
| --- | --- | --- |
| `merchant-ui-api.stripe.com` | **`__Host-LinkSession`** | 2027-09-13（一年）|
| `.stripe.com` | **`__Secure-LinkSessionPresent`** | 2027-09-13 |

而 `listStaleLoginCookies` 只读 `chatgpt.com` 域，**从来看不见它们**；
`__stripe_mid` 还被显式列进设备 cookie 保留名单。

### 两层后果，当天都撞上了

1. **功能**：运营手动付款一次，Link 就在这个窗口里记住那次的邮箱和卡。之后**任何**客户的
   单跑到结账页，Link 自动登录成上一个人 → 新卡输入框不渲染 →
   `secure card fields did not become ready`（`PJV1-ZESq0lU8`）/
   `CHECKOUT_DRIFT`（`PJV1-CsswKRT9`、`PJV1-uhk83YQy`、`PJV1-NnL3DWl9`、`PJV1-Kx8VXj3f`）连环失败。
   **手动救一单 = 给后面所有单埋一个坑**，这是个会自我恶化的循环。
2. **隐私**：Link 绑的是邮箱。上一个客户的 Link 里若存着**他自己的卡**，
   下一个客户的结账页就会显示出来（品牌、后四位、绑定邮箱）。
   今天显示的 5371 是我们自己的卡——**这是运气，不是设计**。

### 修法：遵循本文件既有原则，只是补上漏掉的域

`session-bootstrap.js` 的原则本来就是「设备/网络 cookie 留下，登录态全清」。
`__stripe_mid` 是设备 ID 继续保留；`__Host-LinkSession` / `__Secure-LinkSessionPresent`
是登录态，跟 ChatGPT 的登录态一起清。

断言守两头：Link 两个凭证必须被清、`__stripe_mid` 与 `cf_clearance` 必须保留
（清了会踩风控）。

**当场在真实浏览器上验过**，不是只有测试绿：

```
清理前: m.stripe.com|m, .invoice.stripe.com|__stripe_mid,
        merchant-ui-api.stripe.com|__Host-LinkSession, .stripe.com|__Secure-LinkSessionPresent
清理后: m.stripe.com|m, .invoice.stripe.com|__stripe_mid      ← 两个 Link 凭证已清
```

### 两个没有证实的东西，不写成结论

- **今天是否真的发生过跨客户显示**：最后一单的 ChatGPT 账号是 `chenxing66623@gmail.com`，
  而截图里 Link 显示 `qixuanyu03@gmail.com`。但截图的时间点无法回溯到具体哪一单，
  我去查时那个 Stripe iframe 已被 hCaptcha 取代。**泄露路径是确凿的，是否已发生未证实。**
- **`CHECKOUT_DRIFT` 的确切抛出点**：库里只存 `reasonCode`，本机日志这条不带
  `diagnosticMessage`，`browser_runs` 没有 `last_error_message` 列。
  **今天 5 次失败我只查得出 1 次的真实原因**——这是取证缺口，仍未修。

### 顺带记一条运营规矩（今天差点出事故）

`10:04:18.000` 卡台扣款 / `10:04:18.356` 系统判 `CHECKOUT_DRIFT` 退回 CDK——**同一秒**。
运营和执行器操作同一个浏览器窗口，互相打架：人点了订阅、自动化正在找它要点的控件，
于是判定页面漂移、按设计付款前中止、退回卡密，**而钱已经扣了**。
CDK 退回后客户可再兑换一次 = 重复扣款。已用 `close-manually-fulfilled-order.mjs` 收口堵住。

**规矩**：执行器在跑时不要碰那个窗口。要人工接管，先等它停下、收口，再动手。

## D-201（2026-09-13 10:42 UTC）修正 D-200：清 Link 的 cookie **不管用**，Stripe 会当场重新发放

### 实测结果，不是推断

10:30 我用 `clearStaleLoginCookies` 清掉了 `__Host-LinkSession` 与
`__Secure-LinkSessionPresent`，当场核实两个都没了。10:33 那单跑起来时
`clearedLoginCookieCount: 1`——证明开跑那一刻确实没有 Link cookie 可清。
**然而 10:40 再查，两个 cookie 都回来了**，结账页上 Link 依旧接管着支付区。

**结论：页面一加载，Stripe 就重新发放了 Link 会话。** 它靠 `__stripe_mid`（设备 ID）
认出这台机器。而 `__stripe_mid` 恰恰是本文件明确要保留的设备 cookie——清它可能踩风控。
**清 cookie 这条路走不通。**

D-200 的代码保留（清登录态本身没有坏处，也符合既有原则），但**必须撤回它"解决了问题"
这个含义**：它对 Link 无效。

### 真正的方向：不跟 Stripe 的状态较劲，在 UI 上选「用新卡」

Link 的 iframe 里有现成控件：`Palitan`（更改）、`Alisin`（移除）、`Mag-log out sa Link`（登出）。
正解是**识别到 Link 接管了支付区，就点「更改」切到新卡输入**。

**未实施**，两个前提没满足：①要改付款路径（全系统最敏感处）；
②必须先拿到**英文界面**下的真实按钮文案与 DOM 才能写选择器——
今天看到的是菲律宾语，凭这个猜英文选择器正是 D-172 规则 C 禁止的。

### 跨客户串号：这次有了完整证据链

- 10:04 运营给 `810104104@qq.com` 手动付款，用**卡 5371**；Link 记住了它。
- 10:21 / 10:33 跑 `chenxing66623@gmail.com`——**这个账号我们从未成功付款过**。
- 其结账页却显示 `Mastercard Credit •••• 5371`。

`chenxing66623` 没用过我们的卡，5371 只能是从 `810104104` 串过来的。
**D-200 描述的泄露路径已经实际发生**（这次串过来的是我们自己的卡，属于走运；
若上一个客户 Link 里存着他本人的卡，就会显示给下一个客户）。

### 运营侧的临时办法与那条不能破的规矩

临时：在 Pilot 窗口点 `Mag-log out sa Link` 登出，再重新提单让自动化跑。
**不要手动填卡**——手动填一次就往 Link 里存一次，下一个客户继续中招，
今天这一连串失败就是这么滚起来的。

### 今天这单还有一个未解释的因素

抓现场时页面上有 hCaptcha 且处于 `Please try again` 状态。**人机验证一出现就该推手机
（D-190 续），但 Lemon 没收到通知**——识别为何没生效尚未查明，记在这里不遗漏。

---

## D-202（2026-09-13 10:42–11:05 UTC）编号归属说明

D-202 这个编号在代码注释里已被占用，指 **Stripe Link 接管**那次改动：新建
`browser-mvp/src/stripe-link-picker.js`，把 Link 处理挪到 `observeCheckout` **之前**，
落 `saved-payment-method` 埋点，超时改从契约的 `secureFieldTimeoutMs` 读（兜底
`SAVED_METHOD_WAIT_MS = 15_000`）。过程与教训并入 D-201 正文，此处只留编号索引，
避免账本出现悬空号。

**2026-09-13 12:20 UTC 现场复验：这块已经生效。** 卡框顶部显示
`Mag-log out sa Link`，卡的三个输入框（`cc-number` / `cc-exp` / `cc-csc`）全部
挂载且可见——保存的付款方式确实让开了，Link 不再是阻塞点。

---

## D-203（2026-09-13 12:30 UTC）连环失败的真根因：第四处兜底 + 清空销毁失败现场

### 起因

Lemon 连问两遍同一个问题：「账单明明都填好了，就差点一个订阅，为什么点不了？」

### 现场取证（12:20 UTC，lane-1 窗口，只读，未触碰页面）

| 区域 | 实测 |
|---|---|
| 账单姓名 / 地址 | 已填 |
| 价格 | ₱982.14，Tax 0%，Due today ₱982.14 |
| Subscribe 按钮 | 存在、`disabled=false` |
| 卡号 / 有效期 / CVV | 三框**均挂载、均可见、均为空** |

### 两条当场收回的推断

1. **hCaptcha 不是拦路的。** 页面上确有 hCaptcha 处于 `Please try again` 状态，
   但实测其 frame 屏幕位置 **y = -8645**，在可视区外，不在支付路径上。上一节
   「今天这单还有一个未解释的因素」据此作废——它不是本单失败的因素。
   （推手机通知为何没触发，是独立问题，仍未查明。）
2. **「执行器一个字都没填进去」是错的。** 卡**填进去过**，是失败后被 finally
   清掉的。我拿清空后的空框当成了"从没填过"，据此向 Lemon 报了错误根因。

### 真实链路

1. `fillSecureCardFieldsNonPayment` 填入卡号 / 有效期 / CVV——**成功**
2. `whileFilled` 回调：填账单地址 → 填邮箱 → `observeCheckoutAfterRequote`
3. requote 观察抛 `locator.count: Target page, context or browser has been closed`
4. `executor.js` 该处 catch **没判瞬时故障**，包成 `CHECKOUT_OBSERVATION_FAILED`
   → 终态失败 → **退 CDK**
5. `nonpayment-card-fill.js` 的 finally 无条件清空三个卡字段
6. 运营看到的：账单在、价格对、按钮亮、**卡框空**——「就差点一下」

`isTransientPageError` 的正则（`executor.js:62`）本来就能匹配那条措辞。漏的不是
匹配，是**这一处 catch 根本没调它**。

### 决定一：补上第四处瞬时故障判定

`executor.js` 中 `whileFilled` 内的 requote 观察 catch 加
`isTransientPageError(error) ? 'BROWSER_TRANSIENT_PAGE_ERROR' : 'CHECKOUT_OBSERVATION_FAILED'`。

`BROWSER_TRANSIENT_PAGE_ERROR` 已在 `SAFE_CARD_RETRY_CODES` 内（D-198），因此断连
将回到 `CARD_READY` 等重试，**不再退 CDK**。

**这是同一教训当天第四次。** D-198 改了两处 Session catch，D-202 补了观察器首次
调用那处，这是第三处漏网的兄弟。每次都是"只改了眼前看到的那一处"。

### 决定二：失败现场原样保留（Lemon 要求）

> 「点确认订阅前那一步出问题就把卡资料全清空，那个没有必要做，遇到问题停住就好了」

改法不是"永不清空"，而是按**失败发生的位置**分：

| 场景 | 行为 | 理由 |
|---|---|---|
| 正常走完 | 清空 | 原行为，不留卡数据 |
| **填卡中途**失败（租约丢失/过期） | 清空 | 半张表单帮不了任何人；原有测试守着这条 |
| **填完之后**失败（账单/requote） | **保留** | 完整现场：卡、账单、价格都在，运营可直接接手 |

实现：`allFieldsWritten && !finishedCleanly` 时跳过清空。

**安全边界（已验证，非推断）**：下一单以 `startFresh: true` 运行
（`shared-runtime-integration.js:556`，`run?.recovered !== true`），会先调用
`closeStaleOrderPages` 关掉这个 checkout 页面，**卡号不会带进下一个客户的现场**。

### 为什么这条比听起来重要

清空**销毁了失败现场的证据**，让「填了又被清」和「从没填进去」在事后无法区分——
我今天就是这样判错根因并向 Lemon 报了错的。Lemon 提这条是为了能手动接手；实际
收益更大的是：**排查不再面对一个被擦干净的犯罪现场。**

### 验证

- `test/nonpayment-card-fill.test.js` 新增 `whileFilled failure holds the filled
  scene for the operator`，断言三个字段在 whileFilled 抛错后仍非空
- 该文件 5/5 通过（含两条原有的"失败仍清空"用例，未破）
- `test/executor.test.js` 17/17 通过
- 全量 `npm test`：277 项，**268 通过 / 0 失败 / 9 跳过**

### 尚未验证

代码已改、测试全绿，但**生产 worker 尚未重启**，因此以上行为在生产**未生效**。
重启时机交 Lemon 决定（他此前明确要求跑单期间不重启）。

---

## D-204（2026-09-13 12:50 UTC）supervisor 每分钟自己把自己挡在门外：SSH 连接风暴 + 三处「查不到」被播报成「坏了」

### 症状

D-203 改完重启 worker，旧进程正常停止，**新进程 13 分钟没起来**。supervisor 日志循环：

```
12:41:07Z 付款开关为 取不到，只等不跑
12:43:02Z 等待条件就绪：[警告] 生产服务
12:44:07Z 付款开关为 取不到，只等不跑
```

### 两次错误判断，都当场证伪

1. **「可分配卡 0 张，所以 supervisor 不拉 worker」**——按正式资格口径实查是
   **1 张（卡 5371，余额 34.28，门槛 16.00）**。卡一直够。
2. **「SSH 被限流，因为我排查时查得太密」**——裸 `ssh 'echo OK'` 当场成功，
   紧接着的 `prod-query.sh` 却失败。不是我查得密，是**工具自己的调用模式**。

### 根因：一轮 6 条 SSH 突发

- `prod-query.sh` 每次调用都新开一条 SSH 去 `cat /etc/pojia/runtime.env` 取凭证
- `ready-check.sh` 一轮调它 **5 次**，外加第 26 行一条独立的 `ssh` 查 systemctl
- supervisor 每轮：查付款开关 1 条 + ready-check 6 条 = **每分钟 7 条突发连接**

实测单条成功率约 **75%**（8 次探测失败 2 次），而网络层 **ping 0% 丢包、RTT 0.678ms**
——排除网络，是 sshd 未认证并发上限在随机拒连。一轮全过的概率 ≈ 0.75⁷ ≈ **13%**。

**supervisor 每分钟自己制造一次连接风暴，然后被自己造的风暴挡在门外。**

### 修复一：复用连接

`prod-query.sh` 与 `ready-check.sh:26` 的 ssh 都加
`ControlMaster=auto` + `ControlPath=/tmp/.pojia-cm-$(id -u)-%h-%p-%r` + `ControlPersist=30`。

`ControlPersist` 只留 30 秒：够覆盖一轮查询，不让一条 root 连接长期驻留。
socket 由 ssh 自建为 0600。

**验证**：改前一轮全过 ~13%，改后连打 6 次 **6/6**，完整 ready-check **全部就绪 ✓**，
其中 `生产服务 active active`——服务从头到尾都是好的。

### 修复二：三处「查不到」不再冒充「坏了」

同一个坑今天踩了三次，每次都是 `2>/dev/null` 吞掉错误后拿空值当业务结论：

| 位置 | 原行为 | 危害 |
|---|---|---|
| 余额门槛 | 取空静默按 0 | 上午已修 |
| **可分配卡 ELIG** | 取空 → `${ELIG:-0}` → 报「0 张且无人占卡」 | **会让人去开一张根本不需要的卡** |
| **生产服务 svc** | 取空 → 报「[警告] 生产服务 」 | 让人以为线上服务挂了 |

后两处已改为：取不到就报 `[失败]`，并把话说明白——
「查不到不等于没有卡，不要据此开卡」「查不到不等于服务挂了，先看连接再下结论」。

### 教训

判断工具的**失败模式**和它的**判断规则**一样重要。规则抄错会误判，
错误处理写错会**用最自信的语气播报一个纯属虚构的结论**——而人会照着它去开卡、去重启服务。

`grep -rn "2>/dev/null" scripts/` 里每一处都该问一句：查不到的时候，你打算说什么？

---

## D-205（2026-09-13 13:15 UTC）清空卡资料的是**两处** finally，D-203 只改了不出事的那处

### Lemon 的原话（第二次，同一个问题）

> 「还是出现之前的问题，你根本没有修复好，所有的账单信息全部都填写完整了之后，
> 你就一下子把它全清空了，就没有点订阅」

他是对的。

### 我错在哪

这条链路上有**两个**"填卡 → 用完清空"的地方：

| 文件 | 阶段 | D-203 |
|---|---|---|
| `nonpayment-card-fill.js` | 预检：填卡让页面重新报价，读完税就退 | ✅ 改了 |
| **`live-chatgpt-payment-adapter.js`** | **真正付款：填卡 → 填账单 → 等零税 → 点订阅** | ❌ **没碰** |

Lemon 说的从头到尾都是「点订阅前那一步」——那就是 adapter。我改的是它前面
那个预检阶段。**D-203 的分析对，落点错。**

证据：失败码 `CHECKOUT_DRIFT`，这个码只有 adapter 会抛
（`submitted ? 'PAYMENT_RESULT_UNKNOWN' : 'CHECKOUT_DRIFT'`）。

**这是"只改了眼前看到的那一处"当天第五次。** 前四次是 isTransientPageError
（D-198 两处、D-202 一处、D-203 一处）。同一个动作，同一个错法。

### 决定一：adapter 也保留现场，但分两类

改的时候测试挡下一个我没想到的资金风险——`LIVE adapter never submits a
non-zero-tax quote` 这条测试红了，而它是对的：

**税不为零时保留现场 = 把人往违规付款上推。** 运营看到的会是一个填好的表单加一个
亮着的订阅按钮，而价格是含税的 ₱1,100（免税价 ₱982.14）。手一点就多付 ₱117.86，
正好违反「必须零税」这条硬约束。

所以分界不是"卡填完没提交"，而是：

| 失败类型 | 例子 | 行为 |
|---|---|---|
| **故障类** | 断连、超时、页面抖动 | **保留现场** — 该付没付成，运营接手点订阅 |
| **规则拒绝类** | 税不为零、报价对不上、币种/按钮变了 | **清空** — 本来就不该付，空表单才是正确信号 |

实现：内层 `catch` 在 `finally` 之前跑，用 `POLICY_REFUSAL_PATTERN` 给 finally 定性
（按 message 匹配而非 code——这几种失败**都**是 CHECKOUT_DRIFT，code 分不开
"页面坏了"和"价格不对"）。

### 决定二：CHECKOUT_DRIFT 必须带 stage

以前它抛出来是光秃秃的，`{status, reasonCode, orderId}` 三个字段，连死在哪一步
都说不出——今天连着两单都是这样，我全程只能猜。现在 `error.stage` 精确到
`fill-billing-address` / `wait-for-zero-tax-requote` / `final-pre-submit-check`。

### 验证

- `test/live-chatgpt-payment-adapter.test.js` **10/10**，新增
  `D-205: a fault before submit holds the filled scene for the operator`
  （同时断言 `error.stage === 'final-pre-submit-check'`）
- 税不为零那条测试**恢复绿**，且语义正确：它现在证明的是"规则拒绝要清空"
- 全量 `npm test`：278 项，**269 通过 / 0 失败 / 9 跳过**
- worker 重启：PID 10503，起于 **13:12:59Z**，晚于 adapter 改动 13:11:11Z ✓
- **重启只花 20 秒**（上一次 18 分钟）——D-204 的 SSH 连接复用见效

### 给下一个接班人

改行为之前，先 `grep -rn "fill('')" src/` 数一数**一共有几处**。
今天两次都是找到一处就动手，然后被现场打脸。

---

## D-206（2026-09-13 13:45 UTC）运营手动走通一单的全程轨迹：执行器做不到的四件事，记录里看得见

### 背景

`chenxing66623@gmail.com` 这一单执行器跑了 12 次、近 3 小时全败（D-203/D-205）。
Lemon：「你说有问题，但我能走过，你要全程记录清楚。」他在 Pilot（lane-1）窗口手动
操作，我以 6 秒页面 / 18 秒数据库的频率只记变化，原文存
`docs/evidence/manual-payment-trace-2026-09-13-chenxing.log`（30 行，无卡号/CVV，只记「有值/空」）。

### 轨迹（UTC）

| 时刻 | 页面 | 备注 |
|---|---|---|
| 13:27:29 | `#pricing` | 起点 |
| **13:29:02** | **`/auth/login`** | **他重新登录了** |
| 13:29:25 | `chatgpt.com/` | 登录后回首页 |
| 13:30:58 | `/checkout/<id>` ₱982.14 按钮可点 | 进结账页 |
| 13:31:11 | hCaptcha `Please try again` 出现 | 之后全程存在 |
| 13:31:21 | 卡框 空/空/空 | 距进页 23 秒 |
| 13:31:46 → 13:32:10 | 卡号 → 有效期 → CVV | 填卡 50 秒 |
| 13:32:35 → 13:33:13 | 账单地址 → 姓名 Ashley | 填账单 63 秒 |
| 13:33:46 | Tax (0%) ₱0.00，按钮禁用 | 提交中 |
| 13:34:23 | 跳回 `chatgpt.com/` | 提交后 37 秒 |
| 13:35:19 | `chatgpt.com/` 按钮可点 | 结束 |

全程 3.5 分钟。执行器冲突告警一次没响（待跑单始终 0）。

### 付款成功——**尚未独立核实**

- 卡 5371 库内余额 34.28 未动，`last_transaction_synced_at` 为空（没同步过）
- 卡台 `highvcc-card.mjs` token 过期，交易流水查不了
- 事后探 Pilot 窗口：`/backend-api/me` 200 但 email 空，plan = **guest**——他已登出，
  看不到 Plus 状态
- 唯一证据是 `13:33:46 按钮禁用 → 13:34:23 跳回首页` 这条间接轨迹

Lemon 口述付成了。落盘按「待核实」记，等卡台 token 刷新后查流水补硬证据。

### 与执行器的四条已验证差别

1. **他登录，执行器注入。** 13:29:02 走了 `/auth/login`。执行器从不登录，只注入客户交的
   Session cookie；今天第 12 次失败（13:15）正是注入后探账号 403。他绕过了这一步。
   这也解开了我们俩的分歧：我说「Session 失效」指那份 cookie，他说「不是失效」指账号——
   **两句都对，说的不是一回事。**
2. **hCaptcha 不拦路，第二次证实。** `Please try again` 从 13:31:11 挂到 13:33:46，他无视
   照付。D-203 已实测它在屏幕外（y=-8645）。
3. **他不断连。** 执行器 D-203 那次死在填完卡重读价格时 CDP 断连；人走鼠标键盘，无此通道。
4. **节奏可对照**：进页→卡框 23s、填卡 50s、填账单 63s、提交→成功 37s。执行器各超时
   （secureFieldTimeoutMs 45s、repriceTimeoutMs）在此节奏下应够——但那是**并行遍历所有
   frame** 的探测，与人的**顺序操作**不是同一种压力。

### 不能下的结论

前 11 次执行器在结账阶段的确切 stage——D-205 之前不记这个字段，只有一次带诊断（断连）。
一个样本不足以说"执行器为什么在结账页失败"。**下次执行器再跑会带 stage，届时才能与本轨迹逐步对齐。**

### 待办（依赖 Lemon）

- [x] 付款成功——Lemon 13:55 UTC 确认：账号已是 Plus，与客户确认过
- [x] 登录方式——**上号器一键登录**，付完款账号立刻显示登出（解释了事后探到 guest）。
      执行器默认 `BROWSER_SESSION_PROVIDER=COOKIE`（plist 与进程环境均未设），EXTENSION 模式代码在、有两个单测、
      **无真单**。D-140 曾判"上号器与 Cookie 注入同类机制"，但今天是同账号、同窗口、同出口的直接对照：
      注入探账号 403，一键登录 3.5 分钟付成。**是否切 EXTENSION，Lemon 定。**
- [ ] 刷卡台 token → 查 5371 流水做硬证据（Lemon 在刷）
- [x] **CDK 已锁回 REDEEMED**（13:58 UTC，`close-manually-fulfilled-order.mjs` 不带 `--card-used`，独立核实：
      订单 `RECHARGE_SUCCESS`、CDK `REDEEMED`）。**账本未记**：脚本对 RECHARGE_FAILED 拒 `--card-used`，
      仓库无正式记账写入工具，不自拼 SQL——**5371 与 3159 各欠 1 笔，记账方式待 Lemon 定**
- [ ] 取消续费：Lemon 去账号里关，然后后台点「已在账号里取消续费」（与 qixuanyu03、810104104 同批）

### EXTENSION 模式就绪度核实（2026-09-13 14:05 UTC，五项全通过）

Lemon 说「上号器一键登录」之后立即核实这条路能不能走。**结论：前置条件全部满足，切换只差一个环境变量。**

| 核实项 | 结果 |
|---|---|
| 代码路径 | `production-live-pool-worker.js:230/276` 按 `sessionProviderMode` 选 adapter，preflight 与 live 两处都接 |
| 扩展路径 | `DEFAULT_EXTENSION_PATH` = `~/Library/Application Support/BitBrowser/BitExtensions/384ef55b-…`，**本机存在**，含 `manifest.json`/`popup.html`/`popup.js` |
| worker 未传 `extensionPath` | **不影响**——构造函数有默认值（一度误判为"会抛 TypeError 起不来"，实测构造成功，收回） |
| 扩展在 Pilot 窗口里 | **打开 `chrome-extension://cgiiojcebppjmambpplijjjhjiokjdgd/popup.html` 成功**，标题「诺汇盛专用上号器」，执行器要找的 `#sessionToken`/`#loginButton`/`#statusMessage` **三个控件全在**（只加载页面，未点任何按钮，看完即关） |
| 单测 | `extension-session-bootstrap` + `session-loader-extension` **14/14** |

**切换动作**：给 LaunchAgent plist 加 `BROWSER_SESSION_PROVIDER=EXTENSION` → `kickstart -k`（约 20 秒）。
**回滚**：删掉该变量再 kickstart，同样 20 秒。
**仍然未知**：EXTENSION 模式从未跑过真单。切了之后第一单就是它的真单验证，按 D-139「失败一次即转人工」。

**等 Lemon 决定。** 改 plist 属于改运行配置，不在"直接执行"范围。

---

## D-207（2026-09-13 14:15 UTC）账本欠的不是"两笔记录"，是"两笔状态标错了"——并附今日自审：哪些是事实，哪些是我搞错的

### 一、账本：先前的描述是错的

文档里一直写着「手动付款那单 `card_consumption_ledger` **无对应行**」。**这是错的。**
2026-09-13 14:10 UTC 实查：**今天每一个 `RECHARGE_SUCCESS` 订单都有且只有 1 行账本**，
三笔手动付款（`PJV1-pom5NfWi…` / `PJV1-NnL3DWl…` / `PJV1-BUGAhkA…`）也都有行。

真实问题是**状态**：这些行是 `RELEASED`（释放）而不是 `CONSUMED`（消费）——因为收口脚本
`close-manually-fulfilled-order.mjs` 默认按"分配的卡没用过"处理，把卡释放了。

而资格 SQL 的用量只数三种状态：

```sql
AND eligible_usage.status IN ('RESERVED','CONSUMED','RECONCILIATION')
```

`RELEASED` 不在内 → 用量少算。所以 3159 显示 2 实际 3，5371 显示 0 实际 1（16 行全是 RELEASED，
其中 15 行是今天 12 次失败的真实释放，1 行是手动付款该记而没记成的）。

### 二、建议的补法：新增 `RECONCILIATION` 行，**不动** `RELEASED` 行

技术上能把 `RELEASED` 改回 `CONSUMED`（`transitionCardConsumptionInTransaction` 接受
`allowedCurrentStatuses`），但**默认只允许 `RESERVED → CONSUMED`**，改它等于显式绕过状态机。
不建议，理由：

1. **`RELEASED` 是真事实**——系统确实释放了那张卡，抹掉它就是篡改审计链
2. **`RECONCILIATION` 正是为这件事设计的状态**，且已被资格 SQL 计入用量
3. 补完之后账本读起来是完整的因果："系统释放了 → 人工对账补记了一笔消费"，
   而不是"这笔消费不知怎么就从释放变成了消费"

**需要写一个正式脚本**（仓库现无此入口）：复用 `reserveCardConsumptionInTransaction` +
`transitionCardConsumptionInTransaction(targetStatus:'RECONCILIATION')`，走正式连接池、
带事务、带审计、默认 `--dry-run`，照 `v1/scripts/set-card-stock-threshold.mjs` 的样子。
影响两张卡各 1 笔：3159 用量 2→3（到上限，本就已 DEPLETED）、5371 用量 0→1。

**等 Lemon 点头再写。** 这是写资金账本。

### 三、今日自审：Lemon 问「哪些是事实，哪些是你搞错的」

#### A. 已验证的事实（可以沉淀，每条都有当场证据）

| 事实 | 证据 |
|---|---|
| `executor.js` 填完卡后 requote 观察的 catch 漏判瞬时故障（第四处） | 代码 + 新增测试，全量 269 通过 |
| 清空卡资料的 finally 有**两处**，出事的是 adapter 那处 | 失败码 `CHECKOUT_DRIFT` 只有 adapter 会抛 |
| 税不为零时保留现场会诱导违规付含税价 | 已有测试当场变红挡住 |
| supervisor 每轮开 7 条 SSH 撞并发上限，自己挡自己 | ping 0% 丢包、RTT 0.678ms，但 SSH 8 次失败 2 次；加 ControlMaster 后一轮 6/6 |
| `ready-check.sh` 三处把"查不到"播报成"坏了" | 三处实测：可分配卡 0 张（实为 1）、生产服务空（实为 active active）、门槛取空 |
| hCaptcha 不拦路 | 两次证实：frame 屏幕位置 y=-8645；Lemon 手动全程它挂着照样付成 |
| 运营手动 3.5 分钟走通，四步节奏 | 30 行轨迹，`docs/evidence/manual-payment-trace-2026-09-13-chenxing.log` |
| EXTENSION 模式五项前置全就绪 | popup 打开成功、三个控件在、单测 14/14 |
| **账本没缺行，是状态错标** | 本条第一节 |

#### B. 我搞错并已收回的（**都是"拿观察补原因"**）

| 我说过 | 实际 | 怎么错的 |
|---|---|---|
| 「hCaptcha 挡住了订阅」 | 它在屏幕外 y=-8645 | 看到 `Please try again` 就当成拦路，没查位置 |
| 「卡一个字都没填进去」 | 填了，失败后被 finally 清掉 | 拿清空后的空框当"从没填过"，**据此给 Lemon 报了错误根因** |
| 「SSH 被我查太密限流了」 | 是 `prod-query.sh` 每次新建连接的设计 | 把自己当成原因，没对比裸 SSH |
| 「可分配卡 0 张」 | 实为 1 张（5371，34.28） | 信了工具的假阴性，没跑正式口径复核 |
| 「切 EXTENSION 会让 worker 起不来」 | 构造函数有默认路径，能起 | 看到断言就推断，没试 |
| 「页面在两分钟内变了」 | 是我自己的 host 过滤把 iframe 滤没了 | 把工具缺陷当成现场变化 |
| 「Session 失效了」 | **只对一半** | 那份 cookie 不能用是真的，但 Lemon 一键登录能进——**账号本身没失效**。我把"cookie 不能用"说成了"Session 失效"，听起来像客户的锅 |

#### C. 未验证的推断（已在原文标注，不要当事实引用）

- 「12 次反复重试可能触发了 ChatGPT 风控」——**无证据**，Lemon 随后手动一次就过，倾向于不成立
- 「前 11 次执行器在结账页死在哪个 stage」——D-205 之前不记这个字段，**一个样本不下结论**
- 「Lemon 手动付款成功」——2026-09-13 13:55 UTC Lemon 口头确认账号已 Plus、与客户核对过；
  **卡台流水尚未核对**（token 在刷）

### 四、这条自审本身的用处

今天 B 栏七条，**七条全是同一个错法**：看到一个现象，立刻给它配一个原因，然后拿这个原因去回答 Lemon。
D-172 第 2 条写的就是这件事（"不给观察补原因"），今天还是犯了七次。

**下一个接班人读到这里请注意**：A 栏可以直接引用；B 栏的每一条都曾经以同样自信的语气写在对话里过。
区别不在语气，在有没有当场去查那一下。

---

## D-208（2026-09-13 15:55 UTC）付款那一趟加分步埋点：运行中就能看到卡在哪，不必等失败

### 为什么现在做（和 D-196 当初的理由不同）

D-196 提这个埋点是为了**提速**（找出 73% 的时间花在哪，未实施）。今天 Lemon 重提，
理由变了：「我们不能这样一直糊里糊涂的解决不了问题」。

**今天加的 `stage`（D-205）解决不了他的问题**，两者覆盖的时刻不同：

| | 什么时候有值 | 能回答什么 |
|---|---|---|
| `error.stage` | **失败抛出之后** | 「它死在 `wait-for-zero-tax-requote`」 |
| `payment-stage` 埋点 | **运行中每跨一步** | 「它现在在填地址，已经 20 秒」 |

今天 Lemon 至少三次说「卡住了，你盯一下」。那种时刻错误还没抛出来，`stage` 一点用没有——
最后一个事件永远是 `checkout-navigation`，**之后 56 秒（全流程 36%）零痕迹**，只能答"不知道"。

### 实现：纯旁路，四层透传

`executor.js` → `shared-live-composition.js` → `payment-executor.js` → adapter，
逐层透传一个可选的 `onStage` 回调。adapter 内把 9 处 `stage = 'xxx'` 换成 `setStage('xxx')`，
每跨一步同步回调一次，带 `{ stage, previousStage, previousElapsedMs }`。

覆盖：`resolve-secure-card-controls` / `fill-secure-card-controls` / `fill-billing-address` /
`fill-billing-email` / `wait-for-zero-tax-requote` / `final-pre-submit-check` /
`submit-payment` / `human-verification-gate` / `observe-payment-outcome`。

**两条安全设计，都有测试守着：**

1. **`setStage` 把回调整个 try 住**——埋点抛什么都咽掉。丢一条观察 << 让一单出错。
   测试 `a throwing onStage cannot break the payment`：回调必抛，付款仍 `CONFIRMED`、仍只点一次。
2. **`executor` 落事件刻意不 await**（`void ... .catch()`）——埋点写库慢或失败都不能拖住付款。

### 验证

- 新增两条测试：每一步都报且带上一步耗时、回调抛错不影响付款
- adapter 测试 12/12，payment-executor 22/22
- 全量 `npm test`：280 项，**271 通过 / 0 失败 / 9 跳过**
- worker 重启：PID 68339，起于 **15:54:16 UTC**，晚于最后一处改动 15:52:55 ✓；**25 秒起来**

### 这是今天第三次动付款路径

D-196 自己写过「付款路径应该单独做、单独发、单独验」。这次确实单独做，但离 D-205 只隔两小时。
风险靠"不改控制流 + 双重吞错 + 两条针对性测试"控制，**下一单是它的真单验证**。

### 下一单该看什么

失败时不再只有一个 `CHECKOUT_DRIFT`，而是：完整的分步耗时 + `stage` 指明死点 + 现场留在页面上。
**三样齐了，"为什么停在马上订阅那一步"才第一次具备可回答的条件。**

---

## D-209（2026-09-14 01:20 UTC）埋点第一单就定位到了：死在 `fill-billing-email`；保留现场同一单内生效

### 这一单同时验证了三样今天刚做的东西

单号 `PJV1-G3Ni4WrwJERVUOg5tl3x`（客户 `w1131520942@gmail.com`，卡 1657），
17:09:31 UTC 起跑，17:11:08 失败，Lemon 在保留下来的现场手动点订阅完成。

### 一、D-208 埋点：第一次看见付款内部

```
17:11:03  resolve-secure-card-controls
17:11:04  fill-secure-card-controls    上一步 334ms
17:11:06  fill-billing-address        上一步 2446ms
17:11:08  fill-billing-email          上一步 1824ms   ← 最后一条
          （没有 wait-for-zero-tax-requote）
```

**下一个 `setStage` 没被调用，所以失败就在 `fillTransientBillingEmail` 里面。**
填卡 0.3 秒、填地址 2.4 秒都很顺——今天 8 次 `CHECKOUT_DRIFT` 从来分不出的位置，
第一单就定住了。

### 二、D-205 保留现场：第一次产生实际作用

失败后当场连 Pilot 窗口实查，卡框三格 **卡号/有效期/CVV 全部"有值"**。
Lemon 不用重填，直接点订阅完成。**Stripe 发票 `LUEFGA76-0001`：
`Nabayaran na ang invoice ₱982.14`（已支付），免税价，零税约束没破。**

对照今天下午：同样的失败点，卡框被清空，运营看到的是"账单填好了却一步之遥点不了"。

### 三、待验的假说（**不要当结论引用**）

`fillTransientBillingEmail`（`billing-address-fill.js:88`）要求页面上可见邮箱框
**恰好 1 个**：

```js
if (matches.length !== 1) throw new ContractError('billing email field must resolve to one visible input');
```

而今天走到这一步的单**都是 Stripe Link 接管成功之后**才死的（`detected:true, switched:true`）。
**假说**：Link 带来了自己的登录邮箱框，页面上因此有 2 个可见邮箱框 → 抛错。

**未验证**：去数的时候 Lemon 已接手，checkout 页已关。**下一单失败时第一时间数**。
在数到之前，这只是一条候选，不是原因。

### 四、收口

`close-manually-fulfilled-order.mjs`（不带 `--card-used`，脚本对 `RECHARGE_FAILED` 拒收该参数），
独立核实：订单 `RECHARGE_SUCCESS`、CDK `REDEEMED`。**账本第 3 笔状态错标**（同 D-207），
卡 1657 用量少算 1。

### 五、顺带纠正一个长期错误读数

卡 5371 的余额**同步过了，真值 $2.84**——先前一直显示的 $34.28 是开卡时的静态值
（`last_transaction_synced_at` 为空 = 从未同步）。它已低于门槛 16，不再合格。
**HANDOFF_NOW 缺口 5 说的"判断卡够不够用时不要信库内余额"，今天又应验一次。**

---

## D-210（2026-09-14 07:45 CST / 2026-09-13 23:45 UTC）现场保留后给运营 8 分钟接手，别急着告诉客户"失败了、卡密可以重新兑换"

### Lemon 问出来的窟窿

他问：「客户的圆环是不是随着 CDK 被退回，也就取消了？」——这一问推翻了我前一条建议。

查代码后的客户侧真相（`customer.js` + `order-status-service.js`）：

| | 订单判 `RECHARGE_FAILED` 之后 |
|---|---|
| 圆环 | 冻结在当前位置（`frozen: true`），不是消失 |
| 轮询 | **完全停止**（`poll: null`，终态） |
| 文案 | 「这一单没有完成,没有扣费。**你的卡密可以直接重新兑换。**」 |

`canRetry = !cdkReturnWouldBeBlocked`——今天这些付款前失败都没有付款证据，所以一律为真。

**我原来的方案（失败后自动检测人工接手、后台改成成功）是错的**：客户页早已停止轮询，
后台改了他也看不到；而那句"可以直接重新兑换"就摆在他眼前——运营正在接手的那几分钟里，
客户照做就是**新订单、新卡、再付一次，我们出两份钱**。

### 决定：把判失败往后推，而不是事后补救

```
付款前失败 + 现场被留在屏幕上（D-205 的 holdForOperator 条件）
    ↓
不判失败。订单维持 RECHARGE_PROCESSING，客户继续看到"处理中"、继续轮询
    ↓
推手机通知运营「有单等你接手，现场已保留」
    ↓
盯 8 分钟，只认一个信号：账号真的变成付费计划（复用 verifier.confirmPlus）
    ├─ 检测到 → 停止等待，返回 OPERATOR_TAKEOVER_DETECTED
    └─ 超时/租约丢失 → 照常判失败、退 CDK，客户看到的和现在一样
```

**8 分钟是 Lemon 定的**（他上次从失败到手动付成约 3~5 分钟），并说明「等流程顺了再调短」。
环境变量 `BROWSER_OPERATOR_TAKEOVER_WINDOW_MS` 可调，**设 0 即关掉该行为**，退回旧语义。

### 检测到接手后**不自动判成功**——这是有意的

worker 不知道运营点的是系统分配的那张卡还是另一张，自动记账会记到错误的卡上
（今天已经有 3 笔账本状态错标，见 D-207）。所以它只停止等待并通知人，
由人走正式收口 `close-manually-fulfilled-order.mjs`。**worker 不做资金判定。**

### 实现（四处，均不改付款控制流）

1. adapter 的 catch 里给 error 打 `sceneHeld`（条件与 `holdForOperator` 完全一致）
2. `payment-executor` 把 `sceneHeld` 带进 `PRE_SUBMIT_FAILED` 返回值
3. `shared-live-composition` 新增 `awaitOperatorTakeover()`，在 `createPaymentHandler`
   拿到 `PRE_SUBMIT_FAILED + sceneHeld` 时进入等待
4. `production-live-pool-worker` 读环境变量，默认 8 分钟

### 验证

- 新增 3 条测试：检测到付费即停并通知一次、窗口到期不无限等、**租约丢失立刻退出**
  （租约没了说明可能已被别的 worker 接管，不能继续占着）
- 全量 `npm test`：**274 通过 / 0 失败 / 9 跳过**
- worker 重启：**PID 91755**，起于 23:43:17 UTC，晚于最后一处改动 23:41:06 ✓

### 一条自己的教训

核对重启时我又抓到了**还没死的旧进程**（PID 68339），差点report成"已带新代码"。
**这是今天第四次踩同一个坑。** 以后核对重启一律认 **PID 变化**，不认"进程存在"。

---

## D-211（2026-09-14 02:00 UTC）我今天的五个错误模式，和对应的硬规则

Lemon 要求：「总结你自己工作方式上的问题，沉淀清楚，时刻警醒自己，以后不可以再犯。」
下面每条都配今天的真实案例——**不是提醒，是把犯过的错钉在这里**。

### 模式 A：给观察补原因（今天犯了 8 次，最高频）

看到一个现象 → 立刻配一个原因 → **拿这个原因去回答 Lemon**。

| 我说过 | 真相 | 我漏了哪一步 |
|---|---|---|
| hCaptcha 挡住了订阅 | 它在屏幕外 y=-8645 | 没查它的位置 |
| 卡一个字都没填进去 | 填了，被 finally 清掉 | 没查清空逻辑 |
| SSH 被我查太密限流了 | 是工具每次新建连接的设计 | 没对比裸 SSH |
| 可分配卡 0 张 | 实为 1 张 | 没跑正式口径复核 |
| 切 EXTENSION worker 起不来 | 构造函数有默认值 | 没试一次 |
| 页面在两分钟内变了 | 我自己的 host 过滤滤掉了 | 没查自己的查询 |
| Session 失效了 | 只对一半：cookie 不能用 ≠ 账号失效 | 措辞把锅甩给了客户 |
| 账本缺行 | 有行，状态错标为 RELEASED | 没查行本身 |

**根因**：我把"能解释"当成了"已查明"。一个说得通的故事和一个查证过的事实，
在我嘴里用的是同样的语气——**区别不在语气，在有没有当场去查那一下**。

**硬规则**：说出任何原因之前，先回答「**我查了什么，从而排除了其他可能？**」
答不上来就只能说"不知道，待查"。D-172 第 2 条写的就是这个，今天还是犯了 8 次。

### 模式 B：只改眼前那一处（今天犯了 5 次）

- D-198：`isTransientPageError` 加了两处 Session catch，漏了 account-readonly-probe
- D-202：补了观察器首次调用那处，漏了 requote 那处
- D-203：补了第四处，**同时只改了 nonpayment 的 finally，漏了 adapter 的**
- D-205：才发现清空的 finally 一共有两处

**根因**：找到一处就动手，修好的满足感盖过了穷尽的耐心。

**硬规则**：改任何行为之前，先 `grep -c` 数出**一共有几处**，把这个数字写进 commit
message。数不清楚不动手。

### 模式 C：拿工具的输出当事实，不验证工具本身（今天犯了 4 次）

- `ready-check` 说"可分配卡 0 张"——查询失败返回空，`${ELIG:-0}` 变成 0
- 四次抓到**还没死的旧进程**，差点报"已带新代码"
- 监控脚本自己用 `2>/dev/null` 吞错误——**刚写完 D-204 批评这件事就犯**
- 监控把已存在的单当基线，等不到新单

**根因**：信任自己写的工具，不问"它查不到的时候会说什么"。

**硬规则**：
1. 用工具输出下结论前，先问「**它失败时会输出什么？**」——特别是每一处 `2>/dev/null`
2. 核对进程重启一律认 **PID 变化**，不认"进程存在"

### 模式 D：局部优化，不看系统（Lemon 当面指出的那条）

- D-210 的 8 分钟窗口：只想着"客户不要看到失败"，**完全没想过 1 条 lane 串行、
  后面的客户要排队 8 分钟**
- 自己编限制：「worker 不知道用了哪张卡」（卡就是它自己填的）、
  「要等 120 秒租约」（仓库里早有主动释放的先例）——**用编出来的顾虑换来了"每单要人点按钮"**

**根因**：问题边界画得太小；把过往做法当给定条件，不问"这是在护着什么"。

**硬规则**：改任何行为前，列一张关联方清单并逐条回答：
**队列里的其他客户 / 客户页看到什么 / 告警语义 / 资金账本 / 测试能不能覆盖**。
并且对每一条"现有做法"问一次：这是在护着什么，还是只是过去的一个决定？

### 模式 E：猜外部字段（D-172 第 3 条，今天又犯）

`order_no`、`card_no_last_four`、`browser_run_operations` 全是猜的，实际是
`public_no`、`last4`、`browser_operations`。报错三次才去 `SHOW COLUMNS`。

**硬规则**：写涉及新表/新列的 SQL 前，先 `SHOW COLUMNS`。一次也别猜。

### 最根本的一条：用行动的密度掩盖思考的稀疏

今天改了 5 轮代码、跑了 8 次全量测试、落了 9 条决策——**而根因（`fill-billing-email`
那个函数）到现在一行都没修**。埋点在 17:11 就把死点锁定了，我转头去打磨兜底路径，
又在兜底里加了个会堵住队列的 8 分钟。

**看起来很勤奋，方向是偏的。**

**硬规则**：每轮开工前问一句「**我现在做的，是问题本身，还是问题的周边？**」
周边的事再顺手，也要排在根因后面。

### 附：今天唯一做对的那类事

值得保留的模式只有一个——**当场去查，并且当场推翻自己**。
今天 8 条错误判断里有 7 条是我自己查证后收回的，不是被 Lemon 抓到的。
对抗式审查也自查出 4 条真问题、排除 2 条虚警。

**这套"查证—推翻—更正"是有效的，问题在于它应该发生在开口之前，而不是之后。**

---

## D-212（2026-09-14 01:35 UTC）窗口收到 90 秒止血；六处「知道数量却不说」的断言全部改口

### 一、8 分钟 → 90 秒（止血，不是解决）

对抗式审查发现：**lane 只有 1 条、`runLaneLoop` 串行**，D-210 的 8 分钟等待期间
后面的客户全在排队。今天的量下约 30 分钟阻塞；按"一天几十上百单"的目标，
这是我亲手加进去的吞吐瓶颈——**写它的时候完全没想过队列**。

收到 90 秒：够检测到运营接手（上次点订阅到账号变 Plus 只要几十秒），队列代价可接受。
轮询间隔同时从 15 秒收到 10 秒。**这是止血，不是解决**——真正的解法是"等待期释放 lane"，
排在根因之后。

改了 3 处默认值（worker fallback、helper 默认、composition 默认），改完 `grep "8 \* 60_000"` 确认无残留。

### 二、根因方向：让断言自己把答案说出来

今天 `fill-billing-email` 抛了 8 次 `must resolve to one visible input`，我查一整天
说不出卡在哪——**而 `matches.length` 当时就在代码手里**。更糟的是
`chatgpt-checkout-navigator.js` 把这个数字藏在 `DEBUG_BROWSER_ERRORS` 后面，
生产环境从不开启，等于代码知道答案却不肯说。

新增 `src/locator-diagnostics.js`：把"找到几个、在哪个 frame、什么属性、有没有值"
写进错误消息本身。**只取结构特征，绝不取值**——邮箱、卡号、姓名都可能在 `value` 里，
而这条消息会进日志和数据库。

**六处全部改口**（先数后改，D-211 模式 B）：

| 文件 | 断言 |
|---|---|
| `billing-address-fill.js` | 账单邮箱框（**今天的根因所在**） |
| `nonpayment-card-fill.js` | 卡字段 |
| `chatgpt-checkout-navigator.js` ×3 | 控件 0 个 / 控件多个 / 按钮 / 菜单项 |
| `live-chatgpt-payment-adapter.js` | 等待循环超时那一轮 |

**过程里又犯了一次模式 B**：第一遍我说"4 处"就动手，实际是 6 处——`grep -c` 当时
就显示 navigator 有 4 条，我只改了 3 条。当场发现并补完，记在这里。

### 三、测试夹具这次是对抗性的

审查时自己指出的第 4 条问题：夹具是单页 HTML、只有 1 个邮箱框，**真实 bug 永远测不出来**。
新测试直接造出真实形态——主文档一个邮箱框 + iframe 里一个：

- `two visible email fields name both of them in the error`：消息必须说出"找到 2 个"
  并分别认出 `name=email` 与 `name=linkEmail`
- `diagnostics never leak the field value`：value 是 `secret-customer@...`，
  断言消息里**不得出现**它，只能说"已有值"
- `a broken candidate degrades instead of throwing`：诊断自己出错不能反过来弄坏流程

### 四、验证

- 全量 `npm test`：283 项，**277 通过 / 0 失败 / 9 跳过**
- worker 重启：**PID 25346 → 27629**（认 PID 变化，不认"进程存在"——D-211 模式 C），
  起于 01:35:17 UTC，晚于最后一处改动 01:33:37 ✓

### 五、下一步

**假说仍未证实**：Link 是否带来第二个邮箱框，要等下一次真实失败——但那时消息里会直接写着
"找到 N 个，分别在哪个 frame"，不用再抢现场。这是从"猜"转到"等一条会自报家门的日志"。

---

## D-213（2026-09-14 01:56 UTC）等待期间有人排队就让出 lane：承认"保留现场"与"吞吐"在单窗口下互斥

### 问题

D-212 把等待窗口从 8 分钟收到 90 秒，是止血。真正的结构问题没解决：
`runLaneLoop` 三个 step（`post-payment-verification` / `order-preflight` / `live`）
**依次串行**，`live` 一旦进入等待，另外两个 step 和后面所有客户全部停摆。

### 先承认一个互斥，再谈方案

**"保留现场"和"释放 lane"在单窗口下不可兼得**：下一单以 `startFresh=true` 运行，
开工第一件事就是 `closeStaleOrderPages` 关掉这个 checkout 页。

所以"有人排队还硬等"是**纯亏**：既堵住了别人，又保不住自己要保的那个现场。

### 决定：每轮问一次队列，有人排队立刻让路

| 情况 | 行为 | 理由 |
|---|---|---|
| 队列空 | 等满 90 秒 | 现场留得住，运营能接手——这正是它存在的意义 |
| 有人排队 | 立刻让出 lane，判失败 | 现场反正保不住，吞吐优先 |

### 实现里的两个坑

**坑一：不排除自己就等于没做。** 队列的权威口径要求 `o.status = 'RECHARGE_PROCESSING'`，
而**等待中的这一单自己就是这个状态**。照抄条件会把自己数进队列，一进等待立刻让路。
`countClaimable({ excludeOrderId })` 必须传排除项。

**坑二：不许另写一份近似 SQL。** 队列口径只有一个定义，`claim` 和 `countClaimable`
共用抽出来的 `CLAIMABLE_JOINS` / `CLAIMABLE_PREDICATE` 常量。两处各写一份迟早对不上
（D-211：判断工具不许抄业务规则；今天 `ready-check` 抄残缺资格 SQL 的教训还热着）。

### 验证

- 新增 3 条测试：**有人排队立刻让路**（并断言"每轮都问、不是只在开头问"）、
  队列空仍等满窗口、**队列查询自己挂了不能连累这一单**（查不到当作没人排队，继续等）
- 全量 `npm test`：**280 通过 / 0 失败 / 9 跳过**
- **`countClaimable` 对生产库实跑过**三种参数组合（不排除 / 排除某单 / 带 profile 过滤），
  都能执行、返回 0（当前队列为空）。**不是只过语法检查**——D-172 第 3 条的教训
- worker 重启：**PID 27629 → 34932**（认 PID 变化），起于 01:55:30 UTC，晚于改动 01:54:14 ✓

### 还没解决的

队列空时仍会占住 lane 最多 90 秒。彻底的解法是把等待挪出 lane 主循环（独立观察任务，
或改用不依赖浏览器的信号如卡台流水）。**当前量级下不值得做**——90 秒 × 队列空 = 无人受损。
量级上来后再看。

---

## D-214（2026-09-14 02:15 UTC）今天所有诊断努力卡在两行上：一个标记丢在包装里，一句消息丢在转手里

### 真单实测暴露的两个 bug（都是我自己的实现缺陷）

单号 `PJV1-zdprG5vkLzo7UKs8XEe1`（客户 `1710578962@qq.com`），第二次死在完全相同的位置：

```
02:04:55  fill-secure-card-controls     258ms
02:04:57  fill-billing-address         2474ms
02:04:58  fill-billing-email           1387ms  ← 和前一单同一步
```

**但两样本该生效的东西都没生效**：日志里仍然只有光秃秃三行，90 秒接手窗口**从未触发**
（失败 10 秒就判终态、退了 CDK，而现场其实好端端留在屏幕上）。

#### bug ①：`sceneHeld` 丢在错误包装里

`fillTransientBillingEmail` 抛的是 `ContractError`；我把 `sceneHeld` 设在**它**身上。
但 adapter 外层 catch 对非 Adapter 错误会**新建一个** `LiveChatGPTPaymentAdapterError`
抛出去——新对象上没有这个标记。于是上层永远看不到"现场留着"，D-210/D-213 做的
整个接手窗口**一次都没运行过**。

#### bug ②：诊断消息丢在转手里

```js
// shared-runtime-integration.js:452（修复前）
error: { code: payment.reasonCode || 'PRE_SUBMIT_FAILED' },
```

这里**凭 reasonCode 重造了一个空壳错误对象**，失败原因的文字整个丢掉。
今天做的 `stage`（D-205）、「找到几个」（D-212）——**全部死在这一行**。
我先前查 `diagnosticOf` 时判断"message 为空"，方向对但没走到底：不是取到空，
是上游根本没传。

### 修复

1. adapter 外层 catch 包装时把 `sceneHeld` 带过去
2. `payment-executor` 把 `diagnostic`（沿 cause 链拼的文字）带进 `PRE_SUBMIT_FAILED` 返回值
3. `shared-runtime-integration` 不再造空壳，`message: payment.diagnostic` 一并传下去

### 假说被推翻

现场实数邮箱框：**只有 1 个**（`name=email`，srcdoc frame）。
"Link 带来第二个邮箱框" **不成立，收回**。

`matches.length !== 1` 排除了"多于 1 个"，**剩下的可能是 0 个**——即执行器去找的那一刻
邮箱框还没挂载（填完地址仅 1.4 秒）。**这是时序问题而非数量问题，但仍是推断**：
要等诊断真正打出来那一句话才能定。

### 验证

- 新增 2 条测试：**包装后 sceneHeld 必须还在**（同时断言现场真的留着、stage 正确）、
  **规则拒绝不得带 sceneHeld**（否则上层白等一个窗口）
- 全量 `npm test`：**282 通过 / 0 失败 / 9 跳过**
- worker 重启：**PID 34932 → 43986**，起于 02:15:46 UTC，晚于改动 02:13:13 ✓

### 这一轮的教训

D-211 模式 B 的又一个变体：**我改了"设置标记"的地方，没改"传递标记"的地方**。
数清楚"有几处设置"不够，还要数清楚"它要穿过几层才能到达使用者"。
今天连着三次栽在同一种事上——stage 加了传不出来、sceneHeld 设了传不出来、
诊断拼了传不出来。**加一个字段时，把它从产生点到消费点的每一次转手都走一遍。**

---

## D-215（2026-09-14 03:40 UTC）全链路对抗式审查（阶段一：方向 / 业务 / 系统）

Lemon 要求：不只审查"改动有没有 bug"，还要查**方向是否错了**、**是否不符合业务逻辑**。

### 方向层：我一直在用错的口径报成绩

```
独立客户 11 人 → 9 人最终拿到 Plus
  其中：系统全自动完成 4 单 / Lemon 手动接手 5 单
真实自动化成功率 = 4/11 = 36%
```

我反复汇报的"9 个客户成功"，**有一半是人用手点出来的**。这个口径掩盖了真实状态。

**分界线极其清晰，且不是我的改动造成的：**

```
09:15 UTC  643111635 全自动成功（卡 3159）  ← 最后一次全自动
09:19 UTC  qixuanyu03 失败 CHECKOUT_DRIFT   ← 第一次失败
11:00 UTC  我今天第一次提交代码             ← 晚了 1 小时 45 分
```

同一张卡 3159 在 17:15（北京）还能全自动，17:19 就不行了——**不是卡、不是余额、不是我的代码**。

**从 09:19 到 03:40，17 个小时里我做了 10 次提交，没有一次是在修这个失败点。**
全部投在：诊断（D-208/212/214）、保留现场（D-205）、接手窗口（D-210/213）。

- **诊断那部分是必要的**：它确实把死点收敛到 `fillTransientBillingEmail` 一个函数
- **兜底那部分方向错了**：它优化的是"人工接手"，而人工接手本身就是要消灭的东西。
  D-210 还自己引入了堵队列的问题，又花一轮去修

### 业务层：手动接手的代价被我低估了一个量级

```
全自动完成： 150 / 156 / 220 / 665 秒        （2.5–11 分钟）
人工接手：   253 / 550 / 1139 / 4098 / 22267 秒（4 分钟–6 小时）
```

同样叫"成功"，**客户等待时间差 10~100 倍**——人工那条路的耗时不取决于系统，
取决于运营什么时候看到消息。

按 Lemon 的北极星（一天几十上百单），**64% 需要人工 = 一天接手几十次**，业务上不成立。
**所以自动化成功率是唯一重要的指标，兜底体验再顺也不解决问题。**

### 系统层：三处结构性问题

**① 重试上限看的计数，和实际重试次数不是一个东西**

```
PJV1-XrDZCfpakRwaoRQLrEbS  runs=11  attempt_count=1
PJV1-pom5NfWiskFl9u4Aspdm  runs=3   attempt_count=1
```

`maxDispatchAttempts=3` 检查的是 `claimed.attemptCount`，而一个 dispatch job 下可以跑
多次 run 却不累加它。那单最终成功（11 分钟），但**这道闸门在持续失败时不会生效**。

**② `PRE_SUBMIT_FAILED` 那条路（D-203 让断连走的正是它）不经过重试上限检查**

上限检查在 catch 分支里，只处理抛出的异常；`PRE_SUBMIT_FAILED` 是**返回值**，
走的是另一条路（`shared-runtime-integration.js:449`），**没有 attemptCount 判断**。

**③ 卡余额的三道防线今天全部失守**（详见 D-207/D-211 续）：卡台有结算延迟、
库内同步一小时一次且 `MANUAL_IMPORT` 无条件豁免时效检查、账本状态错标成 `RELEASED`。

### 一个被当场推翻的修复方案

我一度认定 `fillTransientBillingEmail` 缺等待循环（卡字段和账单地址都有，只有它没有）
就是根因，并称"这个修复不依赖任何假说"。**读完整个函数后收回**：

```js
if (matches.length === 0 && !required) return { ... emailFieldPresent: false };
```

**找到 0 个时它正常返回、不抛错**。所以"邮箱框还没挂载"根本不会失败，加等待救不了
一个不存在的问题。该函数真正能失败的只剩三处：邮箱格式、**找到 ≥2 个**、
**`fill()` 5 秒超时**（第三处我先前完全没考虑）。

**三者修法完全不同，而我没有证据区分是哪一个。** D-214 刚修好诊断传递链，
下一次真实失败会直接说明——**在那之前不动手**。

### 阶段结论（给下一步排序）

1. **拿下一单的诊断，定位 `fill-billing-email` 到底是三处里的哪一处** —— 唯一能提升
   自动化率的路
2. 账本推算可用额（D-207 续）—— 防止分到钱不够的卡
3. 重试计数口径（本条系统层①②）
4. **兜底体验相关的一律降级**：现场保留已够用，窗口/队列让路不再投入

### 未完成

实现层逐条（9 项）、SSH ControlMaster 的安全面、客户侧观感，下一阶段继续。

---

## D-216（2026-09-14 05:00 UTC）免费试用账号：系统充不了、人也充不了，唯一一个业务层面无解的案例

### 事实

订单 `PJV1-_md1Qxt_rBopPGKMOkwB`（客户 `zhouyt2022@outlook.com`）：

```
reasonCode: CHECKOUT_NAVIGATION_FAILED
diagnosticMessage: 'plus upgrade control must resolve to one visible button (找到 0 个)'
```

**这是 D-212 的诊断第一次在真实失败中给出答案**——今天之前这里只有一句
`must resolve to one visible button`，要靠猜。

Lemon 在现场看到结账页显示 **0 元**，页面带 `?promo_campaign=plus-1-month-free`，
文案是 `Offer applied: ChatGPT Plus - 1 Month Free Trial`。价格行为
`₱982.14 / ₱982.14 / ₱0.00 / ₱0.00`。

**Lemon 手动试了几次也充不上**，已给客户退款，CDK 待作废
（批次 `B-20260914044709524-D9EB06`，批内仅此一张）。

### OpenAI 官方条款（帮助文档原文要点，非推断）

- Most promotions **auto-renew to the standard ChatGPT Plus monthly rate** after the promo ends
- cancel **at least 24 hours before renewal** to avoid an unwanted charge
- Some promotions are **exclusively for new Plus subscribers**（从未订阅过 Plus 的账号）

### 系统 fail-closed 是对的，这次它挡住了一个资金陷阱

若自动点下那个 0 元 Subscribe：客户立刻拿到 1 个月 Plus（我们零成本），
**但我们的卡被绑为付款方式，一个月后自动续费 ₱982.14 扣我们**。
唯一的防线是"付款后取消续费"，而**今天已有多个账号的续费尚未取消**——这条防线是漏的。

执行器找不到预期的升级入口就停下，没有把我们的卡绑进一个会自动扣款的订阅。

### 待 Lemon 定的业务口径（D-190 第五节挂了很久，今天真实发生）

客户付全款，而他自己本可免费领这一个月。三个方向：

1. **兑换入口就拦**：检测到免费试用资格直接不接单，告诉客户可自行免费领
2. **照常做**：零成本交付，风险全压在取消续费这道工序上
3. **转人工**：停下推手机，逐单处理

大脑建议 **1**：理由不是技术，是客户日后会发现本可免费领而我们收了全款；
规模化后这是口碑风险，不是单笔得失。**决定权在 Lemon。**

### 注意：这一单的"无解"不能推广到别的失败

本单 `CHECKOUT_NAVIGATION_FAILED`（连结账页都没到）与今天主线的
`CHECKOUT_DRIFT`（死在 `fill-billing-email`）**是两回事**。
主线根因仍未定位，等下一单带诊断的真实失败。

---

## D-217（2026-09-14 08:10 UTC）对抗式审查：「API 转正、Browser 备份」这个方案站不住

Lemon 要求对我刚给的路线方案做对抗式审查。查证后，**方案的核心论据被推翻**。

### 被推翻的论据

**① 「API 变量空间小，所以结构性更稳」——错。**

`zzshu-recharge.js` 的 `buildDirectOrderRequest({ cardNumber, expMonth, expYear, cvv, token })`：
我们把**完整卡号、有效期、CVV、客户的 Session token 全部递给 ZZSHU**，它拿去做的事和我们的
Browser 路线一模一样——登录客户账号、在 ChatGPT 页面付款。

**变量没有变少，是被别人扛了。** 而且多了一层：卡与客户凭证外泄给第三方。

**② 「API 31% vs Browser 8%」——两边都是开发期数据，不可比。**

拆开 API 的 13 次：3 次 `40030` 拒单（账号已是 Plus，建单前就拒）、1 次测试 hold、
5 次 `status: failed`、4 次成功。**真实充值尝试 9 次成功 4 次 = 44%**，样本 9。
Browser 真实客户单 4/11 = 36%，样本 11。**差距在噪音范围内。**

**③ 「API 更稳」——只有今天 1 单是真实客户单。** 其余全在 09-07 之前。

### 比推翻论据更严重的发现

**ZZSHU 充值失败是纯黑盒。** 那 5 次 `status: failed`，响应里只有：

```json
{"status": "failed", "cardKey": "DIRECT-…", "orderNo": "9247", "planType": "plus"}
```

**零原因。** Browser 路线今天至少做到了 stage + 「找到几个」+ 现场保留；ZZSHU 失败了
连"死在哪一步"都不会说。**"稳"的前提是能诊断、能改进——ZZSHU 两样都没有。**

### 方案里的死锁

若 API 转正、Browser 停跑，Browser 那个死点（`fill-billing-email`）永远拿不到诊断，
备份永远修不好。rehearsal 能解，但要关付款开关、停生产 5~8 分钟。**方案没考虑这一点。**

### 站得住的部分

- 先定主路线，再动后台 —— 对
- 后台问题被高估：23 条里证据扎实的 5 条 —— 对
- 切换缺"目标路线有没有可用卡"的校验 —— 对，今天卡在 `WAITING_FOR_CARD` 就是它
- `CURRENT_STATE` 至少三处过期 —— 对

### 修正后的判断

**两条路线都没达到"连续 5 单无人工"，谁也不配叫主路线。** 但离这条线更近的是 **Browser**：
它有诊断、有 stage、有现场保留，死点已缩到一个函数三种可能，**下一单失败就能定位**。
ZZSHU 失败零原因，无从改进，且依赖供应商、外泄凭证。

**修正建议**：
- **短期**（这几天）：API 顶着接单，减少 Lemon 手动接手——它今天确实 95 秒跑通了
- **同时**：Browser 用夜间无单时段跑 rehearsal 拿诊断、修死点，**不停生产**
- **目标**：Browser 达到"连续 5 单"后转正；API 退回"供应商还在时的应急"
- 这和我上一条建议**方向相反**。上一条错在把 ZZSHU 当黑盒假设它稳。

### 教训

审查自己的方案时，第一件事是**找出它依赖的那个没验证的假设**。我的假设是"API 是一个 HTTP 调用"，
查一眼 provider 代码就推翻了——它是把浏览器自动化外包。这一眼我在给方案前没看。

## D-218（2026-09-14 09:05 UTC）手动给卡补钱能救当下，但会被还没发布的 A3 新规则挡死

> **【后续·2026-09-16 复查】已选项 3（放弃补钱、只开新卡），A3 可发；补余额作为废机制（见 §5.1、D-235）。下方"待 Lemon 定"是 09-14 当时状态。**

### 起因

Lemon 说「卡台有余额，卡里也有」，与我 08:45 的结论（hnskj 可分配 0 张）冲突。
**冲突是我错。** 拉卡台原始响应（只读，`/tmp/hnskj-readonly.mjs`，对长数字串脱敏）后：

```
FIELD_KEYS= ["id","cardNumber","last4","cardType","status","cardBalance","remark","createdAt",...]
CARD= {"id":4458,"last4":"1652","status":"active","cardBalance":"50.290000",...}
```

卡台侧 `1652` 是 **$50.29**，库内 `current_balance` 是 **$0.29**。钱在卡上，是系统没读到。
对得上 HNSKJ 钱包余额 08:42 `$121.77` → 08:47 `$71.52` 少掉的 $50.25。

### 系统自己追上了，而且当场跑完一单

- 08:57:10 建单 `PJV1-i9TyuhvtCVYmHa5EjNuX`（API 路线）→ 库内余额仍是旧值 → `WAITING_FOR_CARD`
- 该路径排了一次按需同步（`order-demand-sync`，`requested_by=worker`），09:02:43 完成，读到 $50.29
- 09:02:44 分卡 → 09:04:20 `RECHARGE_SUCCESS`，₱982.14 PHP，`subscription_cancelled=1`
- **等卡 5 分 34 秒，拿到卡之后只用了 96 秒。** 延迟全在余额同步，不在充值本身。

### 真正的发现：`funded_amount` 不随补余额更新

`card-stock-service.js:260` 写的是 `funded_amount = COALESCE(?, funded_amount)`，参数来自
`mapStockCard` 的 `fundedAmount` 选项——**由调用方传的开卡金额**，不是卡台响应里的字段
（卡台响应根本没有 funded 字段，只有 `cardBalance`）。所以手动往卡里充钱，`funded_amount`
永远停在开卡时的值。

拿工作区那份（含 D-217 账本推算、**尚未发布**）实跑，不是推理：

| 卡 | current_balance | funded_amount | 账本消费 | 新规则判定 |
|---|---|---|---|---|
| `1657` | $18.56 | $50.00 | $32.00 | **1（可分配）** |
| `1652` | **$50.29** | $16.00 | $32.00 | **0（不可分配）** |

`LEAST(50.29, 16 − 32) = −16 < 16` → 拒绝。**卡上有 $50，新规则判它不能用。**

### 结论

**A3（发布账本推算口径）一旦上线，「给已有卡补钱」这条续命路径就断了。** 生产现在跑的是旧规则
（只看 `current_balance`），所以今天这单跑通了；PLAN_2026-09-14 把 A3 排在第一周周一。

**不是说 A3 错**——它挡住的是「卡台快照滞后导致把用过的卡再分出去」，那个失败同样真实。
问题是它和补余额这条路径互斥，而**两条路径当前都在用**。

### 待 Lemon 定（未实施任何改动）

1. **补余额时同步抬 `funded_amount`**（补多少加多少）——最直接，但要找准写入点，且补余额目前
   走的是人工在卡台操作，系统看不见这个动作，只能靠对账推。
2. **A3 改成「`funded_amount` 与账本任一更新过就信 `current_balance`」**——放宽，退回部分风险。
3. **A3 照发，明确放弃补余额，只用开新卡**——最干净，代价是每单一张新卡的开卡费。

在定下来之前**不要发 A3**，否则下一次补余额会变成「卡上有钱但系统说没卡」，
而这个症状和今天早上那次（真没卡）长得一模一样，很难当场分清。

### D-218 补记（2026-09-14 11:45 UTC）：那 $50 已经不在卡上了

上面写完不到 10 分钟，现场就变了，**当场重查才发现**（差点拿 09:04 的读数当现状汇报）：

- `1652` 现在 `DEPLETED`、余额 **$0.01**
- 卡流水多了一条 **`CARD_BALANCE_RETURN` $34.57 SUCCESS**（系统 10:00:12 首次读到）
- HNSKJ 钱包 09:12 `$71.52` → 09:17 **`$106.09`**，正好 +$34.57 —— **退款实际发生在 09:12–09:17 UTC**，
  流水的 10:00 只是系统读到它的时间

**不是系统做的**：`grep -rn "BALANCE_RETURN\|balanceReturn\|returnBalance" v1/src browser-mvp/src` 无结果，
代码里没有发起退余额的写路径；worker `PROVIDER_CARD_WRITES_ENABLED=false`；10:00 前后的 provider_calls
只有 `card_reconciliation_detail` / `card_reconciliation_transactions` 两个只读操作。
**是谁退的、为什么退，未查清。** 另注意 09:54 对卡 `616`（7705）的对账里也出现 `card_balance_return` 类型。

**当前可分配卡回到 1 张（`1657`，backup-a），API 路线冻结卡源是 hnskj，所以 API 路线又没卡了。**

### 顺带修掉一个会撒谎的工具

`browser-mvp/scripts/state-check.sh` 自称「现场事实比对」，但它生成资格 SQL 用的是**工作区**那份
`card-inventory-eligibility.js`。工作区已含 D-217 账本推算而生产未发布，两份对 `1652` 给出相反判定
（生产：可分配；工作区：不可分配），于是它报「1 张」而生产实际会分出 2 张。
**已改成 ssh 取生产 release 的那份来生成 SQL，取不到就报 `[取值失败]`，绝不回退本地。**
这正是「判断工具不许抄业务规则、也不许用未发布的规则冒充现场」的又一次实例。

---

## D-219（2026-09-14 09:30 UTC）对 V2 架构方案的对抗式审查：中心思想对，但七处边界画错

Lemon 认可中心思想（订单驱动）与四个面，开放控制面调整，并问对抗式审查何时做。
大脑判断：**现在审 V2 方案本身**（架构错了做完再改代价两周，现在审一小时）；
**V2.0 实现完再审整个项目**（那时有真实代码与生产可审）。以下是审查结果，每条带生产数据。

### 发现 1：中心不该是「订单」，该是「CDK」

```
51 个已用 CDK → 73 个订单，平均 1.43，最多 1 个 CDK 对 12 单，6 个 CDK 有重试
```

Lemon 的原话：「客户拿到 CDK 就等于付了钱」。**CDK 才是"客户的一次购买"，订单只是一次尝试。**
chenxing 那 12 单在 V1 里是 12 个陌生订单，在 V2 里应该是**一个 CDK 的 12 次尝试**——
"同一客户第 N 次"这个概念自然就有了，连败熔断、客户页"你已经试了 N 次"都不用另造。
**修正：V2 的唯一真相是 CDK 的生命周期；订单降为 CDK 下的尝试记录。**

### 发现 2：执行面接口只写了四分之一

成功一单在 `browser_operations` 里是四步：`PAYMENT_SUBMIT → PAYMENT_CONFIRMED → PLUS_ACTIVATED → CANCELLATION_CONFIRMED`。
我写的接口只有 `execute()`，对应第一步。**交付 = 付款 + 确认 + 开通 + 取消续费，缺一不算交付。**
修正：接口扩成 `submit / verify / cancelRenewal` 三段，每段可独立重试、独立标 UNKNOWN。

### 发现 3：通知面的问题比"18 类太多"严重——它把最该推的漏了

```
两天 77 条告警 → 76 条推了手机
其中真需要人的：PAYMENT_UNKNOWN 6 + STALLED 2 + HUMAN_REQUIRED 1 + STOCK_EMPTY 1 = 10 条（13%）
CARD_STOCK_EMPTY 那条 → pushed = 0   ← 唯一没推的，恰是最该推的
```

**87% 的推送是噪音，而缺卡告警没推。** 通知面要重做的不是分类数，是**推送与否的判断**：
只有进「需要我处理」队列的才推；供给类（缺卡、开卡失败）单独一条通道，**必须推**。
另加第四类「资金异常」（重复扣款、账本与卡台不一致），今天 V2 稿里漏了。

### 发现 4：展示面「三态」会丢一个客户必须知道的状态

客户页现有 10 种视图。其中 `ACTION_REQUIRED`（等客户换 Session）**是客户必须行动的**，
并进"处理中"客户就不知道要做事。修正：**四态**——处理中 / 需要你换 Session / 已开通 / 没成功联系客服。

### 发现 5：「一键切换」今天暴露了它为什么不是一键

```
06:36:01  路线 302(BROWSER) → 301(API)          provider_route_switch_events
06:36:08  Plus 卡台 103(backup-a) → 101(hnskj)   browser_card_source_switch_events
```

**Lemon 切一次路线，后台同时动了卡台**——7 秒内两条记录。这就是"切换麻烦"的实体：
它不是一个开关，是两个耦合的开关，而运营看到的只有一个按钮。
修正：执行面的切换校验要**同时校验并明示**卡台会跟着变什么；或者解耦，让卡台成为执行器自己的属性。

### 发现 6：两条路线的终态一致，状态机可以共用

```
API:     RECHARGE_SUCCESS 5 / RECHARGE_FAILED 7 / CLOSED 2
BROWSER: RECHARGE_SUCCESS 24 / RECHARGE_FAILED 32 / CLOSED 30
```

终态三种完全一致；中间态差异在执行器内部。**统一状态机成立**，不需要为路线开分支。

### 发现 7：漏了一个面——对账

Lemon 明确要"基础对账能力"。V2 稿五个面里没有它。现状：`card_transactions` 41 行、12 张卡、
最近同步 09-14 11:39；`card-consumption-audit.js` 是只读比对，**从未接进任何流程**。
修正：加第六个面「对账面」——每日一次账本 vs 卡台交易的自动比对，差异进「需要我处理」。
它是资金异常告警的数据源。

### 附：精简清单的一条核实

删 `refund_cases`：代码引用 3 文件 7 行，**与对账代码零交集**——可删，代价小。

### 控制面：从基线 5 页收成 4 页（Lemon 开放调整后的建议）

三周实际操作分布：CDK 生成 53 次（最高频）、付款开关 19 次、其余零星。
**首页 + 订单 + 需要我处理 → 合成一个「工作台」**：顶部三个开关，中间需要我处理，
下面今日订单，**CDK 生成按钮放最上面**（最高频操作不该在二级页）。
四页：**工作台 / CDK / 卡片 / 设置**。诊断仍是高级入口。

### 下一步

修正 V2 文档（同轮），Lemon 认可后进 V2.0。整个项目的对抗式审查排在 V2.0 实现完之后。

---

## D-220（2026-09-14 14:05 UTC）服务器 worker 一直跑着 09-11 的 release：发布脚本只重启 web

> **【后续·2026-09-16 复查】`switch` 已改为发布时同时重启 worker（`b9f0837`）；下方处置 2"待 Lemon 定"已定并实施。worker 当前实际 release 仍以 `state-check` 现场为准。**

### 观察（新 ssh 独立核实）

```
current                 -> /opt/pojia/releases/20260913-orderno-6dcb458
pojia-web    MainPID 3715151  cwd=/opt/pojia/releases/20260913-orderno-6dcb458/v1  起于 09-13 08:44 UTC
pojia-worker MainPID 2149614  cwd=/opt/pojia/releases/20260911-alert-noise-d924563/v1  起于 09-11 15:31 UTC
scripts/deploy-release.sh:86   systemctl restart pojia-web.service      ← 只有 web
```

`WorkingDirectory=/opt/pojia/current/v1` 是符号链接，进程启动时解析成实际目录，之后切 release 进程不跟。
`HANDOFF_LOG` 09-11 06:36 UTC 那条就记过「历次 switch 均未重启 worker，worker 侧改动若有需单独重启」——
记了，没人做，`state-check.sh` 也只比 `is-active`，所以四次发布都报"一致"。

### 影响判定（有证据，不是估）

`worker.js` 的 import 树共 33 个模块；09-11→09-13 两个 release 之间 `v1/src` 改了 15 个文件，交集只有 2 个：

| 文件 | 改动 | worker 侧行为 |
|---|---|---|
| `db/repositories/cdk-return-repository.js` | 把证据查询抽成 `readCdkReturnEvidence` + `cdkReturnBlockedBy` 供客户页复用 | SQL 与判定逐字相同，**等价** |
| `domain/session-validation.js` | 默认 `minimumAccessTokenLifetimeSeconds` 300→1800 | worker 侧更宽松；web 下单入口（新 release）已按 1800 把关，**不会多放进任何单** |

**结论：当前无行为差异，不必紧急重启。** 今天 4 单（3 成 1 败）不受影响。

### 处置

1. `state-check.sh` 加「pojia-worker 进程实际 release」比对项，`CURRENT_STATE` 对应行写明现值——下次再漂就报出来（本轮已做）。
2. **`deploy-release.sh switch` 是否改为同时重启 worker**：worker 用租约 + 有界重试，重启安全，但要在非终态订单 0 时做；
   改脚本后每次发布 worker 都会重启一次。**待 Lemon 定**（不改 = 每次发布后由大脑判断要不要单独重启，靠人记）。
3. 现在要不要把 worker 对齐到 09-13：非终态 0、active_runs 0，是安全窗口；但无行为差异，**不为对齐而重启**。等下次含 worker 侧改动的发布一起。

### 顺带修掉

新加的 ssh 片段第一版在远端双引号里写了 `sed "s#/v1$##"`——`$#` 被展开成参数个数，sed 报 unterminated。
改为 bash 参数展开 `${d%/v1}`。又一次「工具失败时说什么」没先想：这条要是不实跑，会把"取不到"当漂移。

---

## D-221（2026-09-14 14:50 UTC）每卡单数按产品：Plus 3 单、5X/20X 1 单，API 与 Browser 两路线一致（Lemon 定）

### Lemon 的规则（原话要点）

「API 卡台和 API 充值的逻辑已经变了：如果是 Plus，一卡 3 单；如果是 5X 和 20X，一卡一单。与我的 Browser 是一致的。」

### 系统现状（当场核实，`app_settings` 全表 + 今天 4 单）

| 项 | 现值 | 与规则的差 |
|---|---|---|
| `card_max_successful_payments` | **3，全局一个值**；后台只能设 1–4；资格 SQL 三处都读它 | Plus 对；5X/20X 需要 1，**没有按产品的位置** |
| `default_open_card_amount` | **16，全局**；今天 4 单 `open_card_amount` 全是 16 | Plus 3 单需 ≥ $47.16（3 × $15.72）→ 应为 **50**；**没有任何后台端点能改它**（迁移 003 初始化为空，card-stock 端点只有 default-card-type / max-successful-payments / minimum-balance） |
| `minimum_required_card_balance:*` | plus 16 / pro_5x 16 / pro_20x 150 | 已按产品 |
| 历史 hnskj 卡 | 5 张各 $16 开、一单即 `DEPLETED` | 那是旧开卡金额下的结果，**不是规则** |

**我上一轮说「hnskj 卡从来就是一卡一单」是把历史观察当成了规则，收回。**（惯犯 B：给观察补了一个规则。）

### 影响

- **D-218 选项 3 的代价修正**：不是"每单一张 $16 卡"，是"每 3 单一张 $50 卡"——与 Browser/highvcc 现状完全一致（`3159`、`5371` 各 $50 跑 3 单剩 $2.84）。
- **hnskj 开卡金额 = $50**：Lemon 手动开照此（上次 `1652` 就是 $50，类型 20）。系统自动开卡（V2.0 卡供给自动化）之前必须把 `default_open_card_amount` 16 → 50，否则自动开出的卡只够一单。
- **5X/20X 进 V2.1 时**，每卡单数必须按产品（Plus 3 / 5X 1 / 20X 1）；全局设置不够。V2 资源面加"按产品的每卡单数 + 开卡金额"，设置页对应改。
- CLAUDE.md 硬约束「全局 1–4 次成功充值上限」改为按产品（本轮已改）。
- `PLAN_2026-09-14.md` §2 的算术（每卡 3 单、$50/张、67 张/天）本来就按这个规则算，不变。

### 待做

1. `default_open_card_amount` 16 → 50：需要正式写路径——V2.0 设置页加"按产品开卡金额"端点，或先一次性正式脚本（带审计、可 dry-run）。**不用 prod-query 写。** 在此之前系统自动开卡不开。
2. 5X/20X 按产品上限：V2.1 任务。

---

## D-222（2026-09-14 15:05 UTC）验收标准去时间化 + 三天时间盒（Lemon 定，推翻我的"连续 N 天不求助"）

> **【后续·2026-09-16 复查】三天时间盒已漂——今天 09-16 仍在 V2 阶段2收尾、未进落实（这几天花在深入核查、把地基摸准，Lemon 认可可延长）。去时间验收口径（测试+脚本+只读复验）仍有效不变。**

### Lemon 的批评（原话）

「你用时间作为验收标准，这个我非常不满意。」并给出硬时间：**明天一天（09-15）解决两天冲刺；V2.0 / V2.1 / V2.2 各一天（09-16 / 09-17 / 09-18 起）；三天之内这套系统必须全做完。**

### 我错在哪

我把**「做对了」**和**「跑久了没出事」**混成了一件事。「连续 N 天 Lemon 不求助」根本不证明功能做对，只证明这几天没人来问——它把我的举证责任推给了时间。这是惯犯「用行动/等待掩盖没法证明做对了」的变体。

### 新验收口径（本项目自此生效）

一个交付物**完成**的定义：**它的行为可当场核实为正确**，由三类客观证据回答，**不由时间、不由 AI 自述**：

1. **针对性测试通过**——含对抗性夹具（不是只测 happy path；D-172 惯犯 C 的教训：274 个测试全绿却对真 bug 零覆盖）。
2. **现场脚本一致**——`state-check.sh` / `wrapup-check.sh` / `ready-check.sh` 相关项全绿。
3. **生产只读复验**——新连接、新命令核对该行为（CLAUDE.md「生产写操作必须独立核实」）。

**稳定性（跑久了没事）是运营期观察，不作为交付验收门槛。** 想知道稳不稳要看运营期数据，但那不是"这个功能做没做完"的答案。

**每个任务的验收标准必须写成上面三类里可机器检查的形式**，落进 `docs/tasks/`。这也是接班模型 / 多窗口能直接开工的前提。

### 三天时间盒（架构演进，验收全部按上面的口径，不含"连续 N 天"）

| 日 | 目标 | 可当场核实的完成定义（DoD） | 外部依赖（我交付不了"生产跑通"的部分，需 Lemon / 外部） |
|---|---|---|---|
| **09-15** | 两天冲刺压成一天：Browser 主线能跑真单且失败可诊断 | ①A3+funded_amount 修正发布，`state-check` 一致 ②`fill-billing-email` 死因写进库（DB 里能查到确切原因，不靠日志缓冲）③切换校验：目标路线无卡则拒切并给因 | 真实失败样本需要真单；日常单量低，可能要用 rehearsal 兜 |
| **09-16** | V2.0：执行面接口三段 + 切换解耦卡台 + 资源面按产品 + 控制面骨架 | ①接口测试：同一订单分别走 API/Browser 都返回 submit/verify/cancelRenewal 三段；旧单段 `execute()` 入口已删 ②测试证明切路线不再连带改卡台 ③`default_open_card_amount` 按产品可改（端点+审计）④控制面 4 页能加载、关键操作可点 | 自动开卡"生产跑通"依赖 **hnskj 卡台服务器**（今天就坏了，不在我控制内） |
| **09-17** | V2.1：5X/20X 进接口 + 展示面四态 + 通知面 4 类 + 对账面 + 精简删表 | ①通知分类函数只输出 4 类，测试：缺卡必推、信息类不推 ②展示面四态（含 WAITING_FOR_SESSION）测试 ③对账 job 能跑、差异写进队列 ④0 行表已删、入口已清（`grep` 证明无残留引用）| 5X/20X **无真实升级样本**（D-138 之前因量小不做）；代码+测试可交付，真实跑通需真实 5X 客户单 |
| **09-18 起** | V2.2：Browser 迁服务器 + Plus→Pro 升级 | 依 BitBrowser 调研结论走路 1 / 路 2 | **BitBrowser Linux 有没有官方版未调研**——这是 V2.2 能不能按期的唯一前提，必须先调研 |

**诚实标注（不是用时间讨价还价，是把"我可控的"和"依赖外部的"分开——这正是新验收口径要求的）**：代码 + 测试 + 可当场验的行为，三天能交付 V2.0/V2.1 骨架；但上表右列几处的"生产实跑跑通"依赖卡台服务器、BitBrowser Linux、真实 5X 单——这些不是敲键盘能解决的。那几处按新口径的验收是「代码对 + 测试绿 + 能当场验的行为」，「生产跑通」单独作为运营期里程碑，由 Lemon 判定何时算数。

### 接班可续性

三天计划本身按任务书粒度写进 `docs/tasks/`（目标 / 验收 / 边界 / 涉及文件），任何模型或窗口可据此开工。验收不信自述、只信上面三类脚本与测试。

### 补记（2026-09-14 15:20 UTC）：三天是高强度协作的目标，不是赶工交半成品

Lemon 强调：「三天内交付，不是让你去赶工，而是要做高强度的协作、尽快推进，而不是给我做一个半成品或精简版。」

**我上一条回应错在**：面对紧目标，第一反应是防御性地标注"哪里做不完、准备降级方案"（控制面 4 页做不完就降到工作台 1 页）——这是把**自己该做的活做一半**，收回。

**两种"精简"必须分清**：
- **V2 的后台精简**（删无效字段、18 类告警→4 类、5 页→4 页）是 Lemon 要的**产品目标**，是删冗余——要做。
- **把该做的功能做一半** = 交付缩水——他反感的，不做。

**真实外部依赖**（hnskj 卡台故障、BitBrowser Linux 未调研、无真实 5X 样本）仍据实标注——那不由我，是协作里需要 Lemon/外部补的部分，**不是我交半成品的借口**。

**交付标准 = 完整。手段 = 高强度协作**：①多窗口并行（大脑验收 + 执行 A browser-mvp + 执行 B v1）②Lemon 深度参与（决定/开卡/样本/即时反馈）③快速反馈循环——每个 DoD 达成即给可当场验的证据，不攒到最后。

---

## D-223（2026-09-14 15:05 UTC）后台"自动开卡与补余额"是两个开关合一，补余额实际从未关成

> **【后续·2026-09-16 复查】已解决：补余额开关已关成 `card_balance_recharge_enabled=false`（2026-09-16 [A6] 生产核实）；下方"待 Lemon 真关"已完成。**

### 冲突与根因

Lemon 说「后台自动补余额已经关了」，系统显示 `card_balance_recharge_enabled=true`。按 CLAUDE.md「冲突即停止下结论」，查 `admin_setting_events` 审计：

```
card_auto_replenishment_enabled  true→false  codex:d4-safety-stop     2026-09-05 22:33
card_balance_recharge_enabled    false→true  deployment:card-funding  2026-08-31 02:06   ← 之后再无变更
```

**补余额开关从 08-31 至今没被改过。** 后台 `admin.js:348` 把两个 setting 捆成一个 UI 开关"自动开卡与补余额"：
`supplyOn = 两个都 true`，`supplyMixed = 一个 true 一个 false`。自动开卡 09-05 已被关，所以界面显示"部分开启"；
Lemon 想关补余额，点这个合并开关很可能没有把 `card_balance_recharge_enabled` 落成 false。

**今天 4 次 hnskj `card_recharge` 400（06:40/06:43/08:58/09:02）就是这个开关 true 触发的**——系统对 1652 尝试补钱，被卡台拒。

### 这是 D-219 发现 5 的又一实例

「运营看到一个按钮，背后是两个耦合开关」。V2 控制面要把这类合并开关拆开，或让 UI 显示每个 setting 的真实值。

### 处置

- **待 Lemon 去后台真正关闭补余额**，或明确授权大脑走正式端点关（生产开关按惯例 Lemon 点）。关闭后 `admin_setting_events` 会留一条 `true→false`，届时独立核实。
- 在关成之前，缺卡时系统仍会尝试补钱并撞 400（无害但是噪音，且与 D-218「放弃补钱只开新卡」的决定相悖）。

---

## D-224（2026-09-14 15:45 UTC）对整套大方案的对抗式审查（Opus 4.8 接手后重做，真读代码/生产/基线取证）

> **【后续·2026-09-16 复查】发现A（200单靠 highvcc 自动开卡）已被 D-235 改为"highvcc 手动 100张/天够、不做自动开卡"；发现C（建议退 5 页）已被 D-226 作废（最终 4 页）。发现 B/D/E/F/H 与六面划分仍有效（发现 D 删表纪律经 D-236 自查进一步坐实）。**

背景：换模型后 Lemon 要求对"三天时间盒 + V2 六个面 + 协作机制"做对抗式审查，并借此让新模型彻底了解项目、防跑偏。以下每条指得到证据。量级：v1 105 文件 22742 行、browser-mvp 52 文件 9361 行、后台前端 2366 行、52 表、73 端点、161 测试文件。

### 发现 A（方向，最重）：200 单/天的关键路径卡在一个从没调研过的前提上，却排在最后一天

`provider_accounts` 实查：highvcc(backup-a) `supports_api_recharge=0`（**只能喂 Browser 路线**）；hnskj `supports_auto_open=1` 但生产从没成功过（09-05 内测结束、今天服务器故障）。推论链：
- API 路线（ZZSHU）只能用 hnskj 的卡 → hnskj 自动开卡不可行 → **API 路线的自动供卡实际不存在，只能靠 Lemon 手动开卡**。
- highvcc 服务端 `openCard()` 已实现（`highvcc-card-service.js:276`），能自动开卡 → 但只能喂 Browser 路线。
- **所以 200 单/天（67 张卡/天，手点不可能）的唯一可行供给路径 = highvcc 自动开卡 + Browser 路线。**
- Browser 跑 200 单必须迁服务器（本机 1 lane 扛不住）= V2.2；V2.2 依赖 **BitBrowser 有没有 Linux 版**（§5「项目从没调研过」）。

**结论：V2.2 不是收尾锦上添花，是 200 单/天的必要前置；而它的可行性取决于一个没人查过的事实。BitBrowser Linux 调研应该现在做，不是第 4 天做**——若无官方版（路 2 = 重做 runtime 层：代理+指纹+扩展），是大工程，绝非一天，整个 200 单目标要重新排期。

### 发现 B（方向/措辞）：CDK 驱动被包装成架构革命，实质是聚合层改动

`orders.cdk_id`（NOT NULL、有索引）已存在，实测一个 CDK 挂 12 单，**数据层已支持按 CDK 聚合**；V2 §4.3 白纸黑字「订单/CDK 状态机保留不动」。所以"CDK 驱动、订单降为尝试记录、一切围绕 CDK 重构"这个措辞，实质只是**展示/熔断/控制层按 `cdk_id` 聚合**——量级远小于措辞暗示。**风险：措辞会让执行窗口以为要重构状态机（跑偏源头）。** 应改：V2 是"在保留的状态机之上，重整执行器接口、卡供给、后台呈现、告警、对账"——是整理和补齐，不是重造。（利好：V2.0 实际量级比字面小。）

### 发现 C（业务，同一处第二次自作主张）：控制面 4 页偏离 Lemon 确认的 5 页基线

`PRODUCT_SIMPLIFICATION_DISCUSSION.md` 的「接班实施基线」（Lemon 2026-09-06 亲自确认）明确 **9→5 页：首页 / 订单 / CDK / 卡片 / 设置**，且首页（五决定+四数字+需要我处理+心跳）与订单（实时运营板，七列+详情四块）**分开、各自信息密集**。V2 §3.3 把它俩合并成"工作台"收成 4 页，理由写"Lemon 开放调整后"——但 Lemon 原话只是控制面"可以调整"，**没有说合并首页+订单**。**Lemon 之前已纠正过一次"4 页是你发明的，基线是 5 页"，这是同一处第二次自作主张。** 建议退回 5 页基线，除非 Lemon 明确要合并。

### 发现 D（方法论/防跑偏）：V2 精简清单照搬 09-06 基线行数，多处已过时

Browser 主链路是 09-06 基线之后上线的，好几个"0 行待删"已变。当场重查：
- `payment_permits` 基线 0 行/待删 → **现在 26 行、在用**（`browser-execution-repository.js` 写入，Browser 付款资金栅栏）。V2 §4.3 保留它是对的，但 §4.1/基线的删除清单没跟上。
- `cdk_delivery_events` 基线 0 行 → **现在 43 行、在用**。谁照基线删它会删掉在用表。
- `card_funding_manual_actions` V2 §4.1 写"0 行" → **实为 1 行**（数字已错）。

**结论：任何删表决定必须当场重查行数，不能照搬 09-06 基线（`card_stock_jobs` 969、`card_discoveries` 5731 同理要重查语义再删）。**

### 发现 E（资金安全，三天张力的真实所在）：接口三段重构碰付款路径，速度不能牺牲铁律

资金安全靠 `funds_risk_state` / idempotency / `SUBMIT_UNKNOWN` / `payment_permits` 多层分散（8+ 服务）。CLAUDE.md 铁律：提交结果不明确进 `SUBMIT_UNKNOWN`，禁止自动重试/换卡/换执行器。V2.0 一天重构执行面接口（`submit/verify/cancelRenewal`）必然碰这条。**这是三天里唯一"不能为速度让步"的点**——不是说三天不够，是这一项的验收标准要最严（真实响应测试 + 生产只读复验，见发现 F）。

### 发现 F（对新验收口径的自我对抗）：D-222 去时间化有个洞——测试可能是假夹具

新口径"测试绿+脚本一致+只读复验"证"做对了"。但项目血泪：274 测试全绿对真 bug 零覆盖、测试用假数据库（D-172 惯犯 C）、基线里「付款后凭证刷新路径未知，接班未复测」。**补一条：涉及资金/分卡/付款的交付，测试必须用真实响应/真实 schema，关键路径生产只读复验真实数据，不能只靠夹具。** 否则去时间化会让我们交一堆"绿的但错的"。

### 发现 G（我自己造成的文档跑偏，本轮已修）

V2 §6 表头重复（复制粘贴 bug）；V2 §8 + PLAN §5 残留"控制面降级到工作台一页"，与 Lemon 刚纠偏 + D-222 补记直接矛盾。**本轮已修**——正是 Lemon 担心的"跑偏"的实证。

### 发现 H（澄清，非新问题）：D-221"按产品"不是新需求，基线 09-07 就确认了

基线：「开卡金额与最低余额按 CDK 所带产品在建单时决定，不读全局设置」（Lemon 2026-09-07 确认）。所以"按产品"是**早该做没做的基线项**，不是 V2 新增；系统还在用全局 `default_open_card_amount=16`。D-221 定性修正为"补做基线项"。

### 给 Lemon 的三个待定（审查引出）

1. **BitBrowser Linux 调研提前到现在做**（发现 A）——它决定 200 单/天可不可行、V2.2 是不是一天。
2. **控制面页数**：5 页基线 vs 4 页合并（发现 C）——Lemon 定。
3. **删表前逐项当场重查行数**（发现 D）已定为纪律，写进 V2 §4.1 执行须知。

### 没有推翻的部分

六个面的划分（展示/执行/资源/控制/通知/对账）成立；执行面接口三段、通知面按类别推送、展示面四态、对账面、每卡按产品——方向都对。审查动的是**措辞（B）、页数（C）、删除依据（D）、关键路径排序（A）、资金安全验收（E/F）**，不是推翻架构。

---

## D-225（2026-09-15 00:05 UTC）审查后的裁决 + BitBrowser Linux 调研结果

> **【后续·2026-09-16 复查】控制面"5 页职责重划"已被 D-226 作废（最终 4 页）；BitBrowser 无 Linux→云 Windows（路 3 = V2.2）结论仍有效。**

### Lemon 的两个决定

1. **BitBrowser Linux 调研现在做**（发现 A）。
2. **控制面页数：授权大脑按真实分析定最优**，不必退回基线。**并给方法论指导：「过往的决策不是一成不变的，可以根据项目演进调整，不要把过往的东西全当圣旨。」** ——呼应 CLAUDE.md 全局第一条。我审查里"建议退回 5 页基线"恰恰把基线当了圣旨，违反这条，收回。

### BitBrowser Linux 调研结果（2026-09-15 官网实查 bitbrowser.net/download）

- **官方只有 Windows 64 位 + macOS(Apple Silicon/Intel)，没有 Linux 版。** Local API（54345）依赖桌面客户端，客户端无 Linux → Local API 在 Linux 无官方支持。
- **路 1（BitBrowser Linux 版几乎不改）不成立。**
- **找到更优路径——路 3：云端 Windows 服务器。** BitBrowser 有 Windows 版，开一台 Windows 云主机（4核8G、disk>50G、RDP 保持会话）装 BitBrowser + worker，Local API 照旧，代码几乎不改；跨境电商成熟做法，绕过"无 Linux 版"。
- 路 2（headless Chrome 重做指纹）降为后备（指纹质量风控风险高、工作量大）。
- **含义（改善发现 A）**：200 单/天的关键路径不再赌一个不存在的 Linux 版；V2.2 = 路 3，前提变成"开一台按量 Windows 云主机试一天，验证 BitBrowser Local API 可控"——小成本可验证。已更新 V2 §5。

### 控制面裁决：5 页，职责重划（不照抄基线也不盲目合并）

详见 V2 §3.3。要点：**工作台**（三开关 + 今日四数字 + "需要我处理"队列 + 发码快捷入口，日常只看这里）/ **订单**（降为异常下钻）/ **CDK** / **卡片** / **设置**。工作台 = 基线首页升级 + 发码提上来；订单从日常必看降为下钻；不把七列订单表塞进工作台（避免过载）。既非退回基线，也非盲目 4 页合并——基于真实使用量与系统愿景的最优。

### 方向锁定

发现 A（关键路径）有了确定方案（云 Windows），发现 C（页数）已裁决。V2 方向锁死，可拆 09-16 执行任务书。

---

## D-226（2026-09-15 00:20 UTC）控制面最终定 4 页——退回 Fable 5 的合并方案

Lemon 看了大脑（Opus）的 5 页重划，判断「还不如 Fable 5 做的那个好，你退回去，按他的思路做」。
**最终：4 页——工作台（合并首页+订单，一页看全）/ CDK / 卡片 / 设置。**

- 大脑 5 页重划（工作台与订单分开、订单降为下钻）被否：Lemon 要一页看全、少跳转，七列订单表进工作台不算过载。
- **D-224 发现 C 的"建议退回 5 页基线"作废**；D-225 的"5 页职责重划"也作废。4 页是 Lemon 拍板的最优。
- 这是"不把过往当圣旨"的落地：基线 5 页只是过去的决定，4 页更合运营习惯就用 4 页——但"哪个更好"由 Lemon 的运营判断定，不由大脑的信息密度理论定（我那条理论 Lemon 不认）。
- 已改回 V2 §3.3 / §4.2。

---

## D-227（2026-09-15 01:10 UTC）V2 六个面要深化：Lemon 的方向补充 + 面间影响方法论

Lemon 看了 V2 六个面，指出**每个面写得太简单（一句话），实际涉及很多东西，怕做时偏差**。三条方法论 + 三处方向补充。

### 方法论（对所有面适用，写进做每个面的前置动作）

1. **每个面涉及很多，不能停在一句话**；做时先把完整内涵想清楚。
2. **做一个面必须想它对其他面的影响、什么影响、如何规避——先全局，后细节。**
3. **"这些是方向，不是全部"**——不要把大脑列出的当成范围上限。

### 方向补充 / 纠偏

- **通知面**：余额变化等信息类通知**要有**（进看板/后台能看），不是"永不推就完事"。现状读代码：Browser 告警 9 类（`BROWSER_ALERT_TYPES`），已有 severity（只 warning/critical 上首页）+ `PHONE_SILENT_TYPES` 手机静音表。V2 理顺成**两个维度**：推不推手机（要立刻行动才推）× 进不进看板（信息类都进、都能看）。余额变化 = 进看板不推手机；余额低于阈值 = 转缺卡预警才推。
- **对账面 → 其实是运营看板**（Lemon 重新定义）：今日多少单、花了多少钱、用了多少张卡、**两条路线（API/Browser）各自的充值耗时**、异常支出（拒付哪张卡）、当天突发情况/遇到的问题。数据源当场查**都在**（orders 有路线+时间+failure_code、ledger 有消费+卡数），聚合展示不用新表。自动对账（账本 vs 卡台差异）是看板"异常支出"的数据来源之一。
- **资金安全**：付款不明**常是抓取问题**（近 3 天 16 个失败全是 `CHECKOUT_DRIFT/OBSERVATION/NAVIGATION`，0 个真拒付），而我们做订阅——**订阅一旦成功就不能也不该重试**。修正：付款不明先走执行面 **verify（核实订阅状态）**消解——已开通=直接交付、未开通且未扣款=可安全重试、verify 也定不了=才人工。**不违反**"防重复扣款/订阅成功绝不再动"的铁律，是把铁律里"先对账再决定"做实；**不为这一点把系统做无限庞大复杂**。

### 状态

深化对齐中。逐面深化（每个带"对其他面的影响"）经 Lemon 确认后落 `V2_ARCHITECTURE.md`。

---

## D-228（2026-09-15 01:40 UTC）通知面纠正 + 定期销卡新需求（资金泄漏防线，文档里没有）

> **【后续·2026-09-16 复查】highvcc 销卡能力已核实：无卡台 API、Lemon 手动删（见下方 D-228 补充、§2.1）；自动销卡推 V3、V2.0 只做手动销卡（D-232）。通知面"余额变化要推"仍有效。**

### 通知面纠正（推翻我上一轮的理解）

我上一轮理解成"余额变化进看板、不推手机"，**错**。Lemon：**余额有变化就要通知我，我要时刻关注余额变化。** 余额是我们的钱，每笔变动都要让 Lemon 知道。所以余额变化 = **主动通知 Lemon 一类，不静音**。

### 定期销卡（新需求，重要，任何文档里都没有——Lemon 从真实运营提出）

**问题**：客户充值完会员后，可能过段时间自己在后台点"升级"。账号绑的是**我们的卡**，升级会尝试扣我们的卡 → 拒付，**扣的是我们的钱**。
**解决**：定期销卡——交付完成后按配置的时机把卡销掉，卡销了就扣不到我们钱。
**配置**：销卡时机可设——当天销 / 次日销 / 指定几点销。系统要有这个能力。

**现状（当场查，不是猜）**：
- hnskj：有 `withdraw(cardId)`（`providers/hnskj-card.js:455`），可提余额/销卡，但**没接成自动销卡**。
- **highvcc（backup-a，Browser 主力卡台）：代码里没有任何销卡 API** —— 有没有此能力**待测绘核实**。这是阻塞点：Browser 路线主力卡台能不能销卡还不知道。
- 无定时销卡调度；库内 `card_operational_overrides` 的 `RETIRED` 只是"库内不再分配"，**不等于去卡台真销卡**，卡在卡台还活着照样能被扣。

**面间影响（方案阶段要想清楚）**：
- 与一卡多单（Plus 3 单）耦合：卡要服务完这一轮所有单才能销；销卡时机 = "不再接新单 + 已接的都终态"后尽快销，缩短"客户能点升级扣钱"的窗口。
- 资金安全：销卡是新的资金泄漏防线；销卡是不可逆资金动作（红线要确认），自动销卡规则需 Lemon 授权。
- 看板：客户点升级导致的拒付（扣我们钱）是"异常支出"要能看到；销卡成功与否要能看到。

### 状态

纳入资源面 + 资金安全深化；阶段 0 测绘先核实 highvcc 销卡能力。

---

## D-228 补充（2026-09-15 02:00 UTC）：highvcc 删卡机制（Lemon 提供的关键信息）

Lemon：备用卡台（highvcc / backup-a）**可以删除卡片，删除后余额自动返回卡台钱包**，他**手动有这个能力**（在卡台界面操作）。

- **解开一个谜**：D-218 里 `1652` 那 $34.57"退回卡台钱包"，就是这个机制——**删卡 = 退余额回钱包**，不是两步操作。
- **对销卡设计的意义**：highvcc 销卡 = 删卡，且删卡即回收卡上剩余额（不浪费）。所以销卡时机可以是"交付确认后尽快删"，剩余资金自动回钱包再用于开新卡。
- **现状缺口**：Lemon 手动能删，但**系统代码未接 highvcc 删卡 API**（`grep` 无结果）。定期自动销卡 = 把删卡 API 接进系统 + 定时调度（当天/次日/几点可配）。
- **测绘阶段要查**：highvcc 有没有开放删卡 API（手动能做不代表有 API 接口）；hnskj 侧 `withdraw` 是不是同类语义。

---

## D-228 补充二（2026-09-15 03:00 UTC）：卡台有"最短存活期"，销卡不能想销就销（Lemon 提供）

**卡台规则（Lemon）**：卡不是服务完就能马上销——**卡台规定大约开卡 5~6 小时之后才能销，有时候要等到第二天**。规则本身不确定。

**这推翻了"用满即销、快速回收"的设想**，设计必须改：

1. **待销清单要带"可销时间"判断**：`开卡时间 + 最短存活期`（默认按卡台规则配置，可设"当天 X 点 / 次日 X 点"——这正是 Lemon 最初说的"销卡时机可配置"）。**时间没到的卡不进提醒**，免得 Lemon 去点了才发现销不了。
2. **必须容错**：规则不确定 → 销不掉就退回清单稍后再提醒；**记录每次实际销成功的时间点**，积累出卡台的真实规则（不硬编码猜的 6 小时）。
3. **资金回笼有延迟**：钱不能立刻回钱包 → **钱包要保一个最低水位**，覆盖"回笼延迟期间的开卡需求"，否则高峰期钱锁在不可销的卡里、钱包见底就断供。这抬高了"余额变化要通知"的业务权重（D-228）。
4. **硬约束，设计消不掉**：客户点升级扣我们钱的风险窗口 **无法压缩到 5~6 小时以下**。能做的只是"一到可销就尽快销"，不能做到"用完立刻销"。

**对 A 组自动开卡方案的影响**：缓冲池大小与钱包最低水位，要把"资金回笼延迟"算进去，不能按"销卡即回收"估。

---

## D-229（2026-09-15 04:00 UTC）第一性审查的修正：拒付才是真风险，$50 面额本身是升级防线

### 我的审查错在哪（收回）

我推"卡上没钱 → 风险归零 → 销卡可降级"。**Lemon 纠正：只要没销卡，客户点升级就产生拒付，拒付费直接从卡台余额扣**（Browser $0.1 / API $0.4），卡空不空与风险无关 → **销卡必须做**。发现 1、2、5（一卡一单 / 风险自愈 / 连锁简化）**全部作废**。

### 生产数据坐实（`card_transactions`）

- `chargeback` **3 笔 × $128.75** —— 客户真的点过升级
- `chargeback_fee` **3 笔 × $0.40** —— 我们真的付了拒付费（吻合 API 卡台费率）
- 3 笔**全被拒**：卡上只有 $50，$128.75 付不出去 → **$50 面额就是升级防线**（Lemon 的设计意图，我此前当成风险是搞反了）

### 修正后的风险模型

风险 = 拒付费 × 客户点击次数 × 卡未销时长 = **持续小额漏损**（$0.1~0.4/次），不是一次性大额损失。→ **定期批量销卡足够，不需要"抢着销"的复杂机制。**

### Lemon 补充的事实

- 每张卡充 **3~4 次**摊薄开卡费；**5X/20X 一卡一充**
- **$50 面额是为 3 单设计的；将来做 4 单可以调更高**
- 费率：**API 卡台** 开卡 $0.5 / 拒付 $0.4 / 支付 0.5%；**Browser 卡台** 开卡 $0.5 / 支付 0.8% / 拒付 $0.1
- 单价波动很小（一两周不到 $0.5），面额不必留太多余量
- 卡台约一天 100 张限额，可调，暂不是问题

### 仍然成立的两个发现

1. **账本计数不可靠**（`1657` 用掉 $31.44 但 `served=0`）——一卡 3~4 单必须靠准确计数，**A5 从"可选优化"升级为"一卡多单的地基"**
2. **verify 应作交付主判据**（与卡无关，不受影响）

### 新发现：费用记录有缺口（影响运营看板）

- 开卡费 $0.5 **没记进** `card_transactions.fee`（`card_recharge` 的 fee 全为 0）
- **highvcc(backup-a) 交易一笔都没有** → **Browser 路线的费用在后台完全空白**
- → 运营看板「今天花了多少钱」**用现有数据源算不准**，B 组必须先补数据源

### 新需求（Lemon）：客户页前置验证

客户输入 CDK 后就尽可能提醒，而不是跑到最后才说缺卡。现状：`cdk-verify-service` **只验 CDK 本身，完全不查卡**。
处置（大脑定）：**属于 A 组的部分现在做**（新增 A6 卡可用性只读查询，否则 C 组会返工）；**完整前置清单与 UI 提示留 C 组统一排查**。

---

## D-230（2026-09-15 04:30 UTC）highvcc 数据两个缺口：交易从未同步、钱包余额从未入库（不是 token 问题）

Lemon 在后台重新刷新了 highvcc token（`app_settings.highvcc_access_token_ciphertext` `updated_at=2026-09-15 03:49:27`，已生效）。借此当场查清了此前"Browser 路线费用后台空白"这个**没查清原因的结论**：

### 缺口一：highvcc 交易从未同步（代码语义不兼容，与 token 无关）

- **hnskj**：`transactions(cardId, query)` —— **按卡查**
- **highvcc**：`transactions({pageNo,pageSize})` —— **按账户查全部流水**（`/api/cardTrade/authTrans/page`）
- 同步器 `card-read-sync-runner.js:64` 调的是 `provider.transactions(job.provider_card_id, ...)`（按卡查签名）→ **highvcc 套不进这个调用**，其交易从来没进过 `card_transactions`（实测：legacy-primary 41 笔，backup-a **0 笔**）。
- **要补**：新建 highvcc 交易同步（账户级流水 → 归属到卡 → 写 `card_transactions`）。**刷 token 解决不了。**
- **影响**：B 组运营看板算不出 Browser 路线的花费/拒付/回收 → **B 组前置**。

### 缺口二：highvcc 钱包余额从未入库

- `provider_balance_snapshots` 里 backup-a **一条都没有**（hnskj 有）。钱包只有后台手动点查（`getHighvccWalletStatus`），**无定时同步**。
- **影响**：**A3 自动开卡方案里的"钱包最低水位"判断没有数据源** —— 这是大脑方案里没考虑到的前置，**现在补进 A3**。

### 方法论

此前把"Browser 费用空白"写成结论但没查原因（差点归因到 token）。这次按"不给观察补原因"当场查到真因是**接口语义不兼容**。

---

## D-232（2026-09-15）自动销卡推 V3，V2.0 只做手动销卡

Lemon 定：**自动销卡（hnskj `withdraw` 自动、highvcc 半自动的自动部分）先不做,改为纯手动销卡;自动销卡完善后作为 V3 能力之一。**
- **V2.0 的 A5 只做**：系统判断"该销哪些卡(用满+到可销时间)"→列待销清单→提醒 Lemon→**Lemon 全手动删(两个卡台都手动)**。
- **不做(推 V3)**：hnskj `withdraw` 自动销、任何自动删卡。
- **理由**：大摸排(§4)挖出 A5 自动部分工作量大、且"系统看不到你删没删"(缝12)衔接复杂;先手动稳住,自动化留 V3。
- **保留的硬约束**：销卡必须做(不销就持续漏拒付费);手动删依赖 Lemon 及时性(见对抗审查风险)。

---

## D-233（2026-09-15）第一性减法审查：先砍废壳，只补真洞，"不做会死吗"当铁律

> **【后续·2026-09-16 复查】"hnskj PURCHASE_CARD 要跑通作过渡主力"已被 D-235 推翻（改故障补充、不作依赖）；减法方向本身有效，但下方 §5.1 删表清单经 D-236 整体自查订正（card_discoveries/card_stock_jobs 等多表 overview 在读，"删了不会死"改为"删前置改 overview"）。**

Lemon 点破我一直在做**加法**(审该加什么缝/能力),而他要的第一性是**减法**——臃肿系统里什么是业务真需要的,其余全砍。

**铁律(落实阶段每个要加的东西都先过)**：**"不做会死吗?"答不上来就不加。**

**业务第一性 = 6 件必需事**：①收(验CDK/收Session) ②充(付款/确认开通/取消续费) ③卡(开卡/销卡/知余额卡数) ④钱不乱(不重复付/卡不被后续扣) ⑤人兜底(缺卡/付款不明/人机验证叫人) ⑥看(钱/单/卡/异常一眼看清)。

**减法审查方法(逐件事问两题)**：①这件事被裹了几层废壳?→砍。②这件事本身有没有真没做好的洞?→只补真洞。

**臃肿实证(52表行数,2026-09-15 真查)**：0行死表 7 张(browser_artifact_secrets/card_funding_manual_actions/checkout_artifacts/order_compensations/order_notes/order_tags/refund_cases)+ 1行早废(browser_interventions/reconciliation_cases)。但臃肿主因不在表多,在**每件真需事被裹废壳**(充值裹着灰度/履约成本/多产品投影/AB赛道/artifact录制)。

**V2 六面方案要重审**：哪些是6件事真需要的,哪些是把简单事做复杂了的(执行面接口三段统一等存疑)。减法审查结果记 §5。

---

## D-234（2026-09-15）核实要留痕、不靠自称——三道闸门升级成"一眼能验"；CLAUDE.md 不再堆规则

Lemon 把两轮供卡核查（V2 §2.8）树为"颗粒度样板",问怎么固定复现、要不要为此改 CLAUDE.md。

**结论：不是缺方法/话术,是执行率**——前两轮用的全是 CLAUDE.md 现有规则(三道闸门/惯犯规则/观察结论分开/冲突即停),没用任何新东西。**规则已齐,不必再堆**(堆规则会稀释、加臃肿,正是要减的)。

**唯一值得的改动＝提升可检验性(非再加一条"要认真")**：报现状类结论必须**随附查询/代码位置 + 原始输出片段**,拿不出＝"尚未核实"。把"AI 自称查过"变成"Lemon 一眼能验"。已补进 `CLAUDE.md` 开发纪律(紧跟三道闸门)。

**真正的双杠杆**：CLAUDE.md 负责"新窗口默认知道规矩"(地基),但保证不了执行;**执行靠 Lemon 当场的验伪追问**("这条查了哪张表?贴查询和输出""这是查的还是推断的?")——前两轮正是被这类追问逼出的。两者分工,不靠无限扩写 CLAUDE.md。

**样板本身的教训**：核查中两次凭配置/账面推断被真实数据推翻("Plus走API"被 [O]、"矛盾不成立"被 [T]/[U])——任何中间推断都不能停,只认数据到底。另揪出账本命名混淆(103=manual_excel 非"highvcc卡台",highvcc 是其数据来源)、路线表 `card_provider_account_id` 非实际选卡依据。

---

## D-235（2026-09-15）供卡出路拍板：主力 highvcc 手动够用，hnskj 自动开卡只作故障补充

A4 原标"⚠️悬而未决真问题：Browser 主力但卡只能手动开,200单/天供卡不可能"。§2.8 核查 + Lemon 商务确认后**矛盾消解**：

**真相（Lemon 2026-09-15）**：highvcc 手动**一天能开 100 张、可申请扩产、随时可手动消卡**;hnskj 卡 Browser 能用但**卡台经常服务器故障、不可靠**,所以 Lemon 最近主用 highvcc。200单/天只需约 67 张/天(Plus 3单/卡)——**100>67,手动产能足够,"全手动撑不住"是错误假设。**

**拍板**：
- **主力＝highvcc 手动开卡(半自动)**:Lemon 后台开→`snapshot-sync` 每小时入库(103=manual_excel);当前与规模化都以此为主力。
- **hnskj 自动开卡(`PURCHASE_CARD`)＝故障补充,不作依赖、不必优先跑通**:能力保留,highvcc 不可用或 API 路线时补位;`card_auto_replenishment_enabled=false` 维持,非阻塞。
- **A4 重心转移**:系统不自己开卡→转"缺卡预警+提醒 Lemon 备卡"(够不够/剩几张/撑多久/资金池健康)。自动开卡的缓冲/日限/水位复杂逻辑大幅弱化→**A4 大幅简化,符合减法**。

**连带纠正**:撤销 D-233 期"hnskj PURCHASE_CARD 要跑通作过渡主力"的定位(那是"Browser 主力用 hnskj 卡"的错误前提下定的);账本 §2.3/§2.8/A4/§5.1 同步改。

---

## D-236（2026-09-15）阶段2收尾：整体自查结论 + 阶段3"先读透"硬门槛

收尾阶段2前,用供卡颗粒度对账本整体自查(A数据状态/B B/C代码/C自标未核实/D一致性,四批)。

**结论:方向经得起查,B/C 组实现细节测绘多处不准(账本"测绘诚实说明"已预警,自查证实并具体化)**:
- §5.1删表"删了不会死"是账面推断——card_discoveries(5732,card-intake活链路)/card_stock_jobs(969)/card_funding_attempts/reconciliation_cases 都有代码(getOverview等)在读,删前有前置(改overview+拆card-intake),非裸删;browser_interventions 1行非0。
- §2.4告警产生点说4处,实为7处 INSERT operator_alerts(漏 workflow-repository:353/462、card-transaction:42)。
- §2.5 getOverview 实读20+表(账本认知的面间坑2张远不够;漏 card_sync_jobs)。
- §2.2 API落表落 provider_calls/recharge_attempts,写在 repository 非 workflow-handlers(行号不准)。
- 好消息:方案方向/资金红线底座(§4.2)/开关断言/canRetry/D-235无残留 全对。

**立硬门槛(阶段3,已落 §6 + 进度表测绘诚实说明)**:每个面落实前先跑该面"读透+行数+引用"核查(像本次自查),不凭 B/C 测绘直接改。

**收尾**:阶段0/1/2 全走完,进度表阶段2✅/阶段3🟢可进;账本已按自查修订5处(§5.1/§2.4/§2.5/§2.2/测绘说明);落实顺序 G1→G2→A3→A6→A2→A5→A4→A1→B1→B3→B4→C1→C2→C3 见 §6。

---

## D-237（2026-09-16）协作方式与 AI 可靠性的共识（Lemon 与大脑长讨论达成，记判断、不固化方法论）

> 起因：Lemon 追问"怎么让 AI 少打脸、不靠他无限追问"。以下记为**判断/事实**，不是又一套"要认真"的规则（那种没用，见第 3 条）。

**这次会话大脑打脸 ≥6 次**（Plus走API / 矛盾不成立 / funds_risk无守卫 / Browser弱守卫 / 两套规则完全一致…），全是同一模式：**从局部样本外推成全称结论**（查一个转换就说"全一致"、看一层就说"没有"）。

1. **颗粒度重查（硬读代码/生产到底）是最有效、不可省的核实方式**——这次所有真相和打脸都靠它逼出（供卡核查、付款内核体检）。**是地基，不被任何"聪明方法"替代。**
2. **大脑的"看全了/不打脸"自评一律打折**——连它说"读实了"也常有外推的角落（它自己意识不到的 unknown unknowns）。别信它的自我评估。
3. **加规则本身没用**：D-234 上次写进 CLAUDE.md，这次照样打脸。**别再往 CLAUDE.md 堆"要认真"的规则**——瓶颈是执行不是规则覆盖。
4. **真正减负担的是交付形式 + 兜底，不是 Lemon 无限追问**：① 大脑交"可证伪证据"（对比表/清单/查询+原始输出，一眼能抓错）代替"信我的结论"② 重大决定用可回滚小步落实 ③ 能交机器/交叉验证的（多方法圈分母、穷举测试）不靠大脑自评齐全。Lemon 角色从"追问逼可靠"降为"抽查可证伪输出 + 拍判断"。
5. **残余"没意识到要查"消不掉**（AI 固有局限，业界无银弹——查过 GitHub/官方 40 插件，没有"防 AI 打脸"的工具）——只能靠第 4 条兜底控到最低。

**工具调研结论**：planning-with-files（hook 强制落盘/走完步骤，有 benchmark）思路对但**不整个装**——它的三文件落盘系统与我们"单一事实源（四事实源+当轮落盘）"冲突（双落盘/双接班/双收尾/`progress.md` 撞名）。**取其"hook 强制"精华、弃其文件系统**：以后落实中发现某问题反复出、且能被简单 hook 对症拦住时，针对性加 hook，不凭空造一套。

**付款内核体检状态（本次讨论触发，V2/A1 实质工作，进行中未完）**：已读实核心有防重复守卫（authorization-v2 FUNDS_FENCE / recharge-attempt transition 守卫 / browser-execution SQL WHERE 守卫）、`recharge_attempts` 两路线共用 → **核心是地基不是屎**。债 = funds_risk 状态机散落 ~15 处无单一定义。A1 拟从"收拢单一状态机定义"切入。**但"两套规则一致"打脸过（API 允许 UNKNOWN→SETTLED、Browser 不允许），所有转换尚未逐个读全对比——A1 落实前必须先把这张对比表读全，不能凭现有判断拍。**

---

## D-238（2026-09-16）Browser「停在提交前不点、要手动点」根治：fill-billing-email 的 ≥2 邮箱框从抛错改放行跳过（A 方案）

> ⚠️ **同日修正（见 D-239）**：重走 fill-billing-email 之后的下游链路 + WAL/DB 证据显示，A 建立在**未坐实的假说**上——fill-billing-email 有三种死因（邮箱格式/≥2框/fill超时），现有证据全被 adapter 归成 `CHECKOUT_DRIFT`、分不出是哪种，而 A 只对"≥2框"有效。**故 A 暂不生效**，先做诊断落库（D-239）坐实真因，再定 A 对不对。下方分析仍有效，但结论"根治"降级为"待坐实"。

> 高发遗留、改过多次没根治。这次按"供卡核查"颗粒度硬读代码 + 历史，定位到根因函数并落一处改动。排查全程见 scratchpad `browser-stall-rootcause.md`。

**真机制（读实，非以往搞错的"点击后验证 / 演练模式"）**：
- 生产常驻池 = **PAY 真付款模式**（`run-live-pool.sh:50-52` 实证：`BROWSER_POOL_CONFIRMATION=...:PAY` / `unset STOP_BEFORE` / `EXECUTOR_ENABLED=true`），**不走**演练 rehearsal（那条 `authorizeSubmit` 恒 false 的分支）。一开始怀疑是演练模式恒不点，被 run-live-pool.sh 实证推翻，就地改。
- 「停住不点」= 付款前某 stage 返回 `PRE_SUBMIT_FAILED + sceneHeld`（`payment-executor.js:236`）→ `shared-live-composition.js:324-353` 现场保留、推运营"你可以直接点订阅"→ 等人手动点。是**返回值**不是抛异常，所以"干净停住"非"报错崩溃"，与 Lemon 描述逐字吻合。
- 死点 = `fillTransientBillingEmail`（`billing-address-fill.js`，D-209 埋点实证 fill-billing-email 是最后一条 setStage）。
- **唯一触发（当前代码）= `matches.length >= 2`（≥2 个可见邮箱框）**：0 个已放行（`:90`）、正好 1 个正常填、≥2 抛 ContractError。

**为什么改了很多次没改好**：前几轮全在改**兜底与诊断**（D-205 保留现场 / D-208 埋点 / D-210 接手窗 / D-212 locator 诊断），**根因函数一行没修**（D-211 自认"看起来很勤奋，方向是偏的"）。

**关键依据（有据）**：receipt email **非付款必需**——oaics_ Checkout 全无邮箱框也能付成（`billing-address-fill.js:68-70` + 0 框放行既有事实）。故"≥2 拿不准就整单停住要人工"是**过度严格的契约**，撞 Lemon 原则"别为一点风险要人工兜底"。

**假说未坐实（诚实）**：≥2 框到底是什么（疑 Stripe Link 带进第 2 个登录邮箱框）**无真实 DOM 证据**——那 8 次失败在 D-212 诊断上线前，之后无新样本；连 `locator-diagnostics.test.js:14` 的 `linkEmail` fixture 都是**按假说造的**（不构成外部合同证明，D-172 模式3）。A 方案不依赖此假说，恰是"不知道是什么所以不猜、不填、跳过"。

**改动（一处，Lemon 拍板 A）**：`fillTransientBillingEmail` 的 `matches.length !== 1` 分支——`required=true`（无调用点传，预留严格模式）带 D-212 诊断抛错；**默认 `required=false`（付款路径）放行跳过**（返回 `emailFieldPresent:false`，与 0 框同义）。不碰付款控制流、清空 finally（D-137/D-205）、防重复扣款不变量。
- **风险有界且不劣于现状**：万一某变体确实必填 email，提交会在后续 stage 停住（仍要人工，但绝不重付）；上行=直接根治高发痛点。

**验证**：billing-address-fill + locator-diagnostics 9/9（含新增"≥2 放行"+"required=true 仍抛诊断错误"两测）、adapter+executor 31/31（D-205/208/214 兜底全在）、**browser-mvp 全量 292：283 pass / 0 fail / 9 skip**。

**未生效**：本机常驻 worker（PID 43986）ES import 在**启动时**加载旧代码，改源码不热更——需重启（`launchctl kickstart -k com.pojia.browser-pool`，supervisor 会重新拉起）才生效。**付款路径上生产，重启时机待 Lemon 确认。**

---

## D-239（2026-09-16）诊断落库：付款前失败的真因同时落 WAL + browser_run_events，先坐实再改 A

> 起因：Lemon 追问"演练确定能解决吗"→ 重走链路发现 A（D-238）只赌了 fill-billing-email 三种死因（邮箱格式/≥2框/fill超时）里的 ②，而现有证据分不出是哪种。故先补诊断落库，坐实真因，再定 A 对不对——不再"给观察补原因"。

**坐实"哪里"的证据（铁证）**：
- WAL（`lane-1.wal`，Pilot 窗口）**2 次 run 的 stage 都停在 `fill-billing-email`**，之后一条 stage 都没有。
- DB `browser_runs` 付款前失败（PAYMENT_ARMED）**7 次全是 `last_error_code=CHECKOUT_DRIFT`**（09-13～14）。

**为什么"为什么"查不出（根本缺陷）**：
- adapter catch（`live-chatgpt-payment-adapter.js:310-312`）把 ≥2框（ContractError）/ fill超时（TimeoutError）/ 格式非法**全包装成 `CHECKOUT_DRIFT`**，原始区别只留在 cause 链。
- 全库无诊断文字列（`browser_runs` 只有 `last_error_code`；information_schema 查证）——**D-212 的 describeCandidates 诊断从未持久化**，一路传到 abortForPrePaymentFailure 就丢了。故三种死因从 D-209 起一直靠猜，A 也是猜出来的。

**改动（4 处；同时落 WAL + browser_run_events，不改 schema、不改付款行为）**：
1. `payment-executor.js`：`export diagnosticTextOf`（沿 cause 链拼，含"找到 N 个/属性/超时"）。
2. `shared-live-composition.js`：import + `runPreSubmitRehearsal` 失败也带 `diagnostic`（**演练也能坐实**，不用花钱跑真单）。
3. `executor.js`：`paymentResult` 为 `PRE_SUBMIT_FAILED` 时落一条 `pre-submit-failure-diagnostic` 事件。`evidenceSink=CompositeEvidenceSink([WAL, MysqlEvidenceSink])`→ **同时进 WAL 与 `browser_run_events`**（`summary_json` 存诊断，`action` 列可 SQL 过滤）。
4. 测试：`shared-live-composition.test.js:82/84` 断言更新（演练失败带 diagnostic）。全量 **292：283 pass / 0 fail / 9 skip**。

**怎么用坐实真因**：重启 worker 生效后，跑一次演练（不花钱）或下一个真单走到 fill-billing-email 失败 → `grep pre-submit-failure-diagnostic` WAL，或 `SELECT summary_json FROM browser_run_events WHERE action='pre-submit-failure-diagnostic' ORDER BY id DESC` → **一眼看清是 ②≥2框 还是 ③fill超时** → 再定 A 对不对（≥2框→A 对；fill超时→A 无效，改填不进去的根因）。

**测试缺口（诚实）**：executor 落该事件的 e2e 单测未加（executor.test.js 无付款路径框架，硬加需大量脚手架）。诊断内容正确性由 `locator-diagnostics` 测试守、演练失败带 diagnostic 由 `shared-live-composition` 测试守，只差"executor 把两环接起来"这一组装点无独测——下一次演练即实测。

**未生效**：改了源码，需重启 worker（`launchctl kickstart -k com.pojia.browser-pool`）才加载。付款路径上生产，重启时机待 Lemon 确认。


## D-240（2026-09-16）客户交付与内部收尾解耦、核验做减法、允许有界只读重试

用户在本轮确认的方向（尚未实施）：
1. 尽量删除重复核验请求，减轻负担；同一次可信身份/套餐观察可复用，不能删除跨账号检查、付款幂等保护、付款未知禁止重付和取消后的结果确认。
2. Plus产品在确认本单付款关联和目标账号确已开通Plus后，立即持久化客户交付成功、圆环成功；后台继续取消续费和对账，**取消续费不展示给客户**。替代此前“取消/对账全部结束才向客户成功”的交付时点。不是未确认Plus先报成功；后台收尾必须持久化可恢复、失败进入内部待处理，不能将后台进程清理或资源释放也提前。仅此Plus范围，Pro第一阶段不能算整单交付。
3. 用户接受给疑似暂时访问失败重试机会，避免一次失败立即退单。先限身份/套餐等只读请求，不能重跑整单/付款/开卡/换卡。403上游诱因仍未知，重试为体验策略不是根因已修。

建议实施参数（执行者建议，非用户逐项拍板）：初次+最多2次，等待2秒/5秒，整体30秒截止；429遵循Retry-After、超预算暂停而非提前轰击，明确Session失效/身份不匹配不重试；租约/停机优先终止。重试耗尽进入可解释的安全停止，不无限回队列。

代码核查依据：browser-execution-repository.js的recordCancellationConfirmed当前捆绑run完成/attempt成功/order成功；listPaymentVerificationsDue只调度特定run与verification状态，不能只提前改order.status。customer成功映射依赖RECHARGE_SUCCESS；后台收尾需要单独的可恢复生命周期，优先复用已有调度基础，不新增泛化框架。production只读11:27 UTC仍为上一单RECHARGE_SUCCESS/COMPLETED/CANCELLATION_CONFIRMED，当前行为未变。

### D-240 实施记录（2026-09-16 12:14 UTC）

用户后续「以上同意」确认实施。隔离候选分支codex/plus-delivery-d240：64d1d56保存主工作区既有付款诊断快照，81c40ec实现四项与测试；主工作区既有两文件未提交改动未动。任务/证据位于 `/Users/lemon/.codex/worktrees/ai-recharge-d240/docs/tasks/2026-09-16-D240-delivery.md`。Browser295通过/9跳过，v1 675通过/66跳过，隔离MySQL串行27通过，均0失败。未合并/推送/部署/重启。重试参数已落实初次+2次、2s/5s、30s预算；Retry-After超过预算时不提前再请求，沿既有安全失败收口，不新增长期重试队列。取消续费与对账沿原run持久化恢复，客户成功后不再等待；但单lane仍被未收尾/人工待处理run占用。生产新逻辑及真实节省耗时未验证，旧403上游诱因仍未知。

### D-240 发布（2026-09-16 12:41 UTC）

用户明确「发布」后已上线单提交b31a88a；本机与服务器同步，接单恢复，付款开关未改。新版本真实订单效果尚未验证。生产事实以CURRENT_STATE为准，部署证据docs/incidents/d240-deployment/report.md。

### D-240 收益复核要求（2026-09-16 13:58 UTC）

用户明确早交付只是为减少客户等待，不希望打乱流程；要求实际量化提前时间，收益不明显则不必拆分。当前未决定回滚/重新发布。现有历史数据无法拆分取消耗时：旧恢复器完成全部动作后才依次落Plus/取消观察，两条created_at差不能作取消耗时；新版本订单仍0。测量建议和边界见incidents/d240-followup/early-delivery-benefit.md。先证明收益，不继续扩大早交付架构。

### D-240撤回提前成功（2026-09-16 14:17 UTC）

用户确认：复杂度代价不值得则改回。执行采用小范围撤销，确认Plus/关闭自动续费/现有核对完成才客户成功，不回滚核验减法、重试、进度与2秒查询。候选codex/unified-success b8fd6e6本地通过（数据库9、Browser294+9skip、v1 675+66skip），未部署，线上仍b31a88a。历史取消收口兼容保留；原Session过期门槛/独立扣款核对缺口仍未修。

### 统一成功已发布（2026-09-16 15:36 UTC）
用户确认发布，中断后继续完成4334dc2。撤回早交付，成功仍在取消和内部核对后；保留其余提速。切换前无活动run/订单/早交付待收尾run，无需状态迁移。接单已恢复，未真实充值。

## D-241（2026-09-17）hnskj 默认卡段失效致人工开卡卡死；修复 default_card_type_id 18→23；开卡执行仍受写开关闸控

> 起因：Lemon 要把 Plus 切回 API+hnskj，先在运营后台"人工开卡"却创建不了任务。

**根因（实查坐实，非连通性问题）**：卡台在 2026-09-14 后把卡段整批换新——当前有效段 id `23-29`（名字全是"新—VISA-..."），而旧默认 `default_card_type_id=18`（9-14 07:00 设）已不在有效段里。
- 就绪判定：server.js:161 / admin-start-business-service.js:8 `defaultCardTypeReady = cardTypes.some(id===18)` = false → 页面"未就绪"。
- 创建任务：card-stock-job-service.js:80 未指定时默认用 `18` → card-provider-snapshot-service.js:75 `evaluateCardStockRequest` 找不到 → 抛 409 `CARD_STOCK_CARD_TYPE_UNAVAILABLE`「卡段不可用或已变更」。
- 佐证 API 本身正常：`card_provider_snapshots(hnskj)` payload `cardTypes=[23-29]`、`purchaseEnabled=true`、`accountBalance=106.06 USD`，快照由 `pojia-card-catalog-sync.timer` 每 5 分钟刷新保持 fresh；Key/余额/连通均正常，唯默认段 id 过期。

**修复**：`default_card_type_id` 18→23（新—VISA-40024200）。复用生产 `setDefaultCardType`（自带 6 分钟 fresh + 卡段存在校验，不抄第二份规则），本地经隧道连库、先 dry-run 再 apply，独立查询复核（值=23、`admin_setting_events` old18/new23），临时脚本跑完删、工作区干净。

**开卡执行仍有第二道闸（本轮未动，待 Lemon 决策）**：worker 进程 `PROVIDER_CARD_WRITES_ENABLED=false` 且 `PROVIDER_WRITES_ENABLED=false`（worker.service ExecStart 显式）。worker-runtime.js:13：这两个全 false 时 worker 不认领 `PURCHASE_CARD` 任务，开卡任务会一直 PENDING 不执行。真开卡须打开写开关并重启 worker——改系统服务配置 + 授权真实开卡（花钱），须 Lemon 明确确认。切回 API 前应先核 hnskj 是否尚有可分配卡（有则不必开卡）。

### D-241 开卡执行（2026-09-17 01:34 UTC）

Lemon 确认开 1 张 16 刀。**执行路径澄清（先误判后查清）**：手动开卡的执行器是独立脚本 `v1/scripts/card-stock-job-runner.js`——一次性运行，门槛 `PROVIDER_WRITES_ENABLED=false` 且 `PROVIDER_CARD_WRITES_ENABLED=true`（:22），**不是常驻 worker，也无 timer 触发**。worker 的 `PURCHASE_CARD` 是订单驱动开卡（workflow task），与手动 `card_stock_jobs` 是两条独立线；曾误判为 worker 执行、临时打开 worker CARD_WRITES，任务 PENDING 不动才查清——该 worker 改动多余，已回滚恢复 `CARD_WRITES=false`。

流程：`createJob`（jobId 829d0925，dry-run 预估 16.58）→ 服务器按门槛 env 跑 runner → claim → `openStockCards` → COMPLETED opened=1。

结果（独立复查）：新卡 **5276** active/AVAILABLE/余额 16/段 23/刚读同步；正式资格口径 hnskj 可分配 **1 张**；账户余额 106.06→**89.48**（扣 16.58）；worker 已回滚。开卡前置 `card_auto_replenishment_enabled=false`（不会失控自动开卡）、在途订单 0（重启安全）均已核。

**遗留改进**：(1) 默认卡段被卡台换段作废时，就绪判定只给笼统"未就绪"，未点名失效的 `default_card_type_id`，排查困难。(2) 手动开卡执行器 `card-stock-job-runner.js` 无常驻服务/timer，需按需手动跑且要显式带 `PROVIDER_CARD_WRITES_ENABLED=true`——后台"人工开卡"只建 PENDING job，不会自动执行，这个断点值得在文档/后台提示里点明。两项后续 V2 处理，勿在本轮扩建。

## D-242（2026-09-17）两卡台同等重要（纠正账本"hnskj 排后"）；V2 方案须按业务实际全审后再落实

> 起因：定位 V2 进展时照搬账本，被 Lemon 当场纠正两处"文档与业务实际脱节"。

**纠正一：hnskj 与 highvcc 两台同等重要、Lemon 经常切换。** 账本 §3.A（A4，:209-215）原判"主力 highvcc 手动够用、hnskj 自动开卡只作故障补充/非阻塞/排后"是**错判**——它基于"highvcc 产能 100/天够 67/天需求"推出，但 Lemon 实际是**两台同等、高频来回切**。修正影响：① hnskj 自动开卡不能排后，要与 highvcc 一样自动、随时供得上；② A1（切换解耦＋一键切换＋切换前校验）分量加重——两台高频切是刚需非边角（今天 09-17 开 hnskj 卡正因随时切到 API+hnskj）。

**纠正二：阶段状态。** 账本记"阶段 0/1/2 完成、阶段 3 可进"，Lemon 明确"还没到落实、方案没按业务实际最后审过"——**"文档层面过审"≠"业务实际终审"**。阶段 3 落实前须补一道：**按业务实际全审六面（A/B/C 全部，不只 A 组），从 A 组审起**，把真实业务（两台高频切、今天救火摸到的开卡断点/切换校验实证）逐条对进方案。

**方向确认（Lemon 2026-09-17）：全审、从 A 组起，审到位才落实。**

## D-243（2026-09-17）V2 后续推进规划（Fable 5.1 接手）；接手核对为第一步；卡台解耦改为"待讨论"

> 起因：Lemon 指出"各窗口分块审完、合并后必须有整体连贯审查，整体由谁来改"，Opus 4.8 的分块规划没从全局出发。切换 Fable 5.1 后重新规划。

**Lemon 定的四点**：① 他是贯穿所有窗口的人，方向和连贯的最终判断在他；② 同意先清账本；③ **卡台↔支付方式解耦：他还在考虑做不做，不是已定，是接下来第一个要一起讨论的方向节点**（此前会话/任务书把它当已定意图，纠正；技术可行已坐实，做不做未定）；④ 认"一单从 CDK 兑换到交付的全链路"为连贯基准。

**推进五步**：① 清账本、定主线（把已审结论整合进方案而非堆标注，删作废，写清主线六面各管哪段）→ ② B/C 组审（对着主线看"管链路哪段、会不会断链"）→ ③ 整体连贯审（六面方案对着主线走一遍，Lemon 一起过，过了才落实）→ ④ 落实（每窗口一个可独立验收的块，改完放回主线验；优先级待解耦讨论后定）→ ⑤ 集成验收（真单跑完整链路，Lemon 在场）。**不设专门统筹窗口**：统筹靠账本 + Lemon + 每窗口先读全局再做局部。

**接手核对为第一步（Lemon 同意）**：新模型先自己读事实源、核生产、走代码主线，写"接手理解"给 Lemon 核对，过了才算接手、才动账本。任务书 `docs/tasks/2026-09-17-handover-verification.md`。**后续对接在新窗口。**

## D-244（2026-09-17 07:20 UTC）Lemon 对接手核对的四条纠正 + 协作方式（Fable 5.1 接手起）

> 起因：接手理解文档（`docs/tasks/2026-09-17-handover-understanding.md`）列出三个冲突和十二个不确定点，Lemon 逐条回答。

**1. 5X/20X 是要充的产品，路线开着是有意的。** Lemon：「20X 和 5X 也是我要充值的产品，不确定 API 路线能不能充；设想是至少能通过 Browser 路线充，因为目前手动充值也是通过比特浏览器，跟 Plus 的区别只有选的套餐不同；目前 5X 和 10X 在用手动充值。合适的时候加入 Browser 自动化。」
→ CLAUDE.md「当前生产仅启用 Plus；5X/20X 不开放」这条硬约束**按 Lemon 原话重写**：5X/20X 是产品，Browser 路线是它们的目标路线，自动化何时接入待定；API 路线能否充 Pro 未知。**待 Lemon 确认两点**：①「10X」是不是「20X」（系统里只有 pro_5x/pro_20x）；②他是否知道现在一张 20X 码下单会**自动**走 Browser 买到 Plus 再停在升级对话框（`UPGRADE_DIALOG_STOP`），而不是全手动。

**2. hnskj 卡台限流：每分钟最多 60 次请求，超出收费。** 来源 https://card.hnskj.vip/developer（Lemon 提供；页面为前端渲染，curl 抓不到文案，原文未读到）。「可以根据业务调整，不必拘泥过去，但要兼顾其他数据请求，整体不超过 60 次/分钟。」
→ 现场实测（`provider_calls`，只覆盖 worker 与 read-sync 两处记账，**不含** `card-catalog-sync` 每 5 分钟的卡段/余额拉取与本机 pool 的交易读）：近 24h 每分钟均值 4.6、峰值 22（09-16 08:25，`card_reconciliation_detail` 16 + `transactions` 6，为多张卡集中对账）。**远低于 60，但 V2 任何加频（A 组按需同步、B 组看板、G1）都要把这条当预算算进去，且需要一个统一的 hnskj 请求计数点**（现在三处发请求、只两处记账）。

**3. 服务器 09-16 23:36 UTC 重启的原因：Lemon 判断是服务器欠费到期**（9 月 8 日到期，可延一周左右），已续费。这是 Lemon 的判断，非日志证据。

**4. API 路线绑死 hnskj 是现状，「API 路线绑别的卡台行不行」是想法、没试过。** 与 D-243「卡台解耦待讨论」同一件事。

**协作方式（Lemon 原话要点，接手起生效）**：
- 「不要拘泥于过往的决策」，希望协作产生新灵感把系统真正升级好。
- Lemon 的需求「有些模糊」，要一起梳理清楚、确认需求后再做升级。
- 系统必须足够稳定，不要臃肿。
- B/C 组和 A 组一样，都要一起梳理「是否是我们想要的、应该如何实现、是否有更好的方法」；之前的方案是之前的 AI 定的，接手模型可以有不同想法，方案更好就用新的。
→ 对 D-243 五步的含义：「清账本」不是把旧方案整理干净就完，而是**逐面重问需求**（要什么、为什么、最简怎么做），旧方案只是输入之一。

## D-245（2026-09-17 07:40 UTC）「先 Plus 后升级 20X」两阶段方案退休：ChatGPT 现在可从 Free 直接升级到 20X（Lemon 手动充值实操观察）

**Lemon 定**：①D-244 里的「10X」是笔误，指 20X。②「现在实际是可以从 free 直接升级到 20X，之前做的先 Plus 后升级 20X 的方案已经可以退休了。」

**来源与边界**：这是 Lemon 在比特浏览器手动充值时的实操观察，不是本仓库的 PoC 证据。代码里的旧观察相反（`shared-live-composition.js:206`「A free account cannot buy Pro directly, and the Pro tier toggle is absent on the Plus purchase dialog」，D-133/D-136 时期）。**按 CLAUDE.md，页面行为要先经非付款 PoC 冻结到 `docs/contracts/` 才能写进执行器**；Lemon 的观察是方向依据，PoC 是实现依据。

**退休的东西（代码级清单，落实时删）**：`postPlusAction` 的 `UPGRADE_DIALOG_STOP` / `MANUAL_20X_HANDOFF` 分支（`payment-executor.js`、`shared-live-composition.js`、`live-post-payment-recovery.js`、`browser-payment-verification-service.js`、`production-live-pool-worker.js:postPlusActionForPlan`）、`ChatGptPostPaymentVerifier.openUpgradeDialog`、navigator 的 `plan-change` 期望（`chatgpt-checkout-navigator.js:210-231`）、仓库的 `recordManual20xHandoff/recordManual20xReviewRequired`、基线「5X/20X 自动化前置」第 2 条「资金模型改为一单两阶段」、UNVERIFIED_LEDGER 全部两阶段条目、PROJECT_MAP §5「Pro 不能把 Plus 首阶段当整单交付」。**Pro 单变成和 Plus 同型：一次付款、一次确认、一次取消续费，只是 Checkout 里选的套餐不同**——这正是 Lemon 说的「跟 Plus 的区别只有选择的套餐不同」。

**当前生产的资金风险（本轮核实，未动）**：路线 306 `accepts_new_orders=1`，组合层结账计划固定 `plus`（:210），`resolvePlan` 只用于付款后动作。**一张 20X 码现在下单 → Browser 自动买 Plus（≈$15.72）→ 停在升级对话框交人**。生产有 2 张 20X 码 AVAILABLE（批次 B-20260908070237580 / B-20260910030601731）、历史 20X 单 9 单全在 09-08～09-10。**待 Lemon 定**：这两张码在谁手里；方案改完之前是否先把 305/306 接单位关掉（生产动作，先问）。

**对 V2 的影响**：A1「执行面接口的 `fromPlan` 参数」和 V2 §3.1「Free→5X 和 Plus→5X 走同一接口按 fromPlan 分支」简化为只有一个分支（Free→目标套餐）；5X/20X 进 Browser 自动化的工作量从「两阶段+对话框」降为「Checkout 选套餐 + 报价/金额/每卡单数按产品」。基线「5X/20X 自动化前置」5 条里第 1（付款后凭证刷新）、3（升级页只读观察）、4（最终套餐成功后才取消续费）随之重写或作废，保留第 5（按产品开卡金额、一卡一单）。

**CLAUDE.md 硬约束改写**（同轮）：原「当前生产仅启用 ChatGPT Plus；5X/20X 按基线顺序启用，Plus 自动化跑通之前不开放」→ 见 CLAUDE.md 新文。

### D-245 执行（2026-09-17 07:28 UTC）：305/306 接单位已关

Lemon：「先关掉 305 和 306 吧；CDK 在我手上，不必担心；以上同意。」
- 路径：本地经隧道、一次性 mjs（mysql2 事务）：`FOR UPDATE` 读两条路线 → 断言 `accepts_new_orders=1 且未退役` → 断言两路线无非终态订单（0）→ `UPDATE ... SET accepts_new_orders=0`（affectedRows 必须 =2）→ 每条写一条 `provider_route_switch_events`（route_id=previous_route_id=本路线，actor `lemon-via-fable`，note 写明 D-245 原因）→ commit。先 `--dry-run` 后 `--apply`，脚本跑完已删。
- 独立复核（新连接 `prod-query.sh`）：`fulfillment_routes` 301=1 / 302=0 / 305=0 / 306=0；事件 9186026b（305）07:28:51.238、a31f2b1c（306）07:28:51.570；非终态 0。
- 效果：20X/5X 码下单 → intake 找不到接单路线 → `ORDER_ROUTE_UNAVAILABLE` 503；已发出的 2 张 20X 可用码在 Lemon 手上。**回滚**：同法把两条 `accepts_new_orders` 改回 1 并写审计。
- 没动：products、bcs、CDK、任何开关。

## D-246（2026-09-17 08:30 UTC）清账本·面一「卡台与路线」Lemon 拍板；A1/A4 旧稿作废；C 方案（C2 先验、C1 减法）

讨论稿：`docs/tasks/2026-09-17-ledger-face-1-card-and-route.md`（现状证据、真正问题、A/B/C 三选项、Lemon 四答、C 四处修订）。Lemon 大白话复述后「以上同意，改吧」。

**决定**：①「用哪个卡台」两条路都要有：一张「产品 × 执行器 → 卡台」选择表，各选各的；切路线不动卡台。②卡台可插拔是原则：分派只看能力位不看名字（实查名字分支 52 处/20 文件）；新卡台 = 一行账户 + 一个适配器。③C2 先做：隔离直调 ZZSHU 用 highvcc 卡真付一单验证（≈$16，Lemon 当次确认，跑前把卡/账号/请求摆给他看），结果定 API 行白名单初值。④hnskj 卡分卡按需同步（归面二）；C1 切换校验用按需同步后口径。⑤C1 = 选择表替代两处 + intake 删硬写 + 切换四项校验 + 供给分派按能力位；不改付款、不改资格规则。

**Lemon 提供的事实**：切路线时切卡台「只是顺手」（D-219 发现 5 的"耦合"实为手动两次点击，代码不耦合）；hnskj 卡走 Browser 手动能成，任何能开出卡的卡台几乎都能走 Browser，新卡台要复用；highvcc 卡走 API 没试过、预估可以。

**账本改动**：§3.A 头改为面一定稿；A1 只剩「接口三段统一」另审；A4 并入面一/面二；§2.8「BROWSER→101 3 单」订正为 4 单 0 付款；进度表 2.5 行改为逐面重问进度。**纠错**：任务书/第一面讨论稿曾写「A2 切换前校验」——账本 A2 是 verify 作交付判据，切换前校验属 A1，已按正确归属改，A2 未动。

**下一步**：面二「供卡」讨论稿；C2 脚本准备（跑前摆给 Lemon 看）。

## D-247（2026-09-17 09:10 UTC）清账本·面二「供卡」Lemon 八答 + 拍板（09:30 UTC「同意」，已写进账本 §3.A 面二）

讨论稿：`docs/tasks/2026-09-17-ledger-face-2-card-supply.md`（§1 两台链路表与等卡结局、§3 七个真正问题、§4 水位驱动方案、§6 八答与修订）。

**Lemon 提供的事实/决定**：Plus 每台保 2 张；Pro 不预留；开卡 Plus $50 / 5X $100 / 20X $150；卡台每天在线上限 100 张可提；**钱包硬底线 hnskj $30、highvcc $20（基线「250」是错的，作废）**，$50 只告警；hnskj 故障自动开 highvcc 顶上；不过期 key 拿不到；hnskj 12 张空卡已被卡台作废（换服务器）；highvcc 5 张是 Lemon 注销、余额已回钱包；认可水位驱动。

**本轮核出的地基事实**（写进账本 §2）：①生产 930 条旧架构 `card_stock_jobs REVIEW_REQUIRED`（924 PROVIDER）命中 `scheduleAutomaticJob` 的「未解决付费任务」检查 → 自动开卡开关一打开即永远 `FUNDS_REVIEW_REQUIRED`；②worker `PURCHASE_CARD` 无任何创建点，死线；③后台「人工开卡」建的 job 无执行者，靠人 ssh 跑 runner；④`CARD_STOCK_LOW` 只算 hnskj、阈值 1；⑤24 次等卡平均 9～12 小时、13 单最终关闭。

**接手模型对①的建议**：资金效率杠杆是销卡回笼（钱躺在卡上的时间），不是少保几张；Pro 水位 0 + 订单驱动兜底。故障切换在 API 路线上依赖 C2。

## D-248（2026-09-17 10:30 UTC）清账本·面三「执行与交付」Lemon 五答；ZZSHU 支持 Pro 正价开通（API 也能充 Pro）；「需要我处理」边界勾选（三处待确认）

讨论稿：`docs/tasks/2026-09-17-ledger-face-3-execution-delivery.md`（§1 交付判据/付款不明/成功单谁收口/失败分布/人工点清单、§4 E1-E4、§6 五答与理解）。

**Lemon 定**：①A1「接口三段统一」不做，改三张契约表（交付判据 / 付款不明 / 人工兜底点）；④付款前抓取类失败先攒 D-239 样本再改；⑤客户页第一步提示「Session 至少剩 30 分钟」；②Pro 也要能走 Browser，并让我查 ZZSHU 文档。

**核实（新事实）**：ZZSHU 三方接口 `planType` 支持 `plus` / `pro5` / `pro20` / `plus_to_5x` / `renew_20x`，`pro5` / `pro20` 为免费账号正价开通（摘录存 `docs/contracts/2026-09-17_zzshu-third-party-api-plans-excerpt.md`）。→ **Pro 两条路都能走**；API 侧只需 `pro_5x→pro5`、`pro_20x→pro20` 映射 + 真单验证。**纠错**：仓库 `对接api.md` 是 GPT-KCCatk（gogpt.id88.icu）的文档，不是 ZZSHU，此前 `PROVIDER_BASELINE.md:19`「固定 planType=plus」是按当时实现写的，不是上游限制。

**③「需要我处理」勾选**（A 必须叫 / B 系统自己解决 / C 不该出现）：Session 无效 B · 已是 Plus B · 付款前失败现场保留 A · 人机验证 A · **付款不明补核定不了 C** · **取消续费未确认 C** · 崩溃 B · 缺卡 A（开不出才叫）· token/卡台故障 A · **ZZSHU 零原因失败 A**。
**接手模型的理解（待 Lemon 确认三处）**：C = 补核必须靠「账号状态 + 卡台扣款记录」两路证据自动定，G1 成为前置、窗口放长；取消续费 = 重试到成功，API 单复用 Browser 取消能力（ZZSHU 回传 Session）；ZZSHU 零原因 A = (a) 退码+通知 还是 (b) 停单等看。

**三处确认（10:50 UTC）**：①付款不明＝尽量系统解决、准确率优先别谎报 → 两路证据自动定、叫时带证据；②取消续费失败＝不卡单、提醒、销卡兜底（API 单去 CANCELLATION_REVIEW_REQUIRED 阻塞）；③ZZSHU 零原因失败＝b 停单不退码等看。**已写进账本 §3.A 面三。**

## D-249（2026-09-17 11:20 UTC）清账本·面四「通知与对账」Lemon 五答 + 拍板；D-219 发现 3 纠错；highvcc token 约 2 小时失效

讨论稿：`docs/tasks/2026-09-17-ledger-face-4-notification-reconciliation.md`。**Lemon 定**：①「客户提交了充值」也推；账本与卡台对不上前期可推但担心误判/延迟 → 定为看板 + 每日一条汇总、持续两次才进队列；②余额变化前期每笔推、开卡费不推、**拒付必推**、量大后可汇总；③同意补记历史 8 单人工收口的账本；④看板六项认可；⑤token 约 2 小时失效、2 小时叫一次太频繁 → 定为「要用而没有」才叫、一段失效期一次；探索自动登录续 token（待 Lemon 说明登录方式）。

**核出的事实**：近 7 天推 99 条真需要人 <10；**D-176 静音未生效**（原因未查清，落实先坐实）；**D-219 发现 3「CARD_STOCK_EMPTY 唯一没推」是误读**（发过、后被 CANCELLED）；账本 CONSUMED 12 vs 成功 20；highvcc 交易/钱包 0 入库；token 06:06 贴 08:38 失效、无告警（CURRENT_STATE 已记，待重贴）。

已写进账本 §3.A 面四；旧 B1/B3/B4/G1/G2 作废。

## D-250（2026-09-17 12:10 UTC）清账本·面五「展示与控制」Lemon 拍板；两处纠正；五面全过

讨论稿：`docs/tasks/2026-09-17-ledger-face-5-display-control.md`。**Lemon 定**：客户「没成功」屏不放联系方式（CDK 即工单号）；REVIEWING 归「处理中，正在人工确认」；工作台+设置先做、旧页沿用；今日订单七列。**纠正**：①后台 4 页是过去定的，可重新设计增减改（接手模型仍按用法算出 4 页 + 高级入口，出视觉方案时再看）；②**客户页不提示「Session 至少剩 30 分钟」**（反而迷惑）——面三⑤撤回。
**Lemon 新需求（记录）**：工作台要用起来舒服、交互好，V1 太差；UI 可参考客户页，多探讨几个方案 → 落实时出 2～3 版、验收含试用反馈。
**核实**：card-intake（5732 条）是 hnskj 新卡自动录入链路（catalog-sync 每 5 分钟 `discover()`），**保留**，后台页降高级；客户页九阶段保留只在处理中显示；「换 Session」两种触发（Session 无效 / 已是 Plus）；Browser 中途停下客户看「处理中」或「正在等待官方返回结果」，30 分钟后停自动刷新。
**待整体连贯审**：Session 门槛 1800s 是否过严。
**五面全过，账本 §3.A 五面定稿齐；旧 A1-A6 / B1-B4 / C1-C3 / G1-G2 全部作废或并入。下一步 D-243 步③：对着一单全链路把五面拼一遍，Lemon 一起过。**

### D-249 补记（2026-09-17 12:50 UTC）：highvcc 登录有滑块验证 → 自动续 token 不做

Lemon：highvcc 网站登录 = 账号密码 + 随机位置滑动块。→ **系统不做自动登录续 token**（不绕过人机验证，与 D-155 对 hCaptcha 的原则一致）；token 只能人贴；面四⑤「按要用而没有叫、一段失效期一次」是最终方案。token 已于 12:47 UTC 重贴，下次快照 13:38 自动验证。

## D-251（2026-09-17 13:05 UTC）highvcc token「每日时段」模式（Lemon 选 A，定稿）

问题：token 约 2 小时失效、登录有滑块不能自动续；面四原把 highvcc 快照/交易/钱包挂每小时那趟 → 每 2 小时必然要用而没有 → 「按要用叫」并没降频（接手模型自纠）。
**定**：**A · 每日固定时段**——Lemon 每天固定时段贴一次 token（与手动删卡同节奏），系统把所有要碰 highvcc 的活集中在该时段做完（全量卡快照、交易流水、钱包余额、按水位开够当天的卡）；其余时间不碰 highvcc（Browser 付款用库内凭证不需 token；卡余额白天靠账本推算，次日对账）。时段外只有突发缺卡（Pro 来单即开、Plus 水位抽干）才叫一次。代价：highvcc 的余额/流水/拒付看板数字最多滞后一天（hnskj 不受影响）。单量上来不够再加时段。账本面二⑧、面四②⑤已改。

## D-252（2026-09-17 13:30 UTC）整体连贯审通过（D-243 步③）；三个打架 Lemon 定；进步④落实

连贯审：`docs/tasks/2026-09-17-coherence-review.md`（5 打架 / 11 缝 / 顺序 8 步 / 红线 / 横切）。**Lemon 定**：①付款不明要拉 highvcc 流水算时段外突发例外（token 有效就拉、失效才叫、带证据）；②时段外 Browser 缺 highvcc 卡**自动用 hnskj 开一张顶上**（故障转台双向、按「该台此刻能不能开」判）；③Session 门槛统一 30 分钟不动。其余打架 3～5、缝 a～k 按连贯审处置写进账本「连贯审补丁」。
**账本状态**：五面定稿 + 补丁 + 落实顺序齐；旧 A/B/C/G 全部作废或并入。**D-243 步①②③完成，进步④：按顺序开落实窗口，第一件 C2 真单 + Pro 映射验证（需 Lemon 提供 free 测试号 Session、当次确认）。**

## D-253（2026-09-17 13:55 UTC）C2 结果：ZZSHU 拒绝 highvcc 卡（40020「该卡头暂不支持提交，请联系客服添加支持」）——ZZSHU 认 BIN，解耦的技术前提不成立

**执行**：Lemon 提供 free 测试号 Session（shichuan003@gmail.com，free，accessToken 有效至 09-21）；卡用 highvcc 尾号 0601（BIN 53211304，Lemon 充至 $15.99，手动触发快照核实）；planType `plus`；13:54:45 UTC 隔离直调 `POST /third-party/orders/direct` 一次。
**结果**：HTTP 400、业务码 **40020**「该卡头暂不支持提交，请联系客服添加支持」。`uncertain=false`（ZZSHU 语义：创建前校验拒绝，未创建订单）。**未扣款**（卡台余额下次快照/时段同步核）。Session 文件已删。
**含义**：①「ZZSHU 不认卡台」（D-246 时的技术判断）**错**——ZZSHU 按卡 BIN 白名单放行，highvcc 的 BIN 53211304 不在名单；3336 那张（BIN 54317796）未试、大概率同样。②**面一选择表 API 行白名单初值 = 只有 101（hnskj）**；解耦到 API 路线的路只剩「找 ZZSHU 客服把 highvcc 的 BIN 加进支持名单」（商务动作，Lemon 定）。③面二⑦故障转台：API 路线不转，维持。④D-252 打架 2「时段外 Browser 缺卡自动用 hnskj」不受影响（Browser 不认 BIN）。
**下一步待 Lemon 定**：找 ZZSHU 客服加 BIN（53211304 / 54317796）后再试一次，还是接受 API 只走 hnskj。

### D-253 补记（2026-09-17 14:05 UTC）：Lemon 定「接受 API 路线只走 hnskj，客服不加 BIN」

→ 卡台↔支付方式解耦（D-243 起的方向节点）**结论：Browser 路线可用任何卡台（已成立）；API 路线固定 hnskj（ZZSHU 认 BIN，不扩）。** 面一选择表保留「产品 × 执行器 → 卡台」结构，API 行固定 101、后台不给选择控件（减法）；面一 C1 ②③④、切换四项校验不变。C2 脚本作废。

## D-254（2026-09-17 14:40 UTC）browser-mvp 改动纪律（Lemon 顾虑：Browser 自动化代码脆弱）

落实 8 块里只有③④轻碰（非付款）、⑦碰付款链路（排最后、前置非付款 PoC）；②⑤⑥⑧不碰。规则：碰的任务书列文件白名单、越界即停；付款前三件（`billing-address-fill` / `live-chatgpt-payment-adapter` / `payment-executor` submit 段）任何块不许改除非 Lemon 单独批；一动就全量测试 + rehearsal 演练；worker 重启前问；每块收尾含 Browser 演练。已写进账本「做的顺序」下。第②步任务书已含「不碰 browser-mvp」边界。

## D-255（2026-09-17 15:30 UTC）第②步 T2 开卡费：Lemon 选 B「观察余额差」而非 A「按费率表推算」

**问题**：卡台收的开卡手续费一分没记进账（`card_transactions.fee` 对 `card_recharge` 全 0）。两条路：**A** 按 D-229 的费率表（开卡 $0.5 / 支付 0.5%）算一个数写进去；**B** 开卡前后各读一次账户余额，差值 − 开卡金额 = 真实成本。
**Lemon 定 B。** 理由（他问「B 会不会让系统臃肿和不稳定」，核实后答）：
- **不臃肿**：开卡「前」的余额读取与入库**本来就有**（`card-stock-job-runner` 的 `beforeCard` → `refreshProviderSnapshot` → `provider_balance_snapshots`），`onCardOpened` 钩子也是现成的。B 只是把前一次的结果留下、开卡后再读一次。**不新增表、不新增字段。** A 反而要新建费率常量与写入逻辑，费率一变还得改代码。
- **两个不稳定点已处理**：①开卡后那次读取失败会让 job 报失败，而卡已开出、钱已花 → 全程 try/catch，最坏只是「这张卡成本没算出来」；②前后读数间混进别的动账会污染差值（2026-09-14 真发生过，账户被充值）→ 合理性闸门 `金额 10% + $1 底`（只用 10% 会误伤 $5 卡的正常成本），超出就如实记「算不准」，**绝不退化成 0 或退化成费率推算值**。
**关键区别**：B 算不出来的时候会承认算不出来；A 永远能写出一个数，费率变了就一直安安静静记错，没人发现。
**费率只作对照不作依据**：生产两个干净样本——开卡 $16 扣 16.58（成本 $0.58）、补值 $50 扣 50.25（0.5%），与 D-229 记的费率吻合，但代码不拿费率去校正观察。

## D-256（2026-09-17 15:35 UTC）账本补记只补「有卡台流水证据」的单：8 单 → 7 单可补、1 单（Dqcn）证据不足

**任务书原定补 8 单**（D-249 Lemon 同意）。第②步落实时把 22 笔 highvcc 真实流水逐单比对，结论要改：
- **6 单 highvcc 精确对上**（VHl_/pom5/NnL3/BUGA/G3Ni/zdpr）：每单都有一笔 $15.75 落在该单「账本建仓 → 订单结束」窗口内。pom5 那笔与 Lemon 当时写在 `order_events` 里的备注（「卡台已见 $15.72 PENDING，2026-09-13T09:47:48Z，卡 3159」）逐字对上。
- **1 单 hnskj（FqFn）对上但标人工复核**：`trade_time_raw` 是 UTC+8 本地串（两个独立样本推断，非卡台文档确认），不自动断言。
- **1 单（Dqcn）补不了**：09-10 14:29 建仓、09-11 02:36 关单，7402 卡在窗口内**一笔流水都没有**；该卡唯一的 09-10 流水是 03:47:02 的 $142.87 / 8919.64 PHP，早于建仓 11 小时且是 Pro 价位。**原因未知，待查。**
**规则**：补记脚本只补能找到窗口内流水的单，找不到一律 BLOCKED——「订单成功」不等于「用的是这张卡」。
**三处纠正任务书的定性**：①7 单 RELEASED 不是「收口分支漏写」，三条人工收口分支当前代码都写账本；真因是 `close-manually-fulfilled-order.mjs:42-44` **明确拒绝**给 RECHARGE_FAILED 单记 `--card-used`（已知设计缺口）。②FqFn 不是人工收口单，是 API 全自动成功单，只是早于账本机制上线（账本最早行 2026-08-29 05:50:22，该单 08-27 结束）。③金额不能用 `orders.actual_payment_amount`——那列存商户侧原币（实见 982.14 PHP），账本口径是卡上占用美元额度（16.00）。
**补记后效果**（已用生产资格 SQL 核过基线）：1657 用量 1→3（用满）、3159 2→3（用满）、5371 0→2、7402 0→1、6807 0→1。D-249 预告的是「1657/5371 用满」，**实际用满的是 1657 和 3159**。这几张卡当前已全部因余额不足不可分配，**补记不改变可分配卡集合**。

### D-256 补记（2026-09-18 00:0x UTC+8 / 2026-09-17 16:0x UTC）：7 单已 apply；FqFn 的时区推断被订单事件独立证实

**Lemon 同意后执行**（`--apply`，7 单成功、Dqcn 按规则拒绝）。新连接独立核实：账本 CONSUMED 12→**19**、RELEASED 53→47、7 单各有 `consumed_at` + `provider_transaction_id` + 1 条 `order_events` 审计行；Dqcn 仍 RELEASED、0 审计行。
**FqFn 的人工复核做了，不是跳过**：该单 `order_events` 07:50:31 提交充值 → **卡台流水（按 UTC+8 解释）07:51:03** → 07:51:10 provider 确认付款成功。流水正好夹在提交与确认之间（距提交 32 秒、距确认 7 秒）。若时区解释错（按 naive UTC = 15:51:03），流水会比订单结束晚 8 小时、不可能对应。**hnskj 的 `trade_time_raw` 是 UTC+8 至此由订单自身事件时间独立证实，不再是两点推断。**
**补记后效果与预测一致**：1657 用量 1→3（用满）、3159 2→3（用满）、5371 0→2、7402 0→1、6807 0→1；**可分配卡仍是 2 张（0577 + 3336），补记没有减少可分配卡**。

## D-257（2026-09-17 16:1x UTC）对账判据不是「放宽白名单」就能修好——实测推翻我自己的建议

我此前向 Lemon 报「`card-consumption-audit.js:33` 只认 `LOWER(status)='success'`，放宽判据即可」。**补记后用宽判据（认 success/succeeded/settled/complete/completed）实测，这个说法不成立**：14 张相关卡里只有 7 张能归零，另 7 张差异原因各不相同 ——
- **符号不统一**：8590 那笔真实消费 `amount = -15.97`（负数），按「金额>0」过滤反而把它漏掉；库里 purchase 有正有负。
- **PENDING 也是真实扣款**：1657 的第 3 笔（09-16 11:08:59 $15.67）状态是 `PENDING`，对应的订单 x-tIs 已成功。只认已结算状态会少算。
- **无主流水**：0237 $100、0601 两笔、5371 的 09-13 16:01:49、5501 的 09-06 05:51 —— 卡台真实扣款但库内没有任何对应订单（**Lemon 在系统外人工用卡的痕迹**，面二⑩销卡与面四③对账都要处理）。
- **反向缺口**：5501 的 RCbA 单账本记 CONSUMED，卡台该时段无对应流水。
**结论**：这是一个要认真设计的对账口径（符号、未结算态、系统外用卡、双向缺口），不是改一行白名单。**归第⑤步「日对账」一并做**，本块只报不改（规则维持 D-249「前期只进看板 + 每日一条汇总推，连续两次才进队列」）。

## D-258（2026-09-17 16:1x UTC）数据库集成测试在当前生产代码上就有 14/43 失败——发布门槛形同虚设，Lemon 同意立项

**怎么发现的**：第②步发布时我漏跑了数据库集成测试（AGENTS.md 把「数据库集成测试串行运行」列为发布门槛），事后补跑。
**对照结论（当前版 vs 基线 `4334dc2`，各自干净库 + 全量 migrations）**：两边都是 43 tests / 28 pass / **14 fail**；**当前版独有的失败 0 条 → 第②步没有引入任何新失败**；覆盖本块改动的那条（`inventory-only card sync is durable and persists transactions without an order`）单独跑通过。
**但那 14 个失败是既有的**：串行跑（`--test-concurrency=1`）结果相同，不是并行干扰。失败集中在同一类报错 `Order route cannot assign a card`（订单没绑上路线）。**根因未查**（超出本块范围，只报不修）。按 `v1/README.md` 写的方式跑，没有别的准备步骤；种子数据齐（4 routes / 3 accounts / 3 products，与生产一致）。
**含义**：这道发布门槛实际上过不了，此前的发布多半也没真跑过它。**Lemon 同意立项**，不排进第③步（它不挡 V2 落实，但挡的是「发布前能不能真验证」）。
**顺带**：`v1/README.md:44` 说「12 个数据库集成用例会跳过」，实际 66 个，文档过时。

## D-259（2026-09-18 00:05 UTC）库存水位统计不能用分卡的资格 SQL——Lemon 在放行调度器前问出来的

**问题**（Lemon）：水位判「缺几张」如果套现在那条资格 SQL，hnskj 的 5276 每小时只有 15 分钟合格，窗口外调度器会以为缺 2 张开 2 张。
**核实**：确实如此。第一版 `countEligibleCards` 直接套 `eligibleInventoryCardSql`，其中「非 MANUAL_IMPORT 卡须 15 分钟内同步过流水」对 5276（`sync_tier=AVAILABLE`）生效；00:19:42 UTC 实测（5276 上次同步 00:00:12）：旧口径 hnskj 0 张，实际库里有 1 张 $16 好卡。
**改法**：水位统计与切换校验改用**库存口径** `stockCountingCardSql` = 正式资格规则去掉那一句新鲜度（换成「至少同步过一次」），余额门槛 / 每卡单数上限 / 活动分配 / 资金与退款风险 / RETIRED / PRODUCT_ONLY 全部保留；**分卡本身不动**（客户单仍等同步窗口，「分卡时当场同步这一张」是面二⑨，归第④块）。不复制规则：从 `eligibleInventoryCardSql` 生成后只替换那一句，找不到就抛错；测试锁住「只少一个 AND 条件」。
**大白话**：以前数的是「此刻能分出去的卡」，现在数的是「还能服务新单的卡」。同一时刻实测：旧口径 0 / 库存口径 1（提交 `ba28273`，随第③步 release 上线）。

## D-260（2026-09-18 00:19 UTC）965 条旧架构开卡残留已归档（不删行）

Lemon 看过 dry-run 清单后确认 `--apply`：`REVIEW_REQUIRED AND opened_count=0 AND created_at < 2026-09-06` 共 965 条（PROVIDER 924 / CARD_TYPE_UNAVAILABLE 23 / BALANCE_INSUFFICIENT 12 / SCHEMA 5 / TIMEOUT 1）→ `status=ARCHIVED_LEGACY`，写 `archived_at`/`archive_reason`，`error_code`/`error_message` 原样。新连接核实：ARCHIVED_LEGACY 965、REVIEW_REQUIRED 0、调度器「花过钱没人核对」检查从命中变为 0。账本 §3.A 写的 930 是「卡住调度器的那部分」，965 是全部残留，两个数分母不同、都对。

## D-261（2026-09-18）browser-mvp 白名单两处按 `sync_tier` 判而不按 provider_accounts 能力位——为什么

任务书要求「按能力位」。实查：那两处的输入是同文件 `resolveCardContext`（`production-live-worker.js:165-179`）的 SQL，只查 `c.sync_tier` 和 `pa.provider_code`，**没查 `supports_api_sync`**；真按能力位判必须改那段 SQL 加一列，而它在 D-254 白名单外（白名单只列了 :215 和 :283-284 两处判定）。选择：白名单内能做到的是去掉 `provider_code === 'manual_excel'` 这个名字分支，只按 `sync_tier`——它是卡资料来源层的标记（`MANUAL_IMPORT` = 凭证来自导入/highvcc API 直录，没有 hnskj 那种可回查的流水接口），语义上就是「这张卡能不能用 hnskj 读取器核交易」，与 `supports_api_sync` 同义但落在卡上而不是账户上。**没有扩白名单是为了守 D-254**；要不要把 :165 那段 SQL 一并改成读 `pa.supports_api_sync`，Lemon 定（本块列为待定项，已报）。副作用：v1 侧付款前查卡（`workflow-handlers.js`）已改为按 `context.card.supports_api_sync`（`loadOrderContext` 新增这一列），两边判据暂时一个按卡一个按账户，现有两台数据下结论相同（103 的卡全是 MANUAL_IMPORT 且 103 supports_api_sync=0）。

## D-262（2026-09-18 00:27 UTC）第③步 D：hnskj 真开一张，T2 第一个真实样本 $0.75

Lemon 逐项看过预检（钱包 $89.48、卡段 23 未维护、$50、预估总扣 $50.75、扣完 ≥ 底线 30）后说「开」。走人工 job（不经调度器，总闸仍 false）+ 手动 `systemctl start pojia-card-stock-runner.service`：开出 5622（尾 6754，$50，AVAILABLE），钱包 89.48 → 38.73，`CARD_ISSUE_FEE` 行 `LOCAL_ISSUE_FEE_5622` = **$0.75**（差 50.75 − 50；与卡台报价 0.5 + 0.5% 吻合，但记的是余额差观察，D-255 选 B 至此有真实样本）。highvcc 那张 Lemon 定先不开（钱包 $23.65 < 20 + 50 + 手续费，且要在时段内贴 token）。

## D-263（2026-09-18 00:50 UTC）第③步 C：供卡调度上线，首轮就按设计拒开并叫人

**放行前 Lemon 先问了一个问题**（见 D-259）：水位判「缺几张」用什么口径。答清并改完（库存口径）他才放行。
**做了三步**：①`deploy/server/pojia-card-stock-runner.{service,timer}` 同步到生产并 `enable --now`（60s 一轮）；②`set-supply-scheduler-flag.mjs on --apply` 只打开 `card_auto_replenishment_enabled`（**新脚本**：后台那个按钮会把补余额开关一起开，而补余额整条线定要删，所以不能用它）；③连跑两轮看行为。
**首轮（总闸仍关）**：`reason=DISABLED`，六行决策 = hnskj plus 2/2、pro_5x 2/0、pro_20x 0/0；103 plus 1/2（low）、pro_5x 1/0、pro_20x 0/0。只刷告警不开卡。
**总闸打开后那轮**：`reason=WALLET_BELOW_FLOOR`，**没建任何 job**（`card_stock_jobs` 自 00:50 起 0 行）。调度器真去读了 highvcc 钱包（$23.65，新快照 00:50:59 写入，token 当时有效），算出 `23.65 − 50 − 6（保守估手续费）= -32.35 < 底线 20` → 不开、推两条告警（`CARD_SUPPLY_WALLET_LOW` critical + `PROVIDER_WALLET_LOW` warning）。两台 `supply_fault_state` 仍 OK——**钱不够不是卡台故障**，没误标、没误转台。
**Lemon 侧的后续**：充到 ≥ $76 并在时段内贴 token 后，下一轮调度器自己开那张，不用叫人。
**hnskj 那边不动**：plus 2/2 不缺（0577 + 00:27 新开的 5622），不会开卡。

## D-264（2026-09-18 01:0x～01:46 UTC）第③步 E：browser-mvp 一动就演练——两次都停在付款前，报价段未验；两个既有缺口顺手坐实

**流程（Lemon 逐步批）**：切默认方式 API→BROWSER（四项校验全过，这是校验在生产的第一次实证）→ `stop-live.sh` 停常驻池 47905 + 关付款开关 → 用正式建单函数建演练单 → 关接单 → `run-live-rehearsal.sh once`。**顺序上纠正了 Opus 5 先提出的方案**：必须先切路线再停池，因为切 BROWSER 要求常驻池心跳 60 秒内新鲜。
**第一次**（`PJV1-08VhIP9rOVWJgM2k-2sQ`）：注入后身份探测回 `RefreshAccessTokenError`，fail-closed。Session 的 accessToken 签发于 09-11 05:29 UTC，就是 D-253 C2 直调 ZZSHU 用过的那份；D-190 既有结论「刷新令牌一次性，用过的 Session 不能复用」再次成立。
**第二次**（`PJV1-DE68qse66RbfNDVkpmmE`，Lemon 重导出的 Session，accessToken 同一个、sessionToken 新）：身份探测过（loggedIn / FREE / identityMatched）、页面签名、卡料预检 ready，**进结账找不到 Plus 升级按钮**（`CHECKOUT_NAVIGATION_FAILED`，找到 0 个）。Lemon 看窗口确认：是「ChatGPT Plus - 1 Month Free Trial / 0 元」offer 页，与 D-216 同一情况；**用的 CDK 正是 D-216 那张「待作废」的码**（批次 `B-20260914044709524-D9EB06`），至今仍 AVAILABLE——本次作废（`revokeCdkBatch`，REVOKED 1）。
**结论（如实）**：演练证明了 browser-mvp 能加载、会话注入 / 身份探测 / 页面签名 / 卡料预检这一段没被本次两行改动波及；**结账报价段没走到，未验**。那两行改的是付款后交易读取器，演练本来也走不到；它们的验证靠 browser-mvp 单测（303/294/0）和下一单真实付款后的核对。Lemon 定：等有无试用资格的 free 号再补一次演练，不阻塞本块收尾。
**顺手坐实的两个缺口**（只报，修不修 Lemon 定）：①`close-rehearsal-order.mjs` 只认 CARD_READY，D-158 后演练单到 dispatch 已是 RECHARGE_PROCESSING，脚本前提过时；后台控制面没有「付款前失败、放弃并放卡」动作（RELEASE_SAFE 是恢复自动化），worker 的 abort 又要租约——**本次扩了脚本一处**（多接这种形态，按 worker PRE_PAYMENT_ABORT 同一顺序收，守卫不放松，提交 `ac4f8ab`），两单都用它收口并新连接核实。②D-239 的 `pre-submit-failure-diagnostic` 只在「点击前填写失败」落，进结账前找不到按钮这一步不落，诊断只有一句 reason。
**恢复**：两单 CLOSED / CDK 退回后作废 / 3336 回池 AVAILABLE $145 / 账号槽 0 / 非终态 0；切回 API（事件 2b954ae0）；接单开；付款开关开（同步 profile）；常驻池由 supervisor 自动拉起 PID 74272，心跳恢复。Session 副本服务器与本机均已删。

## D-265（2026-09-18 02:1x UTC）第③步范围外发现的处置（Lemon 定）

1. **免费试用账号（D-216 三个方向）——Lemon 给出新事实：带免费试用资格的号可以走 API 路线充。** 方向定为「Browser 遇到免费试用 offer 页 → 该单改走 API」，不拦客户、不转人工。前提两条（接手模型提出，未做）：①系统现在只知道「找不到升级按钮」，认不出「是免费试用页」，要先在 `CHECKOUT_NAVIGATION_FAILED` 这一步落页面特征（URL `promo_campaign` / 文案）坐实，否则页面改版也会被当成试用页转走；②转 API = 换卡（冻结 103 → hnskj），付款前一步未做时安全，但必须走正式的释放 + 重新分卡路径。**归第⑤块**（与 D-239 诊断落库同一块）。
2. **后台「付款前失败、放弃并放卡」动作**：Lemon 同意加，**归第⑥块**工作台/「需要我处理」队列；在那之前用扩过的 `close-rehearsal-order.mjs`（D-264）。
3. **开/关接单、开/关派单不写 `admin_setting_events`**：Lemon 定「改」→ 已改（提交 `765e971`：`updateSetting` 值有变化时写一行 old→new+actor，端点传 `req.admin.id`，单测 +1，v1 810/744/0）。**代码在 main、生产未发布**，随第④步 release 一起上；在那之前生产的接单/派单开关仍无审计行。
其余 9 条按账本 §6 第③步节的归属不变（第⑤块 4 条、第⑥块 1 条、第⑧块 1 条、待查 2 条、噪音 2 条）。

## D-266（2026-09-18）分卡侧 15 分钟新鲜度：Lemon 选 a——资格规则不变，分卡时当场同步这一张再判（与面二⑨一致）

第③步只把水位统计/切换校验改成库存口径（D-259）；分卡那侧的 `eligibleInventoryCardSql` 新鲜度条件保留，第④步用「分卡时候选卡过期 → 当场同步 → 再判」消掉每小时 15 分钟窗口的抖动。不选 b（去掉新鲜度、只靠账本推算兜底）：账本刚补记过 8 单，分卡安全不只押在它上面。

## D-267（2026-09-18 05:xx UTC）第④步「按需同步 + 待销清单 + 三张契约表」落地方式（代码已在 main，未发布）

**按需同步（面二⑨，D-266 选 a）**：资格规则 `eligibleInventoryCardSql` 一字未改。worker 分卡 handler 先调 `findStaleInventoryCandidate`（只读：有合格卡 → null；否则挑一张 supports_api_sync=1、非 MANUAL_IMPORT、流水 >15 分钟未同步、连续失败 <5 的卡），当场同步这一张（卡详情 1 + 流水 ≥1 页，与定时 runner 共用 `syncHnskjCardReadOnly`），再按同一条资格规则分。失败 → 不分、不开卡、不换台，60 秒后再来。**分卡里「排一条 card_sync_jobs 等 runner 领」的旧实现已删**。定时同步 AVAILABLE 档 10 分钟 → 3 小时；scheduler 不再排 MANUAL_IMPORT 卡（此前 114 条 REVIEW_REQUIRED 全是拿 highvcc 卡 id 去问 hnskj）和 RETIRED 卡。限流预算：按需每单 ≤2 次（多页流水才更多）+ 开卡每张 ≤3 次 + 定时每卡每 3 小时 2 次。
**核出的一个事实**：CURRENT_STATE 原写「条件 next_sync_at <= now-60min」不准——代码条件是 `next_sync_at <= now`，每小时一次的真因是 dedupe 桶 `scheduled-card-sync:<card>:<60分钟桶>` 撞唯一键；所以 ASSIGNED（5 分钟档）/ RECHARGE_PROCESSING（1 分钟档）实际也只能每小时一次（归第⑤块看要不要提）。

**待销清单（面二⑩，打架 4）**：派生查询不建表（缝 c），口径 = 用满（全局上限）/ 服务过 Pro 单 / DEPLETED 或 FAILED（生产实跑口径时发现 hnskj 7 张作废卡没 override 不在清单，补 FAILED）/ 已标 RETIRED / 取消续费未确认（`cancellation_review_required=1 AND subscription_cancelled=0`），且 `created_at + card_min_retire_age_hours（默认 6，迁移 054 只加这一个设置键）` 已到；有活动分配的不进。端点 `GET /admin/card-retirement/candidates`（due / notYetDue / recentlyConfirmed）、`POST /admin/card-retirement/confirm`（确认词 `已销卡 <last4>`）：卡进终态 `inventory_status=RETIRED`（新值；hnskj 卡另 `sync_tier=ARCHIVED`，MANUAL_IMPORT 不动 tier 因它是快照比对键）+ override RETIRED + `card_state_events CARD_RETIRED_CONFIRMED`（带 ageHours 积累卡台真实规则）。快照缺席不再把 RETIRED 改回 HELD_FOR_REVIEW。两批旧卡用 `retire-legacy-cards.mjs`（dry-run 已出：hnskj 12 张 / highvcc 8 张全列，**apply 等 Lemon 勾选与确认**）。

**契约表（面三②③④）**：三份落 `docs/contracts/2026-09-18_{delivery-criteria,payment-unknown-reconciliation,human-intervention-points}-contract.md`。落地：
- 表一：`commitCancellationStatus(exhausted)` 与后台 `RESOLVE_UNKNOWN_PAYMENT CHARGED` 未勾续费 → `RECHARGE_SUCCESS` + `cancellation_review_required=1` + `ORDER_CANCELLATION_UNCONFIRMED`（warning）；`CANCELLATION_REVIEW_REQUIRED` 不再由自动路径产生。
- 表二 API：`markAttemptUnknown` 排有界 `POLL_RECHARGE`（30×60s）；`pollRecharge` 遇 SUBMIT_UNKNOWN 走两路证据（有 cardKey 查 ZZSHU；无 cardKey 当场同步 hnskj 卡流水按 UTC+8 判扣款）；定不了 → `escalateUnknownSubmission`（RECONCILIATION_REQUIRED + 告警/案例都带两路证据摘要，栅栏不动）；后台 `POST /admin/orders/:publicNo/resolve-unknown-submission`（CHARGED / NOT_CHARGED，NOT_CHARGED 不自动重提）。
- 表二 Browser：`recoverExpiredRun` 崩溃后按付款态分三路进补核（PAYMENT_SUBMITTING → 等价 markPaymentUnknown + VERIFYING，deadline 30 分钟）；`escalatePaymentVerification` 告警与案例带 `evidenceSummary`；白名单内 `browser-card-transaction-reader.js` 支持注入 `ledgerSource`（读 `card_transactions` + token 有效时 refresh 一次）走真证据，**未注入时保留旧 marker**——因为工厂 `production-live-worker.js` 在白名单外（见 D-268）。
- 表三：12 个人工点唯一清单（含每个点的后台入口与告警类型）；ZZSHU 零原因失败「停单不退码」**本块未改**（现状仍判失败退码），与队列一起归第⑤/⑥块。

**不改的**：付款行为、一卡多单上限值、通知白名单（第④步新告警类型现在按旧规则会推手机）、任何表。**随本块发布的还有** D-265 第 3 条（接单/派单开关审计，`765e971`）。

## D-268（2026-09-18）第④步三件要 Lemon 定的事（等答复，代码已备好两阶段）

1. **`production-live-worker.js` 一行**（白名单外）：`transactionReaderFactory` 给 MANUAL_IMPORT 卡注入 `ledgerSource`（`listPurchases` 读 v1 `card_transactions`；`refresh` 调 highvcc `syncTransactions`，token 失效抛 `HIGHVCC_TOKEN_EXPIRED`）+ `cardId`。不批 → highvcc 卡的「卡台扣款」一路仍是旧 marker 恒匹配（D-248「谎报」根源之一未闭合）；批 → 同时删 reader 里的 marker 分支，且本块「browser-mvp 一动 = 全量 + rehearsal」照做。
2. **Browser 付款后核实窗口放长**：默认 5 分钟在 `production-live-config.js`（白名单外）；可不改代码，`run-live-pool.sh` 环境加 `BROWSER_PAYMENT_VERIFICATION_WINDOW_MS=1800000`，常驻 worker 重启前问。
3. **highvcc HELD_FOR_REVIEW 8 张里哪几张是你注销的**：清单（尾号 / 账面余额 / 最后一次在快照里 / 首次缺席）——5501 $1.79（09-17 12:53 / 13:52）、2911 $1.00（09-11 03:39 / 10:50）、7428 $1.00（同 2911）、3241 $1.00（09-11 10:50 / 11:00）、9354 $1.00（同 3241）、9839 $50.00（同 2911）、3118 $1.01（同 5501）、5371 $1.75（同 5501）。勾了的走 `retire-legacy-cards.mjs --batch highvcc-cancelled --last4 …`（dry-run → 你看 → apply）；没勾的保持 HELD_FOR_REVIEW。hnskj 12 张 $0 批 dry-run 已出（12 张全对上），apply 同样等你一句。

## D-269（2026-09-18 06:xx UTC）Lemon 对 D-268 的答复与处置

1. **highvcc HELD_FOR_REVIEW 8 张**：Lemon「这几天注销了很多张卡，后台没有就是注销了，不记得具体哪几张」→ **8 张全部按「已注销」标终态**；**3336 一起标 RETIRED**（Lemon：余额 145 → 2.46 是他手动用这张卡给客户付了一笔 20X，没经过 Browser 和 API；记「Lemon 手动付 20X」）。hnskj 12 张按「卡台已作废」标终态。apply 前再 dry-run 一次贴给 Lemon。
2. **工厂注入真证据（白名单外）**：批。已做：`production-live-pool-worker.js` 与 `production-live-worker.js` 两处 `transactionReaderFactory` 各加 `cardId` + `ledgerSource`（Lemon 批的是「那一行」，实际是两份同样的工厂各三行，如实记）；`browser-card-transaction-reader.js` 加 `createCardLedgerSource`（读 `card_transactions`）与 `createHighvccLedgerRefresh`（token 有效时再拉一次），**假 marker 分支已删**，MANUAL_IMPORT 卡不带证据源直接构造失败。测试 browser-mvp 308/299/0、v1 842/776/0、`npm run check` 过。
3. **Browser 核实窗口放长**：批。`run-live-pool.sh` 环境加 `BROWSER_PAYMENT_VERIFICATION_WINDOW_MS=1800000`，常驻 worker 重启前问。
4. 发布 / apply / rehearsal：可以，每步先问。
5. **发现的处置**（Lemon「按你建议的来」）：scheduler 60 分钟桶 → 第⑤块；reader 对 hnskj 卡时区偏 8 小时 → 第⑦块（碰 browser-mvp 的块）；`recovery.js` 死代码 → 第⑧步清理；`card_sync_jobs` 307 条历史 REVIEW_REQUIRED → 像 965 条一样归档（dry-run 后问）；ZZSHU 零原因失败停单 → 第⑤/⑥块。

## D-270（2026-09-18 06:5x～07:0x UTC）第④步 rehearsal：**报价段首次跑通**（D-264 遗留补上）；三个顺手坐实的缺口

**流程**（Lemon「全部」授权，逐步贴证据）：切路线 API→BROWSER（四项校验全过，事件 6df4d9f2）→ `stop-live.sh` 停常驻池 74272 + 关付款开关 → 正式 intake 建演练单 `PJV1-8DB4vPHrXotbcNBJHETH`（Lemon 给的 free 号新鲜 Session，10 天有效）→ 关接单 → `run-live-rehearsal.sh once` → 收口 → 切回 API（四项校验全过）→ 开回接单与付款开关 → supervisor 07:06:55 拉起新池 PID 67131。

**结果：`PRE_SUBMIT_STOPPED / BROWSER_REHEARSAL_STOPPED`，报价 PHP 982.14、税 0.00。** 这是 D-264 两次演练都没走到的那一段（一次 Session 复用失败、一次撞免费试用 offer 页），**第④步补上了**：整条生产 Browser 路径（Session 注入 → 身份探测 → 页面签名 → 报价弹窗 → Checkout → 卡料/地址/邮箱 → 零税重新报价 → 最终复核）在本块 browser-mvp 改动之后仍然走得通，按设计停在付款点击前。付款提交 0 次、卡余额未动、账号槽 0。

**顺手坐实并处理的三个缺口**：
1. **收口脚本守卫认不出新形态**（已扩）：D-264 那两次是 worker fail-closed 直接退出（attempt 还挂着 run RUNNING/NOT_STARTED、租约过期）；这次 worker 自己走完付款前中止，把当时那条 attempt 收成 CLEARED/CLEARED、run 置 FAILED_SAFE/PRE_PAYMENT_ABORT，**并按设计重置 SUBMIT_RECHARGE，于是又建了一条新的 PREPARED/ACTIVE attempt 和一个 QUEUED 派单**。守卫原来写死「只有一条 attempt、run 必须 RUNNING」，直接拒。改判据为「恰好一条还活着的 attempt、其余都已 CLEARED/CLEARED、任何 run 都没有付款痕迹、活着那条要么没 run 要么 run 还 RUNNING 且租约过期」。**这个形态若不收口，开回付款开关后池会真的去付这一单**。
2. **我建演练 CDK 时用了底层函数、漏了批次行**（我的失误）：`storeCdkBatch` 只写 `cdks`，正式路径 `createAdminCdkService` 还写 `cdk_batches`。退回 CDK 要写 `cdk_delivery_events`，它有外键指向 `cdk_batches` → 收口在最后一步失败。加 `--skip-cdk-return`（只给运维自己生成的一次性演练码用，注释写明客户码一律不能用它），那张码停在 REDEEMED + 订单 CLOSED = 死码。
3. **supervisor 的「残留 worker」判据被我自己触发**（第③步发现 12 原样重演）：我用 `until pgrep -f "production-live-pool-worker"` 等池拉起，这条命令行本身含那串，supervisor 判定有残留、拒绝拉起，卡了 5 分钟。停掉循环后 07:06:55 正常拉起。判据本身要不要改，仍按第③步结论「记着，不立项」。

**新池已带 D-269 ③ 的 30 分钟核实窗口**（`ps eww` 实测 `BROWSER_PAYMENT_VERIFICATION_WINDOW_MS=1800000`）。

**演练走不到付款后，所以 D-269 ② 新接的「备用卡台侧扣款」真证据路径没被执行**。补了一次**生产真实流水的只读验证**（不写任何东西）：① 1657 窗口内 Plus 扣款（15.70 USD / 982.14 PHP）→ 唯一匹配；② 同卡提交时间挪到两天后 → 不匹配；③ 3336 上 Lemon 手动付的那笔 20X（142.54 USD / 8919.64 PHP）→ 不匹配。三例全符合预期，证明 `card_transactions` 这一路在真实数据上判得对。**仍未验的是「真单付款后由 worker 自动调用这条路径」。**

**新发现（只报未改）**：`plausiblePlusAmount` 只认 USD 14~22 / PHP 900~1200，**Pro 单的扣款一律判成不匹配** → 将来 Pro 走 Browser 时补核永远定不了、每单叫人。归第⑦块（Pro 同型）一并改成按订单套餐取价位区间。

## D-271（2026-09-18 07:5x UTC）D-176 静音为何没生效：**代码没错，是 bark 进程从来不跟发布走**

**坐实（第⑤块前置核查，全部生产实证）**：

- `pojia-bark-notifications.service` 的 `MainPID=2324`，`ActiveEnterTimestamp=2026-09-16 23:36:28 UTC`——那是**服务器 boot** 的时刻（`journalctl --list-boots` 只有这一个 boot，首条 23:36:11），不是任何一次发布。
- `readlink -f /proc/2324/cwd` = `/opt/pojia/releases/20260916-unified-4334dc2/v1`，而 `readlink -f /opt/pojia/current` = `/opt/pojia/releases/20260918-step4-251a441`：**进程落后 current 四个版本**。
- unit 是 `WorkingDirectory=/opt/pojia/current/v1` + `ExecStart=/usr/bin/node scripts/bark-notification-runner.js`（相对路径）。软链在 systemd 启动进程那一刻解析成实目录，之后 current 换指向对已跑进程无效。
- `scripts/deploy-release.sh` 的 switch 段只有 `systemctl restart pojia-web.service`（:86）与 `pojia-worker.service`（:91）。**bark 不在重启名单里**，所以发布永远换不掉它的代码。

**闭环（证明 09-16 那次不是巧合）**：`docs/HANDOFF_LOG.md:2367` 记 2026-09-16 10:46 UTC 现场核对 `current = 20260913-orderno-6dcb458`；服务器实测该 release 的 `alert-notification-repository.js:10` **确有** `PHONE_SILENT_TYPES`；而生产 `alert_notifications` 里 `BROWSER_PAYMENT_UNKNOWN` id=438347 `created_at=2026-09-16 11:09:35.571 / sent_at=11:09:36.261`、`BROWSER_PAYMENT_CONFIRMED` id=438355 `created_at=11:10:11.707`。**current 含静音的同时仍在插行并推**——只能是执行插入的那个进程跑着更老的代码。

**排除了其它解释**：全项目 `grep alert_notifications`，INSERT 只有 `alert-notification-repository.js:14` 一处（唯一调用方 `bark-dispatcher.js:2` ← `bark-notification-runner.js`）；`information_schema.TRIGGERS` 对 `alert_notifications`/`operator_alerts` **无触发器**；`created_at` 是 `DEFAULT CURRENT_TIMESTAMP(3)` 且无 `ON UPDATE`，就是插入时刻；两个静音类型的**全部** 20 行 `created_at` 最晚停在 09-16 11:10，都在 boot 之前。

**范围**：生产只有三个常驻 service——web / worker（均 `20260918-step4-251a441`）与 bark（`20260916-unified-4334dc2`）。其余 8 个 pojia-* 都是 timer 拉起的 oneshot，每次新进程走 current，不受此影响。**所以这个洞只咬 bark 一个，但它咬的正好是「通知」。**

**同一个洞被修过一次，漏了这个服务**：D-220（2026-09-14）就发现 worker 在四次发布后仍跑 09-11 的 release，当时给 switch 段加了 `restart pojia-worker`，脚本里那段注释写得很清楚——**但只修了 worker**。生产的常驻服务是三个，bark 是第三个，没人回头数一遍。

**处置**：① `deploy-release.sh` switch 段加 `pojia-bark-notifications.service` 一起重启（本块已改，并打印 `bark cwd=`，ROLLBACK 行同步带上）；② 现在这个跑旧代码的进程要不要立刻重启，问 Lemon（重启推送进程属「先开口问」）。③ 白名单改完之后如果不重启 bark，改动一样不会生效——**发布 ≠ 生效，这条写进 RUNBOOK**。

**副发现（只报）**：`journalctl -u pojia-bark-notifications` 在整个 boot 内**一条都没有**，连启动时 `console.log('Bark notification runner started')` 都看不到（Node 非 TTY 下 stdout 块缓冲，短字符串留在缓冲区）。等于这个服务在生产是**哑的**，出问题无从查。归第⑥块运维工具。

## D-272（2026-09-18 08:0x UTC）第⑤步 Lemon 定的三件 + 推送白名单与日对账的落地判据

**Lemon 定的三件**（任务书里挂着等他答的）：

1. **待销到期不单推**，到期张数并进每日对账那一条汇总。理由：待销是「到存活期去卡台删卡」，不紧急、可积压；单独每天推一条会变成新的常态噪音，而本块的目的正是去噪。契约表三 #12 已改。
2. **highvcc 的 `usdDeposit` 是押金、不能花**，钱包预检要从余额里扣掉。`walletPreflight` 改成 `余额 − 押金 − 开卡金额 − 手续费 ≥ 硬底线`；卡台不报押金（hnskj）时按 0，行为不变。与 Lemon 2026-09-10 在 CURRENT_STATE 里留的那句「账户另有 $20 押金要先扣，才是真实可开卡余额」一致。
3. **运营手动用卡要有登记入口**，入口归第⑥块工作台；在它上线前，本块的日对账把这类扣款**单列一栏「待登记」，不算差异、不猜原因**。

**白名单的四类**（`v1/src/domain/alert-push-policy.js`，替代 `PHONE_SILENT_TYPES`）：叫人 10 种 / 供给 4 种 / 资金 4 种 / 客户动态 1 种；不推的 9 种**逐条写了理由**（`NON_PUSH_REASONS`）。新增类型要么进白名单、要么进理由表，不留空白——排除法的毛病就是新类型默认开口子。

- **与任务书不同的三处**（当场重查后改的，都在下面「发现」里说了为什么）：① `BROWSER_ORDER_STALLED`、`ORDER_WAITING_FOR_CARD`、`PROVIDER_SNAPSHOT_STALE` 三种任务书没列，按契约表三 #3/#9/#10 属「A 必须叫」，进白名单；② `BROWSER_ORDER_COMPLETED`（成功）**不推**——D-249 定的「其余只进后台」推翻了 D-176 的「一头一尾」，成功数改进每日汇总；③ `CARD_SUPPLY_BLOCKED` 进供给类。
- **`enqueueOpenAlerts` 里那条 CANCELLED→PENDING 的复活路径以前没有类型过滤**：白名单外的类型只要历史上推过一次，就能靠它一直复活。已加。`claimNext` 也加了白名单，防止白名单收窄前遗留的 PENDING 行在改动上线后继续被推。
- **三个新产生点**（都是「以前只改状态、不叫人」）：`PROVIDER_TOKEN_EXPIRED`（token 失效，挂在 `sync-highvcc-snapshot.mjs` 的失败分支）、`CARD_SUPPLY_FAULT`（挂进 `markSupplyFault` 本身，五个调用点自动带上）、`CARD_CHARGEBACK`（拒付必推）。「一段失效期只推一次」靠固定 dedupe_key + `alert_notifications` 的 `(alert_id, channel)` 唯一约束，恢复时 RESOLVE。

**日对账的判据**（`v1/src/domain/card-transaction-audit.js`，D-257 的正式答案）：

- 状态只写**生产真实数据里见过的**：成功态归一化后是 `SUCCESS`/`SETTLED`/`COMPLETE`，`PENDING` 也算扣款（3336 那笔 142.54 就是 PENDING，而 Lemon 确认真付过）。**没见过的状态归 `UNKNOWN_STATUS` 进报告让人看**，不默认映射成功或失败。
- 符号取绝对值（hnskj 有 -15.97 / -78.24 两笔负数），0 元授权不算扣款，**判据不认商户名**（0237 卡上有一笔 `ANTHROPIC* CLAUDE SUB` 100.00，把 OPENAI 写进判据会让它凭空消失）。
- **首次生产实跑（08:04 UTC，只读）报出 11 条差异，其中 9 条是判据自己的问题，当场修掉**：① 7 条来自已作废的卡（余额被清零或退回，「开卡金额 − 扣款 = 余额」不适用）→ 终态卡不做金额对账；② 2 条来自把账本的 `RECONCILIATION` 占位当成已确认消费（1013/4643，付款未知、资金锁着）→ 确认消费只数 `CONSUMED`，占位单列 `AWAITING_RESOLUTION`。**修后重跑（08:05 UTC）剩 2 条**。
- 差异前期只进看板 + 每日一条汇总；**连续两次日对账仍在**才升 critical（指纹存 `app_settings.daily_reconciliation_last_report`，不新建表）。

**白名单上线不会引发补推风暴**（上线前实查）：`operator_alerts` 里 OPEN 的行**全部**已有对应的 BARK 通知行（`LEFT JOIN ... WHERE n.id IS NULL` 返回空），且当前没有任何 `PENDING/RETRY/SENDING/DEAD` 的待推行。`INSERT IGNORE` + 唯一约束保证不会重插。

## D-273（2026-09-18 09:1x UTC）撤回 D-272 ②：那 $20 押金**早就是 `wallet_floor`**，我扣了第二遍

**Lemon 原话**：「20 美金的押金是人家卡台的规定，没有写在哪儿」——它不是某个 API 字段，是卡台要求账户里留着不能动的一笔钱。

**它早就实现了**：`provider_accounts.wallet_floor`（备用卡台 A = **20**，hnskj = 30），预检公式 `余额 − 开卡金额 − 手续费 ≥ 硬底线` 里的硬底线就是它。生产那条告警文案自己就写着「扣完剩 -9.01，**低于硬底线 20.00**」。第③步做对了。

**我干了什么**：在 D-272 ② 又按 `usdDeposit` 扣了一遍。**就算那个字段真等于 20，也是押金扣两次（20 + 20 = 40），照样错。** 这不是「字段读错」，是我凭空造了一个已经解决的问题。

**更难看的一点**：项目里早就写过结论。`highvcc-snapshot-sync-service.js:330` 的注释：「只入 usdBalance（可用余额）。`usdDeposit` 的业务含义卡台没说清（按卡冻结？历史累计？），把它填进 pendingBalance 等于替卡台下结论」；`test/highvcc-transaction-wallet-sync.test.js:184` 还留着实测值 `usdDeposit 94240 分 = $942.40`。**那行注释就在我这次改过的同一个文件里**，我没看，反而编了道选择题去问 Lemon「usdDeposit 是不是那 $20 押金」，用错误前提换来一个「确认」，再拿它上线。

**处置**：`heldBalance` 整套删除（不是「保留备用」——公式里就不该有第二个扣减项）。`card-open-adapters.js` / `highvcc-card-service.js` 已与第④步逐字节相同；`walletPreflight` 回到原公式，只在注释里留下这次的教训：**要调那笔留存，改 `wallet_floor` 这一个地方**。v1 全量 885/819/0。

**生产状态**：错误代码在 release `20260918-step5-740bc1d`（08:29 UTC）里，**但从未执行过**——调度器全程 `NO_DEMAND`（highvcc 水位 2 已满），一次都没走到钱包预检；生产告警文案仍是旧代码算的。修复未发布。

**这次的教训不是「外部字段要验真」**（那条我早就知道，还写在任务书里）。是：**动一处逻辑之前，先读它旁边已有的注释和测试**——项目里已经有人把答案写下来了，我却去问用户，还把问题问成了带错误前提的选择题。用户的「确认」不能替代证据，尤其当那个前提是我自己塞进去的。

## D-274（2026-09-18 09:0x UTC）1657 / 3159 的金额差查清了：不是钱丢了，是 `funded_amount` 不是「卡里实际到账的钱」

**只读核对**（拉卡台授权流水 + 卡详情，逐笔比对，不写任何东西）：

| 卡 | 卡台授权流水 | 库里 `card_transactions` | 缺笔？ |
|---|---|---|---|
| 1657 | 3 笔，合计 **47.20** | 3 笔，合计 **47.20** | 无，`cardAuthId` 逐个对上 |
| 3159 | 3 笔，合计 **47.25** | 3 笔，合计 **47.25** | 无 |

**所以不是流水没入库。** 反推实际入卡金额：

- 1657：`balance 1.80 + 授权 47.20` = **49.00**，而 `funded_amount` = 50.00 → 差 **1.00**
- 3159：`balance 1.05 + 授权 47.25` = **48.30**，而 `funded_amount` = 50.00 → 差 **1.70**

**差额正是日对账报的那两个数。** 结论：`funded_amount` 记的是**我们下单要充的金额**，
不是**卡台实际充进卡里的金额**；两者之间少掉的那一点，最可能是开卡时从充值额里扣的费用
（**这是推测，未经卡台确认**）。同一个根因也解释了第⑤块发现 6「`funded_amount` 对 highvcc 卡多数不可信」
——只是 5501（funded 2.00 / 扣款 159.16）那种差得太离谱，不是一两块钱的费用能解释的，另有原因，待查。

**卡详情里也有个 `deposit` 字段**（1657 = 6500、3159 = 5000）：**含义未确认，不拿它做任何计算**，理由见 D-273——这个项目对这类字段早有成文规矩，别再去猜第二次。

**对日对账的影响（要定）**：现在这两条会在 2026-09-19 04:01 的第二跑变成 `persistent` → 汇总升 **critical** 推手机。
但它们**不是资金问题，是基准口径问题**——第⑤块刚把推送改成白名单就是为了「响的都值得响」，
让上线后第一条 critical 是这个，等于自己拆自己的台。处置选项见当窗口给 Lemon 的两个方案。

## D-275（2026-09-18 12:xx UTC）第⑤块收窄（Lemon 认）：金额对账降级、未知扣款不猜、连续两次只认正式批次、拿掉汇总选项与推送次数；手动用卡 = 标 RETIRED；第⑧块删表清单缩小

**起因**：Codex 审查 `docs/reviews/STEP5_REVIEW_2026-09-18.md`（F-47～F-55）与 `V2_STEP5_TO_STEP678_OPTIMIZATION_ASSESSMENT_2026-09-18.md`；Fable 复核后认同主要发现。**根因有一半在设计**：面四③「金额对账 = 开卡金额 − 卡台交易合计 vs 卡余额」由接手模型（Fable）写时默认 `funded_amount` = 实际入卡金额，未核；D-274 证明对 highvcc 卡它是下单金额。建在不可靠起点上的自动金额判断 = 「给观察补原因」。

**Lemon 认的八条**：
1. 金额对账降级：无可验证期初的卡显示「无法核对」，不判异常也不判一致；次数对账保留。
2. 未知扣款就是未知：已确认手动消费（待登记）与无主扣款分开，后者保留差异属性、先不升级推送、不隐藏。
3. 「连续两次」只由正式批次推进；只读 GET / dry-run 不推进。
4. `DAILY_DIGEST` 余额汇总选项拿掉（未实现的功能不给开关）。
5. 看板「今天叫了几次」拿掉（`alert_notifications` 行可覆盖，撑不住精确次数）；`countPushesByType` 删或改名为告警实例数。
6. F-47 押金重复扣减的修复（`31b5639`）单独发一版，Lemon 当次确认。
7. 手动用卡登记 = **标 RETIRED + 原因**（`card_operational_overrides` 已有），不新建表；手动用过的卡不再进系统分配；第⑥块把入口放进工作台。面二⑩待销口径含 RETIRED 已覆盖。
8. 第⑧块删表清单缩小：`reconciliation_cases`（付款不明处理在写在读）、`browser_interventions`（人工接管在用）**不删**；面五④相应改。只删真 0 引用的表；`refund_cases` 删前先改资格 SQL 引用。

**保留不动**：D-271 bark 重启修复、白名单四类 + 复活/领取过滤、三个新产生点、日对账次数部分、`card-transaction-audit` 状态归一化。

**做法**：开小块 **⑤b「收窄」**（任务书 `docs/tasks/2026-09-18-impl-step5b-narrowing.md`），做完再开⑥；⑥暂不接「持续差异 / 叫了几次 / 汇总选项」三个字段。账本面四③、面五④已按本条改。
