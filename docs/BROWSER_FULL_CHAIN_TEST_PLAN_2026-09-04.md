# Browser 全链路真实订单测试清单（2026-09-04）

## 测试目标

用一笔客户式订单，从客户提交 CDK + Session 开始，经过 Browser 单 Profile 执行，到 Plus 成功、续费取消、交易/余额/对账/通知确认，形成可复核证据。付款只允许在官方 Checkout 最终稳定显示 `₱982.14` 且税费为 `₱0` 时执行；否则安全停在付款前。

## 阶段与必须证据

1. **前置与路线**：菲律宾代理 `loc=PH/colo=MNL`；生产 DB/readiness 正常；单 Profile headed Worker 心跳正常；默认路线 Browser；Browser dispatch 开启；付款与 Provider/卡资金写权限在付款前保持关闭。
2. **客户提交**：CDK 有效且未使用；Session 解析成功；客户确认邮箱；只在确认后创建订单；订单冻结 `BROWSER` 路线并记录创建时间/查询码。
3. **派发与卡片**：只创建一个 Browser job/attempt；单 Profile 获得租约；分配卡片、余额和资料资格通过；无重复任务、无并发占用。
4. **Session/账号**：Session 仅通过加密共享材料读取；登录 HTTP 200；身份摘要全部匹配；账号当前为非 Plus；不输出原文 Session/Cookie。
5. **Checkout**：进入官方 Plus Checkout；确认套餐、币种 PHP、基础价、税费、最终总额；填卡和账单资料后再次读取并等待稳定。记录请求/响应脱敏摘要，不保存完整敏感字段。
6. **付款闸门**：只有第 5 阶段同时得到总额 `₱982.14`、税费 `₱0` 才临时开启唯一付款许可；确认唯一 submit intent，点击一次；若金额、税费或状态未知，禁止点击。
7. **付款后履约**：确认 Provider 返回成功；账号 Plus；取消自动续费；订单成功；卡片 PURCHASE 交易与金额/币种一致；卡余额、手续费和卡台余额变化可对账；Bark 通知内容正确。
8. **收尾与不变量**：订单/attempt/run/task 终态正确；无 ACTIVE/UNKNOWN 资金风险；无活动 permit；无未释放 lease；Profile 客户页面、Session Cookie、storage 清理且运行 Cookie 按 allowlist 保留；Worker/隧道停止；默认路线恢复 API、Browser dispatch 关闭、付款权限关闭。

## 当前现场阻断（已核对）

- 当前最新订单 `PJV1-GodDHJHDQnURKz62CmYU` 是 `WAITING_FOR_CARD` 且路线为 API；不能改作 Browser。
- 生产默认路线为 API，Browser dispatch=false，Browser payment=false；生产 Browser Worker inactive。
- 既有菲律宾官方 UI 证据为 `₱982.14 + ₱117.86 VAT = ₱1,100`，所以 `₱982.14/₱0 tax` 尚未满足付款门槛。
- 后台 `WAITING_FOR_CARD` 取消按钮的代码修复已完成但尚未部署；当前订单如需取消，必须先部署该小修复，或保留它并新建 Browser 测试单。

## 执行原则

不把“未观察到”写成“通过”；每阶段保存脱敏证据并在下一阶段前检查前置条件。任何不确定付款结果均进入锁定/人工核对，不换卡、不重付、不切路线。
