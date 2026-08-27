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

## 范围修订：收敛为“核心真实付款 MVP”（2026-08-26）

用户决定将 MVP 从“功能较全的非付款扩展版”收敛为：

> 具备核心功能、能完成多次自动化充值全链路，并为后期每天 200–300 单提供基础能力。

### 收敛后的核心范围

只保留以下必须能力：

1. 卡台/运营后台只读上游投影与卡片就绪门槛；
2. Session Bootstrap 与账号身份核对；
3. Google Chrome control lane + 一个本地指纹浏览器候选；
4. 队列、租约、幂等、卡片占用和有限并发；
5. Checkout 观察和真实付款提交；
6. 付款结果、订阅权益和卡台交易的交叉确认；
7. UNKNOWN、重试、只读对账和人工接管；
8. 最小运营追溯：订单、attempt、browser run、cardRef、routeRef、外部交易、扣款金额和错误；
9. 面向 200–300 单/日的基础配置：可调并发、速率限制、背压、任务年龄、失败队列、指标和容量压测。

### 明确后移

- 完整多 Provider 自动切换；
- 多机高可用和跨地域部署；
- 复杂运营后台写操作；
- 全量 artifact 检索和长期归档；
- 大规模 Profile 预热和自动养号；
- 退款、提现、销卡自动化；
- 非必要的 RPA/批量操作功能。

### 真实付款闸门

“包含真实付款”不等于一开始就批量写入。执行顺序必须是：

```text
模拟闭环通过
→ 1 笔真实付款观察
→ 3–5 笔受控连续付款
→ 10 笔小批量稳定性验证
→ 通过后再逐步接近 200–300 单/日
```

每个闸门都要核对卡台余额、卡片余额、外部扣款、订阅权益、重复提交和 UNKNOWN；任何无法解释的资金差异都停止继续提交。真实付款写入将在首次执行前再次单独确认。

### 200–300 单/日的基础估算口径

MVP 不承诺立即达到该产能，只要求架构不把它堵死：

- Worker 无状态，任务状态和租约持久化；
- 并发数、每卡占用、每 Provider/Checkout 速率均可配置；
- 卡台读取使用快照和关键阶段刷新，避免每个页面动作调用卡台；
- 失败和 UNKNOWN 单独进入重试/人工队列；
- 记录每单耗时、成功率、扣款金额、失败类型和 Profile 资源占用；
- 用可重复的压测/回放数据验证调度能力，不用真实卡批量压测。

## 对抗式审查与范围再收敛（2026-08-26）

### 发现的问题

上一版方案把生产化前置条件、未来 200–300 单/日的扩展准备和 MVP 核心能力混在一起，存在以下问题：

- 在尚未证明一单真实 Checkout 能完成前，先做了过多队列、指标、Artifact、后台和容量设计；
- 同时推进 Google Chrome 和指纹浏览器两条运行时，调试面翻倍；
- 把卡台完整资金动作、MySQL、Provider 路由和 Browser 付款一次性接入，容易把“卡片就绪”和“Plus 扣款”混成一个大项目；
- 为未来 200–300 单预留过多架构，短期产出低；
- 过多状态和恢复分支会遮蔽最核心的问题：是否能稳定完成一次付款并确认权益。

### 简化后的核心 MVP

第一阶段只做一条纵向切片：

```text
一张卡台已就绪 Visa 卡
→ 一个测试账号的 Session Bootstrap
→ Google Chrome 独立 Profile
→ 一个 Worker 顺序执行
→ 打开 Checkout 并完成真实付款
→ 回到账户页确认权益
→ 查询卡台扣款/外部交易
→ 保存最小审计结果
```

必须保留但只做最小实现的能力：

1. 卡台只读“已就绪卡”投影；
2. Session 注入和账号身份核对；
3. 一个 Chrome Profile 的创建、启动、停止和清理；
4. 单 Worker 队列、幂等键、卡片独占锁和失败/UNKNOWN 停止；
5. Checkout 提交、订阅权益确认和卡台交易核对；
6. 默认关闭的真实付款开关和人工确认闸门；
7. 一份可追溯的订单/attempt/run/卡片/外部交易记录。

### 明确后移

