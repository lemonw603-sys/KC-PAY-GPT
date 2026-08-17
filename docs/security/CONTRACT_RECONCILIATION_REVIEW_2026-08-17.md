# Provider 合同遗漏专项审查

- 日期：2026-08-17
- 范围：`开放API对接文档.md`、直充 Provider、worker、一次性真实 PoC 脚本
- 触发原因：资金测试前错误地把卡台 `minBalanceUsdt=25` 当成候选开卡金额，且未先核对直充文档中的固定 `PH/PHP` 合同

## 结论

未发现已经造成真实资金损失或数据泄露的证据；真实开卡和直充尚未执行。

发现 3 个实现缺口和 1 个流程缺口。其中，一次性 PoC 的孤儿订单恢复问题和错误输出脱敏问题已在真实调用前修复；生产 worker 的维护状态分类、成功后 Token/取消续费闭环仍待修复。

## CR-01 高：PoC 创建成功后未立即持久化恢复标识（已修复）

- 位置：`v1/scripts/provider-poc.js`
- 合同证据：对接文档第 34–35、450–452、1099–1100 行要求创建成功后立即保存 `order_no` 和 `card_key`，再以相同 `card_key` 查询。
- 原实现：`createDirectOrder()` 后直接查询状态，只有整个函数返回时才输出订单号；若查询断线，已创建订单会失去查询凭据。
- 影响：形成无法自动追踪的孤儿订单；人工误以为未创建而重新提交时，可能重复充值。
- 修复：在开卡前、开卡成功、直充创建成功、每次轮询和最终状态后原子写入权限 `0600` 的恢复文件。恢复文件不保存 Session、完整卡号或 CVV。

## CR-02 中：`40305` 维护状态被错误分类为不可重试失败（待修复）

- 位置：`v1/src/providers/zzshu-recharge.js:53`、`v1/src/providers/zzshu-recharge.js:60`、`v1/src/providers/zzshu-recharge.js:65`
- 合同证据：对接文档第 38、963–966 行以及 `docs/contracts/API_BASELINE.md:137` 都要求维护关闭时等待恢复后再下单。
- 当前实现：只有 `42902` 被标为可重试；`40305` 会得到 `retryable=false`、`uncertain=false`。
- 影响：上游维护会把本可恢复订单错误终结为失败，需要人工重建任务；不是重复扣费风险，但会造成可用性和订单状态错误。
- 最小修复：把 HTTP 403 + `40305` 标记为明确的创建前拒绝、可延迟重试；保留原订单和相同业务边界。

## CR-03 中：成功后的最新 Token 和取消续费没有正式闭环（待修复）

- 位置：`v1/src/providers/zzshu-recharge.js:23`、`v1/src/providers/zzshu-recharge.js:78`、`v1/src/workers/workflow-handlers.js:127`、`v1/src/domain/task.js:13`
- 合同证据：对接文档第 51–52、454–455、912–914、1105 行说明成功后旧 accessToken 会失效，状态返回最新 Token，并应读取取消续费状态。
- 当前实现：状态 Schema 不读取 `token`；`normalizeStatus()` 丢弃最新 Token；worker 看到 `success` 后立即完成任务。虽然定义了 `RECHECK_CANCELLATION`，但没有 handler，也不会创建该任务。
- 影响：系统无法证明续费已经取消，也无法用更新后的 Token 做后续核验。不会把 Token 暴露给客户，但运营后台可能把“充值成功”误当成“充值与取消续费均完成”。
- 最小修复：最新 Session 继续加密保存；成功状态与取消续费状态分开记录；成功后创建一次延迟复查任务，直到 `is_subscription_cancelled=1` 或进入人工处理。

## CR-04 低：PoC 错误输出使用较弱的独立脱敏规则（已修复）

- 位置：`v1/scripts/provider-poc.js:50`
- 原实现：自定义正则不完整覆盖 `accessToken`、`sessionToken` 等组合字段。
- 影响：若上游错误消息回显敏感字段，终端可能出现明文片段。
- 修复：复用生产代码的 `redactSensitiveText()` 单一脱敏边界。

## PR-01 流程缺口：文档合同没有成为资金动作前的强制核对项

- 已观察事实：对接文档第 48、454 行明确固定 `PH/PHP`；卡台只读响应又明确 `minAmount=5`、`minBalanceUsdt=25`。本次仍发生了错误推断。
- 根因：实现测试覆盖了请求字段与错误分类，但没有一张逐项、可机检的“文档事实 → 代码位置 → 测试 → 运行证据”矩阵；人工操作也没有在资金动作前重新核对地区、币种、开卡金额和重试边界。
- 影响：不会单独形成远程可利用漏洞，但会把错误业务假设带入真实资金动作。
- 建议：在 `docs/contracts/` 固化合同矩阵；每次真实 Provider 写入前只核对金额、地区/币种、幂等键、错误分类、恢复标识五项，不增加庞大流程。

## 已核对且当前一致

- 直充固定 `orderType=direct`、`planType=plus`。
- 完整 Session 原样提交，含 `user`、`account`、`accessToken`、`sessionToken`、`expires`。
- HTTP 状态与业务 `code` 同时判断。
- `42902` 是创建前容量拒绝，可退避重试。
- `50001`、5xx、超时和断流按不确定处理，不自动重新创建。
- `failed` 延迟约 2.5 秒确认一次。
- 创建成功后的正式 worker 会原子保存 `order_no` 和 `card_key`。
- 状态响应中的卡号、CVV、完整 Session 不进入客户页面或普通 Provider 摘要。

## 已知但不是本次新发现

- 正式 worker 的卡台开卡与卡详情映射仍处于硬锁状态，等待真实响应冻结。
- 退款交易同步、人工确认和余额提取尚在路线图后续阶段。
- 公开上线前的限流代理边界和后台会话撤销问题已在既有安全审查中登记。

以上项目不能因为本次专项审查而被误报为已经完成。
