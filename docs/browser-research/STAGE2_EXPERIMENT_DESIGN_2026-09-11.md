# 阶段 2 实验设计｜待批准，未执行

前提：阶段 1 代码经大脑 review 合并；不修改现有 Dqcnq 订单/7402、不沿用其账号作干净样本。实验目标不是证明“Sentinel 随机拦截”，而是分别证明 Session 路线确实执行、身份正确、页面能否到达停止点。

## E0：离线取证补强（0 账号）

在真实实验前补 executor 两处证据事件 session-bootstrap/session-replaced：adapter 模式、viaExtension、existingSessionPreserved、replacedCookieCount、每次 attempt 的标识。布尔/枚举使用白名单，不落 token、cookie 值、完整付款 URL。记录实际走的分支，不能由 EXTENSION 环境变量反推。

回归要覆盖：扩展真的点击 popup → viaExtension=true；已有会话被保留 → existingSessionPreserved=true 且扩展点击 0；Cookie 注入不能标扩展。WAL 与写库摘要映射都要核对（如需 v1 配合则交大脑，不能自行修改）。E0 本次只设计未实施，未有标记不能开始 E1/E2。

## E1：两种建会话路线的 AUTH_READ_ONLY 配对

- 账号数：申请 1 个专用 free 测试账号，不是现有客户卡住账号；2 次建会话、0 Checkout、0 卡、0 付款。该账号后续不再称“未经实验的干净账号”。
- 变量：只改变 Cookie/Extension 建会话路线。固定同一已批准 lane、相同运行配置与出口；记录 Session 采集年龄、浏览器构建、页面版本。两轮前均清同一个 lane 的会话与 ChatGPT tabs；不换设备 cookie、指纹或 IP。
- 必须先由大脑指定允许清理的 Profile，核对没有活动订单/run/人工接管。清理工具 `browser-mvp/scripts/clear-lane-session.mjs` 会关闭 ChatGPT tabs，不能称纯观察。清理后 remainingSession 必须为空；清理授权也包含在本实验申请中。
- 流程：清理 → Cookie 建会话 → 仅读首页/身份 → 保存脱敏证据 → 清理 → Extension 建会话 → 同样只读。任何账号/出口/凭证发生变化、挑战或身份失败则停止；不继续点击套餐按钮。
- 预期：两条路线都能核实同一身份；EXTENSION 的实际分支为 viaExtension=true、existingSessionPreserved=false。不满足则实验无效，不转用另一账号硬试。
- 判据：仅证明本账号、该时点两种建会话方式的身份可达性；单一顺序存在时间/会话轮换影响，不能判某路线风控更优。若需平衡顺序再由大脑批准额外样本；不自行追加。

## E2：单次 EXTENSION rehearsal，不作 Cookie/Extension 因果对照

- 账号数：另申请 1 个从未在本项目实验的 free 账号；它不是 E1 的账号。总申请上限 2 个，分步放行，先 E1 后再决定是否提供 E2。
- 订单、CDK、卡源与身份由大脑指定；不使用 Dqcnq/7402。固定出口/窗口配置，REHEARSAL 付款关闭、BROWSER_LIVE_STOP_BEFORE=SUBMIT。
- 前置：无其他 pool worker，确认不占活动客户窗口；用上述工具清批准 lane，会话为空后才启动；E0 标记必须落盘。
- 执行：一次正式预检→正式派发→单次 rehearsal 停在 PRE_SUBMIT_STOPPED；不能直接启动会循环领取/自动重试的常驻池来模拟“单次”。现有 once 预检入口如何传 EXTENSION、如何限制预检/导航内部重试需先代码核对并由大脑认可，未具备单次边界则不启动。
- 停止：首个错误、挑战、身份不符、出口改变、导航无响应或超过批准时限即停止新尝试；不复点、不换账号/卡/执行器。冻结诊断信息交大脑；没有 PAYMENT_SUBMIT 才能按无付款流程收口，收口由大脑处理。
- 预期/成功判据：证据显示真实扩展 bootstrap、身份匹配、结账与零税报价、PRE_SUBMIT_STOPPED、PAYMENT_SUBMIT=0。未到停止点只记录最早失败分支，不能归因 Sentinel。
- 网络证据：只记录路径类别、状态码、时序、请求是否发出、响应脱敏错误码。禁止持久化授权头、cookie、完整 checkout URL、client_secret。遇页面 payments error，区分请求尚未发出、已发出被拒、返回成功后导航失败。

## 风险与约束

清会话/登录/Checkout 创建本身会改变账号状态，因此“非付款”不等于“零影响”。E1/E2 分离防止把配对账号再当新样本。E2 一次 rehearsal 不能证明路线因果或付款成功；真正多维控制对照尚未做，“穷尽”不成立。

## [需要大脑]

请先批准 E0 的证据字段实现范围；之后决定是否批准 E1 的 1 个专用测试账号、指定可清理 Profile 和停点。E2 另行放行，需指定新订单/卡与单次编排方式。当前不需要 PAY 权限，未请求也未执行付款。