- 指纹浏览器只做独立兼容性 Spike，不阻塞第一条 Chrome 真实纵向切片；
- 多 Worker 并发只保留一个可配置参数，不先做分布式调度；
- MySQL/运营后台先提供最小适配或 CLI/JSON 报告，不先做完整页面；
- Artifact 只保留截图、URL、页面摘要和失败证据，不先做完整 Vault 产品；
- 200–300 单/日只预留队列字段、并发配置和卡片锁，不做容量承诺和大规模压测；
- 先验证 1 笔，再验证 2–3 笔连续成功，之后再决定是否扩展。

### 重新定义产出

第一阶段的成功不是“做完一套生产平台”，而是拿到以下硬证据：

- 一笔真实付款能完成；
- 账户权益能在页面/接口确认；
- 卡台交易和金额能对上；
- 重复提交被阻止；
- 失败或未知结果不会自动再次扣款；
- Profile 和 Session 能在任务结束后清理；
- 同一流程可以安全地再跑 2–3 笔。

## 再审查：从后期路线前置到 MVP 的必要能力（2026-08-26）

用户指出：后期路线中可能存在一些虽然不适合一开始大规模建设、但没有它们就无法称为“核心充值 MVP”的能力。该判断成立。MVP 不应只验证“点击并扣款”，还必须带上能防止重复扣款、错卡、续费失控和结果无法解释的最小闭环。

### 必须前置到 MVP 的能力

#### 1. 外部副作用幂等与 UNKNOWN 锁定

- 订单/attempt/browser run 的稳定幂等键；
- 提交前的本地 fence；
- 提交后无响应时进入 `UNKNOWN`；
- UNKNOWN 未对账前禁止再次付款；
- 人工结案不能凭空触发第二次提交。

这是 F1/F4 的一部分，但没有它就不能安全地完成第二笔充值。

#### 2. 卡片独占和卡片材料运行时接入

- 一张卡在一个时间只能被一个 attempt 持有；
- Browser 任务必须拿到卡片 ready 证明；
- 付款时需要一个短时 card-material lease/受控填充边界；
- PAN/CVV 不进入队列和普通事件，但不能因为安全边界而省略“付款所需材料如何到达浏览器”的实际实现。

当前 `cardRef` 只读投影还不足以完成真实付款，这个缺口必须在 MVP 明确解决。

#### 3. 付款后权益、扣款和订阅状态三方核对

付款页面成功不是最终成功。MVP 至少要核对：

- 目标账号 Plus 权益；
- 卡台/外部交易及实际扣款金额；
- 本地 attempt 最终状态；
- 订阅续费/取消状态或明确的人工处理状态。

尤其是周期性订阅，必须记录是否仍会自动续费；不能把“本月充值成功”误报成“后续不会继续扣款”。

#### 4. 最小恢复和人工接管

- Worker 崩溃、浏览器关闭、网络超时可恢复；
- 任何可能已付款但结果缺失的情况转 `UNKNOWN/MANUAL_REVIEW`；
- 人工可以查看订单、卡、外部引用和最后错误；
- 恢复动作默认只读，不自动重放付款。

完整运营后台可后移，但这组最小人工接管能力不能后移。

#### 5. 真实上号器/Session 路径可验证

- 实际上号器扩展 lane，或明确批准的等价自动 Session source；
- Session 注入后必须做真实账号身份核对；
- 403、人机验证、身份不匹配要有不同结果；
- 不能只凭 Cookie 已写入就进入付款。

#### 6. 最小停止开关和付款闸门

- 全局 Browser 写开关默认关闭；
- 单订单、单卡和全局三个级别的停止能力；
- 第一次真实付款、连续 2–3 笔验证分阶段放行；
- 任意资金差异自动停止新提交。

### 不需要前置的后期能力

- 多 Provider 自动 fallback；
- 多机高可用和跨地域部署；
- 完整运营后台页面；
- 全量 Artifact Vault 产品化；
- 自动养号、Profile 预热和 CAPTCHA solver；
- 200–300 单/日的容量承诺和真实卡压测；
- 退款、提现、销卡的全自动生命周期（但退款/销卡状态字段和人工入口需要预留）。

### 修订后的 MVP 定义

```text
卡台就绪卡 + 卡片材料 lease
→ 实际上号器/等价 Session Bootstrap
→ Chrome 独立 Profile
→ 账号身份核对
→ Checkout 观察
→ 真实付款（受闸门控制）
→ 权益 + 扣款 + 订阅状态三方核对
→ 幂等/UNKNOWN/人工接管
→ 最小审计、停止和清理
```

这是一条比“打开网页并付款”稍完整、但仍然不包含生产平台建设的核心纵向切片。
