# Browser 充值 MVP 范围冻结（2026-08-26）

## 目标

Browser MVP 不是一个“能点击几下”的脚本，而是能够在**不产生真实付款副作用**的前提下，完整走通一笔订单的控制面、Session、Profile、Checkout 观察、模拟付款、状态回写和故障恢复。

目标闭环：

```text
卡台/运营后台上游投影
→ Session Bootstrap
→ Google Chrome control lane 或本地指纹 Profile
→ Browser Worker claim/lease
→ Checkout 观察
→ 模拟付款结果
→ order/attempt/browser-run/audit 回写
→ Profile 清理与可重放证据
```

## A. MVP 必须完成

### 1. 上游输入合同

- `orderId`、`attemptId`、`browserRunId`、`sessionRef`、`cardRef`、`routeRef`、`cardReadyEvidence`、`auditRef`；
- 卡台卡片必须是 active、就绪、未被其他 attempt 占用；
- 路由必须是启用的 Browser 路线；
- Browser 只读消费投影，不直接持有卡台/Provider 密钥，不直接开卡或补余额；
- 快照带时间和有效期，过期 fail-closed。

### 2. Session Bootstrap

- 接收 opaque Session 引用；
- 支持现有上号器能力作为一种 Cookie 输入/注入实现；
- 域名白名单、Cookie 解析、分块和注入；
- 真实 Session API/UI 身份核对；
- 核对账号 ID/邮箱与订单绑定；
- Session 原文不进队列、普通日志或事件列表。

### 3. Browser Identity Runtime

- Google Chrome 作为 control lane；
- 一个可替换的本地指纹浏览器候选 lane；
- 创建/启动/停止/清理 Profile；
- 每个任务独占 Profile/Context；
- 固定代理、locale、timezone、UA 和 Profile 元数据；
- 失租约、超时或身份不匹配时关闭并清理 Profile；
- 不使用云 Profile、云同步或第三方 Session 托管。

### 4. Worker 控制面

- durable enqueue、claim、lease、heartbeat；
- 幂等键和重复任务拒绝；
- 过期租约恢复；
- 有界重试；
- 人工冻结；
- UNKNOWN 不自动重放，进入 reconcile/manual review。

### 5. Checkout 观察器

- 打开目标站点并校验页面签名；
- 识别国家/地区、币种、套餐、账单摘要；
- 识别付款表单和验证入口是否出现；
- 检查当前账号身份与订单是否一致；
- 记录页面状态、截图/HTML digest/trace 等 artifact 引用；
- 不记录 PAN、CVV、完整 Session 或明文密钥。

### 6. 模拟付款闭环

- `SIMULATED_SUCCESS`；
- `SIMULATED_DECLINED`；
- `SIMULATED_3DS_REQUIRED`；
- `SIMULATED_TIMEOUT`；
- `SIMULATED_UNKNOWN`；
- 所有结果都写入独立的模拟命名空间，不能伪装成真实 Provider 成功。

### 7. 状态、资金和审计关联

- order、attempt、browser run、cardRef、routeRef、sessionRef、artifactRef 全链路关联；
- 记录付款前检查、页面观察、模拟结果和 Profile 清理；
- 扣款、冻结、卡余额、卡台账户余额、Plus 实际消费分栏；
- 运营视图至少能看到队列年龄、租约、Worker、重试次数、最后错误、Checkout 是否创建、付款副作用数、人工处理和 UNKNOWN。

### 8. 故障恢复

- claim 后崩溃；
- Profile 已启动但页面未打开；
- Session 身份不匹配；
- 页面漂移；
- 3DS/验证码等待；
- 模拟结果未知；
- WAL 截断/篡改；
- 恢复只进入 reconcile/manual，不自动重复可能产生副作用的动作。

### 9. 测试和验证

- 合同、队列、租约、WAL、Session、Profile、Checkout observer 单测；
- Google Chrome control lane smoke；
- 指纹浏览器候选 smoke；
- 测试账号/合成 Session 身份核对；
- 模拟成功、拒绝、超时、UNKNOWN；
- 进程崩溃和租约过期恢复；
- 长时间 soak；
- 全程不调用真实付款、开卡、补余额或退款写接口。

## B. 可以一并完成的 MVP+

以下能力不会产生真实付款副作用，建议在核心闭环稳定后顺手完成：

- MySQL 只读 `browser_upstream_ready_projection` 接线；
- 运营后台只读 Browser 任务列表和详情；
- artifact vault 的 retention、索引和下载权限；
- Chrome 与指纹浏览器双 lane 对照报告；
- Profile/Session/代理一致性检查；
- 卡片 readiness 过期提醒和续费观察任务；
- metrics、健康检查、失败告警；
- 一键生成单笔任务的诊断包；
- 运行手册、故障处理手册和审计查询示例；
- route/profile/runtime 可替换适配器，不把某个品牌写死。

## C. 明确不放进本次 MVP

- 真实付款提交；
- 真实客户 Session 实验；
- 卡台开卡、补余额、销卡和退款写接口；
- 自动切换多个 Provider；
- 云 Profile、云同步、第三方 Session 托管；
- CAPTCHA solver、stealth 绕过和风控规避脚本；
- 多机高并发生产调度；
- 生产 Browser 写开关；
- 非 Browser 订单、资金和运营后台共享核心的大范围重构。

## D. 推荐推进顺序

1. 冻结上游 `cardRef/cardReadyEvidence/routeRef` 合同；
2. 接入 Google Chrome control lane；
3. 完成 Session Bootstrap 和账号身份核对；
4. 完成 Checkout 观察和模拟付款闭环；
5. 接入一个本地指纹浏览器候选做对照；
6. 补齐故障恢复、artifact、只读运营视图和 soak；
7. 输出真实付款前的验收报告，单独等待确认。

## 成功标准

在干净环境中，用一笔合成/测试订单，能够从上游投影开始，经过 Session、Profile、Checkout 观察、模拟付款、审计回写、故障恢复和清理，得到可追溯的终态；同时证明 `submitCalls=0`、Provider 写调用为 0、真实付款副作用为 0。

